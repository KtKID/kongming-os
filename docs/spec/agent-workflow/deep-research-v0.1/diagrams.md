# Deep Research v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/03/04 是文字事实源，本文件是只读视图；增减模块、组件、阶段或实体时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](#总览)
- [策略组件](#策略组件)
- [六阶段时序](#六阶段时序)
- [事实状态流转](#事实状态流转)
- [Artifact ER](#artifact-er)

图例：🔵 P0 核心/阻塞 · 🟠 P1 主要/必须 · ⚪ P2 辅助/可选

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Tool["AgentWorkflowTool<br/>P0 · mode schema and payload normalize"]:::p0
  Manager["AgentWorkflowManager<br/>P0 · lifecycle audit manifest result"]:::p0
  Strategy["DeepResearchStrategy<br/>P0 · six phase state machine"]:::p0
  SubAgent["SubAgentManager<br/>P0 · child agent execution"]:::p0
  Source["ResearchSourceProvider<br/>P0 · search and fetch PoC"]:::p0
  Board["FactBoard<br/>P0 · v0.1 structured artifacts"]:::p0
  Viewer["Workflow Viewer Adapter<br/>P2 · later projection"]:::p2

  Tool --> Manager
  Manager --> Strategy
  Strategy --> SubAgent
  Strategy --> Source
  Strategy --> Board
  Board -.-> Viewer
```

## 策略组件

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph DeepResearch["deep_research strategy package"]
    Entry["DeepResearchStrategy<br/>P0 · run and phase dispatch"]:::p0
    Contracts["contracts.py<br/>P0 · spec limits schemas"]:::p0
    Prompts["prompts.py<br/>P1 · planner extractor jury reporter"]:::p1
    Provider["source_provider.py<br/>P0 · web source contract"]:::p0
    Dedupe["dedupe.py<br/>P0 · canonical URL and budget"]:::p0
    Board["fact_board.py<br/>P0 · jsonl and report artifacts"]:::p0
    Jury["jury.py<br/>P0 · quorum and tally"]:::p0
  end

  Manager["AgentWorkflowManager<br/>P0 · context and writers"]:::p0
  SubAgent["SubAgentManager<br/>P0 · child sessions"]:::p0
  WebTools["WebSearch/WebFetch<br/>P0 · high risk PoC"]:::p0
  Result["workflow result<br/>P0 · result and reports index"]:::p0

  Manager --> Entry
  Entry --> Contracts
  Entry --> Prompts
  Entry --> Provider
  Entry --> Dedupe
  Entry --> Board
  Entry --> Jury
  Entry --> SubAgent
  Provider --> WebTools
  Board --> Result
```

## 六阶段时序

```mermaid
sequenceDiagram
  participant U as Parent Agent
  participant T as run_agent_workflow
  participant M as AgentWorkflowManager
  participant S as DeepResearchStrategy
  participant P as ResearchSourceProvider
  participant A as SubAgentManager
  participant B as FactBoard

  U->>T: mode=deep_research payload
  T->>M: run_workflow_payload
  M->>S: run(context, payload)
  S->>A: Plan child agent
  A-->>S: search lines
  S->>P: Search lines
  P-->>S: hits
  S->>B: sources selected duplicates overflow
  S->>P: Fetch selected URLs
  P-->>S: fetched sources
  S->>A: Extract facts
  A-->>S: raw facts
  S->>A: Group equivalent facts
  A-->>S: fact groups
  S->>A: Crosscheck jury tasks
  A-->>S: rulings
  S->>A: Report task
  A-->>S: research report
  S->>B: final artifacts stats report
  S->>M: AgentWorkflowResult
  M-->>T: result data
  T-->>U: summary and paths
```

## 事实状态流转

```mermaid
stateDiagram-v2
  [*] --> raw_fact: Extract
  raw_fact --> capped_fact: rank and FACT_CAP
  capped_fact --> grouped: Group success
  capped_fact --> per_fact_group: Group fallback
  grouped --> jury_pending: Crosscheck enqueue
  per_fact_group --> jury_pending: Crosscheck enqueue
  jury_pending --> upheld: cast_count >= quorum and rejects < quorum
  jury_pending --> rejected: rejects >= quorum
  jury_pending --> rejected: cast_count < quorum
  upheld --> reported: Report success
  rejected --> reported: Report includes rejected
  upheld --> fallback_report: Report null
  rejected --> fallback_report: Report null
  reported --> [*]
  fallback_report --> [*]
```

## Artifact ER

```mermaid
erDiagram
  RESEARCH_PLAN ||--o{ SEARCH_LINE : contains
  SEARCH_LINE ||--o{ SEARCH_HIT : produces
  SEARCH_HIT }o--|| SOURCE_RECORD : selected_as
  SOURCE_RECORD ||--o{ EXTRACTED_FACT : supports
  EXTRACTED_FACT }o--o{ FACT_GROUP : member_of
  FACT_GROUP ||--o{ JURY_RULING : reviewed_by
  FACT_GROUP ||--|| CHECKED_GROUP : decided_as
  CHECKED_GROUP }o--|| RESEARCH_REPORT : summarized_in
  SOURCE_RECORD }o--|| RESEARCH_REPORT : cited_by

  RESEARCH_PLAN {
    string topic
    string objective
  }
  SEARCH_LINE {
    string line_id
    string query
    string angle
  }
  SOURCE_RECORD {
    string source_id
    string canonical_url
    string tier
    string fetch_status
  }
  EXTRACTED_FACT {
    string fact_id
    string statement
    string excerpt
    string weight
  }
  FACT_GROUP {
    string group_id
    string canonical_statement
    int support_count
  }
  JURY_RULING {
    string ruling_id
    bool reject
    bool abstain
  }
  CHECKED_GROUP {
    string status
    int cast_count
    int reject_count
    string tally
  }
  RESEARCH_REPORT {
    string answer
    int finding_count
    int rejected_count
  }
```
