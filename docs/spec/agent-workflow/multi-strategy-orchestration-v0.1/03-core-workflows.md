# 核心流程

## LLM 选择并运行策略

```mermaid
sequenceDiagram
  participant P as Parent LLM
  participant T as AgentWorkflowTool v2
  participant H as AgentWorkflowHandle
  participant F as AgentWorkflowManager
  participant M as AgentWorkflowStrategyManager
  participant S as WorkflowStrategy
  participant U as SubAgentManager
  participant A as Audit Files
  participant R as AgentWorkflowResult

  P->>T: list_agent_workflow_strategies()
  T->>H: list_strategies()
  H->>F: list_workflow_strategies()
  F->>M: list_strategies()
  M-->>P: 中文 catalog
  P->>T: describe_agent_workflow_strategy(mode)
  T->>H: describe_strategy(mode)
  H->>F: describe_workflow_strategy(mode)
  F->>M: describe_strategy(mode)
  M-->>P: 中文详细说明 + schema + 示例
  P->>T: run_agent_workflow(mode, payload)
  T->>H: run_strategy(request)
  H->>F: run_workflow(request)
  F->>M: run_strategy(request)
  M->>A: workflow_started
  M->>S: run(context, payload)
  S->>A: strategy_plan_started
  S->>U: run child tasks
  U->>A: subagent lifecycle events
  U-->>S: subagent reports
  S->>A: strategy_result_merged
  S-->>M: AgentWorkflowResult
  M->>A: workflow_completed + result.json + reports/index.json
  M-->>T: AgentWorkflowResult
  T-->>P: 模型可读结果摘要
```

## `parallel` 迁移流程

1. `ParallelWorkflowStrategy.describe()` 返回中文说明：适合独立任务 fan-out / fan-in。
2. `AgentWorkflowStrategyManager.register(ParallelWorkflowStrategy(...))`。
3. `run_parallel_subagents` 继续可用，内部调用 `run_agent_workflow(mode="parallel")`。
4. `AgentWorkflowManager.run_workflow_specs(mode="parallel")` 通过 manager 分发。
5. 现有 audit、result、reports/index 输出保持。

## `map_reduce` 接入流程

1. 当前 catalog 保持 `status="planned"`、`runnable=false`；`map-reduce-strategy-integration-v0.1` 完成后注册为 `status="available"`、`runnable=true`。
2. LLM 提交 objective、input_source、shard_strategy、output_contract。
3. tool 通过 `AgentWorkflowManager.run_workflow_payload(mode="map_reduce", payload=...)` 传入完整 payload。
4. `AgentWorkflowStrategyManager` 分发到 `strategies/map_reduce/strategy.py::MapReduceStrategy`。
5. `MapReduceStrategy` 在 executors 内构造 `MapReduceWorkflowSpec`。
6. strategy 调 planner、input materializer、`SubAgentManager` mapper 任务、validator、reducer。
7. manager 写统一 workflow 产物，strategy 写 `map_reduce/` 细节产物。
8. 本阶段保持 `parallel` 当前执行链路，parallel 拆包放入后续任务。

## 策略错误流程

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px

  REQ["run/describe(mode=unknown)<br/>P0 · LLM 请求"]:::p0
  MGR["StrategyManager<br/>P0 · 查 registry"]:::p0
  ERR["WorkflowStrategyNotFound<br/>P0 · 模型可读错误"]:::p0
  LIST["available_modes<br/>P1 · 返回可选策略"]:::p1
  PLANNED["run(mode=planned)<br/>P1 · 策略未可执行"]:::p1
  NR["WorkflowStrategyNotRunnable<br/>P1 · 返回依赖任务"]:::p1

  REQ --> MGR --> ERR --> LIST
  PLANNED --> MGR --> NR
```

错误消息应包含：
- unknown mode。
- 已注册 mode 列表。
- 可直接运行的 mode 列表。
- planned 策略的 `depends_on`。
- 建议先调用 `list_agent_workflow_strategies` 或 `describe_agent_workflow_strategy`。

## tool 兼容路径

旧路径：

`run_parallel_subagents(tasks)` -> `AgentWorkflowManager.run_workflow_specs(mode="parallel")`

新路径：

`run_parallel_subagents(tasks)` -> `run_agent_workflow(mode="parallel", payload={"tasks": tasks})` -> `AgentWorkflowManager` facade -> strategy manager -> `ParallelWorkflowStrategy`

兼容策略：
- 保留旧 tool 名。
- 新增统一 tool。
- 旧 tool 和新 tool 共享同一个 runtime strategy。
