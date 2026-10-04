# 验证策略与演进

## 必需验证层

| 层级 | 建议命令 | 验证点 |
|------|----------|--------|
| strategy 单测 | `uv run pytest tests/unit/test_agent_workflow_task_flow.py -v` | strategy registry、plan 生成、节点状态、严重异常暂停、result 写入 |
| contracts 单测 | `uv run pytest tests/unit/test_agent_workflow_task_flow_contracts.py -v` | payload 默认值、节点数量限制、状态枚举、错误信息 |
| start gate 单测 | `uv run pytest tests/unit/test_agent_workflow_task_flow_start_gate.py -v` | describe 提示词覆盖 title、summary、when_to_use、auto、guided、choice_required，示例 payload 带 plan |
| progress 单测 | `uv run pytest tests/unit/test_agent_workflow_task_flow_progress.py -v` | Progress projection 的完成数、当前节点、暂停状态 |
| viewer adapter 单测 | `uv run pytest tests/unit/web/test_workflow_viewer_task_flow_adapter.py -v` | plan graph、panel、artifact 和 diagnostics |
| 前端组件测试 | `cd web && npm test -- WorkflowRunViewerPage` | task_flow panel、needs user input 状态、节点选择 |
| 端到端 smoke | `uv run pytest tests/e2e/test_task_flow_workflow_smoke.py -v` | 从 run_agent_workflow 到 viewer API 的完整链路 |

## Fixture 设计

第一版至少准备 5 类 fixture：

| Fixture | 目标 |
|---------|------|
| `task_flow_completed` | 3 个节点全部完成，Progress 显示 3/3 |
| `task_flow_auto_plan_payload` | LLM 直接传入 `plan.nodes`，workflow 直接渲染并执行 |
| `task_flow_choice_prompt` | LLM 判断需要用户选方案，先输出 2-3 个选项 |
| `task_flow_running` | 第 2 个节点 running，Progress 显示 1/3 |
| `task_flow_awaiting_plan_confirmation` | 计划生成后等待用户确认 |
| `task_flow_needs_user_input` | 严重异常暂停，存在 `interruption.json` |
| `task_flow_artifact_missing` | artifact index 指向缺失文件，viewer 给 diagnostics |

## 验收样例

输入：

```json
{
  "objective": "把 Progress 弹窗接入 task_flow 展示",
  "plan": {
    "summary": "先实现可渲染的 Progress DTO。",
    "nodes": [
      {
        "node_id": "node-01",
        "display_order": 1,
        "title": "定义 Progress DTO",
        "goal": "确定 Progress 弹窗渲染字段",
        "kind": "analysis",
        "risk_level": "low",
        "approval_required": false,
        "expected_outputs": ["DTO 字段清单"]
      }
    ]
  },
  "planning": {
    "interaction_mode": "auto",
    "max_nodes": 5,
    "require_confirmation": false
  }
}
```

期望：

- 直接按 payload 中的 `plan.nodes` 生成 `task_flow/plan.json`。
- 计划节点数为 payload 中的节点数。
- workflow 直接进入 `running`。
- Progress payload 显示 `0/1` 或实际节点数。
- 节点按顺序执行。
- 完成后 `result.json.data.task_flow.completed_node_count` 等于节点数。

## 异常验收

严重问题样例：

- 节点需要修改的文件和当前工作区冲突。
- 测试失败显示用户主路径断裂。
- 权限审批被拒绝。
- LLM 发现目标前提失效。

期望：

- 当前节点状态为 `needs_user_input`。
- workflow manifest 状态为 `needs_user_input`。
- `task_flow/interruption.json` 存在。
- Progress payload `needs_user_input=true`。
- Viewer panel 展示问题、影响和可选动作。

## 演进路线

| 阶段 | 能力 | 说明 |
|------|------|------|
| v0.1 | 线性 task flow | 基础计划、确认、顺序执行、严重异常暂停 |
| v0.2 | 节点恢复 | `continue`、`skip_node`、`revise_plan` 的完整恢复执行 |
| v0.3 | 分支和依赖 | 支持轻量 DAG、节点依赖和局部重排 |
| v0.4 | 多 agent 节点 | 节点内部可调用 `parallel` 或 `roundtable_review` 子 workflow |
| v0.5 | UI 主工作台 | task_flow 成为 Agent Space 的默认任务对象 |

## 风险巡检

- Progress 和 artifact 双写需要保持一致，测试必须断言同一节点状态。
- 计划确认和权限审批要有清晰边界，避免两个弹窗争夺用户注意力。
- 严重异常分类要可解释，避免用户看到“需要你”但不知道为什么。
- Viewer adapter 需要容忍旧 workflow 或部分文件缺失。
