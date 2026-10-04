# pending-input-queue-v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/03/04 是文字事实源，本文件是只读视图，增减模块或组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](./diagrams.md#总览)
- [E2E 测试链路](./diagrams.md#e2e-测试链路)
- [Runtime Gate](./diagrams.md#runtime-gate)
- [Protocol](./diagrams.md#protocol)
- [Queue UI](./diagrams.md#queue-ui)
- [Choice/Avatar Bridge](./diagrams.md#choiceavatar-bridge)
- [数据关系/状态流转](./diagrams.md#数据关系状态流转)

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Gate["Pending Input Runtime Gate<br/>统一同 thread 普通 run start 与 drain<br/>类/函数：ThreadManager.submit_user_input()"]:::p0
  Protocol["Pending Input Protocol<br/>定义队列 DTO 与 WS 帧<br/>类/函数：PendingInputDTO"]:::p0
  UI["Pending Queue UI<br/>输入框上方展示可编辑队列<br/>类/函数：PendingInputQueueManager.applySnapshot()"]:::p1
  Bridge["Choice/Avatar Submission Bridge<br/>choice 与 Avatar 适配统一入口<br/>类/函数：ThreadManager.submit_choice_result()"]:::p1
  Tests["Verification and Contract Tests<br/>锁定并发、协议、UI、多 tab 行为<br/>类/函数：Test Harness"]:::p2

  Bridge --> Gate
  Gate --> Protocol
  Protocol --> UI
  Gate -.-> Tests
  Protocol -.-> Tests
  UI -.-> Tests
  Bridge -.-> Tests
```

## E2E 测试链路

```mermaid
flowchart LR
  classDef setup fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef action fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef assert fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Seed["准备 fake thread<br/>active run task + WS clients"]:::setup
  SendUser["用户动作<br/>running 时发送 user.input"]:::action
  Queue["后端处理<br/>ThreadManager 入队并广播 snapshot"]:::action
  SendChoice["用户动作<br/>发送 choice.submit"]:::action
  Drain["run 收尾<br/>normal/user_interrupt 后 drain"]:::action
  Assert["断言<br/>单 current_run_task<br/>choice priority<br/>多 tab snapshot 一致"]:::assert

  Seed --> SendUser --> Queue --> SendChoice --> Drain --> Assert
```

## Runtime Gate

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph GateMod["Pending Input Runtime Gate"]
    Manager["ThreadManager<br/>P0 · 唯一 run start gate"]:::p0
    Submit["submit_* methods<br/>P0 · user/choice/avatar 入口"]:::p0
    Queue["pending_inputs<br/>P1 · 后端队列真源"]:::p1
    Drain["drain policy<br/>P1 · normal/Stop drain"]:::p1
    Lock["pending_input_lock<br/>P1 · 并发互斥"]:::p1
  end

  Cell["ThreadCell<br/>current_run_task"]:::p2
  WS["WebSocket routes<br/>只提交请求"]:::p2
  Avatar["AvatarAssistantManager<br/>adapter"]:::p2

  WS --> Submit
  Avatar --> Submit
  Submit --> Manager
  Manager --> Lock
  Manager --> Queue
  Manager --> Drain
  Manager --> Cell
```

### Run 完成后 drain

```mermaid
sequenceDiagram
  participant Run as current_run_task
  participant Manager as ThreadManager
  participant Cell as ThreadCell
  participant WS as WebSocket Broadcast

  Run->>Manager: completion_reason
  Manager->>Cell: clear current_run_task
  Manager->>Manager: should_drain(reason)
  alt normal or user_interrupt
    Manager->>Cell: pop next pending input
    Manager->>WS: pending-input.started
    Manager->>Cell: set current_run_task
  else lifecycle stop
    Manager->>WS: pending-input.changed or thread unavailable
  end
```

## Protocol

### Frame 流向

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Py["Python ws_frames<br/>PendingInput DTO 真源"]:::p0
  TS["TS protocol.ts<br/>PendingInput interface 复刻"]:::p0
  Snapshot["pending-input.snapshot<br/>订阅/重连全量"]:::p1
  Changed["pending-input.changed<br/>增删改重排"]:::p1
  Started["pending-input.started<br/>队列项启动 run"]:::p1
  Error["ErrorFrame<br/>pending_input_queue_full"]:::p2

  Py --> Snapshot
  Py --> Changed
  Py --> Started
  Py --> Error
  Py -.-> TS
```

## Queue UI

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph UIMod["Pending Queue UI"]
    Store["PendingInputQueueManager<br/>P0 · snapshot 状态边界"]:::p0
    Panel["PendingInputQueuePanel<br/>P0 · 输入框上方队列"]:::p0
    Editor["QueueItemEditor<br/>P1 · 编辑内容"]:::p1
    Controls["QueueControls<br/>P1 · 删除/上移/下移"]:::p1
    Counter["QueueCounter<br/>P2 · 20 条计数"]:::p2
  end

  Chat["Chat.tsx<br/>ChoicePanel + QueuePanel + Composer"]:::p2
  Composer["Composer<br/>running 时允许文本 submit"]:::p2
  Network["WebSocket client<br/>发送操作帧"]:::p2

  Chat --> Store
  Store --> Panel
  Panel --> Editor
  Panel --> Controls
  Panel --> Counter
  Chat --> Composer
  Store --> Network
```

## Choice/Avatar Bridge

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph BridgeMod["Choice/Avatar Submission Bridge"]
    ChoiceRoute["choice.submit route<br/>P0 · 格式化 choice 文本"]:::p0
    ChoiceFormat["format_choice_submit_as_user_input()<br/>P1 · 复用归一化"]:::p1
    AvatarAdapter["AvatarAssistantManager<br/>P1 · adapter 提交"]:::p1
  end

  Gate["ThreadManager<br/>统一 submit_choice_result/submit_avatar_input"]:::p0
  Queue["pending queue<br/>choice_response 优先"]:::p2

  ChoiceRoute --> ChoiceFormat
  ChoiceFormat --> Gate
  AvatarAdapter --> Gate
  Gate --> Queue
```

## 数据关系/状态流转

### 数据关系

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#181A1F", "primaryColor": "#242933", "primaryTextColor": "#F5F7FA", "primaryBorderColor": "#6BA7FF", "lineColor": "#AAB4C0", "textColor": "#F5F7FA", "edgeLabelBackground": "#181A1F"}}}%%
flowchart LR
  classDef entity fill:#1F2633,stroke:#6BA7FF,color:#F5F7FA,stroke-width:1.5px
  classDef supporting fill:#191F29,stroke:#AAB4C0,color:#F5F7FA,stroke-width:1.2px

  THREAD["THREAD_CELL<br/>────────<br/>PK thread_id<br/>status"]:::entity
  RUN["CURRENT_RUN<br/>────────<br/>PK run_id<br/>FK thread_id<br/>status"]:::entity
  INPUT["PENDING_INPUT<br/>────────<br/>PK id<br/>FK thread_id<br/>priority"]:::entity
  SNAP["SNAPSHOT<br/>────────<br/>FK thread_id<br/>version"]:::supporting
  CLIENT["WEB_CLIENT<br/>────────<br/>client_id<br/>thread_id"]:::supporting

  THREAD -->|owns 0:1| RUN
  THREAD -->|queues 0:N| INPUT
  THREAD -->|broadcasts 1:N| SNAP
  SNAP -->|renders 1:N| CLIENT
```

### 队列项状态

```mermaid
stateDiagram-v2
  [*] --> queued
  queued --> queued: update/reorder
  queued --> removed: cancel
  queued --> starting: drain or idle start
  starting --> running: set current_run_task
  running --> completed: normal
  running --> interrupted: user_interrupt
  running --> stopped: runtime_refresh_failed/evicted/shutdown/deleted
  completed --> [*]
  interrupted --> [*]
  removed --> [*]
  stopped --> [*]
```

### Drain Policy

```mermaid
stateDiagram-v2
  [*] --> run_done
  run_done --> drain_next: normal
  run_done --> drain_next: user_interrupt
  run_done --> skip_drain: runtime_refresh_failed
  run_done --> skip_drain: evicted
  run_done --> skip_drain: shutdown
  run_done --> skip_drain: deleted
  drain_next --> [*]
  skip_drain --> [*]
```
