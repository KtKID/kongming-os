# Task 映射

## 建议 task 列表

| Task | 优先级 | 目标 | 验收 |
|------|--------|------|------|
| `map-reduce-contracts-v0.1` | P0 | 定义数据结构、JSON payload、validator | 所有字段有中文注释，validator 单测通过 |
| `map-reduce-strategy-integration-v0.1` | P0 | 以 `strategies/map_reduce/` 独立包接入 strategy registry，补 planner、input materializer、mapper、validator、reducer、artifacts | `map_reduce` 可运行，workflow result、audit、report index、reducer result 完整；parallel 旧链路保持 |
| `map-reduce-live-smoke-v0.1` | P1 | MiniMax M3 小目录 live smoke | 真实模型产出 mapper JSON，reducer 输出成功 |
| `map-reduce-xcodeatlas-v0.2` | P2 | 接入 module/dependency 分片 | 大工程模块分片更稳定 |

## 开发顺序

1. `map-reduce-contracts-v0.1`
2. `map-reduce-strategy-integration-v0.1`
3. `map-reduce-live-smoke-v0.1`
4. `map-reduce-xcodeatlas-v0.2`

## 代码映射

| 组件 | 建议文件 | 对应 task |
|------|----------|-----------|
| `MapReduceToolPayload` schema | `src/tools/agent_workflow_tool.py` | `map-reduce-strategy-integration-v0.1` |
| `MapReduceWorkflowSpec` | `src/executors/agent_runtime/strategies/map_reduce_contracts.py` | `map-reduce-contracts-v0.1` |
| `MapperOutputValidator` | `src/executors/agent_runtime/strategies/map_reduce_contracts.py` | `map-reduce-contracts-v0.1` |
| `MapReduce contracts re-export` | `src/executors/agent_runtime/strategies/map_reduce/contracts.py` | `map-reduce-strategy-integration-v0.1` |
| `MapReducePlanner` | `src/executors/agent_runtime/strategies/map_reduce/planner.py` | `map-reduce-strategy-integration-v0.1` |
| `MapperInputMaterializer` | `src/executors/agent_runtime/strategies/map_reduce/input_materializer.py` | `map-reduce-strategy-integration-v0.1` |
| `MapperPromptBuilder` | `src/executors/agent_runtime/strategies/map_reduce/mapper.py` | `map-reduce-strategy-integration-v0.1` |
| `MapperOutputValidator` | `src/executors/agent_runtime/strategies/map_reduce/validator.py` | `map-reduce-strategy-integration-v0.1` |
| `MapReduceReducer` | `src/executors/agent_runtime/strategies/map_reduce/reducer.py` | `map-reduce-strategy-integration-v0.1` |
| `MapReduceArtifacts` | `src/executors/agent_runtime/strategies/map_reduce/artifacts.py` | `map-reduce-strategy-integration-v0.1` |
| `MapReduceStrategy` | `src/executors/agent_runtime/strategies/map_reduce/strategy.py` | `map-reduce-strategy-integration-v0.1` |
| `run_agent_workflow(mode="map_reduce")` | `src/tools/agent_workflow_tool.py` | `map-reduce-strategy-integration-v0.1` |
| Live e2e | `tests/e2e/test_map_reduce_live.py` | `map-reduce-live-smoke-v0.1` |

## 第一版 task 建议

`map-reduce-strategy-integration-v0.1` 已创建 req：[dev-pipeline/tasks/map-reduce-strategy-integration-v0.1](../../../dev-pipeline/tasks/map-reduce-strategy-integration-v0.1/)。

这个 task 以独立策略包接入 runtime，保留 `parallel` 当前实现，降低回归风险。
