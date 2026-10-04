# CLI Approval Manager

> 状态：已完成
> 目标：让终端 CLI 复用 ApprovalManager 的自动审批和 pending 决策模型，同时保留终端用户审批体验。

## 系统目标

CLI 已经通过 `ApprovalManager.request()` 进入统一 pending 模型，并由 `ApprovalRules` 连接自动审批策略。本 spec 把 CLI 接入同一条审批主链，让自动允许、危险规则强制人审、用户审批和后续审计在同一个模型下扩展。

## 最小可用路径

用户在 CLI 中触发需要审批的 tool call -> SafetyGatedApproval 进入 interactive prompt -> `make_manager_prompt_fn(channel="cli")` 调 `ApprovalManager.request()` -> 共享规则判定自动允许、危险规则强制人审或默认 ask -> pending 路径由 `CLIApprovalEventSink` 在终端询问用户 -> `manager.resolve()` 回填 -> Runner 继续工具执行或拒绝。

## 范围边界

**包含**：
- CLI 接入 `ApprovalManager`。
- 自动审批 policy 从 Web 边界下沉到共享 safety 层。
- `ApprovalRules` 支持 `channel="cli"`。
- 新增 `CLIApprovalEventSink`，用于终端 pending 展示和用户决策回填。
- CLI 装配点使用 manager prompt_fn，规则未命中自动结果时继续用户审批。
- 单元测试和 CLI e2e 覆盖自动允许、危险规则强制人审、ask、一次允许和拒绝。CLI 当前不提供 session grant 入口。

**排除范围**：
- Web inbox 视觉调整。
- rules.yaml 完整 schema 重设计。
- persistent grant 写盘。
- cron / evolution / claude_code 迁移。
- Runner 主循环重构。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| Shared Auto Approval Policy | 已完成 | [02-module-breakdown.md](./02-module-breakdown.md) | 已完成 | Web policy 已下沉到 `src/safety/auto_approval/` 共享层 |
| ApprovalRules CLI Channel | 已完成 | [02-module-breakdown.md](./02-module-breakdown.md) | 已完成 | `generic_chat` 和 `cli` 共用自动规则判定 |
| CLIApprovalEventSink | 已完成 | [02-module-breakdown.md](./02-module-breakdown.md) | 已完成 | 终端展示 pending 并调用 `manager.resolve()` |
| CLI Runtime Wiring | 已完成 | [02-module-breakdown.md](./02-module-breakdown.md) | 已完成 | CLI interactive 模式装配 manager prompt_fn |
| Validation Suite | 已完成 | [05-validation-and-evolution.md](./05-validation-and-evolution.md) | 已完成 | pytest 覆盖规则、sink、装配和 e2e |

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 实现落点

| 模块文档 | 说明 |
|----------|------|
| [docs/modules/安全/README.md](../../modules/安全/README.md) | 共享 `auto_approval`、`ApprovalRules`、`ApprovalManager`、Web inbox sink 的实现索引 |
| [docs/modules/命令行/README.md](../../modules/命令行/README.md) | CLI `ApprovalManager + CLIApprovalEventSink` 装配链路 |
| [docs/modules/Web前端/README.md](../../modules/Web前端/README.md) | Web inbox 倒计时和 `src/hosts/web/approvals/auto` 兼容 re-export 边界 |
| [dev-pipeline/tasks/cli-approval-manager-v0.1/](../../../dev-pipeline/tasks/cli-approval-manager-v0.1/) | 开发任务包、验证报告和 QA gate 记录 |
