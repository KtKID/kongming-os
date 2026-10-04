# subagent-scoped-permissions-v0.1

> 维护说明（2026-07-13）：本 spec 的子 Agent 工作目录和 grant 产品目标继续有效；`SubAgentApprovalProvider` 作为最终审批 wrapper 的组合方案已由 `repo:docs/spec/safety-approval-single-entry-v0.1/` 取代。目标链路改为 `SubAgentGrant → ApprovalScope/GrantEvidence → SessionEngine 唯一 SafetyGatedApproval`，范围内请求继续执行全局安全规则。

> 状态：方案确认
> 目标：为子 agent 增加创建时授权和运行时 scoped approval，让第一版子 agent 只能在自己的工作目录内操作，并把创建、授权、审批、拒绝完整写入 workflow 审计目录。

## 系统目标

子 agent 权限的核心目标是把执行能力收束到可审计、可解释、可回放的边界内。第一版只开放子 agent 自己 `working_dir` 内的 read / write / list，主 agent 创建子 agent 时选择工具和 skill，`SubAgentManager` 固化授权单，子 agent 触发工具审批时先按授权单判断，越界请求直接拒绝。

## 最小可用路径

主 agent 调用 `run_parallel_subagents` -> 每个 task 传入 `tool_names`、`skill_names`、`permission` -> `AgentWorkflowManager` 分配 `agents/<task_run_id>/` 和 `work/` -> `SubAgentManager` 创建 `SubAgentGrant` -> 写入 `subagent.json` 和 `subagent_created` 审计 -> 子 agent 调工具 -> `SubAgentApprovalProvider` 按 grant 判断 -> working_dir 内 approved，越界 rejected -> 写入审批审计 -> 子 agent 汇报结果。

## 设计原则

- 默认权限足够小：read / write / list 范围只包含子 agent 自己的 `working_dir`。
- 授权发生在创建时：主 agent 只能选择工具、skill 和固定权限模式。
- 运行时按 grant 执行：子 agent 每次工具调用都带上 `workflow_id`、`subagent_id`、`grant_id`。
- 审计记录完整：创建时记录完整 task、prompt、context、工具、skill、权限和路径。
- 日志位置分层：权限事实写 workflow 审计，创建快照写 `subagent.json`，子 session JSONL 保留原始对话。
- 复用现有审批链：新增 wrapper，不改 `core.contracts.ApprovalProvider` 协议。

## 范围

包含：
- `SubAgentGrant` 数据结构。
- `SubAgentGrantStore` 或 `SubAgentManager` 内部 grant registry。
- `SubAgentApprovalProvider`，包住现有 `ApprovalProvider`。
- `AgentWorkflowTool` task schema 新增 `skill_names` 和 `permission`。
- `subagent.json`、`subagent_created`、`subagent_approval_decided` 审计。

范围外：
- 项目源码读权限。
- 项目源码写权限。
- shell / network 工具放行。
- 主 agent 运行中审批子 agent 越权请求。
- Web 渲染实现。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `SubAgentGrant` | 待实现 | [04-data-and-state.md](./04-data-and-state.md) | 是 | 子 agent 授权单，记录身份、工具、skill、工作目录和路径策略 |
| `SubAgentApprovalProvider` | 待实现 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 子 agent 工具调用的审批 wrapper |
| `SubAgentManager` grant registry | 待实现 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 维护每个子 agent 的授权和生命周期 |
| `AgentWorkflowTool` schema | 待实现 | [04-data-and-state.md](./04-data-and-state.md) | 是 | 主 agent 创建子 agent 时传入权限选项 |
| `WorkflowAudit` | 待实现 | [03-core-workflows.md](./03-core-workflows.md) | 是 | 完整记录创建、授权、审批和拒绝 |

## 文档导航

- [架构图](./architecture.html)
- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

第一版实现 `scoped_workdir` 单一权限模式：`read_file`、`write_file`、`list_dir` 只允许 resolve 后位于子 agent `working_dir` 内；其他工具默认拒绝；后续再扩展 workspace read、user approval、main agent approval。

日志决策固定为三层：

| 日志 | 路径 | 记录内容 | 定位 |
|------|------|----------|------|
| workflow 审计日志 | `<workflow_dir>/audit.jsonl` | 每次子 agent 创建、授权绑定、审批 approved / rejected、越界拒绝 | 权限事实源 |
| 子 agent 创建快照 | `<workflow_dir>/agents/<task_run_id>/subagent.json` | 完整 task、prompt、context、tool、skill、permission、grant、路径；产物目录为同级 `work/` | 创建事实源 |
| 子 agent 会话日志 | `.kongming/sessions/<child_session_id>/<child_session_id>.jsonl` | Runner 原始消息、工具消息、最终回复 | 对话回放 |
