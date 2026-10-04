# agent-tree-v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/04/05 是文字事实源，本文件是只读视图——增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](./diagrams.md#总览)
- [E2E 测试链路](./diagrams.md#e2e-测试链路)
- [模块 A · AgentManager](./diagrams.md#模块-a-agentmanager)
- [模块 B · TaskRegistry](./diagrams.md#模块-b-taskregistry)
- [模块 C · Mailbox + agent_loop](./diagrams.md#模块-c-mailbox--agent_loop)
- [模块 D · run 终态分类器](./diagrams.md#模块-d-run-终态分类器)
- [模块 F · 审批 agent_id 维度](./diagrams.md#模块-f-审批-agent_id-维度)
- [模块 G · Event/wire 协议扩展](./diagrams.md#模块-g-eventwire-协议扩展)
- [跨模块状态与数据](./diagrams.md#跨模块状态与数据)

图例：🔵 P0 核心/阻塞性 · 🟠 P1 主要/必须完成 · ⚪ P2 辅助/可选。节点写模块名、中文作用、关键类/函数。

## 图类型规范

| 节 | 放什么图 | mermaid 类型 |
|----|---------|-------------|
| 总览 | 模块级依赖图：每模块一个节点，只画模块间关系 | `flowchart TD` |
| E2E 测试链路 | 从测试数据准备到断言的端到端验证路径 | `flowchart LR` |
| 模块节 | 局部组件依赖图、核心流程图、时序图、状态流转图、数据关系图 | `flowchart TD/LR` / `sequenceDiagram` / `stateDiagram-v2` |

写图顺序：先总览，再 E2E 测试链路，再按模块拆局部图，最后跨模块状态/数据。单图节点约 12 个以内。

## 总览

模块级依赖图：每个模块一个节点，只画模块间关系。实线=强依赖，虚线=弱/调起。

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  ModA["A · AgentManager<br/>主+子 agent 生命周期门户<br/>类：AgentManager.spawn()/cancel_subtree()"]:::p0
  ModB["B · TaskRegistry<br/>资源账本 + 树级砍靶<br/>类：TaskRegistry.cancel_subtree()"]:::p0
  ModC["C · Mailbox + agent_loop<br/>串行驱动内核 + epoch 门卫<br/>协程：agent_loop()"]:::p0
  ModD["D · run 终态分类器<br/>Result→Disposition<br/>函数：classify_result()"]:::p1
  ModF["F · 审批 agent_id 维度<br/>控制面加 agent_id + 共享 bridge<br/>类：_PendingApproval"]:::p1
  ModG["G · Event/wire 协议扩展<br/>坐标字段 + 流式 agent_id<br/>类：Event / Message"]:::p1
  Runner["Runner（复用）<br/>唯一 run loop<br/>类：Runner._drive_turns()"]:::p2
  ModH["H · 统一时间工具<br/>收编散落 epoch-ms helper<br/>函数：now_epoch_ms() / now_iso()"]:::p2
  ThreadCell["ThreadCell（host 装配 + 树态 owner）<br/>+root_agent / +registry owner / +epoch owner<br/>方法：bump_epoch()"]:::p0

  ThreadCell -->|owns root_agent| ModA
  ThreadCell -->|owns| ModB
  ThreadCell -->|owns| ModF
  ModA -->|账本登记| ModB
  ModA -->|cancel 编排| ModC
  ModA -->|spawn 建 cell| ModC
  ModC -->|run_fn| Runner
  ModC -->|match 消费| ModD
  ModC -->|Event/Mail 字段| ModG
  ModF -.->|pending future 取消| ModB
  ModH -.->|Event.timestamp_ms| ModG
  ModH -.->|Mail.enqueued_at_ms| ModC
  ModH -.->|TaskRecord 审计时间| ModB
```

## E2E 测试链路

从测试数据准备、用户动作、系统处理到断言的验证路径。

```mermaid
flowchart LR
  classDef setup fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef action fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef assert fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Seed["准备测试数据<br/>建 ThreadCell + 主 AgentCell A"]:::setup
  UserMsg["用户发消息<br/>Mail(user_message) 入 A mailbox"]:::action
  RunA["A run<br/>agent_loop 取消息 → Runner.run()"]:::action
  Spawn["spawn B<br/>AgentManager.spawn() 登记 TaskRecord + 建 AgentCell B"]:::action
  ReplyA["A 立即回「已派出 B」<br/>tool_result 返回 {child_id, dispatched}"]:::action
  Idle["A idle<br/>用户继续聊 A（不阻塞）"]:::action
  RunB["B run<br/>B agent_loop → Runner.run() 完成任务"]:::action
  ChildResult["child_result<br/>Mail(child_result, epoch) 入 A mailbox"]:::action
  RunA2["A 新 run 汇总<br/>A agent_loop 取 child_result → Runner.run()"]:::action
  Assert["断言<br/>A 汇总报告用户<br/>流式帧带 agent_id"]:::assert

  Seed --> UserMsg --> RunA --> Spawn --> ReplyA --> Idle --> RunB --> ChildResult --> RunA2 --> Assert
```

打断侧链 E2E：

```mermaid
flowchart LR
  classDef setup fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef action fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef assert fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Spawn["A 派出 B<br/>B running（run_task + bash PID）"]:::action
  Stop["用户点 Stop<br/>WS interrupt 帧"]:::action
  Cancel["cancel_subtree(A)<br/>bump_epoch + TaskRegistry.cancel_subtree"]:::action
  Kill["后序砍靶<br/>B run_task cancel + B PID kill+wait"]:::action
  Purge["mailbox purge<br/>A 内部消息（旧 epoch）被门卫拦截"]:::action
  Assert["断言<br/>A 回 idle，无复活说话<br/>无僵尸进程/孤儿子"]:::assert

  Spawn --> Stop --> Cancel --> Kill --> Purge --> Assert
```

## 模块 A · AgentManager

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph ModA["模块 A · AgentManager（边界 = subgraph 框线）"]
    AM["AgentManager<br/>P0 · 边界类，唯一入口<br/>spawn/cancel_subtree/list_agents"]:::p0
    SpawnCore["spawn 实现<br/>P0 · 建 cell + 登记 + 启 loop + 返回 dispatched"]:::p0
    CancelCore["cancel_subtree 编排<br/>P0 · bump_epoch + registry 砍靶 + purge"]:::p0
    CellReg["AgentCell 注册表<br/>P1 · register/unregister/close_cell"]:::p1
  end

  ModB["B · TaskRegistry<br/>邻居，账本登记"]:::p0
  ModC["C · Mailbox/agent_loop<br/>邻居，cell 内部"]:::p0
  ThreadCell["ThreadCell（host 装配）<br/>邻居，树态/epoch owner"]:::p0
  Runner["Runner<br/>run_fn"]:::p2

  ModB --> AM
  ThreadCell --> AM
  AM --> SpawnCore
  AM --> CancelCore
  AM --> CellReg
  SpawnCore --> ModC
  SpawnCore --> ModB
  SpawnCore --> Runner
  CancelCore --> ModB
  CancelCore --> ThreadCell
```

## 模块 B · TaskRegistry

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph ModB["模块 B · TaskRegistry（边界 = subgraph 框线）"]
    TR["TaskRegistry<br/>P0 · 边界类，纯账本"]:::p0
    Reg["register_run/register_external<br/>P0 · 登记 TaskRecord(pending)"]:::p0
    Cancel["cancel_subtree<br/>P0 · 后序遍历砍靶 + kill+wait"]:::p0
    Close["close_registry<br/>P0 · 关门标志拒绝新登记"]:::p0
    NoDesc["no_live_descendants<br/>P1 · single_shot 退出判定"]:::p1
  end

  ModA["A · AgentManager<br/>调用方"]:::p0
  Bash["subprocess PID<br/>external_process kill 靶"]:::p2

  ModA --> TR
  TR --> Reg
  TR --> Cancel
  TR --> Close
  TR --> NoDesc
  Cancel -->|kill+wait| Bash
```

### cancel_subtree 后序流程

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px

  Start["cancel_subtree(agent_id) 入口"]:::p0
  Close["置关门标志 close_registry()<br/>拒绝新登记（防孤儿子）"]:::p0
  Traverse["后序遍历子树<br/>先子孙后自身"]:::p0
  KillRun["砍 agent_run：run_task.cancel()<br/>asyncio cancellation 沿 await 链"]:::p0
  KillPid["砍 external_process：PID kill + wait<br/>兜底防僵尸"]:::p0
  Done["子树全部终态"]:::p1

  Start --> Close --> Traverse
  Traverse --> KillRun
  Traverse --> KillPid
  KillRun --> Done
  KillPid --> Done
```

## 模块 C · Mailbox + agent_loop

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph ModC["模块 C · Mailbox + agent_loop（边界 = subgraph 框线）"]
    Cell["AgentCell<br/>P0 · 对外暴露（含 mailbox/run_task）"]:::p0
    MB["asyncio.Queue[Mail]<br/>P0 · 串行输入流"]:::p0
    Loop["agent_loop 协程<br/>P0 · 常驻消费"]:::p0
    Gate["epoch 门卫<br/>P0 · 旧世代内部投递丢弃"]:::p0
    Match["Disposition action 二选一<br/>P0 · 上投/不上投"]:::p0
  end

  ModD["D · run 终态分类器<br/>classify_result() 产出"]:::p1
  ModB["B · TaskRegistry<br/>register_run"]:::p0
  Runner["Runner.run()<br/>run_fn"]:::p2

  ModD -->|Disposition| Match
  ModB --> Cell
  Cell --> MB
  Cell --> Loop
  Loop --> Gate
  Loop -->|await| Runner
  Loop --> Match
```

### agent_loop 核心流程

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px

  Get["await mailbox.get()<br/>取队头 Mail"]:::p0
  Gate{"epoch 门卫<br/>kind!=user_message<br/>且 mail.epoch<current_tree_epoch?"}:::p0
  Drop["丢弃（旧世代内部投递）<br/>user_message 永不过期"]:::p1
  Stamp["盖章 run_epoch = mail.epoch（内部投递）<br/>user_message 取 0；state=running"]:::p0
  Create["create_task(Runner.run(seed))<br/>registry.register_run"]:::p0
  Await["await run_task<br/>约束16：cancel 收口成 Result，不 raise"]:::p0
  Catch{"Exception?<br/>actor 不失聪兜底"}:::p1
  InternalFail["internal_failure_result(exc)"]:::p1
  Classify["classify_result(result) → Disposition"]:::p0
  MatchC{"action 二选一"}:::p0
  D1["Completed → deliver_up_or_ui"]:::p0
  D2["Cancelled tree_wide=True → emit_only"]:::p0
  D3["Cancelled tree_wide=False → deliver_up_or_ui(cancelled_notice)"]:::p0
  D4["Failed → deliver_failure_up"]:::p0
  D5["Exhausted → deliver_partial_up"]:::p0
  Exit{"single_shot<br/>且 no_live_descendants?"}:::p1
  Close["break → close_cell<br/>注销 + 关 mailbox"]:::p1
  Idle["state=idle<br/>回 mailbox.get()"]:::p0

  Get --> Gate
  Gate -- 是 --> Drop --> Get
  Gate -- 否 --> Stamp --> Create --> Await --> Catch
  Catch -- 是 --> InternalFail --> Classify
  Catch -- 否 --> Classify
  Classify --> MatchC
  MatchC --> D1
  MatchC --> D2
  MatchC --> D3
  MatchC --> D4
  MatchC --> D5
  D1 --> Exit
  D2 --> Exit
  D3 --> Exit
  D4 --> Exit
  D5 --> Exit
  Exit -- 是 --> Close
  Exit -- 否 --> Idle --> Get
```

## 模块 D · run 终态分类器

### reason 映射与分发

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Result["Result<br/>classify_result() 输入"]:::p0
  Completed["Completed<br/>正常完成"]:::p1
  Exhausted["Exhausted<br/>max_turns/token/cost"]:::p1
  Cancelled["Cancelled<br/>user_interrupt/parent_cascade<br/>hook_blocked/watchdog<br/>+ tree_wide"]:::p0
  Failed["Failed<br/>llm.capability/protocol_400/auth<br/>rate_limit/tool.execution/internal.bug"]:::p1

  Deliver1["deliver_up_or_ui"]:::p0
  Deliver2["deliver_partial_up"]:::p1
  Deliver3["tree_wide=True→emit_only<br/>False→deliver_up_or_ui"]:::p0
  Deliver4["deliver_failure_up"]:::p1

  Result --> Completed --> Deliver1
  Result --> Exhausted --> Deliver2
  Result --> Cancelled --> Deliver3
  Result --> Failed --> Deliver4
```

## 模块 F · 审批 agent_id 维度

### 控制面绕 mailbox 时序

```mermaid
sequenceDiagram
  participant Child as 子 agent B (run 中)
  participant AM as ApprovalManager
  participant Inbox as 会话级 inbox（控制面）
  participant Parent as 父 agent A (run 中)

  Note over Child,Parent: 审批是控制面，绕过 mailbox 直达 inbox<br/>否则父在跑 run 时子的审批排队挂死
  Child->>AM: 请求审批（agent_id=B）
  AM->>AM: _PendingApproval(channel, thread_id, agent_id=B, future)
  AM->>Inbox: 直达会话级 inbox（不经任何 mailbox）
  Note over Parent: 父 run 不受影响（审批不进父队列）
  Inbox-->>AM: 用户决策（子规则=父规则，路由按 thread_id）
  AM->>Child: future.set_result(决策)
  Note over Child: cancel_subtree 时 future.cancel() 取消子树 pending
```

## 模块 G · Event/wire 协议扩展

### 双侧真源同步

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph BE["后端 Python（repo:src/hosts/web/protocol/）"]
    PyEvent["Event<br/>+ agent_id/task_id/conversation_id"]:::p0
    PyMsg["Message<br/>复用现有，不加字段（provenance 走 metadata 软键）"]:::p0
    PyFrame["WS 流式帧<br/>+ agent_id"]:::p0
  end

  subgraph FE["前端 TS（repo:web/src/protocol.ts）"]
    TSEvent["Event fixture"]:::p0
    TSMsg["Message fixture"]:::p0
    TSFrame["WS 帧消费"]:::p0
  end

  Drift["协议漂移测试<br/>双侧 fixture 一致性"]:::p1

  PyEvent -.->|必须同步| TSEvent
  PyMsg -.->|必须同步| TSMsg
  PyFrame -.->|必须同步| TSFrame
  Drift -.->|断言| TSEvent
  Drift -.->|断言| TSMsg
```

## 跨模块状态与数据

### AgentCell 状态流转

```mermaid
stateDiagram-v2
  [*] --> idle: spawn/register
  idle --> running: mailbox.get() 取到消息<br/>盖章 run_epoch
  running --> idle: run_task 完成<br/>Disposition 处理完<br/>（persistent 或 single_shot 有子孙）
  running --> closed: single_shot 终态<br/>且 no_live_descendants
  idle --> closed: single_shot 终态<br/>且 no_live_descendants<br/>（退出条件通用式）
  closed --> [*]: close_cell 注销 + 关 mailbox
  note right of running
    cancel 砍 run_task（不砍 agent_loop）
    agent_loop 永不被单独 cancel
  end note
```

### epoch 世代流转

```mermaid
stateDiagram-v2
  [*] --> e0: ThreadCell.epoch=0
  e0 --> e1: cancel_subtree → bump_epoch
  e1 --> e2: cancel_subtree → bump_epoch
  e2 --> e3: cancel_subtree → bump_epoch
  note right of e1
    epoch 门卫：Mail.epoch<ThreadCell.epoch
    且 kind!=user_message → 丢弃
    user_message 永不过期
  end note
```

### 打断链时序

```mermaid
sequenceDiagram
  participant U as 用户
  participant A as 父 agent A
  participant B as 子 agent B
  participant Reg as TaskRegistry
  participant TC as ThreadCell

  Note over A,B: 段1：child_result 已进 A mailbox，A run 未启动
  B->>A: Mail(child_result, epoch=e0) 入队列
  U->>A: Stop（cancel_subtree A）
  A->>TC: bump_epoch → e1
  A->>Reg: cancel_subtree（关门标志）
  Reg->>B: run_task.cancel() + PID kill+wait
  Note over A: A mailbox.get() 取到旧 epoch mail
  A->>A: epoch 门卫拦截（e0<e1）→ 丢弃，不复活

  Note over A,B: 段2：A run 已启动，LLM 推理中
  U->>A: Stop
  A->>Reg: cancel_subtree
  Reg->>A: run_task.cancel() → CancelledError 在 await 挂起点炸开
  Note over A: 约束16：收口成 Result(cancelled) + 占位配对<br/>httpx 连接随协程取消关闭<br/>损失仅服务器侧已推理算力

  Note over A: 段3：A run 已跑完，回复已 append session + 推 UI
  Note over A: 必须不抛弃：session 已提交不可回滚<br/>该抛弃的只有此 run 完成后上投 mail<br/>带旧 epoch 绕回段1 被拦截
```

### 数据关系

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#181A1F", "primaryColor": "#242933", "primaryTextColor": "#F5F7FA", "primaryBorderColor": "#6BA7FF", "lineColor": "#AAB4C0", "textColor": "#F5F7FA", "edgeLabelBackground": "#181A1F"}}}%%
flowchart LR
  classDef entity fill:#1F2633,stroke:#6BA7FF,color:#F5F7FA,stroke-width:1.5px
  classDef supporting fill:#191F29,stroke:#AAB4C0,color:#F5F7FA,stroke-width:1.2px

  TREE["THREAD_CELL（树态 owner）<br/>────────<br/>PK thread_id<br/>root_agent (AgentCell)<br/>registry (TaskRegistry)<br/>epoch"]:::entity
  CELL["AGENT_CELL<br/>────────<br/>PK agent_id<br/>FK parent_id<br/>cwd, role_id<br/>state, lifecycle, depth"]:::entity
  TASK["TASK_RECORD<br/>────────<br/>PK task_id<br/>FK agent_id<br/>FK parent_task_id<br/>kind, status"]:::entity
  ENV["MAIL<br/>────────<br/>kind, sender<br/>recipient_agent_id<br/>task_id, epoch, payload"]:::supporting
  MSG["MESSAGE<br/>────────<br/>PK (session,seq)<br/>FK session_id<br/>role, metadata[source_agent_id]"]:::entity
  OUT["OUTCOME<br/>────────<br/>type<br/>reason/tree_wide/budget/error_class"]:::supporting

  TREE -->|owns root_agent 1:1| CELL
  CELL -->|owns 1:N| CELL
  CELL -->|runs 1:N| TASK
  CELL -->|consumes 0:N| ENV
  ENV -->|payload| MSG
  TASK -.->|produces| OUT
```
