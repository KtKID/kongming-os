# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|---|---|---|---|---|
| InputNormalizer | ANSI / NFKC / NULL 反混淆预处理 | 无 | 方案确认 | 借鉴 Hermes `_normalize_command_for_detection` |
| ShellIntentParser | 把 shell 段翻译成 `ShellIntent(verb, target, flags)` 列表 | InputNormalizer | 方案待评审 | 闭合 verb 白名单，本期 5+8 个 case |
| MechanismRule 表 | 从 v0.1.4 析出"纯机制"硬拒规则（不带 target） | 无 | 方案待评审 | 复用 `HardDenyCommand` schema，新增 `match_mode="intent_verb"` |
| HardBlockGuard 重构 | 主入口接入 parser，先意图匹配后 fallback | 上述全部 | 方案待评审 | `_match_command` 重写 |
| Legacy Regex Fallback | 旧 regex 表保留为兜底通路 | HardBlockGuard | 方案确认 | parser miss 时触发，写 trace 标记 |
| SmartApprovalHook | 给 ConsentResolver 预留 LLM 二次裁判接口 | ConsentResolver | 探索中 | v0.1.5 只落接口，不接 LLM |

## 模块详情

### 模块 1：InputNormalizer

**职责**：把可能被 ANSI 转义、unicode 全角字符、NULL 字节、奇异引号污染的 shell 字符串收敛成可被 parser 与 regex 稳定匹配的"干净文本"。

**主要消费的规则表**：无。本模块不读规则表，只做文本变换。

**包含范围**：

- ANSI 转义剥离：去掉 `\x1b\[[0-9;]*m` 等 SGR / OSC 序列；
- unicode NFKC 归一化：把 `ｒｍ ‐ｒｆ` 全角写法折成 `rm -rf`；
- NULL 字节剥离：去掉 `\x00`，避免 `r\x00m -rf /` 这种 segment-split 绕过；
- 引号字符替换：保留 v0.1.4 `_strip_quote_chars` 的行为，把弯引号 / 反引号统一成 `"`/`'`；
- 行尾 `\r` 折叠为换行；连续空白压成单空格。

**不包含范围**：

- 不展开变量、不展开 `$(...)` / `` `cmd` `` 命令替换（属于 parser 的 `unknown` 兜底）；
- 不解 alias / function（非确定性，留 fallback）；
- 不做 ASCII 大小写折叠（`RM` 与 `rm` 故意保留差异，部分系统 case-sensitive）。

**依赖**：无。

**风险与讨论点**：

- NFKC 会把 `ﬁ` 折成 `fi`，对 shell 命令影响极小但需在 trace 里同时保留 raw 与 normalized 两份字符串，便于复盘；
- 必须保证 idempotent：`normalize(normalize(x)) == normalize(x)`，否则上下游调用方需关心调用次数；
- 性能：每次决策都会调一次，要求纯 Python、无系统调用、< 50µs / KB。

**task 建议**：

- 建议 task 名：`safety-input-normalize`
- 是否进入 x-req：是
- 原因：纯函数、可独立测、被多处复用，先落最稳。

### 模块 2：ShellIntentParser

**职责**：把一段 shell 字符串拆分成 segment 后，对每个 segment 输出 `list[ShellIntent]`；意图无法识别时输出 `Verb.UNKNOWN` 占位，由策略层保守处理。

**主要消费的规则表**：无。parser 不读策略，只做"verb → target/flags"的语法映射。

**包含范围**：

- segment 切分复用 v0.1.4 `_split_shell_segments`（按 `;` / `&&` / `||` / `|`，保留引号体）；
- 闭合 verb 白名单（v0.1.5 第一批 5 个 + 第二批 8 个）：

| 批次 | verb | 触发模式 | 输出 ShellIntent |
|---|---|---|---|
| 一 | `rm` / `rmdir` | 头 token 是 `rm`，target = 各非 flag 位置参数 | `Verb.DELETE, target=path, flags=set("-r","-f",...)` |
| 一 | `>` / `>>` | 检测到重定向算子 | `Verb.WRITE, target=右侧 path` |
| 一 | `cp` / `mv` | 头 token 是 `cp`/`mv`，target = 最后一个位置参数（覆盖目的地） | `Verb.WRITE, target=dst` |
| 一 | `dd` | 解析 `of=PATH` 显式 kwarg | `Verb.WRITE, target=PATH` |
| 二 | `tee` | `tee FILE` / `tee -a FILE` | `Verb.WRITE, target=FILE` |
| 二 | `sed -i` | 检测 `-i` flag | `Verb.WRITE, target=最后位置参数` |
| 二 | `truncate` | 头 token 是 `truncate` | `Verb.WRITE, target=最后位置参数` |
| 二 | `find ... -delete` | 检测 `-delete` action | `Verb.DELETE, target=find 起点路径` |
| 二 | `install` | 头 token 是 `install` | `Verb.WRITE, target=最后位置参数` |
| 二 | `rsync` | 头 token 是 `rsync` | `Verb.WRITE, target=最后位置参数` |
| 二 | `chmod` / `chown` | 头 token 是 `chmod`/`chown` | `Verb.CHMOD_ZERO, target=path`（仅当 mode=`000` / 递归到 `/`） |
| 二 | `mkfs.*` | 头 token 匹配 `mkfs\..+` | `Verb.FORMAT_DISK, target=最后位置参数` |
| 二 | `:(){:\|:&};:` 整段 | 整段 regex 匹配 | `Verb.FORK_BOMB, target=None` |
| 二 | `--no-preserve-root` flag | 任意命令带此 flag | 在原 verb 上叠加 `flags |= {"--no-preserve-root"}` |

- target 解析：相对路径不在 parser 内做 expanduser / resolve（保留为字符串），策略层在匹配规则前再统一解析；
- 解析失败 / 命中 alias / 命中 `$()` / heredoc 体内 → emit `ShellIntent(verb=UNKNOWN, target=None, flags=set())`，segment 原文挂在 `flags["raw"]` 用于 fallback。

**不包含范围**：

- 不识别用户自定义 verb（用户加新机制必须改 parser，不能在 yaml 里"教"框架）；
- 不解析 git / docker / kubectl 等子命令家族（属于 v0.1.6+ approval-required 表，非 hard-block）；
- 不识别 `python -c "import os; os.remove(...)"` 这类被语言宿主代理的删除（兜底交给 ConsentResolver + path 表）。

**依赖**：InputNormalizer。

**风险与讨论点**：

- verb 白名单会持续生长，但每条新增都对应一个具体攻击面，比"加一条 regex × 全部目标"低一个数量级；
- 解析失败必须是 fail-safe 的：UNKNOWN 不视作"放行"，而是触发 fallback 分支；
- 重定向 `>` 在 `echo bad > /etc/passwd` 这类组合中要正确把 `target` 归到右侧，而不是左侧动词；
- bash 的 `2>&1` / `&>` 要识别但不报警（fd 重定向不写文件目标）。

**task 建议**：

- 建议 task 名：`safety-shell-intent-parser`
- 是否进入 x-req：是
- 原因：核心抽象层，决定 v0.1.5 重构成败；纯函数 + 大量参数化测试，可独立 PR。

### 模块 3：MechanismRule 表

**职责**：承载"无 target 也要立即拒绝"的纯机制规则——这些场景跟具体路径无关，只看动作本身（如 mkfs、fork-bomb、`--no-preserve-root`）。

**主要消费的规则表**：`DEFAULT_MECHANISM_RULES`（v0.1.5 新建于 `default_rules.py`）。

**包含范围**：

从 v0.1.4 `DEFAULT_HARD_DENY_COMMANDS` 析出的纯机制项，搬迁到新表，统一以 `match_mode="intent_verb"` + matcher `"VERB:<name>"` 表达：

| rule_id | matcher | 含义 |
|---|---|---|
| `mechanism-mkfs-format` | `VERB:format_disk` | `mkfs.*` / `mke2fs` 等格式化任意目标 |
| `mechanism-fork-bomb` | `VERB:fork_bomb` | `:(){:\|:&};:` 整段 |
| `mechanism-no-preserve-root` | `flag:--no-preserve-root` | 任意命令带此 flag（提权擦根） |
| `mechanism-raw-disk-write` | `VERB:write` + `target=/dev/sd*` | 原始磁盘块写入 |
| `mechanism-pipe-to-shell-from-net` | `pattern:curl_pipe_sh` | `curl ... \| sh` / `wget -O- ... \| bash`，无 target 但模式固定 |
| `mechanism-fdisk-destructive` | head_token=`fdisk` + flag in `{-w}` | 直接覆盖分区表 |
| `mechanism-chmod-recursive-zero-root` | `VERB:chmod_zero` + `target=/` | `chmod -R 000 /` 等同于 fork-bomb 级灾难 |

**不包含范围**：

- "机制 × 目标"组合规则（如"删 `notdeltest/`"）：这类规则**不进** MechanismRule，而是变成一条 `SensitivePathRule`，由 parser 把 shell delete/write 归一后命中；
- 用户自定义机制：不开放给 yaml；用户只能加 `sensitive_paths` 与 `approval_required_commands`。

**依赖**：v0.1.4 `HardDenyCommand` schema（仅扩 `match_mode` 枚举值）。

**风险与讨论点**：

- 表大小要严格控制在 < 15 条，超过说明设计漂移（很可能某条该归到 `SensitivePathRule`）；
- `mechanism-pipe-to-shell-from-net` 实际是模式而非 verb，临时用专用 matcher，等 parser 增加 `pipe_to_interpreter` verb 后再迁移。

**task 建议**：

- 建议 task 名：`safety-mechanism-rule-split`
- 是否进入 x-req：是
- 原因：表内容稳定，重构动作小，可在 parser 落地后立即进表。

### 模块 4：HardBlockGuard 重构

**职责**：把 v0.1.4 的 `_match_command` 单层 regex 替换成"normalize → parse → 走 path 表 / 机制表 → fallback 旧 regex"四级流水线，对外保持 `evaluate(request) -> ApprovalDecision | None` 协议不变。

**主要消费的规则表**：`DEFAULT_MECHANISM_RULES`、`SensitivePathRule(effect=block)`、`DEFAULT_LEGACY_FALLBACK_RULES`、用户 yaml 的 `safety.hard_deny_commands` / `safety.sensitive_paths`。

**包含范围**：

- 新流水线主函数 `_match_command_v015(self, command_segment) -> Match | None`：
  1. `normalized = InputNormalizer.normalize(raw)`；
  2. `intents = ShellIntentParser.parse(normalized)`；
  3. for each intent with `target is not None`：用 v0.1.4 现有的 `_match_path` 套到 `intent.target` 上，命中 `effect=block` 的 `SensitivePathRule` 即返回拒绝；
  4. for each intent with `verb in MECHANISM_VERBS`：查 `DEFAULT_MECHANISM_RULES` 命中即返回拒绝；
  5. 全部 miss 且至少有一条 `Verb.UNKNOWN` → 进入 fallback；
  6. fallback 调用 v0.1.4 旧 `_match_command_legacy`，命中则返回拒绝并在 trace 写 `legacy_regex_fallback=true`；
- 主入口 `evaluate(request)` 保持不变，仅在内部把 `_match_command(...)` 调用换成 `_match_command_v015(...)`；
- 整段 regex（如 `:(){:|:&};:`）的"先整段后 segment"两层匹配挪到 fallback 分支保留——避免被 segment 切坏的特殊串失灵。

**不包含范围**：

- 不改 `_match_path` 行为（路径侧 v0.1.4 已稳定）；
- 不改 `evaluate` 对外签名（CLI / tools / safety chain 不感知重构）；
- 不引入新的 trace key 名，仅追加可选字段。

**依赖**：InputNormalizer / ShellIntentParser / MechanismRule 表 / Legacy Regex Fallback。

**风险与讨论点**：

- v0.1.4 的 `_match_command` 内部代码会被替换，但旧实现保留为 `_match_command_legacy` 私有方法，作为 fallback 分支调用方；
- 重构必须分两个 PR：先加 `_match_command_v015` 与开关位（默认开），保留旧路径供回退；下一版再删 `_match_command_legacy`；
- 出错路径必须 fail-safe：parser 抛任何异常 → `evaluate` 返回 `ApprovalDecision.deny(reason="parser_failure")`，不允许 silent allow。

**task 建议**：

- 建议 task 名：`safety-hardblock-intent-integration`
- 是否进入 x-req：是
- 原因：装配核心，必须在 parser + 机制表落定后才能合入；测试口径完整（决策类、决策源、trace 字段全过）。

### 模块 5：Legacy Regex Fallback

**职责**：在 parser 输出 UNKNOWN 或全部 miss 时复用 v0.1.4 完整 regex 表，保证零回退风险。

**主要消费的规则表**：`DEFAULT_LEGACY_FALLBACK_RULES`（即原 `DEFAULT_HARD_DENY_COMMANDS` 中"机制 × 目标"组合项的全集）+ 用户 yaml 内尚未迁移的 `hard_deny_commands` 条目。

**包含范围**：

- 把 v0.1.4 的 `_match_command` 改名为 `_match_command_legacy`，**不动其内部逻辑**；
- fallback 命中时在 `ApprovalDecision.metadata` 写 `legacy_regex_fallback=true` 与原 `matched_rule`；
- 提供工具脚本 `scripts/safety_legacy_audit.py`（v0.1.5 第二批落）：扫 trace 文件，列出过去 N 天里仅靠 fallback 命中的规则，便于后续删表。

**不包含范围**：

- 不在 fallback 内做新规则匹配——它只是历史兼容层；
- 不试图在 fallback 命中后再回头跑 parser（避免 mutual recursion）。

**依赖**：HardBlockGuard 重构（被它调用）。

**风险与讨论点**：

- fallback 是兼容层但不能"温水煮青蛙"：必须有清退路径，否则 v0.1.5 的收益会被永久 fallback 抵消；
- audit 工具产出的 deprecation 列表是 v0.1.6 删表的输入。

**task 建议**：

- 建议 task 名：与 `safety-hardblock-intent-integration` 合并实现
- 是否进入 x-req：否
- 原因：是 HardBlockGuard 重构的子分支，单独拆 task 反而引入额外集成成本。

### 模块 6：SmartApprovalHook

**职责**：在 `ConsentResolver` 给出 `standard ask` 之前，预留一个可选的 LLM 二次裁判调用点；v0.1.5 只落接口形状，不接真实 LLM。

**主要消费的规则表**：无。hook 不读规则，只读 `ApprovalRequest` 与候选 `ApprovalDecision`。

**包含范围**：

- 协议定义（建议放 `core.contracts`）：

  ```python
  class SmartApprovalHook(Protocol):
      async def review(
          self, request: ApprovalRequest, tentative: ApprovalDecision
      ) -> ApprovalDecision | None: ...
  ```

- `ConsentResolver` 在内部持 `Optional[SmartApprovalHook]`，None 时直接走原路径；
- v0.1.5 只提供 `_NoopSmartApproval`（永远返回 None）和 `_DenyAllSmartApproval`（用于演练 fail-closed），无真实 LLM 调用。

**不包含范围**：

- 不实现 LLM 调用（Hermes 的 `_smart_approve` 是 v0.2 `safety-smart-approval` 范围）；
- 不让 hook 覆盖 `hard_block`（只能介入 `explicit_consent`）；
- 不引入新的 trace 顶层字段，hook 输出走 metadata。

**依赖**：v0.1.4 ConsentResolver。

**风险与讨论点**：

- 协议必须 async，否则未来接 LLM 时要破坏性改签名；
- hook 只能"加严"不能"放宽"——如果 hook 想 `silent_allow` 一个本应 `ask` 的请求，必须强制走 ConsentResolver 标准路径，避免 LLM 越权；
- 在 v0.1.5 落地时仅留 0~3 行接口代码，避免 over-engineer。

**task 建议**：

- 建议 task 名：`safety-smart-approval-hook`
- 是否进入 x-req：否
- 原因：v0.1.5 内只是"接口形状"占位；真正落 LLM 是 v0.2，那一期再升级到 x-req。

## 模块依赖图

```
            ┌───────────────────┐
            │ InputNormalizer   │  纯函数
            └─────────┬─────────┘
                      │
                      ▼
            ┌───────────────────┐
            │ ShellIntentParser │  闭合白名单
            └─────────┬─────────┘
                      │ List[ShellIntent]
                      ▼
        ┌──────────────────────────┐
        │ HardBlockGuard 重构       │
        │  ├─ SensitivePathRule 匹配│ ← v0.1.4 path 表
        │  ├─ MechanismRule 匹配    │ ← v0.1.5 新机制表
        │  └─ Legacy Regex Fallback │ ← v0.1.4 旧 regex 兜底
        └──────────┬───────────────┘
                   │
                   ▼
            ┌───────────────────┐
            │ ConsentResolver   │ ← v0.1.4
            │   └─ SmartApprovalHook?  v0.1.5 只占位
            └───────────────────┘
```
