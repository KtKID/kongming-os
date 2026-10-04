# 核心流程

## 主链路

```mermaid
sequenceDiagram
  participant P as Parent Agent
  participant T as AgentWorkflowTool
  participant W as AgentWorkflowManager
  participant S as MapReduceStrategy
  participant PL as MapReducePlanner
  participant I as MapperInputMaterializer
  participant M as Mapper SubAgents
  participant V as MapperOutputValidator
  participant R as MapReduceReducer
  participant A as audit/result files

  P->>T: run_agent_workflow(mode="map_reduce", payload)
  T->>W: run_workflow_payload(mode="map_reduce", payload)
  W->>S: strategy registry dispatch
  S->>S: build MapReduceWorkflowSpec
  S->>A: audit map_reduce_started
  S->>PL: plan(input_source, shard_strategy)
  PL-->>S: MapShard[]
  S->>A: audit map_reduce_shards_planned
  S->>I: materialize(shards)
  I-->>S: input manifests
  par mapper runs
    S->>M: run shard 1
    S->>M: run shard N
  end
  M-->>S: mapper final content
  S->>V: validate output
  V-->>S: MapperOutputEnvelope / MapperValidationError
  S->>R: reduce(valid_outputs, failed_shards)
  R-->>S: ReducerOutput
  S->>A: write map_reduce/reducer/result.json
  W->>A: write root result.json + reports/index.json
  S-->>W: AgentWorkflowResult
  W-->>T: AgentWorkflowResult
  T-->>P: tool result with reducer summary
```

## 分片流程

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  IN["InputSource<br/>P0 · 文件来源"]:::p0
  DISC["Discover Files<br/>P0 · 发现文件"]:::p0
  GROUP["Group Strategy<br/>P0 · 按目录/模块/依赖分组"]:::p0
  SPLIT["Split Oversize<br/>P1 · 超限 shard 二次切分"]:::p1
  PLAN["ShardPlan<br/>P0 · 稳定分片计划"]:::p0
  MAT["Input Manifest<br/>P0 · 物化输入映射"]:::p0
  AUD["Audit<br/>P1 · 写分片审计"]:::p1

  IN --> DISC --> GROUP --> SPLIT --> PLAN --> MAT --> AUD
```

## mapper 输出校验流程

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  RAW["Mapper Final Content<br/>P0 · 子 agent 最终回复"]:::p0
  JSON["Extract JSON<br/>P0 · 提取 JSON"]:::p0
  SCHEMA["Validate Contract<br/>P0 · 校验字段"]:::p0
  OK["Valid Output<br/>P0 · 进入 reducer"]:::p0
  ERR["Validation Error<br/>P1 · 进入 failed_shards"]:::p1

  RAW --> JSON
  JSON --> SCHEMA
  SCHEMA --> OK
  SCHEMA --> ERR
```

## reducer 流程

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  VALID["Valid Mapper Outputs<br/>P0 · 有效 mapper 输出"]:::p0
  DEDUPE["Dedupe Findings<br/>P0 · 去重"]:::p0
  RANK["Rank Findings<br/>P0 · 排序"]:::p0
  COV["Coverage Summary<br/>P1 · 覆盖率汇总"]:::p1
  FAIL["Failed Shards<br/>P1 · 失败分片汇总"]:::p1
  FINAL["ReducerOutput<br/>P0 · 最终结果"]:::p0

  VALID --> DEDUPE --> RANK --> FINAL
  VALID --> COV --> FINAL
  FAIL --> FINAL
```

## 审计事件顺序

1. `map_reduce_started`
2. `map_reduce_shards_planned`
3. `map_reduce_inputs_materialized`
4. `map_mapper_started` × N
5. `map_mapper_completed` / `map_mapper_failed` × N
6. `map_mapper_output_validated` / `map_mapper_output_rejected` × N
7. `map_reduce_reducer_started`
8. `map_reduce_reducer_completed`
9. `map_reduce_completed`

每条事件都带 `workflow_id`、`run_id`、`mode`、`output_contract`，shard 级事件额外带 `shard_id`、`task_run_id`、`report_path`。
