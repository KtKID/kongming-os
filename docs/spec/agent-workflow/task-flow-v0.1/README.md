# Task Flow v0.1

> 状态：历史方案；当前实现以 `docs/spec/workflow-task-progress-single-owner-v3/spec.md` 为准
> 目标：新增 `task_flow` workflow strategy，把普通用户任务转成可确认计划，再按节点逐步执行，并为 Progress 弹窗和 Workflow Viewer 提供稳定可视化投影。

## 系统目标

`task_flow` 面向基础任务执行场景：用户给出目标，LLM 先判断任务启动方式。简单任务由 LLM 直接填入 `plan` 参数并调用 workflow，系统按 plan 渲染 Progress 弹窗并开始执行；交互式任务由 LLM 先给用户 2-3 个方案选择，用户选定后再生成 plan 并启动 workflow。执行中遇到可恢复问题时记录并继续，遇到严重意外问题时暂停在 `needs_user_input` 状态，把问题、影响范围和可选动作交给用户。

## 策略目录文案

`task_flow` 在策略目录中必须用强描述引导 LLM 使用：

| 字段 | 内容 |
|------|------|
| `mode` | `task_flow` |
| `title` | `任务流 Task Flow` |
| `summary` | `通用计划执行 workflow。适合把用户目标拆成可视化步骤并逐步完成；parallel、map_reduce、deep_research、roundtable_review 均无法精准覆盖时选择它。` |
| `when_to_use` | `任务比较复杂，需要先拆 plan；任务存在多条方案路线，需要先让用户选择；任务需要在 Progress 弹窗展示步骤进度；任务需要每完成一步就更新指定 step 状态。` |
| `llm_instruction` | `简单任务直接填 plan 参数并调用 run_agent_workflow 创建任务流；有多方案或交互取舍时先提问，用户确认后再创建 plan；执行过程中使用 advance_task_progress 的 start/next 命令，参数只含 workflow_id、step_id 与可选 next_step_id。` |

## 最小可用路径

主 agent 根据策略说明先做启动判断。自动完成式任务直接调用 `run_agent_workflow(mode="task_flow", payload={objective, plan, planning.interaction_mode="auto"})` 创建任务流 plan，`AgentWorkflowManager.run_workflow_payload()` 创建 workflow 生命周期，`TaskFlowStrategy` 写入不可变的 `task_flow/plan.json` 与当前 foreground Progress task 列表。执行时先调用 `advance_task_progress(action="start", workflow_id, step_id)`，完成每一步时调用 `advance_task_progress(action="next", workflow_id, step_id, next_step_id)`；最后一步省略 `next_step_id`。`SessionTaskProgressManager` 持有五态当前快照，Progress 弹窗只读取该快照。

## 范围边界

**包含**

- 新增 workflow mode：`task_flow`。
- 复用 `AgentWorkflowManager`、`AgentWorkflowStrategyManager`、`WorkflowExecutionContext`、workflow audit/result writer、`SessionTaskProgressManager` 和 viewer adapter 注册模式。
- 定义 LLM 启动判断：`auto`、`guided`、`choice_required` 三种交互模式。
- 定义 plan 生成、计划确认、节点执行、严重异常暂停、用户恢复决策和最终验收的状态机。
- 定义 Progress 弹窗所需的轻量 DTO：总节点数、完成数、当前节点、阻塞原因、节点标题和折叠状态。
- 定义 Workflow Viewer 专用投影：PlanGraph、节点详情、产物列表、异常和用户决策。

**范围外职责**

- 通用 DAG 调度器。
- 多 agent 评审、分片归并、深度研究。
- 完整项目管理系统、任务排期和跨 workflow 依赖。
- 自动修复所有失败节点。
- Web 主界面重构。

## 组件状态

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `TaskFlowStrategy` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 新增策略包，持有计划生成、节点执行和暂停恢复状态机 |
| `TaskFlowContracts` | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | payload、plan、node、artifact、decision 和 result schema |
| `TaskFlowStartGate` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 让 LLM 判断自动执行、引导确认或方案选择 |
| `TaskFlowPlanner` | 方案确认 | [03-core-workflows.md](./03-core-workflows.md) | 是 | 根据用户目标生成 3-8 个可执行节点 |
| `TaskFlowExecutor` | 方案确认 | [03-core-workflows.md](./03-core-workflows.md) | 是 | 顺序执行节点，驱动子 agent 或父 runner 能力 |
| `TaskFlowInterruptionPolicy` | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | 区分 warning、recoverable、severe，并把 severe 转成人类决策 |
| `TaskFlowProgressProjector` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 给 Progress 弹窗输出轻量 workflow |
| `TaskFlowViewerAdapter` | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 给 Workflow Viewer 输出 plan graph 和节点详情 |

## 文档导航

- [图集：总览、执行链路、状态机和数据关系](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计、接口和数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

第一轮进入 x-req：实现 `TaskFlowStrategy` skeleton、plan/node contracts、artifact writer、Progress projector 和 viewer adapter。执行层先支持线性节点和单 agent 顺序执行，后续再扩展分支、重试策略和多 agent 节点。
