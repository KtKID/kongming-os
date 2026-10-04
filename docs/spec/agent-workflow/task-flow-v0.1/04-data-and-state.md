# 数据模型与状态

状态图和数据关系见 [diagrams.md](./diagrams.md)。

## Payload schema

```json
{
  "objective": "把 Web 界面改造成任务导向工作台",
  "context": "先从 workflow 可视化和 Progress 弹窗开始",
  "plan": {
    "summary": "先打通 Progress 弹窗的任务流渲染，再补完整 Viewer。",
    "nodes": [
      {
        "node_id": "node-01",
        "display_order": 1,
        "title": "定义 Progress 投影字段",
        "goal": "让 Web 能按 plan 参数直接渲染任务流",
        "kind": "analysis",
        "risk_level": "low",
        "approval_required": false,
        "expected_outputs": ["progress.json 字段清单"]
      }
    ]
  },
  "planning": {
    "interaction_mode": "auto",
    "max_nodes": 8,
    "require_confirmation": false,
    "allow_llm_planning": true
  },
  "execution": {
    "stop_on_severe_issue": true,
    "max_retries_per_node": 1,
    "default_node_timeout_seconds": 600
  },
  "audit_tags": ["agent-space-v2", "workflow-visualization"]
}
```

## 核心数据模型

### `TaskFlowStrategyDescription`

该结构对应 `TaskFlowStrategy.describe()` 输出的语义要求，用于诱导 LLM 正确选择 workflow。

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | string | 固定为 `task_flow` |
| `title` | string | `任务流 Task Flow` |
| `summary` | string | 通用计划执行 workflow 描述 |
| `when_to_use` | string[] | 复杂任务、多方案任务、Progress step 任务和兜底任务 |
| `llm_instruction` | string | 创建 plan、执行 step、更新 step 状态的工具说明 |

### `TaskFlowSpec`

| 字段 | 类型 | 说明 |
|------|------|------|
| `objective` | string | 用户任务目标 |
| `context` | string | 任务背景和边界 |
| `plan` | `TaskFlowPlan/null` | 可选的外部传入计划 |
| `planning` | `TaskFlowPlanningOptions` | 计划生成和确认策略 |
| `execution` | `TaskFlowExecutionOptions` | 执行限制和异常处理策略 |
| `audit_tags` | string[] | 审计标签 |

### `TaskFlowPlanningOptions`

| 字段 | 类型 | 说明 |
|------|------|------|
| `interaction_mode` | string | `auto` / `guided` / `choice_required` / `llm_decide` |
| `max_nodes` | int | 计划最大节点数，默认 8 |
| `require_confirmation` | bool | workflow 启动后是否需要确认计划 |
| `allow_llm_planning` | bool | payload 未带 plan 时是否允许 planner 生成计划 |

`interaction_mode` 语义：

| 模式 | 含义 | 工具调用要求 |
|------|------|--------------|
| `auto` | 自动完成式任务 | LLM 直接填 `plan.nodes` 并调用 workflow |
| `guided` | 引导确认式任务 | LLM 填 `plan.nodes`，高风险节点标记 `approval_required=true` |
| `choice_required` | 方案选择式任务 | LLM 先提问，用户选择后再调用 workflow |
| `llm_decide` | 让 LLM 按策略说明判断 | prompt 层默认值，实际 tool payload 尽量落成前三种之一 |

### `TaskFlowPlan`

| 字段 | 类型 | 说明 |
|------|------|------|
| `plan_id` | string | 计划 ID |
| `objective` | string | 用户目标 |
| `summary` | string | 计划摘要 |
| `nodes` | `TaskFlowNode[]` | 节点列表 |
| `created_by` | string | planner task run id 或 `payload` |
| `created_at` | string | ISO 时间 |
| `source_choice_id` | string/null | 来源方案 ID，用户选择方案后启动时填写 |

### `TaskFlowChoiceOption`

该结构主要用于 LLM 启动前提问。用户选择后，选项 ID 写入 `TaskFlowPlan.source_choice_id`。

| 字段 | 类型 | 说明 |
|------|------|------|
| `choice_id` | string | 方案 ID |
| `title` | string | 方案标题 |
| `summary` | string | 方案摘要 |
| `tradeoffs` | string[] | 主要取舍 |
| `recommended` | bool | 是否为推荐方案 |

### `TaskFlowNode`

| 字段 | 类型 | 说明 |
|------|------|------|
| `node_id` | string | 稳定节点 ID |
| `display_order` | int | 显示和执行顺序 |
| `title` | string | Progress 弹窗显示标题 |
| `goal` | string | 节点目标 |
| `kind` | string | `analysis` / `edit` / `test` / `review` / `approval` / `artifact` |
| `status` | string | 节点状态 |
| `risk_level` | string | `low` / `medium` / `high` |
| `approval_required` | bool | 是否需要审批 |
| `expected_outputs` | string[] | 预期产物 |
| `depends_on` | string[] | 第一版为空或前序节点 |
| `attempt_count` | int | 已执行次数 |

### `TaskFlowArtifactRef`

| 字段 | 类型 | 说明 |
|------|------|------|
| `artifact_id` | string | 产物 ID |
| `node_id` | string | 所属节点 |
| `kind` | string | `file` / `diff` / `test` / `report` / `preview` / `json` |
| `path` | string | repo 相对路径或 workflow artifact 路径 |
| `title` | string | 展示标题 |
| `summary` | string | 摘要 |
| `available` | bool | 是否可读取 |

### `TaskFlowInterruption`

| 字段 | 类型 | 说明 |
|------|------|------|
| `interruption_id` | string | 暂停 ID |
| `node_id` | string | 触发节点 |
| `severity` | string | 固定为 `severe` |
| `problem` | string | 问题摘要 |
| `impact` | string | 影响范围 |
| `evidence` | string[] | 证据摘要 |
| `options` | `TaskFlowDecisionOption[]` | 可选恢复动作 |
| `created_at` | string | ISO 时间 |

### `TaskFlowDecision`

| 字段 | 类型 | 说明 |
|------|------|------|
| `decision_id` | string | 决策 ID |
| `interruption_id` | string | 对应暂停 |
| `action` | string | `continue` / `revise_plan` / `skip_node` / `stop_flow` |
| `instruction` | string | 用户补充说明 |
| `resume_from_node_id` | string/null | 恢复节点 |
| `decided_at` | string | ISO 时间 |

## Artifact 目录树

```text
agent-workflows/<workflow_id>/
├── workflow.json
├── audit.jsonl
├── result.json
├── reports/
│   └── index.json
├── agents/
│   └── <task_run_id>/
│       ├── subagent.json
│       ├── task.log.jsonl
│       ├── result.json
│       └── work/
└── task_flow/
    ├── spec.json
    ├── plan.json
    ├── nodes.jsonl
    ├── progress.json
    ├── interruption.json
    ├── decisions.jsonl
    ├── artifacts/
    │   └── index.json
    └── result.json
```

## Workflow 状态

| 状态 | 含义 |
|------|------|
| `planning` | 正在生成计划 |
| `awaiting_plan_confirmation` | 等待用户确认计划 |
| `running` | 正在执行节点 |
| `needs_user_input` | 严重异常暂停，需要用户决策 |
| `completed` | 所有必要节点完成 |
| `failed` | 不可恢复失败 |
| `cancelled` | 用户取消 |
| `stopped` | 用户要求停止 |

## 节点状态

| 状态 | 含义 |
|------|------|
| `planned` | 已进入计划，尚未执行 |
| `running` | 正在执行 |
| `needs_approval` | 等待权限或计划确认 |
| `needs_user_input` | 严重异常等待用户指令 |
| `completed` | 正常完成 |
| `failed` | 执行失败 |
| `skipped` | 用户或策略跳过 |

## 审计事件

| 事件 | 触发点 | payload 核心字段 |
|------|--------|------------------|
| `task_flow.workflow_started` | workflow 创建 | `workflow_id`、`objective`、`audit_tags` |
| `task_flow.plan_created` | 计划生成 | `plan_id`、`node_count`、`plan_path` |
| `task_flow.plan_confirmation_requested` | 等待确认 | `plan_id`、`risk_summary` |
| `task_flow.plan_confirmed` | 用户或策略确认 | `decision_source`、`plan_id` |
| `task_flow.node_started` | 节点开始 | `node_id`、`display_order`、`kind` |
| `task_flow.node_completed` | 节点完成 | `node_id`、`artifact_count`、`elapsed_ms` |
| `task_flow.node_failed` | 节点失败 | `node_id`、`error_digest`、`attempt_count` |
| `task_flow.interruption_created` | 严重异常暂停 | `interruption_id`、`node_id`、`problem` |
| `task_flow.user_decision_recorded` | 用户做出恢复决策 | `decision_id`、`action`、`resume_from_node_id` |
| `task_flow.progress_projected` | Progress 投影更新 | `completed_count`、`total_count`、`current_node_id` |
| `task_flow.workflow_completed` | workflow 完成 | `completed_node_count`、`artifact_count` |

## Progress 投影

`task_flow/progress.json` 是弹窗唯一需要读取的 mode 专属轻量文件：

```json
{
  "title": "任务流",
  "status": "running",
  "completed_count": 7,
  "total_count": 8,
  "current_node_id": "node-08",
  "needs_user_input": false,
  "nodes": [
    {
      "id": "node-01",
      "title": "创建 HTML 文件骨架",
      "status": "completed",
      "display_order": 1
    }
  ],
  "updated_at": "2026-06-18T12:00:00Z"
}
```
