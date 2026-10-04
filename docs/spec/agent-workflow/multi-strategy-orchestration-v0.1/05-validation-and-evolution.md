# 验证策略与演进

## 验证矩阵

| 能力 | 验证命令 | 关键断言 |
|------|----------|----------|
| strategy registry | `uv run pytest tests/unit/test_agent_workflow_strategy_manager.py -v` | 注册、重复 mode、未知 mode、planned mode |
| 中文 catalog | 同上 | title / summary / when_to_use 为中文文本 |
| describe | 同上 | 返回 schema、示例、warnings |
| parallel 迁移 | `uv run pytest tests/unit/test_agent_workflow_manager.py -v` | 旧 parallel 行为保持 |
| tool v2 | `uv run pytest tests/unit/test_agent_workflow_tool.py -v` | list / describe / run tool schema |
| 架构边界 | `uv run lint-imports` | tools 不 import executors 私有 dataclass |
| smoke | `uv run pytest tests/e2e/test_agent_workflow_strategy_smoke.py -v` | pytest 封装 CLI smoke，parallel strategy 真跑通过 |

## 单测重点

- `AgentWorkflowStrategyManager.register()` 接收唯一 mode。
- 重复 mode 抛结构化错误。
- 未知 mode 的 run / describe 错误包含 available modes 和 runnable modes。
- planned mode 的 run 错误包含 status、depends_on 和 runnable modes。
- `list_strategies()` 只返回 catalog，不暴露 runtime 对象。
- `describe_strategy()` 返回完整中文说明。
- `run_strategy()` 创建 workflow context 并调用目标 strategy。
- `ParallelWorkflowStrategy` 复用现有 report / audit / result 产物。
- 旧 `run_parallel_subagents` tool 输出保持。

## R1 风险：策略说明和执行逻辑漂移

风险：catalog 说适合某类任务，strategy 实际 schema 或行为不匹配。

应对：
- 每个 strategy 单测同时检查 `describe().inputs` 和 payload parser。
- description 示例 payload 必须能被 parser 接受。

## R2 风险：manager 变胖

风险：`AgentWorkflowStrategyManager` 同时承载注册、执行、具体策略逻辑。

应对：
- manager 只做 registry、context、dispatch。
- `AgentWorkflowManager` facade 只承接公开入口和旧路径兼容。
- 每种 strategy 自己实现 payload 校验和调度。
- manager 单测不关心 strategy 内部流程。

## R3 风险：tool 层突破依赖边界

风险：tool 层为了生成 schema 直接 import executor dataclass。

应对：
- tool 通过 handle 调用 `list/describe/run`。
- description 返回 JSON-serializable dict。
- import-linter 保持 tools -> executors 私有类型隔离。

## R4 风险：LLM 过度手工编排

风险：LLM 看了策略说明后仍逐个调用子 agent 管理工具，绕过 strategy。

应对：
- 对结构化策略提供专用 `run_agent_workflow` 示例。
- `map_reduce`、review panel、pipeline/DAG 在 description 中明确由 strategy 生成调度计划，并由 `SubAgentManager` 承接子 agent 生命周期。
- `parallel` 保持自由 `tasks[]`，其他 strategy 收紧 payload。

## 演进路线

### v0.1 strategy manager foundation

- `AgentWorkflowManager` facade 集成。
- `WorkflowStrategy` protocol。
- `AgentWorkflowStrategyManager`。
- `WorkflowStrategyDescription`。
- `WorkflowExecutionContext`。
- 结构化 `WorkflowStrategyNotFound`。

### v0.2 parallel strategy + tool catalog

- `ParallelWorkflowStrategy`。
- tool list / describe / run。
- 旧 `run_parallel_subagents` 兼容路径。

### v0.3 map_reduce strategy integration

- 注册 `MapReduceStrategy`。
- 复用已完成的 `map_reduce_contracts.py`。
- 接入 planner / materializer / reducer。
- 以 `strategies/map_reduce/` 独立策略包承载具体实现。
- `parallel` 当前执行链路保持，拆包重构进入后续任务。

### v0.4 pipeline / DAG

- `WorkflowPlan`。
- 节点依赖图。
- 失败传播和跳过策略。

### v0.5 review panel

- reviewer role schema。
- 多视角审查。
- finding 合并和冲突标记。

### v0.6 supervisor-worker

- agent target registry。
- wait / followup / close / resume。
- mailbox / notification store。
