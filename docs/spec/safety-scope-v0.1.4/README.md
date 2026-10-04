# Safety Scope v0.1.4

> 维护说明（2026-07-13）：本 spec 继续作为 HardBlock、Boundary、Destructive、Trust 与 Consent 规则语义来源；主 Agent、子 Agent和定时任务的统一组合顺序与 provider 单入口由 `repo:docs/spec/safety-approval-single-entry-v0.1/` 管理。

> 状态：方案确认中
> 目标：把 agent 的文件/命令审批从“问 / 不问”收敛成基于边界、审批强度、信任证据的 3 段式决策模型，让默认路径顺手、危险路径清晰、授权可沉淀。

## 系统目标

v0.1.3 的 `SafetyGatedApproval` 只表达 capability → permission → approval 三段链，对外语义仍接近“问 / 不问”。这在三个方向上不够稳定：

- **边界不清**：默认哪些路径可以静默写，哪些路径必须拦，文档和实现都容易漂移；
- **敏感读取缺位**：凭据类路径的读取价值很高，单靠“写入禁止”不足以抵御 prompt injection；
- **信任来源分散**：会话批准、配置静默、默认作用域本质上都是“已有信任证据”，继续拆层会增加理解成本。

v0.1.4 改为 3 段式模型：

- **HardBlock**：绝对禁止的路径、命令、自我提权目标，直接拒绝；
- **ExplicitConsent**：越界写、敏感读、不可逆动作进入人工审批，分 `standard` / `elevated` 两档；
- **SilentAllow**：存在充分信任证据时静默放行，证据来源统一为 `intrinsic` / `session` / `config`。

核心目标：

- 把“默认可做什么”表达成清晰的 `BoundaryResolver`；
- 把“哪些命令直接拒绝”落成显式 `hard_deny_commands` 表；
- 把“哪些动作必须审批”落成显式 `approval_required_commands` 表；
- 把“哪些路径要按 read/write 分开处理”落成显式 `sensitive_paths` 表；
- 把“问过以后如何沉淀”表达成可追溯的 `GrantStore`；
- 对外仍只暴露 `ApprovalProvider` 协议面，不改 `tools/` / `host/` / `cli/` 接线。

## 范围边界

**包含**：

- `HardBlockGuard`：路径/命令硬拒绝，含 secrets、系统破坏、全局配置、自我提权目标。
- `BoundaryResolver`：按请求判定 `trusted zone` / `approval zone` / `blocked zone`。
- `ConsentResolver`：统一处理 `standard ask` / `elevated ask`。
- `TrustResolver`：统一消费三类信任证据：
  - `intrinsic`：tracked 文件、明确的工作目录
  - `session`：本会话已批准的 grant
  - `config`：配置显式允许的 grant
- `GrantStore`：承载 session grant 与 config grant 的读写与匹配。
- `DecisionTrace`：记录 `decision_class`、`decision_source`、`matched_rule`、`reason`。
- `ConfigSelfProtection`：把 `.kongming/config*`、`.kongming/safety/`、`AGENTS.md`、`CLAUDE.md`、`pyproject.toml [tool.kongming.safety]` 纳入高强度审批。

**不包含**：

- 多 agent 之间的信任传播与授权继承。
- 远端审计、SIEM、集中式策略下发。
- 网络域名级白名单策略引擎。
- 沙箱 / 容器 runtime 的实现本身。
- 基于历史行为的自动风险评分。

## 架构原则

- `safety/` 对外仍只暴露 `core.contracts.ApprovalProvider`。
- 决策顺序固定：`HardBlock → SilentAllow → ExplicitConsent`。
- `HardBlock` 的优先级最高，`session/config` grant 不能覆盖。
- `SilentAllow` 只消费“已有信任证据”，不负责产生新授权。
- `ExplicitConsent` 是唯一的新授权入口。
- 三张规则表先于 grant 生效：
  - `hard_deny_commands` 负责命令硬拒绝；
  - `approval_required_commands` 负责命令级人工审批；
  - `sensitive_paths` 负责路径级 `read/write` 风险分流。
- 每次决策都要写 trace，trace 字段统一使用：
  - `decision_class = hard_block | silent_allow | explicit_consent`
  - `decision_source = intrinsic | session | config | standard | elevated`
- `BoundaryResolver` 负责文件系统边界，不让默认作用域分散到多处文档和规则表里。

## 三张规则表

### `hard_deny_commands`

适用场景：命令一旦执行就可能破坏宿主、擦除数据、改写安全边界、自我提权。  
处理逻辑：按 command segment 匹配，命中即拒绝；`session/config` grant 不能覆盖。

示例：

- `rm -rf /`
- `mkfs.*`
- `dd if=... of=/dev/...`
- `chmod -R 000 /`
- `git reset --hard` 写到受保护配置根目录

### `approval_required_commands`

适用场景：命令本身合理，但影响面超出默认静默边界，或者动作不可逆，需要用户确认。  
处理逻辑：命中后进入 `ExplicitConsent`；每条规则都带 `severity = standard | elevated`。

示例：

- `git push` → `standard`
- 工作区外写入命令 → `standard`
- 申请额外网络权限的命令 → `standard`
- 改写 `.kongming/config*` 的命令 → `elevated`
- 改写 `AGENTS.md` / `CLAUDE.md` 的命令 → `elevated`

### `sensitive_paths`

适用场景：文件路径的风险由目标路径和操作类型共同决定，必须区分 `read` 与 `write`。  
处理逻辑：路径规则附带 `ops` 和 `effect`；同一路径对 `read` 和 `write` 可以给出不同结果。

示例：

- `~/.ssh/` + `read|write` → `block`
- `~/.aws/config` + `read|write` → `elevated`
- `.env*` + `read|write` → `elevated`
- `AGENTS.md` + `write` → `elevated`
- `.kongming/work/` + `write` → `allow`

## Host 与 Sandbox 差异摘要

当前 v0.1.4 仍以 host 规则为主，沙盒 runtime 本身继续放在范围外。  
这套结构已经能扩展到 sandbox，关键差异集中在“伤害半径”和“默认边界”。

| 维度 | Host | Sandbox | 对规则表的影响 |
|---|---|---|---|
| 文件系统 | 真实宿主路径 | 隔离根目录 + 挂载目录 | `sensitive_paths` 需要按 `boundary_scope` 匹配，运行时由 `boundary_kind` 判定 |
| 命令影响面 | 影响真实机器与真实账户 | 影响容器、VM、临时工作区、挂载卷 | `hard_deny_commands` / `approval_required_commands` 需要按边界降级或维持 |
| 敏感路径 | `~/.ssh/`、`~/.aws/`、`/etc/` | 挂载进来的 host 路径、注入凭据、共享卷 | 路径规则要支持 runtime-aware 匹配 |
| 网络 | 真实外网、内网、凭据上下文 | 常见是 `off / allowlist / full` | 命令审批要纳入 `network_policy` |
| 持久化 | 长期状态 | 会话层、镜像层、挂载层 | grant 要记录作用边界 |
| 审计说明 | 强调宿主影响 | 强调隔离范围与挂载点 | trace 需要补 runtime 上下文 |

完整方案见：[Sandbox Boundary](./05-sandbox-boundary.md)

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| HardBlockGuard | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-1hardblockguard) | 是 | secrets / destructive / self-escalation 直接拒绝 |
| BoundaryResolver | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-2boundaryresolver) | 是 | 统一判定 trusted / approval / blocked zone |
| ConsentResolver | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-3consentresolver) | 是 | `standard` / `elevated` 两档审批 |
| TrustResolver | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-4trustresolver) | 是 | 汇总 intrinsic / session / config 三类证据 |
| GrantStore | 探索中 | [模块拆分](./02-module-breakdown.md#模块-5grantstore) | 否 | session / config grant 形态与 CLI 交互仍需定型 |
| SafetyDecisionEngine | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-6safetydecisionengine) | 是 | 装配层，替换现有多层 if-elif 判定 |
| DecisionTrace | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-7decisiontrace) | 是 | 记录 `decision_class/source` 与证据 |
| ConfigSelfProtection | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-8configselfprotection) | 否 | 作为 HardBlock/Consent 默认规则集的一部分实现 |

## 文档导航

- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)
- [Sandbox Boundary](./05-sandbox-boundary.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 先把 `hard_deny_commands`、`approval_required_commands`、`sensitive_paths` 三张表定完整，再开始实现。
2. 第一批落 `HardBlockGuard + BoundaryResolver + ConsentResolver`，建立安全闭环。
3. 第二批落 `TrustResolver + SafetyDecisionEngine + DecisionTrace`，形成稳定默认体验。
4. `GrantStore` 继续停留方案层，等 CLI 审批交互定型后进入 x-req。
5. `ConfigSelfProtection` 作为默认规则集跟随第一批一起落地，不单独拆实现阶段。
