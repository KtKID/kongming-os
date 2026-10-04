# 模块设计、接口和数据结构

## 架构原则

`task_flow` 是 `application.agent_workflows.strategies` 下的独立策略包。公共 workflow 生命周期由 `AgentWorkflowManager` 负责，策略包负责 plan 生成、节点执行、严重异常暂停、节点产物和 mode 专属 result。组件关系见 [diagrams.md](./diagrams.md)。

## 模块总览

| 模块 | 职责 | 边界类 | 状态 |
|------|------|--------|------|
| `AgentWorkflowTool` | 暴露 `mode="task_flow"`，归一化 payload，格式化策略说明 | `RunAgentWorkflowTool` | 已有，需扩展 |
| `AgentWorkflowManager` | 创建 workflow context、manifest、audit、result，注册策略 | `AgentWorkflowManager` | 已有，需注册 |
| `TaskFlowStrategy` | 执行 plan -> confirm -> node loop -> finalize 状态机 | `TaskFlowStrategy` | 方案确认 |
| `TaskFlowContracts` | 解析 payload，定义 plan、node、artifact、decision schema | `TaskFlowContractParser` | 方案确认 |
| `TaskFlowStartGate` | 给 LLM 的启动判断规则，决定直接启动或先问方案 | `TaskFlowStartGate` | 方案确认 |
| `TaskFlowPlanner` | 根据用户目标生成可执行基础计划 | `TaskFlowPlanner` | 方案确认 |
| `TaskFlowExecutor` | 顺序执行节点并记录状态、产物和错误 | `TaskFlowExecutor` | 方案确认 |
| `TaskFlowArtifactWriter` | 写入 task_flow 专属 artifact | `TaskFlowArtifactWriter` | 方案确认 |
| `TaskFlowInterruptionPolicy` | 识别严重意外问题并创建用户决策 | `TaskFlowInterruptionPolicy` | 方案确认 |
| `TaskFlowProgressProjector` | 投影 Progress 弹窗轻量 workflow | `TaskFlowProgressProjector` | 方案确认 |
| `TaskFlowViewerAdapter` | 投影 Workflow Viewer plan graph 和节点详情 | `TaskFlowWorkflowViewerAdapter` | 方案确认 |

## `TaskFlowStrategy`

建议位置：`repo:src/application/agent_workflows/strategies/task_flow/strategy.py`

职责：

- `mode = "task_flow"`。
- 实现 `catalog_entry()`、`describe()`、`run(context, payload)`。
- `describe()` 必须明确 LLM 启动判断：简单任务直接填 `plan` 参数调用 workflow；需要方案取舍时先向用户提问。
- `describe()` 必须提供可诱导 LLM 使用的策略名称和描述，强调 `task_flow` 是通用计划执行 workflow。
- 调用 `TaskFlowContractParser` 解析 payload。
- 调用 `TaskFlowPlanner` 生成计划并写入 `task_flow/plan.json`。
- 根据 confirmation policy 进入自动执行或等待确认。
- 按 `display_order` 执行节点。
- 捕获异常并交给 `TaskFlowInterruptionPolicy`。
- 写根目录 `result.json` 的 `data.task_flow` 扩展字段。

公开边界：

```python
class TaskFlowStrategy:
    mode = "task_flow"

    def catalog_entry(self) -> WorkflowStrategyCatalogEntry: ...
    def describe(self) -> WorkflowStrategyDescription: ...
    async def run(
        self,
        context: WorkflowExecutionContext,
        payload: Mapping[str, object],
    ) -> AgentWorkflowResult: ...
```

### `WorkflowStrategyDescription` 要求

`TaskFlowStrategy.describe()` 必须返回以下语义，保证 LLM 在策略目录中能正确选择：

```python
WorkflowStrategyDescription(
    mode="task_flow",
    title="任务流 Task Flow",
    summary=(
        "通用计划执行 workflow。适合把用户目标拆成可视化步骤并逐步完成；"
        "parallel、map_reduce、deep_research、roundtable_review 均无法精准覆盖时选择它。"
    ),
    when_to_use=(
        "用户目标需要先拆成 plan 再逐步完成",
        "任务比较复杂或包含多个阶段",
        "任务存在多条方案路线，需要先让用户选择",
        "任务需要在 Progress 弹窗展示 step 进度",
        "每完成一步都需要更新指定 step 状态",
    ),
)
```

工具使用说明必须写入 description：

1. 简单自动任务：直接填 `plan.nodes`，调用 `run_agent_workflow(mode="task_flow", payload=...)` 创建 plan 并开始执行。
2. 多方案任务：先向用户展示 2-3 个方案并等待选择。
3. 用户确认方案后：把选定方案转为 `plan.nodes`，调用 `run_agent_workflow(mode="task_flow", payload=...)`。
4. 执行中先调用 `advance_task_progress(action="start")`，每完成一个节点调用 `advance_task_progress(action="next")` 原子完成当前步骤并启动下一步。
5. 遇到严重意外问题：进入 `needs_user_input`，把问题、影响范围和可选动作交给用户。

## `TaskFlowContracts`

建议位置：`repo:src/application/agent_workflows/strategies/task_flow/contracts.py`

职责：

- 解析 payload。
- 校验 plan 节点数、节点标题、节点类型、风险等级和执行限制。
- 定义 artifact JSON schema 和 viewer projection 输入。
- 为测试 fixture 提供稳定 dataclass。

核心 payload：

```json
{
  "objective": "把 Web 界面改造成任务导向工作台",
  "context": "用户希望先做 workflow 可视化和 Progress 弹窗",
  "plan": {
    "summary": "先接入任务流 Progress 投影，再补 Viewer 投影。",
    "nodes": [
      {
        "node_id": "node-01",
        "display_order": 1,
        "title": "定义 task_flow Progress DTO",
        "goal": "补齐后端和前端共享字段",
        "kind": "analysis",
        "risk_level": "low",
        "approval_required": false,
        "expected_outputs": ["DTO 字段清单"]
      }
    ]
  },
  "planning": {
    "interaction_mode": "auto",
    "max_nodes": 8,
    "require_confirmation": false
  },
  "execution": {
    "stop_on_severe_issue": true,
    "max_retries_per_node": 1
  }
}
```

## `TaskFlowStartGate`

建议位置：`repo:src/application/agent_workflows/strategies/task_flow/start_gate.py`

职责：

- 定义写进 `TaskFlowStrategy.describe()` 的 LLM 选型规则。
- 给工具说明提供 `interaction_mode` 的中文解释和触发条件。
- 给策略目录提供 `title`、`summary`、`when_to_use` 和工具调用说明。
- 约束 LLM 的工具调用：`auto` 和 `guided` 需要带 `plan.nodes`；`choice_required` 需要先在聊天中向用户提问。
- 给测试提供分类 fixture，验证策略说明覆盖简单任务、交互式任务和方案选择任务。

交互模式：

| 模式 | 适合任务 | LLM 行为 |
|------|----------|----------|
| `auto` | bug 修复、补测试、文档整理、小范围确定性改动 | 直接填 `plan` 参数并调用 `task_flow` |
| `guided` | 涉及权限、发布、迁移、关键文件覆盖 | 填 `plan` 参数并标出确认节点 |
| `choice_required` | UI/UX、架构路线、交互设计、多种实现路线 | 先给用户 2-3 个方案，用户选择后再调用 `task_flow` |

兜底选择规则：

| 场景 | LLM 行为 |
|------|----------|
| 任务需要分步骤执行，且专用 workflow 覆盖不精确 | 选择 `task_flow` |
| 任务适合并行派发互不依赖子 agent | 选择 `parallel` |
| 任务是大规模同构代码分析 | 选择 `map_reduce` |
| 任务是多来源研究报告 | 选择 `deep_research` |
| 任务是多 Agent 评审和仲裁 | 选择 `roundtable_review` |

LLM 提问格式：

```text
这个任务有几条可选路线，我建议先选方向：
1. 低风险渐进改造：...
2. 结构重塑：...
3. 理想方案：...
选定后我会把方案转成 task_flow plan 并开始执行。
```

## `TaskFlowPlanner`

建议位置：`repo:src/application/agent_workflows/strategies/task_flow/planner.py`

职责：

- 把用户目标生成 3-8 个节点。
- 给每个节点补 `kind`、`risk_level`、`approval_required`、`expected_outputs`。
- 生成 `plan_summary`，供 Progress 弹窗折叠标题使用。
- 计划生成失败时返回可解释错误，不进入节点执行。

第一版计划生成方式：

- 优先由主 agent 通过 LLM tool payload 传入 `plan.nodes`，让 Web 直接按参数渲染 Progress。
- payload 未传入 plan 时，`TaskFlowPlanner` 使用 strategy prompt 启动 planner 子 agent 生成计划。
- 测试场景可注入 deterministic planner。

## `TaskFlowExecutor`

建议位置：`repo:src/application/agent_workflows/strategies/task_flow/executor.py`

职责：

- 按节点顺序执行。
- 每个节点执行前写 `task_flow.node_started`。
- 每个节点成功后写 `task_flow.node_completed` 和产物索引。
- 节点失败后写 `task_flow.node_failed`，交给 interruption policy 分类。
- 更新 `SessionTaskProgressManager` 的 progress task。

执行模型：

- 第一版每个节点可映射为一个 `SubAgentTask`，复用 `AgentWorkflowManager.run_subagent_task()`。
- 对纯 artifact / approval 节点，策略内部直接写状态，不创建子 agent。
- 节点执行 prompt 必须带目标、当前节点、前序节点产物摘要、边界和停止条件。

## `TaskFlowInterruptionPolicy`

建议位置：`repo:src/application/agent_workflows/strategies/task_flow/interruption.py`

职责：

- 读取节点异常、工具失败、测试失败、审批拒绝、输出缺失等信号。
- 输出 `issue_severity`：`warning`、`recoverable`、`severe`。
- `warning` 记录后继续。
- `recoverable` 允许有限重试或跳过。
- `severe` 写 `interruption.json` 并把 workflow 状态置为 `needs_user_input`。

严重问题规则：

| 条件 | 结果 |
|------|------|
| 计划前提失效 | `severe` |
| 关键文件缺失或冲突 | `severe` |
| 测试显示主路径破坏 | `severe` |
| 用户权限审批拒绝 | `severe` |
| 工具输出为空但节点可重试 | `recoverable` |
| 单个非关键检查失败 | `warning` |

## `TaskFlowProgressProjector`

建议位置：`repo:src/application/agent_workflows/strategies/task_flow/progress.py`

职责：

- 从 `TaskFlowPlan` 和节点状态生成 Progress 弹窗 payload。
- 只输出轻量字段：总数、完成数、当前节点、折叠标题、节点状态、严重问题摘要。
- 同步到已有 `SessionTaskProgressManager`。

示例：

```json
{
  "title": "任务流",
  "progress": "7/8",
  "completed_count": 7,
  "total_count": 8,
  "current_node_id": "node-08",
  "status": "running",
  "nodes": [
    {"id": "node-01", "title": "读取需求", "status": "completed"},
    {"id": "node-08", "title": "运行验证", "status": "running"}
  ]
}
```

## `TaskFlowViewerAdapter`

建议位置：`repo:src/hosts/web/workflow_viewer/adapters/task_flow.py`

职责：

- 读取 `task_flow/plan.json`、`task_flow/nodes.jsonl`、`task_flow/artifacts/index.json`、`task_flow/interruption.json`。
- 输出 `WorkflowFlowNodeDTO` 和 `WorkflowFlowEdgeDTO`。
- 增加 `kind="task_flow"` panel，展示计划、节点、产物和暂停决策。
- 缺失 mode artifact 时回落到 unknown adapter，同时给 diagnostics。

前端面板建议：

- `Task Flow`：节点列表、进度、当前状态。
- `Current Node`：目标、输入、输出、风险、错误。
- `Artifacts`：节点产物索引。
- `Needs You`：严重异常和用户选项。
