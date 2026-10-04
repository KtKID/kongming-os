# Task 映射

## 建议 task 列表

| Task | 优先级 | 目标 | 验收 |
|------|--------|------|------|
| `agent-workflow-strategy-manager-v0.1` | P0 | 新增 strategy protocol、strategy manager、description、runnable/planned record、`WorkflowExecutionContext`，并接入 `AgentWorkflowManager` facade | facade 可 list/describe/run 测试 strategy，未知 mode 返回 available/runnable modes，planned mode 返回 depends_on |
| `parallel-strategy-migration-v0.1` | P0 | 把现有 parallel 接入 `ParallelWorkflowStrategy` registry 分发 | 旧 `run_parallel_subagents` 单测和 smoke 通过 |
| `agent-workflow-tool-catalog-v0.1` | P0 | tool 暴露 list / describe / run，并保持旧 tool 兼容 | LLM 能看到中文策略说明并运行 parallel |
| `planned-strategy-catalog-v0.1` | P1 | catalog 注册后续 planned 策略说明 | pipeline/review/supervisor 等后续策略可 describe，run 提示依赖任务 |
| `map-reduce-strategy-integration-v0.1` | P0 | 以 `strategies/map_reduce/` 独立策略包注册并执行 `MapReduceStrategy`，parallel 保持现状 | map_reduce workflow 单测通过，parallel 旧测试不改或保持通过 |
| `parallel-strategy-package-refactor-v0.1` | P1 | 把 parallel 具体执行从 manager 拆到 `strategies/parallel/` 包 | 旧 tool 输出、audit、reports 路径保持 |
| `pipeline-dag-workflow-v0.1` | P2 | 引入 `WorkflowPlan` 和依赖图调度 | DAG 节点按依赖顺序执行 |
| `review-panel-workflow-v0.1` | P2 | 多 reviewer role 审查同一产物 | 输出按 reviewer role 聚合 |
| `supervisor-worker-workflow-v0.1` | P2 | 支持 wait / followup / close / resume | 跨轮协作有 agent target registry |

## 推荐开发顺序

1. `agent-workflow-strategy-manager-v0.1`
2. `parallel-strategy-migration-v0.1`
3. `agent-workflow-tool-catalog-v0.1`
4. `map-reduce-strategy-integration-v0.1`
5. `parallel-strategy-package-refactor-v0.1`
6. `pipeline-dag-workflow-v0.1`
7. `review-panel-workflow-v0.1`
8. `supervisor-worker-workflow-v0.1`

## 代码映射

| 组件 | 建议文件 | 对应 task |
|------|----------|-----------|
| `AgentWorkflowManager` facade | `src/executors/agent_runtime/workflow/manager.py` | `agent-workflow-strategy-manager-v0.1` |
| `WorkflowStrategy` | `src/executors/agent_runtime/strategies/base.py` | `agent-workflow-strategy-manager-v0.1` |
| `AgentWorkflowStrategyManager` | `src/executors/agent_runtime/strategies/manager.py` | `agent-workflow-strategy-manager-v0.1` |
| `WorkflowStrategyDescription` | `src/executors/agent_runtime/strategies/description.py` | `agent-workflow-strategy-manager-v0.1` |
| `WorkflowExecutionContext` | `src/executors/agent_runtime/workflow/context.py` | `agent-workflow-strategy-manager-v0.1` |
| `WorkflowStrategyNotFound` | `src/executors/agent_runtime/strategies/base.py` | `agent-workflow-strategy-manager-v0.1` |
| `ParallelWorkflowStrategy` | `src/executors/agent_runtime/strategies/parallel.py` | `parallel-strategy-migration-v0.1` |
| `AgentWorkflowTool v2` | `src/tools/agent_workflow_tool.py` | `agent-workflow-tool-catalog-v0.1` |
| `MapReduceStrategy` | `src/executors/agent_runtime/strategies/map_reduce/strategy.py` | `map-reduce-strategy-integration-v0.1` |
| `MapReducePlanner` | `src/executors/agent_runtime/strategies/map_reduce/planner.py` | `map-reduce-strategy-integration-v0.1` |
| `MapperInputMaterializer` | `src/executors/agent_runtime/strategies/map_reduce/input_materializer.py` | `map-reduce-strategy-integration-v0.1` |
| `MapReduceReducer` | `src/executors/agent_runtime/strategies/map_reduce/reducer.py` | `map-reduce-strategy-integration-v0.1` |
| `ParallelWorkflowExecutor` | `src/executors/agent_runtime/strategies/parallel/executor.py` | `parallel-strategy-package-refactor-v0.1` |

## 可进入 x-req

第一批可以直接进入 x-req：

- `agent-workflow-strategy-manager-v0.1` — 已创建 req：[dev-pipeline/tasks/agent-workflow-strategy-manager-v0.1](../../../dev-pipeline/tasks/agent-workflow-strategy-manager-v0.1/)
- `parallel-strategy-migration-v0.1` — 已创建 req：[dev-pipeline/tasks/parallel-strategy-migration-v0.1](../../../dev-pipeline/tasks/parallel-strategy-migration-v0.1/)
- `map-reduce-strategy-integration-v0.1` — 已创建 req：[dev-pipeline/tasks/map-reduce-strategy-integration-v0.1](../../../dev-pipeline/tasks/map-reduce-strategy-integration-v0.1/)

`parallel-strategy-package-refactor-v0.1` 等 `map_reduce` 集成稳定后进入 x-req。
