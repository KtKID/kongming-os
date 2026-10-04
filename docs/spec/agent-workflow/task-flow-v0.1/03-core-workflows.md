# 核心流程

图见 [diagrams.md](./diagrams.md)。

## 启动门：LLM 自行判断

1. LLM 读取 `TaskFlowStrategy.describe()`。
2. LLM 读取 `title`、`summary`、`when_to_use` 和工具使用说明。
3. LLM 判断 parallel、map_reduce、deep_research、roundtable_review 的适配度，通用计划执行任务选择 `task_flow`。
4. LLM 根据用户目标选择 `interaction_mode`。
5. `auto`：LLM 直接填 `plan.nodes` 参数并调用 `run_agent_workflow(mode="task_flow")`。
6. `guided`：LLM 填 `plan.nodes` 参数并把高风险节点标为 `approval_required=true`。
7. `choice_required`：LLM 在聊天中给出 2-3 个方案并提问，等待用户选择。
8. 用户选择方案后，LLM 把选定方案转成 `plan.nodes` 并调用 `task_flow`。

## LLM 工具调用流程

自动完成式任务：

1. LLM 创建 `plan.nodes`。
2. LLM 调用 `run_agent_workflow(mode="task_flow", payload=...)` 创建任务流。
3. LLM 根据 plan 执行第一个 step。
4. LLM 先调用 `advance_task_progress(action="start", step_id=<node_id>)`；完成后调用 `advance_task_progress(action="next", step_id=<node_id>, next_step_id=...)`。
5. 全部 step 完成后，workflow 写入 result。

方案选择式任务：

1. LLM 先给用户 2-3 个方案。
2. 用户选择方案。
3. LLM 将方案转换为 `plan.nodes`。
4. LLM 调用 `run_agent_workflow(mode="task_flow", payload=...)`。
5. LLM 按 plan 执行，并在每个 step 完成后调用 `advance_task_progress(action="next")`。

## 主流程：创建计划并执行

1. 主 agent 收到用户任务目标。
2. 主 agent 查询 workflow strategies，选择 `task_flow`。
3. 主 agent 根据启动门决定直接调用 workflow 或先向用户提问。
4. `AgentWorkflowManager` 创建 workflow 目录和 `WorkflowExecutionContext`。
5. `TaskFlowStrategy` 解析 payload。
6. payload 已带 `plan.nodes` 时直接规范化为 `TaskFlowPlan`；未带 plan 时由 `TaskFlowPlanner` 生成。
7. `TaskFlowArtifactWriter` 写入 `task_flow/plan.json`。
8. `TaskFlowProgressProjector` 写入 Progress 初始状态。
9. 确认策略要求用户确认时，workflow 进入 `awaiting_plan_confirmation`。
10. 计划确认后，`TaskFlowExecutor` 按顺序执行节点。
11. 每个节点完成后写 `nodes.jsonl`、产物索引、audit 和 Progress 投影。
12. 全部节点完成后写 `task_flow/result.json` 和根目录 `result.json`。

## 计划确认流程

第一版支持三种确认策略：

| 策略 | 用法 |
|------|------|
| `auto_confirm_low_risk` | 全部节点风险为 low/medium 且无 edit 节点时自动执行 |
| `require_user_confirmation` | 默认策略，计划生成后等待用户确认 |
| `preflight_choice_required` | workflow 启动前由 LLM 提问，用户选择后再生成 plan |

用户确认动作：

| 动作 | 结果 |
|------|------|
| `approve_plan` | 从第一个节点开始执行 |
| `revise_plan` | 用户给修改意见，planner 重新生成计划 |
| `cancel_flow` | workflow 标记为 cancelled |

## 节点执行流程

每个节点执行时使用相同状态协议：

1. 节点状态从 `planned` 变为 `running`。
2. 写 audit：`task_flow.node_started`。
3. 生成节点执行 prompt。
4. 节点调用子 agent 或策略内置动作。
5. 产物写入节点工作目录或 `task_flow/artifacts/`。
6. 写 audit：`task_flow.node_completed` 或 `task_flow.node_failed`。
7. 更新 `nodes.jsonl` 和 Progress 投影。

## 严重异常暂停流程

严重异常出现时：

1. `TaskFlowExecutor` 捕获节点错误。
2. `TaskFlowInterruptionPolicy` 分类为 `severe`。
3. `TaskFlowArtifactWriter` 写入 `task_flow/interruption.json`。
4. 当前节点状态变为 `needs_user_input`。
5. workflow manifest 状态变为 `needs_user_input`。
6. Progress 弹窗显示需要用户处理。
7. Workflow Viewer 展示问题、影响范围和推荐选项。

用户可选动作：

| 动作 | 结果 |
|------|------|
| `continue` | 按用户说明继续当前节点或下一节点 |
| `revise_plan` | 从指定节点重新生成后续计划 |
| `skip_node` | 标记当前节点 skipped，继续后续节点 |
| `stop_flow` | 结束 workflow，状态为 stopped |

## Progress 弹窗流程

Progress 弹窗只消费轻量 projection：

- `title`
- `completed_count`
- `total_count`
- `current_node`
- `nodes`
- `needs_user_input`
- `updated_at`

弹窗不读取子 agent 对话，不读取大文件产物。详细信息进入 Workflow Viewer。

## Workflow Viewer 流程

Viewer 读取完整 artifact：

1. 扫描 thread 的 `agent-workflows/<workflow_id>/`。
2. adapter registry 命中 `task_flow`。
3. `TaskFlowViewerAdapter` 读取 `plan.json`、`nodes.jsonl`、`artifacts/index.json`、`interruption.json`。
4. 返回 flow nodes / edges / panels / diagnostics。
5. 前端渲染 plan graph、节点详情、产物和暂停决策。
