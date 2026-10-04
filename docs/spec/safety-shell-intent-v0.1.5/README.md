# Safety Shell-Intent v0.1.5

> 状态：方案待评审
> 目标：把 `HardBlockGuard` 的 shell 命令匹配从"机制 × 目标"笛卡尔积重构为"机制 × 目标"两轴解耦，让保护新目标只需 1 条规则、新增机制只需 1 个 parser case。

## 系统目标

v0.1.4 的 `HardBlockGuard` 已经能区分路径与命令两条匹配通路，但 **shell 命令通路仍把"shell 词法"和"安全策略"压扁在一条 regex 里**。直接后果是：

- 用户每加一个保护目标（例如"也别动我项目里的 `notdeltest/`"），就要为现有的每种 shell 写法（rm / rmdir / mv / `>` / tee / cp / sed -i / dd of= / truncate / find -delete）各写一条 regex，10+ 条起步；
- 框架每发现一种新攻击向量（rsync 覆盖、install 进系统目录、引号绕过、管道接收方），就要给所有已注册保护目标各补一条 regex；
- 测试沿"机制 × 目标"两个维度笛卡尔积增长（参考 `tests/unit/test_safety_hard_block_guard.py` §6 的 24 项 parametrize 与 10 条 `_USER_NOTDELTEST_RULES`）；
- 同一个安全意图（"保护此路径不被破坏"）在 `_match_path` 与 `_match_command` 两套表里被翻译两次，路径写得对但 shell 漏一个机制就破防。

v0.1.5 引入 **ShellIntentParser** 层，把 shell 字符串翻译成结构化 `ShellIntent(verb, target, flags)`，然后让有 `target` 的意图复用 v0.1.4 的 `SensitivePathRule` 表，让无 `target` 的纯机制（mkfs / fork-bomb / pipe-to-shell / --no-preserve-root）落到独立、固定的 `MechanismRule` 表。这一拆解的本质是把 Linux 内核 VFS 的"主体-动作-客体"三元组搬到 shell 文本层。

核心目标：

- 让用户加一个 shell 保护目标只需写 1 条 `SensitivePathRule`，自动覆盖所有已支持的 shell 写法；
- 让框架升级一种 shell 写法（如 rsync）只需在 parser 加一个 case，所有已注册保护目标自动覆盖；
- 把 v0.1.4 的 `DEFAULT_HARD_DENY_COMMANDS` 表瘦身为"纯机制规则"（< 15 条），不再混入"机制 × 目标"组合；
- 提供 `InputNormalizer`，吸收 Hermes `tools/approval.py` 的 ANSI / NFKC / NULL 反混淆预处理；
- 与 v0.1.4 全兼容：旧规则表保留为 fallback，用户已写的 yaml 配置零改动可继续工作；
- 对外仍只暴露 `core.contracts.ApprovalProvider` 协议面，不改 `tools/` / `host/` / `cli/` 接线。

## 范围边界

**包含**：

- `ShellIntentParser`：从 shell segment 解析出 `ShellIntent` 列表；白名单 ~15 个常用 verb；解析失败保守回退。
- `MechanismRule`：从 `DEFAULT_HARD_DENY_COMMANDS` 析出"纯机制"规则（mkfs / fork-bomb / pipe-to-shell / --no-preserve-root / fdisk / chmod-zero-/）。
- `SensitivePathRule` 复用：保留 v0.1.4 schema，**不引入新 op 字段**；shell 的 delete / move / redirect / overwrite 全部归一到 `write` op。
- `HardBlockGuard` 主入口重构：先归一化 → 解析 → 走 path 表或 mechanism 表 → 全部 miss 才退回 v0.1.4 旧 regex。
- `InputNormalizer`：ANSI 转义剥离、NFKC unicode 归一化、NULL 字节剥离、引号字符替换（保留 v0.1.4 的 `_strip_quote_chars` 行为）。
- `SmartApprovalHook`（hook only）：在 ConsentResolver 边上预留 LLM 二次裁判接口，不引入实际 LLM 调用，仅为 v0.2 留位。
- 测试组织重构：parser 单测、policy 单测、guard 集成测试三轴解耦。

**不包含**：

- Sandbox / Docker 执行后端（属于 v0.2 `safety-sandbox-runtime`）。
- 实际 LLM 智能审批调用（属于 v0.2，本期只留 hook）。
- 完整 shell 语法解析（变量展开、命令替换、heredoc 体内、alias / function）：parser 检测到这些结构时把对应 segment 标记为 `unknown`，policy 层保守处理。
- 多 agent / 多用户的安全模型。
- 远端审计、SIEM、集中式策略下发。
- BoundaryResolver / ConsentResolver / TrustResolver / GrantStore 的协议变更（v0.1.4 已落或待落）。

## 架构原则

- **机制与目标解耦**：增长复杂度从 O(N×M) 降到 O(N+M)。
- **fail-safe 分层**：parser 失败 → 旧 regex fallback；旧 regex miss → 通过；任何一层异常 → 拒绝并打 trace。
- **零用户配置惊讶**：v0.1.4 写过的 yaml `safety.hard_deny_commands` 与 `safety.sensitive_paths` 不需任何修改，行为更严格但不更松。
- **parser 是框架封闭白名单**：用户不能注册新 verb；要保护新路径 → 加 `SensitivePathRule`；要拦新攻击 verb → 提 issue 升级 parser。
- **hard_block 来源恒为 intrinsic**：不允许 grant / session approval 覆盖；与 v0.1.4 一致。
- **决策顺序固定**：`InputNormalizer → ShellIntentParser → SensitivePathRule(path-target intents) → MechanismRule(non-target intents) → legacy regex fallback`。
- **trace 字段保持兼容**：`decision_class=hard_block` / `decision_source=intrinsic` / `matched_rule=...` / `boundary_kind=host` 不变，新增可选字段 `intent_verb` / `intent_target` 用于复盘。
- **整段匹配仍保留**：v0.1.4 `_match_command` 的"先整段后 segment"两层匹配在 fallback 路径里保留，防 `:(){:|:&};:` 这种被 segment 切坏的特殊字符串失灵。

## 关键收益（与 v0.1.4 直接对比）

| 维度 | v0.1.4 现状 | v0.1.5 重构后 |
|---|---|---|
| 保护一个新目标（如 `notdeltest/`） | 写 ~10 条 regex（每种 shell 机制各一条）+ ~24 个 parametrize 测试 | 写 1 条 `SensitivePathRule` + 0 个新测试（parser 单测已覆盖机制） |
| 支持一种新 shell 机制（如 `rsync`） | 给每个已注册目标各加 1 条 regex（N 条） | parser 加 1 个 case + 1 个 parser 单测 |
| 修一条 regex 太宽的 false positive | 改对应 regex，可能影响其他机制；需要重测笛卡尔积一格 | 改 parser 的 verb case；策略表完全不动 |
| 同一目标在 `write_file` 与 `run_shell` 之间 | 两套表，容易漂移（path 表写了 ssh，shell 表漏写 rm ~/.ssh） | 共享 `SensitivePathRule`，物理上不可能漂移 |
| `_USER_NOTDELTEST_RULES` 体量 | 10 条 user regex + 24 项 parametrize | 1 条 user path rule + 复用现有 parser 测试 |
| 测试增长曲线 | 沿"机制 × 目标"二维笛卡尔积爆炸 | 沿机制（parser）与目标（policy）两条独立曲线增长 |

## 与 v0.1.4 的关系

- **非破坏性增强**：v0.1.5 不替换 v0.1.4 的任何模块，只在 `HardBlockGuard.evaluate` 的 shell 通路上插入 parser 层。
- **共存策略**：`DEFAULT_HARD_DENY_COMMANDS` 中"纯机制"规则被搬到新表，"机制 × 目标"组合规则被标记 deprecated 并在解析失败时作为 fallback 触发；用户 yaml 的 `hard_deny_commands` 仍按 v0.1.4 语义工作。
- **迁移计划**：v0.1.5 完成后，v0.1.6 / v0.2 才考虑删除被 fallback 覆盖的旧 regex 项；此期间 fallback 命中会写一条 `legacy_regex_fallback=true` 的 trace，便于后续清理。

详情见 [05-defense-in-depth.md § 与 v0.1.4 的迁移路径](./05-defense-in-depth.md)。

## Hermes 启示与差异

v0.1.5 的设计参考过 hermes-agent 的 safety 实现（`other/hermes-agent/tools/approval.py` + `tools/tirith_security.py` + `tools/environments/docker.py`），关键结论：

- **抄过来的**：输入归一化（ANSI / NFKC / NULL），smart-approval hook，多层防御思路。
- **没抄的**：hermes 用 60+ 条扁平 regex 也没爆炸，是因为它**保护目标固定（5 个）+ 用户不能扩展**，且**容器化兜底**。我们的 yaml 开放扩展 + host 直执行，必须做 parser 抽象。
- **启发**：parser 不需要做到 100% 完美——后续层（smart approval、未来的 sandbox runtime）会兜底。这降低了 parser 的工程门槛。

详情见 [05-defense-in-depth.md § Hermes 对照](./05-defense-in-depth.md)。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| InputNormalizer | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-1inputnormalizer) | 是 | ANSI / NFKC / NULL 反混淆 |
| ShellIntentParser | 方案待评审 | [模块拆分](./02-module-breakdown.md#模块-2shellintentparser) | 是 | 核心抽象层 |
| MechanismRule 表 | 方案待评审 | [模块拆分](./02-module-breakdown.md#模块-3mechanismrule-表) | 是 | 从 v0.1.4 表析出"纯机制"规则 |
| HardBlockGuard 重构 | 方案待评审 | [模块拆分](./02-module-breakdown.md#模块-4hardblockguard-重构) | 是 | 主入口接入 parser |
| Legacy Regex Fallback | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-5legacy-regex-fallback) | 否 | 与上一项合并实现 |
| SmartApprovalHook | 探索中 | [模块拆分](./02-module-breakdown.md#模块-6smartapprovalhook) | 否 | v0.2 才落 |

## 文档导航

- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)
- [纵深防御与迁移路径](./05-defense-in-depth.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 先评审 [04-data-and-state.md](./04-data-and-state.md) 确认 `ShellIntent` 与 `MechanismRule` 的数据形态——这是后续所有实现的契约面。
2. 第一批落 `InputNormalizer + ShellIntentParser`（白名单 5 个最常见 verb：rm / `>` / cp / mv / dd of=），跑通最小闭环。
3. 第二批落 `HardBlockGuard 重构 + MechanismRule 析出 + Legacy Regex Fallback`，建立完整决策链。
4. 第三批扩展 parser 剩余 verb（tee / sed-i / install / rsync / truncate / find-delete / chmod / chown）；同步把对应的 v0.1.4 老 regex 标记为 deprecated。
5. SmartApprovalHook 在 v0.1.5 内只落"接口形状"，不接 LLM；v0.2 配合 sandbox runtime 一起落地。
