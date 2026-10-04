# 目标与边界

## 需求要点

- 用户确认 workflow mode 名称为 `task_flow`。
- 架构接入现有 `AgentWorkflowStrategyManager` 和 `AgentWorkflowManager`。
- 流程从用户任务目标生成基础 plan，再按节点逐步执行。
- LLM 根据任务目标自行判断交互模式：简单任务直接填 `plan` 参数启动，方案型任务先提问让用户选择。
- Progress task 弹窗展示简单 workflow，重点显示进程、已完成节点、当前节点和阻塞节点。
- 执行中出现严重意外问题时，workflow 暂停并询问用户。

## 系统目标

1. 让 LLM 能把普通任务目标转换为可视化、可审计、可恢复的 `TaskFlowPlan`。
2. 让 LLM 在调用 workflow 前完成启动判断：自动执行、引导确认或方案选择。
3. 让 Web Progress 弹窗获得稳定轻量投影，显示类似 `进程 7/8` 的任务流。
4. 让 Workflow Viewer 能读取完整 plan、节点状态、产物和异常决策。
5. 让严重异常进入人类决策，避免 Agent 在高风险不确定状态下继续推进。
6. 保持 strategy 体系统一，新增能力以独立策略包接入。

## 完成标准

| DoD 条目 | 需要模块 | 需要 task |
|----------|----------|-----------|
| `task_flow` 出现在策略目录和 describe 详情中 | `TaskFlowStrategy` | `task-flow-strategy-skeleton-v0.1` |
| LLM 能按任务类型选择 `auto`、`guided` 或 `choice_required` | `TaskFlowStrategy`、`TaskFlowContracts` | `task-flow-llm-start-gate-v0.1` |
| LLM 能提交用户目标并生成 3-8 个节点计划 | `TaskFlowPlanner`、`TaskFlowContracts` | `task-flow-contracts-v0.1` + `task-flow-planner-v0.1` |
| 计划确认后节点按顺序推进并写 audit/result | `TaskFlowExecutor`、`TaskFlowArtifactWriter` | `task-flow-executor-v0.1` |
| 严重异常能暂停并形成用户决策 payload | `TaskFlowInterruptionPolicy` | `task-flow-interruption-v0.1` |
| Progress 弹窗能展示轻量 workflow | `TaskFlowProgressProjector` | `task-flow-progress-projection-v0.1` |
| Workflow Viewer 能展示 plan graph 和节点详情 | `TaskFlowViewerAdapter` | `task-flow-viewer-adapter-v0.1` |
| 后端与前端合同有测试覆盖 | `TaskFlowContracts`、`TaskFlowViewerAdapter` | `task-flow-contract-tests-v0.1` + `task-flow-e2e-smoke-v0.1` |

## 包含范围

- `mode="task_flow"` 的策略说明、payload schema 和示例。
- LLM 启动门：简单任务直接填 `plan` 并启动 workflow；交互式任务先向用户提问。
- 线性 plan：节点按 `display_order` 顺序执行。
- 节点类型：`analysis`、`edit`、`test`、`review`、`approval`、`artifact`。
- 节点状态：`planned`、`running`、`needs_approval`、`needs_user_input`、`completed`、`failed`、`skipped`。
- 严重异常暂停：写 `interruption.json`，Progress 弹窗突出显示，Workflow Viewer 展示决策项。
- 产物索引：每个节点可关联文件、diff、测试结果、报告或预览链接。

## 不包含范围

- DAG 并行调度。
- 无限节点数和长周期项目管理。
- 自动跨 thread 恢复。
- 自动解决权限审批。
- 对现有 `parallel`、`map_reduce`、`deep_research`、`roundtable_review` 的行为修改。
- 运行中动态生成多套产品方案供用户比较；方案选择发生在 workflow 启动前。

## 关键约束

- 协议字段由 `TaskFlowContracts` 统一定义，Web DTO 只消费投影结果。
- 策略接入必须通过 `AgentWorkflowStrategyManager.register(TaskFlowStrategy(...))`。
- workflow 根目录继续使用现有 `agent-workflows/<workflow_id>/`。
- Progress 弹窗投影必须轻量，避免读取子 agent 完整对话。
- 计划节点默认 3-8 个，超过上限需要合并节点或提示用户拆任务。
- `planning.interaction_mode="choice_required"` 时，LLM 应先在聊天中提问，等待用户选定方案后再调用 `run_agent_workflow`。

## 风险

| 风险 | 等级 | 处理 |
|------|------|------|
| LLM 生成计划过细，Progress 弹窗噪声过高 | 中 | planner 限制节点数并要求动作级标题 |
| 节点失败分类不稳定 | 高 | interruption policy 使用显式规则和测试 fixture |
| Progress 状态与 workflow artifact 漂移 | 高 | executor 每次状态更新同时写 artifact 和 progress projection |
| 用户暂停恢复后重复执行已完成节点 | 中 | recovery decision 必须带 resume_from_node_id |
| LLM 把需要用户取舍的 UI/架构任务直接自动执行 | 高 | strategy describe 明确 choice_required 触发规则并补提示词测试 |

## 状态

当前 spec 状态：方案确认。`TaskFlowStrategy`、`TaskFlowStartGate`、contracts、Progress 投影和 viewer adapter 可以进入 x-req。
