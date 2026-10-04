# 审批单入口与分支单调收紧 v0.1

> 状态：B0 已实现，B1/B2 继续演进
> 方案类型：安全架构收敛
> 权威范围：Runner 工具调用前的最终审批决策、分支范围约束、授权证据和审批审计
> 起因：`repo:reports/night/night-review-20260713-030441.md` 的第一个 P0
> B0 实现权威：`repo:openspec/changes/session-engine-safety-chain-single-entry/`

## 结论

每个 `SessionEngine` 只装配一个最终 `ApprovalProvider`：`SafetyGatedApproval`。B0 已让主 Agent、新 Agent 树 child、遗留 child、普通 run 和 continue 统一使用该实例，并删除 run 级 provider 覆盖入口。定时任务的 context/evidence 迁移属于后续阶段。

子 Agent 工具能力在应用层按 `父级实际工具 ∩ 请求工具 ∩ scope 允许工具` 单调裁剪；同一份不可变快照同时驱动 LLM schema 与 Runner 查找面，scoped 文件 wrapper 继续执行路径边界校验。不同 Agent 共用当前 `SessionEngine` 的最终 provider 实例，各自的工具快照、文件 scope、模型参数和 `agent_id` 保持独立。

固定决策顺序为：`HardBlock → RuntimeScope → Boundary → Destructive → Trust → Consent`。子 Agent 的 scope 只产生“继续评估”或“拒绝”，范围内请求继续经过全局规则；预授权通过类型化 `GrantEvidence` 进入 Trust 阶段，并始终位于 HardBlock 与 scope 之后。

`ApprovalManager` 负责显式 consent 的请求、等待、解决、取消和 inbox 生命周期；`SafetyDecisionEngine` 负责规则顺序和最终判定；`ApprovalAuditManager` 负责一次性发布最终审批事件并落实持久化等级。这三个 owner 的职责互斥且可组合。

## 最小可用路径

父 Agent 派生 frozen 子 scope/evidence → 子 Agent 的工具请求进入 `SessionEngine` 唯一 `SafetyGatedApproval` → 六阶段规则完成最终判定 → required 审计确认 → approved 工具执行。

## 起因与已完成封口

历史生产链路允许子 Agent 在 `SpawnAgentRequest.approval` 中携带 `SubAgentApprovalProvider`，随后经 `AgentCell.run_approval` 传给 `SessionEngine.run(approval=...)`。该对象会覆盖装配期的全局 `SafetyGatedApproval`，范围内调用因此可能绕过 HardBlock、Boundary、Destructive、Trust 与 Consent。

B0 已删除上述三个行为对象入口和 `SubAgentApprovalProvider` 生产实现。新旧 child 均通过 `SessionEngine.run()` 进入全局安全链；工具白名单与 scoped 文件路径限制分别由不可变工具快照和执行期 wrapper 落实。

定时任务也通过 `ScheduleApprovalProvider` 包装最终 provider，并自行处理 trust 与审计。多条最终 provider 链形成了规则顺序、审计语义和首次/继续运行行为漂移。

## 目标

- Runner 的每次工具调用都经过同一个高层 `ApprovalProvider` 实现。
- 所有原生分支共享同一组全局规则和相同顺序。
- 子 Agent 权限相对父运行上下文单调收紧，无法扩大父级权限。
- `AutoAllow`、人工询问和宿主审批都作为 Consent 叶子策略，无法替换完整安全链。
- 策略计算保持纯净，最终审批事件由单一 owner 写出一次。
- 主运行、子 Agent、定时任务和 continue 路径采用同一合同。

完整目标和边界见 [目标与边界](./01-goals-and-boundaries.md)。

## 关键架构决定

| 编号 | 决定 | 判断依据 | 缺失后果 | 直接结果 |
|---|---|---|---|---|
| ADR-01 | `ApprovalProvider` 保留为 Runner 最终决策协议 | Runner 需要一个宿主无关的完整决策 seam | 多个最终协议会把规则顺序重新交给调用方 | 生产运行只注入 `SafetyGatedApproval` |
| ADR-02 | 新增 `ConsentPrompt` 叶子协议 | 人工询问只发生在规则链末端 | auto-allow 和 scope evaluator 可被误注入最终槽位 | `ApprovalManager`、auto-allow、宿主询问只回答 Consent 阶段 |
| ADR-03 | 删除 run 级 provider 覆盖能力 | build/run 分离要求 composition root 持有执行依赖 | 分支仍能绕过 build 时安全链 | `SessionEngine.run()` 接受 `ApprovalRunContext` |
| ADR-04 | scope 采用单调收紧语义 | 子权限需要保持父权限子集不变量 | scope 范围内调用会提前形成最终批准 | scope 的 allow 代表继续评估，deny 代表终止 |
| ADR-05 | 预授权建模为 `GrantEvidence` | Trust 是验证既有授权事实的规则阶段 | grant wrapper 可绕过 HardBlock 与 scope | Trust 消费证据，HardBlock 与 scope 始终先执行 |
| ADR-06 | 审批规则返回结构化 evaluation | policy 需要可组合、可测试和无 I/O | 规则顺序与文件写入故障互相污染 | policy/provider 不直接写文件 |
| ADR-07 | `ApprovalAuditManager` 是终态事件单写点 | 多个 sink 需要共享同一 decision identity | workflow、scheduler、trace 会产生重复或矛盾记录 | 每个 tool call 最多一个 `approval.evaluated` 终态事件 |
| ADR-08 | provider 唯一性按 `SessionEngine` 实例定义 | runtime 的配置、workspace 和授权快照可以不同 | 进程级全局单例会串扰独立 runtime | 每个 runtime 内唯一，多个 runtime 相互隔离 |

## 模块

| 模块 | 门户或边界角色 | 状态 | 说明 |
|---|---|---|---|
| 核心审批合同 | `ApprovalProvider`、`ConsentPrompt` | 可进入 x-req | 定义最终决策、运行上下文、范围约束与授权证据 |
| 安全决策 | `SafetyDecisionEngine`、`SafetyGatedApproval` | 可进入 x-req | 固定规则顺序，汇总阶段 evaluation |
| 运行时装配 | `SessionEngine` | 可进入 x-req | 持有唯一最终 provider，移除 run 级 provider 覆盖 |
| Agent 授权上下文 | `AgentManager`、`SubAgentManager` | 可进入 x-req | 将 `SubAgentGrant` 转成 scope/evidence，移除 provider 传递 |
| 定时任务授权上下文 | `SchedulerManager` | 可进入 x-req | 将 task approval mode 转成 consent policy/evidence |
| 审批审计投影 | `ApprovalAuditManager` | 方案确认 | 统一事件、持久化等级和串行写入 |

详细职责和 import 边界见 [模块拆分](./02-module-breakdown.md)。

## 文档导航

- [目标与边界](./01-goals-and-boundaries.md)：需求、术语、范围和约束。
- [模块拆分](./02-module-breakdown.md)：门户、公开方法、内部实现和依赖方向。
- [核心流程](./03-core-workflows.md)：主链、子 Agent、定时任务、continue 与审计时序。
- [数据与状态](./04-data-and-state.md)：不可变合同、状态 owner 和事件字段。
- [验证与演进](./05-validation-and-evolution.md)：DoD、验证矩阵、迁移顺序和风险。
- [任务地图](./90-task-map.md)：x-req 切分、依赖和交付边界。
- [图表](./diagrams.md)：现状问题、目标模块、决策流和迁移图。

## 交付顺序

1. 先收敛合同、规则顺序和 `SessionEngine` 单入口，封死新的 provider 覆盖入口。
2. 再迁移子 Agent 与定时任务，把分支 provider 转成运行上下文。
3. 最后收敛审计投影，并完成跨分支合同测试和薄 smoke。

当前无需拆分新的同级 spec。`ApprovalAuditManager` 的队列确认与必达写入需要在对应 x-req 的第一项技术验证中给出可执行结果。

## 当前建议

B0 由 OpenSpec change `session-engine-safety-chain-single-entry` 交付。下一阶段建立 `approval-reliable-audit-projection` change：从 Runner 唯一 `approval.request` / `approval.decision` 事实流生成 workflow ledger 可靠投影，并继续设计 required acknowledgment、scheduler context/evidence 与统一终态审计。
