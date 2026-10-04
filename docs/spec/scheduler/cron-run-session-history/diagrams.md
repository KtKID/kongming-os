# Cron Run Session History Diagrams

> 建议在支持 Mermaid 缩放的 Markdown 预览器中查看。所有图只描述本 spec 的模块边界、数据关系和主链路。

## 目录

- [总览](#总览)
- [数据关系](#数据关系)
- [执行链路](#执行链路)
- [前端分流](#前端分流)

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  SM["SchedulerManager<br/>P0 - run index portal"]:::p0
  EB["ExecutionBridge<br/>P0 - run session execution"]:::p0
  TM["ThreadManager<br/>P0 - thread/run API portal"]:::p0
  WS["cron.* protocol<br/>P0 - thread task run session tuple"]:::p0
  FS["Frontend scheduler store<br/>P0 - selected run state"]:::p0
  CP["Chat provider/timeline<br/>P0 - run-aware messages"]:::p0
  Store["Scheduler store<br/>P1 - task/run jsonl"]:::p1
  Session["Session store<br/>P1 - per-run history"]:::p1

  SM --> Store
  EB --> SM
  EB --> Session
  EB --> WS
  TM --> SM
  TM --> Session
  FS --> TM
  WS --> FS
  WS --> CP
  CP --> Session
```

## 数据关系

```mermaid
erDiagram
  SCHEDULED_TASK ||--o{ SCHEDULED_RUN : owns
  THREAD ||--|| SCHEDULED_TASK : entry_for
  SCHEDULED_RUN ||--|| RUN_SESSION : writes_to
  THREAD ||--o{ RUN_SESSION : groups

  THREAD {
    string thread_id
    string thread_kind
    string source_id
  }

  SCHEDULED_TASK {
    string task_id
    string thread_id
    string name
    string preset_id
  }

  SCHEDULED_RUN {
    string run_id
    string task_id
    string thread_id
    string session_id
    string status
    string scheduled_for
  }

  RUN_SESSION {
    string session_id
    string run_id
    string task_id
    string thread_id
  }
```

## 执行链路

```mermaid
sequenceDiagram
  participant Ticker
  participant EB as ExecutionBridge
  participant SM as SchedulerManager
  participant Session as Run Session
  participant WS as cron.* WS
  participant UI as Frontend

  Ticker->>EB: due task reservation
  EB->>EB: create run_id and session_id
  EB->>SM: append RUNNING run
  EB->>WS: cron.run.started(thread_id, task_id, run_id, session_id)
  EB->>Session: Runner.run(session_id)
  Session-->>EB: final message
  EB->>SM: supersede completed run
  EB->>WS: cron.run.finished(thread_id, task_id, run_id, session_id)
  EB->>WS: cron.message.appended(thread_id, task_id, run_id, session_id)
  WS-->>UI: append or update by selected run
```

## 前端分流

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Thread["Scheduled task thread<br/>P0 - single entry"]:::p0
  Runs["Run selector<br/>P0 - today yesterday manual"]:::p0
  Store["Scheduler store<br/>P0 - selectedRunIdByTaskId"]:::p0
  API["Task run API<br/>P0 - messages"]:::p0
  Timeline["Chat timeline<br/>P0 - threadId + runId key"]:::p0
  Composer["Composer<br/>P0 - send to selected run"]:::p0
  Other["Other run frames<br/>P1 - list badge only"]:::p1

  Thread --> Runs
  Runs --> Store
  Store --> API
  API --> Timeline
  Composer --> API
  Store --> Composer
  Other --> Store
```
