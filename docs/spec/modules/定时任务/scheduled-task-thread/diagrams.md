# Scheduled Task Thread Spec · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/03/04 是文字事实源，本文件是只读视图——增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](#总览)
- [M1 scheduler domain/store contract](#m1-scheduler-domainstore-contract)
- [M2 scheduler manager/provisioning](#m2-scheduler-managerprovisioning)
- [M3 execution bridge session binding](#m3-execution-bridge-session-binding)
- [M4 web thread metadata/REST contract](#m4-web-thread-metadatarest-contract)
- [M5 frontend navigation](#m5-frontend-navigation)
- [数据关系](#数据关系)
- [状态流转](#状态流转)

图例：P0 核心/阻塞 · P1 主要/必须 · P2 辅助/可选

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  M1["M1 domain/store<br/>P0 · thread_id 一等字段"]:::p0
  M4["M4 thread metadata/REST<br/>P0 · thread_kind 协议"]:::p0
  M2["M2 SchedulerManager<br/>P0 · 创建链路门户"]:::p0
  M3["M3 ExecutionBridge<br/>P0 · 执行落绑定 thread"]:::p0
  M5["M5 frontend navigation<br/>P1 · 分组与打开历史"]:::p1
  M6["M6 validation<br/>P1 · 验证闭环"]:::p1

  M1 --> M2
  M4 --> M2
  M1 --> M3
  M2 --> M3
  M4 --> M5
  M1 --> M6
  M2 --> M6
  M3 --> M6
  M5 --> M6
```

## M1 scheduler domain/store contract

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph M1["M1 scheduler domain/store contract"]
    Task["ScheduledTask<br/>P0 · thread_id 字段"]:::p0
    Ctx["TaskExecutionContext<br/>P0 · thread_id 运行上下文"]:::p0
    Store["Store<br/>P1 · JSON roundtrip 与回填"]:::p1
    Recover["recover_task_thread_id<br/>P1 · 兼容恢复规则"]:::p1
  end

  Store --> Task
  Store --> Recover
  Ctx --> Task
```

## M2 scheduler manager/provisioning

### 创建链路

```mermaid
sequenceDiagram
  participant Caller as Web route / schedule_tool
  participant Manager as SchedulerManager
  participant Threads as ThreadManager
  participant Store as Store

  Caller->>Manager: create_task_with_thread(command)
  Manager->>Threads: create_scheduled_task_thread(...)
  Threads-->>Manager: thread_id
  Manager->>Store: create_task(thread_id, delivery.target)
  Store-->>Manager: ScheduledTask
  Manager-->>Caller: ScheduledTask
```

### 补偿路径

```mermaid
sequenceDiagram
  participant Manager as SchedulerManager
  participant Threads as ThreadManager
  participant Store as Store

  Manager->>Threads: create_scheduled_task_thread(...)
  Threads-->>Manager: thread_id
  Manager->>Store: create_task(...)
  Store-->>Manager: error
  Manager->>Threads: delete_thread(thread_id)
  Manager-->>Manager: raise create error
```

## M3 execution bridge session binding

### 执行链路

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph M3["M3 execution bridge session binding"]
    Bridge["ExecutionBridge<br/>P0 · 选择 session_id"]:::p0
    Runner["Runner.run<br/>P0 · 写 user/assistant 历史"]:::p0
    Delivery["DeliveryDispatcher<br/>P1 · 广播与 target 策略"]:::p1
    Audit["Cron audit<br/>P1 · 记录 thread_id"]:::p1
  end

  Task["ScheduledTask.thread_id<br/>邻居输入"]:::p0
  WebSink["WebDeliverySink<br/>邻居广播"]:::p1
  TargetSink["ThreadTargetSink<br/>邻居追加"]:::p2

  Task --> Bridge
  Bridge --> Runner
  Bridge --> Audit
  Bridge --> Delivery
  Delivery --> WebSink
  Delivery -.-> TargetSink
```

## M4 web thread metadata/REST contract

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph M4["M4 web thread metadata/REST contract"]
    TM["ThreadManager<br/>P0 · thread 门户"]:::p0
    Meta["ThreadMetadata v11<br/>P0 · thread_kind/source_*"]:::p0
    ThreadsAPI["threads router<br/>P1 · DTO 字段"]:::p1
    CronAPI["cron router<br/>P1 · thread_id DTO"]:::p1
    Protocol["protocol.ts<br/>P1 · TS 合同"]:::p1
  end

  TM --> Meta
  ThreadsAPI --> TM
  CronAPI --> TM
  ThreadsAPI --> Protocol
  CronAPI --> Protocol
```

## M5 frontend navigation

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph M5["M5 frontend navigation"]
    SchedulerAPI["scheduler api/store<br/>P0 · threadId 映射"]:::p0
    TaskRow["Scheduler task row<br/>P1 · 打开 thread"]:::p1
    ThreadList["ThreadList<br/>P1 · 定时任务分组"]:::p1
    Router["thread selection<br/>P1 · 切换历史"]:::p1
  end

  Protocol["protocol.ts<br/>邻居合同"]:::p1

  Protocol --> SchedulerAPI
  SchedulerAPI --> TaskRow
  Protocol --> ThreadList
  TaskRow --> Router
  ThreadList --> Router
```

## 数据关系

```mermaid
erDiagram
  SCHEDULED_TASK ||--|| THREAD_METADATA : binds
  SCHEDULED_TASK ||--o{ SCHEDULED_RUN_REQUEST : executes
  SCHEDULED_RUN_REQUEST ||--|| TASK_EXECUTION_CONTEXT : carries
  SCHEDULED_TASK ||--o{ SCHEDULED_RUN : produces
  THREAD_METADATA ||--o{ THREAD_MESSAGE : contains

  SCHEDULED_TASK {
    string task_id
    string name
    string thread_id
    string preset_id
    string delivery_target
  }
  THREAD_METADATA {
    string id
    string backend_kind
    string thread_kind
    string source_kind
    string source_id
  }
  SCHEDULED_RUN_REQUEST {
    string run_id
    string session_id
    string user_input
    string agent_name
  }
  TASK_EXECUTION_CONTEXT {
    string task_id
    string scheduled_for
    string trigger_type
    string origin
    boolean is_scheduled_run
    string thread_id
  }
  SCHEDULED_RUN {
    string run_id
    string task_id
    string session_id
    string status
  }
  THREAD_MESSAGE {
    string session_id
    string role
    string content
  }
```

## 状态流转

### 创建状态

```mermaid
stateDiagram-v2
  [*] --> request_received
  request_received --> thread_created: create thread
  thread_created --> task_created: create task
  task_created --> created
  thread_created --> thread_rollback_requested: task create failed
  thread_rollback_requested --> failed
  created --> [*]
  failed --> [*]
```

### 执行状态

```mermaid
stateDiagram-v2
  [*] --> reserved
  reserved --> session_bound: task.thread_id
  session_bound --> runner_running
  runner_running --> run_completed
  runner_running --> run_failed
  run_completed --> cron_broadcasted
  cron_broadcasted --> recorded
  run_failed --> recorded
  recorded --> [*]
```
