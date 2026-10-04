# Task 映射

## 开发顺序

| Task | 优先级 | 范围 | 验收 |
|------|--------|------|------|
| `task-flow-contracts-v0.1` | P0 | 新增 `TaskFlowSpec`、`TaskFlowPlan`、`TaskFlowNode`、parser 和 fixture | payload 默认值、节点限制、状态枚举单测通过 |
| `task-flow-strategy-skeleton-v0.1` | P0 | 注册 `TaskFlowStrategy`，实现 catalog/describe/run skeleton | `task_flow` 出现在策略目录，describe 返回中文说明 |
| `task-flow-llm-start-gate-v0.1` | P0 | 在 describe 和工具提示中定义 title/summary/when_to_use、auto/guided/choice_required 规则 | 简单任务示例直接带 plan；方案型任务示例先提问；兜底选择说明存在 |
| `task-flow-planner-v0.1` | P0 | 支持外部 plan 和 planner 子 agent 生成 plan | 生成 3-8 个节点并写 `plan.json` |
| `task-flow-executor-v0.1` | P0 | 顺序执行节点、写 nodes/result/audit | completed fixture 跑通 |
| `task-flow-interruption-v0.1` | P0 | 严重异常暂停和用户决策 artifact | needs_user_input fixture 跑通 |
| `task-flow-progress-projection-v0.1` | P0 | 同步 Progress 弹窗轻量 workflow | running/completed/paused 三类 projection 单测通过 |
| `task-flow-viewer-adapter-v0.1` | P1 | 后端 viewer adapter 和前端 panel 渲染 | Workflow Viewer 展示 plan graph、节点和 interruption |
| `task-flow-contract-tests-v0.1` | P1 | 补后端 DTO、viewer DTO、前端类型和 fixture 合同测试 | payload、projection、panel DTO 字段双侧一致 |
| `task-flow-e2e-smoke-v0.1` | P1 | 真实 workflow 目录到 Web API 的 smoke | viewer API 读取 task_flow fixture |

## 组件到 task 映射

| 组件 | Task |
|------|------|
| `TaskFlowContracts` | `task-flow-contracts-v0.1` |
| `TaskFlowStrategy` | `task-flow-strategy-skeleton-v0.1` |
| `TaskFlowStartGate` | `task-flow-llm-start-gate-v0.1` |
| `TaskFlowPlanner` | `task-flow-planner-v0.1` |
| `TaskFlowExecutor` | `task-flow-executor-v0.1` |
| `TaskFlowArtifactWriter` | `task-flow-executor-v0.1` |
| `TaskFlowInterruptionPolicy` | `task-flow-interruption-v0.1` |
| `TaskFlowProgressProjector` | `task-flow-progress-projection-v0.1` |
| `TaskFlowViewerAdapter` | `task-flow-viewer-adapter-v0.1` |

## PoC 建议

先做 `task-flow-progress-projection-v0.1` 的极小 PoC：用 fixture 生成 `progress.json`，让现有 Progress 弹窗渲染 `任务流 7/8`、completed 节点和当前节点。这个 PoC 最快验证用户看见的第一价值。

## 可进入 x-req

- `task-flow-contracts-v0.1`
- `task-flow-strategy-skeleton-v0.1`
- `task-flow-llm-start-gate-v0.1`
- `task-flow-progress-projection-v0.1`

## 暂留方案层

- DAG 分支和依赖。
- 多 agent 节点。
- task_flow 作为 Agent Space 默认任务对象。
