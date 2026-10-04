# 纵深防御与迁移路径

本文档解释 v0.1.5 为什么要做"shell 意图 parser"这一层、为什么仍保留旧 regex、与 hermes-agent 的对照、以及从 v0.1.4 迁到 v0.1.5/v0.1.6 的具体路径。

## 1. 为什么需要纵深防御

`HardBlockGuard` 不是 agent 安全的唯一防线，它只是"第 0 道闸门"。在 kongming-agent 的整体安全栈里，至少有以下层次：

```
   层级               典型组件                   触发时机                     失效后果
   ────────────────────────────────────────────────────────────────────────────────────
   L0 输入归一化      InputNormalizer            每次决策                     绕过格式化攻击
   L1 硬拒绝          HardBlockGuard             所有请求                     立即拦截灾难
   L2 边界判定        BoundaryResolver           非 hard_block                决定默认作用域
   L3 静默放行        TrustResolver              进入 boundary 后             消费 grant
   L4 显式审批        ConsentResolver            未拿到充分信任                人工兜底
   L5 智能审批        SmartApprovalHook (v0.2)   ConsentResolver 内嵌         LLM 二次裁判
   L6 沙箱运行时      sandbox-runtime (v0.2)     工具实际执行点                伤害半径压缩
   L7 审计 / SIEM     observability (v0.2+)      事后                         发现绕过
```

每一层都不应假设别人不出错。v0.1.5 的核心收益恰恰是把 L1 拆成"机制 + 目标"两轴解耦——但这不意味着 L1 完美，反而意味着它和 L4 / L6 之间的协作更清晰：parser 只做"看得懂的部分必须严格"，剩下的交给 ConsentResolver 与未来的 sandbox 兜底。

## 2. 为什么不直接抄 hermes 的扁平 regex

hermes-agent (`other/hermes-agent/tools/approval.py`) 用 60+ 条扁平 `DANGEROUS_PATTERNS` regex，运行良好。是不是抄过来就行了？不是。

### 2.1 hermes 能扁平的前提（kongming 都不满足）

| 前提 | hermes | kongming |
|---|---|---|
| 保护目标固定 | 是（5 个：home / etc / dev / sys / proc） | 否（用户 yaml 可加任意 `notdeltest/` 等） |
| 用户能不能扩展规则 | 否（regex 表写死在源码） | 是（`safety.sensitive_paths` / `safety.hard_deny_commands` 完全开放） |
| 容器化兜底 | 是（`tools/environments/docker.py` 强制 `--cap-drop ALL` 等） | 否（直接在 host 跑 shell） |
| 外置二次裁判 | 是（tirith Rust binary + smart_approve LLM） | 否（v0.1.5 只是接口占位） |
| 文件操作的"大权"层 | 容器 + bind-mount `:ro`，文件系统层强制 | 仅 SafetyGatedApproval，依赖 Python 自己 |

结论：**hermes 是"靠下层兜底，所以上层可以糙"；kongming 上层就是最后一道，必须做精**。

### 2.2 抄什么、不抄什么

抄过来：

- **输入归一化思想** — `_normalize_command_for_detection` 的 ANSI / NFKC / NULL 反混淆值得借鉴，但实现要按 v0.1.5 自己的契约重写，而非直接 import；
- **smart approval 接口形状** — 给 LLM 二次裁判预留位（v0.1.5 只占位，不实装）；
- **整段优先 + segment 兜底** — hermes 在 `_safe_split_command` 里做了类似两层匹配，与 v0.1.4 现状吻合，继续保留；
- **多层防御思路** — hermes 是 regex + tirith + smart approval + container 四层，kongming 是 parser + path 表 + fallback regex + ConsentResolver + (v0.2 sandbox) 五层。

不抄过来：

- 扁平 regex 数量级（hermes 60+ 条静态写死，kongming 用户可任意加 → 必然超过 60，必须 parser 抽象）；
- 直接调用 tirith 二进制（kongming 不允许引入未知执行体作为安全组件）；
- 隐式假设 docker 总是可用（kongming 默认 host 运行，sandbox 是 v0.2 选项）。

## 3. 与 v0.1.4 的迁移路径

### 3.1 三阶段计划

```
v0.1.4 (现状)
   │
   │ Stage A: parser + 机制表 + fallback 共存
   ▼
v0.1.5
   │  - DEFAULT_HARD_DENY_COMMANDS 拆成 DEFAULT_MECHANISM_RULES + DEFAULT_LEGACY_FALLBACK_RULES
   │  - HardBlockGuard 主入口走新流水线，全 miss + UNKNOWN intent 时退回旧 regex
   │  - trace 多打 legacy_regex_fallback=true 字段
   │  - 用户 yaml 零改动
   │
   │ Stage B: parser 扩展 + audit
   ▼
v0.1.5 末（feature complete）
   │  - 第二批 parser verb 全部上线
   │  - audit 脚本运行 N 周，统计仅靠 fallback 命中的 regex 集合
   │  - 把"已被新流水线覆盖"的 regex 标记 deprecated
   │
   │ Stage C: 删表
   ▼
v0.1.6
      - 删除被 audit 证明可删的 legacy regex
      - 重写 _USER_NOTDELTEST_RULES 类型用户文档（10 条 regex → 1 条 SensitivePathRule）
      - DEFAULT_LEGACY_FALLBACK_RULES 仅保留"parser 永远看不懂"的兜底项（如 heredoc / `bash -c "..."` 内嵌）
```

每阶段不允许跳跃：必须先有 audit 数据再删表。

### 3.2 用户 yaml 兼容矩阵

| 场景 | v0.1.4 yaml | v0.1.5 行为 | v0.1.6 推荐写法 |
|---|---|---|---|
| 保护单一目录 `notdeltest/` | 10 条 hard_deny_commands regex | 旧规则继续命中（fallback），同时新写法（1 条 sensitive_paths）也命中 | 删除 10 条 regex，保留 1 条 sensitive_paths |
| 拒绝 mkfs | 1 条 hard_deny_commands regex | 走新机制表（matcher=`VERB:format_disk`） | 自动迁移，无需用户改 yaml |
| 拒绝 fork-bomb | 1 条 hard_deny_commands regex | 走新机制表（matcher=`VERB:fork_bomb`） | 同上 |
| 拒绝 `git reset --hard` 写入 .kongming | 1 条 hard_deny_commands regex | 走 fallback 旧 regex（git 子命令 v0.1.5 parser 不识别） | v0.1.6 加 git 子命令 parser 后迁移 |

兼容承诺：

1. v0.1.4 写过的 yaml **零改动**可继续工作；
2. 新流水线**只可能更严，不会更松**——若新写法漏拦，fallback 兜底；
3. trace `matched_rule` 字段保持稳定（path 表条目 id、机制表条目 id 都是稳定字符串），监控/告警规则不需要改。

## 4. 测试策略变化

### 4.1 v0.1.4 的痛点

`tests/unit/test_safety_hard_block_guard.py` 现状：

- 24 项 parametrize × 10 条 `_USER_NOTDELTEST_RULES` 在测试一个目标的 N 种攻击写法；
- 加保护目标 → 测试翻倍；加攻击向量 → 测试翻倍；
- 维护成本沿"机制 × 目标"二维笛卡尔积爆炸。

### 4.2 v0.1.5 的解耦

测试组织三轴：

| 轴 | 文件 | 测什么 | 增长曲线 |
|---|---|---|---|
| Parser 单测 | `test_safety_shell_intent_parser.py` | 输入字符串 → ShellIntent 列表 | 沿"verb 数量"线性 |
| Policy 单测 | `test_safety_default_rules.py` | DEFAULT_MECHANISM_RULES / SensitivePathRule 配置正确 | 沿"规则条数"线性 |
| Guard 集成测试 | `test_safety_hard_block_guard.py` | parser + 表组合，每个机制选 1~2 个代表性 case | 与代码改动量大致同步 |

具体收益：

- 保护新目标 `notdeltest/`：只需 1 条 sensitive_paths 测试 + 0 条 guard 测试（parser 已被独立测过）；
- 支持新 verb（如 `rsync`）：parser 加 1 case + 1 个 parser 单测；guard 测试不变；
- 修一条 parser bug：只动 parser 单测，guard 集成测试与策略表都不受影响。

期望：v0.1.5 完成后，guard 测试体量从当前的 ~600 行降到 ~250 行，parser 单测达到 ~400 行（独立增长）。

## 5. 攻击面对照表

下表展示同一攻击在 v0.1.4 与 v0.1.5 的处理路径差异，帮助 reviewer 验证 v0.1.5 不漏拦：

| 攻击 | v0.1.4 命中规则 | v0.1.5 命中链路 | 是否 fallback |
|---|---|---|---|
| `rm -rf notdeltest/` | `_USER_NOTDELTEST_RULES[0]` | parser→`Verb.DELETE,target=notdeltest/`→sensitive_paths | 否 |
| `find notdeltest/ -delete` | `_USER_NOTDELTEST_RULES[7]` | parser→`Verb.DELETE,target=notdeltest/`→sensitive_paths | 否 |
| `dd of=notdeltest/file` | `_USER_NOTDELTEST_RULES[5]` | parser→`Verb.WRITE,target=notdeltest/file`→sensitive_paths | 否 |
| `> notdeltest/file` | `_USER_NOTDELTEST_RULES[3]` | parser→`Verb.WRITE,target=notdeltest/file`→sensitive_paths | 否 |
| `mkfs.ext4 /dev/sda` | `mkfs-format` | parser→`Verb.FORMAT_DISK`→DEFAULT_MECHANISM_RULES | 否 |
| `:(){:\|:&};:` | `fork-bomb` | parser 整段命中→`Verb.FORK_BOMB`→DEFAULT_MECHANISM_RULES | 否 |
| `rm --no-preserve-root -rf /a` | `host-root-delete` | parser→`Verb.DELETE,flags={"--no-preserve-root"}`→机制表 | 否 |
| `bash -c "rm -rf /"` | `host-root-delete`（整段 regex） | parser 输出 `Verb.UNKNOWN`→fallback→旧 regex | 是 |
| `$(rm -rf /)` 嵌入 | `host-root-delete`（整段 regex） | parser 输出 `Verb.UNKNOWN`→fallback→旧 regex | 是 |
| `awk 'BEGIN{system("rm /a")}'` | 当前未拦 | 当前仍未拦（parser 不解 awk）→ 进 ConsentResolver | — |

最后一行说明：v0.1.5 不假装解决 awk / python 内嵌等"语言宿主代理"问题，那是 sandbox 层的事。

## 6. 风险与开放问题

| 风险 | 说明 | 缓解 |
|---|---|---|
| parser 漏 case | 比如忘了识别某种 rsync 形式 | fallback 兜底 + audit 数据驱动新增 case |
| fallback 永久开启 | 用户从不升级，旧 regex 永远活着 | 每年发版 release note 标 deprecated；audit 报告做关键决策 |
| 用户在 yaml 加新机制 | 框架不允许，但用户可能"绕路"用 hard_deny_commands 写一条 regex | 文档显式说明"新机制必须开 issue 升 parser"，yaml 不接受 verb 注册 |
| 与 v0.1.4 GrantStore 交互 | hard_block 在 GrantStore 之前，理论无影响 | 在 SafetyDecisionEngine 装配测试中加交叉用例验证 |
| LLM smart approval 副作用 | 未来 v0.2 落 LLM 后可能误放 hard_block | 协议文里写死 hook 不可覆盖 hard_block，配 fail-closed 演练 |

## 7. Hermes 对照（详版）

| 维度 | Hermes 设计 | kongming v0.1.5 设计 | 启示 |
|---|---|---|---|
| 文件路径保护 | `DANGEROUS_PATH_PATTERNS` 5 个固定路径 | 用户开放 + 默认 17 条 | 用户扩展性 → 必须 parser |
| 命令 regex | 60+ 条静态 | 11 条 mechanism + 用户开放 | 表分层 |
| 引号处理 | `_normalize_command_for_detection` | InputNormalizer | 直接借鉴思路 |
| ANSI 反混淆 | 内置 | InputNormalizer | 直接借鉴 |
| Smart approval | LLM 同步调用，可放可拒 | hook only（v0.2 接 LLM）；只能加严 | 限制权力面 |
| Sandbox 后端 | docker / singularity / modal / daytona 全栈 | v0.2 单独项目，v0.1.5 不涉及 | 解耦时间 |
| 容器加固 | `--cap-drop ALL` / `no-new-privileges` / pids-limit / tmpfs nosuid,noexec | 不在 v0.1.5 范围 | 借鉴 v0.2 sandbox |
| Bind-mount 安全 | 默认 `:ro`，凭据挂载强 ro | host 直跑无此问题 | 借鉴 v0.2 sandbox |

总结：**hermes 是"沙箱 + 简单 regex"的组合拳；kongming 因为短期不要求 sandbox，必须把 regex 替换成更稳的 parser**。两条路径不冲突，v0.2 落 sandbox 后 kongming 就同时拥有"严谨 parser + 沙箱降伤害"双层。

## 8. 决策清单（给评审用）

需要确认的关键决定：

1. **不引入新 op 字段**：`SensitivePathRule.ops` 仍是 `read|write` 二元，`Verb.DELETE` 归一到 `write`。✅
2. **机制表与旧 regex 表共存**：v0.1.5 不删旧表，仅搬迁 + 标记 deprecated。✅
3. **parser 闭合白名单**：用户 yaml 不能注册 verb。✅
4. **fail-safe 等价于 deny**：流水线异常一律拒绝，不 silent allow。✅
5. **SmartApprovalHook 仅占位**：v0.1.5 不接 LLM。✅
6. **测试三轴解耦**：parser 单测 / policy 单测 / guard 集成测试拆三个文件。✅

如有反对，请在 [README.md § 模块导航](./README.md) 标记的"方案待评审"模块下留 issue。
