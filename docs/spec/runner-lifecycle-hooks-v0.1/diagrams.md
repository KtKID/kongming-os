# runner-lifecycle-hooks-v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/04 是文字事实源，本文件是只读视图，增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](./diagrams.md#总览)
- [E2E 测试链路](./diagrams.md#e2e-测试链路)
- [Runner Hook 主流程](./diagrams.md#runner-hook-主流程)
- [Lifecycle Hook 定义](./diagrams.md#lifecycle-hook-定义)
- [Runner Hook 调度](./diagrams.md#runner-hook-调度)
- [SessionEngine 注册表](./diagrams.md#SessionEngine-注册表)
- [Evolution Hook 消费者](./diagrams.md#evolution-hook-消费者)
- [生命周期数据关系](./diagrams.md#生命周期数据关系)

图例：P0 蓝色表示核心/阻塞性，P1 橙色表示主要/必须完成，P2 灰色表示辅助/可选。

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Lifecycle["Lifecycle Hook 定义<br/>命名触发点与 Protocol<br/>类/函数：LifecycleHook.after_run()"]:::p0
  Runner["Runner Hook 调度<br/>统一调用 turn/tool/run hook<br/>类/函数：Runner._run_lifecycle_after_run()"]:::p0
  Runtime["SessionEngine 注册表<br/>build 后注册与 run 入口快照<br/>类/函数：SessionEngine.add_lifecycle_hook()"]:::p0
  Evolution["Evolution Hook 消费者<br/>自我进化 after_run adapter<br/>类/函数：EvolutionLifecycleHook.after_run()"]:::p1
  Hosts["Host 装配迁移<br/>CLI/Web build 后注册<br/>类/函数：runtime.add_lifecycle_hook()"]:::p1
  Tests["验证与文档对齐<br/>顺序测试与旧 API 清理<br/>类/函数：RunnerLifecycleHookTestSuite"]:::p1
  Events["EventSink<br/>事实事件落地<br/>类/函数：EventSink.emit()"]:::p2

  Lifecycle --> Runner
  Runtime --> Runner
  Hosts --> Runtime
  Hosts --> Evolution
  Evolution --> Runtime
  Runner -.-> Events
  Tests --> Lifecycle
  Tests --> Runner
  Tests --> Runtime
  Tests --> Evolution
```

## E2E 测试链路

```mermaid
flowchart LR
  classDef setup fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef action fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef assert fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Build["准备 runtime<br/>SessionEngine.build(fake deps)"]:::setup
  Register["注册 hook<br/>runtime.add_lifecycle_hook(fake hook)"]:::action
  Run["执行首个 run<br/>runtime.run() 或 continue"]:::action
  Result["构造 Result<br/>completed/failed/cancelled"]:::action
  Hook["触发 after_run<br/>fake hook 记录 marker"]:::action
  End["发出 run.end<br/>EventSink 记录 terminal event"]:::assert
  Assert["断言<br/>after_run 早于 run.end<br/>旧 after_run_hooks 清零"]:::assert

  Build --> Register --> Run --> Result --> Hook --> End --> Assert
```

## Runner Hook 主流程

```mermaid
sequenceDiagram
  participant Host as Host 装配层
  participant Runtime as SessionEngine
  participant Runner as Runner
  participant Hook as LifecycleHook
  participant Sink as EventSink

  Host->>Runtime: SessionEngine.build(...)
  Host->>Runtime: add_lifecycle_hook(EvolutionLifecycleHook)
  Host->>Runtime: run() / continue_from_last_user_message()
  Runtime->>Runtime: snapshot lifecycle hooks
  Runtime->>Runner: run(..., lifecycle_hooks=snapshot)
  Runner->>Sink: run.start
  Runner->>Sink: turn.start
  Runner->>Hook: before_turn(state)
  Runner->>Hook: after_turn(state, assistant_message)
  Runner->>Hook: before_tool(state, call)
  Runner->>Hook: after_tool(state, call, result_message)
  Runner->>Runner: construct Result
  Runner->>Hook: after_run(state, session, result)
  Runner->>Sink: run.end
  Runner-->>Runtime: Result
```

## Lifecycle Hook 定义

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Lifecycle["Lifecycle Hook 定义（边界 = core/lifecycle.py）"]
    Protocol["LifecycleHook<br/>P0 · 统一 Protocol"]:::p0
    Points["LifecycleHookPointSpec<br/>P0 · 命名触发点说明"]:::p0
    Turn["before_turn / after_turn<br/>P1 · turn 触发点"]:::p1
    Tool["before_tool / after_tool<br/>P1 · tool 触发点"]:::p1
    Run["after_run<br/>P0 · Result 后 run.end 前"]:::p0
  end

  State["RunState<br/>core 状态对象"]:::p2
  Session["Session<br/>core contract"]:::p2
  Result["Result<br/>run 终态对象"]:::p2

  Protocol --> Turn
  Protocol --> Tool
  Protocol --> Run
  Points --> Protocol
  Run --> State
  Run --> Session
  Run --> Result
```

## Runner Hook 调度

### Runner hook 时序

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Start["run.start<br/>EventSink fact"]:::p2
  TurnStart["turn.start<br/>进入 turn"]:::p2
  BeforeTurn["before_turn<br/>history 读取前"]:::p1
  AfterTurn["after_turn<br/>assistant 写入后"]:::p1
  BeforeTool["before_tool<br/>approval 前"]:::p1
  AfterTool["after_tool<br/>tool_result 后"]:::p1
  Result["Result constructed<br/>completed / failed / cancelled"]:::p0
  AfterRun["after_run<br/>run.end 前"]:::p0
  End["run.end<br/>terminal fact"]:::p2

  Start --> TurnStart --> BeforeTurn --> AfterTurn --> BeforeTool --> AfterTool --> Result --> AfterRun --> End
  AfterTurn -.无 tool.-> Result
```

### Hook 异常隔离

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Hook["LifecycleHook method<br/>任意触发点"]:::p1
  Error["Exception / CancelledError<br/>hook 内部异常"]:::p1
  Emit["error event<br/>source=lifecycle_hook"]:::p0
  Result["Result<br/>保持原状态"]:::p2
  End["run.end<br/>继续发出"]:::p2

  Hook --> Error --> Emit --> Result --> End
```

## SessionEngine 注册表

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Runtime["SessionEngine 注册表（边界 = runtime_assembly/session_engine.py）"]
    Manager["SessionEngine<br/>P0 · 注册表 owner"]:::p0
    Add["add_lifecycle_hook<br/>P0 · 装配期注册"]:::p0
    Remove["remove_lifecycle_hook<br/>P1 · 按身份移除"]:::p1
    Snapshot["_lifecycle_hooks_snapshot<br/>P0 · run 入口快照"]:::p0
  end

  Hook["LifecycleHook<br/>core Protocol"]:::p2
  Runner["Runner.run / continue<br/>消费 snapshot"]:::p0

  Manager --> Add
  Manager --> Remove
  Manager --> Snapshot
  Add --> Hook
  Remove --> Hook
  Snapshot --> Runner
```

### SessionEngine 注册状态

```mermaid
stateDiagram-v2
  [*] --> built
  built --> hook_registered: add_lifecycle_hook
  hook_registered --> first_run_snapshot: run入口快照
  first_run_snapshot --> run_invoked: 传给 Runner
  run_invoked --> hook_registered: run完成
  hook_registered --> hook_removed: remove_lifecycle_hook
  hook_removed --> next_run_snapshot: 下一次run入口快照
  next_run_snapshot --> run_invoked
```

## Evolution Hook 消费者

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph EvolutionHook["Evolution Hook 消费者（边界 = EvolutionLifecycleHook）"]
    Adapter["EvolutionLifecycleHook<br/>P1 · after_run adapter"]:::p1
    RuntimeCtx["SessionEngine context<br/>P1 · agent_spec/tools"]:::p1
    Manager["EvolutionManager<br/>P0 · cadence 与 reviewer 业务"]:::p0
  end

  Runner["Runner<br/>调用 after_run"]:::p0
  Store["evolution artifacts<br/>现有业务产物"]:::p2

  Runner --> Adapter
  Adapter --> RuntimeCtx
  Adapter --> Manager
  Manager --> Store
```

## 生命周期数据关系

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#181A1F", "primaryColor": "#242933", "primaryTextColor": "#F5F7FA", "primaryBorderColor": "#6BA7FF", "lineColor": "#AAB4C0", "textColor": "#F5F7FA", "edgeLabelBackground": "#181A1F"}}}%%
flowchart LR
  classDef entity fill:#1F2633,stroke:#6BA7FF,color:#F5F7FA,stroke-width:1.5px
  classDef supporting fill:#191F29,stroke:#AAB4C0,color:#F5F7FA,stroke-width:1.2px

  RUNTIME["session_engine<br/>────────<br/>PK runtime_id<br/>status"]:::entity
  REGISTRY["HOOK_REGISTRY<br/>────────<br/>FK runtime_id<br/>count"]:::entity
  HOOK["LIFECYCLE_HOOK<br/>────────<br/>PK object_id<br/>method_set"]:::entity
  RUN["RUN<br/>────────<br/>PK run_id<br/>status"]:::entity
  SNAPSHOT["HOOK_SNAPSHOT<br/>────────<br/>FK run_id<br/>count"]:::supporting
  RESULT["RESULT<br/>────────<br/>PK run_id<br/>status"]:::entity
  EVENT["EVENT<br/>────────<br/>FK run_id<br/>kind"]:::supporting

  RUNTIME -->|owns 1:1| REGISTRY
  REGISTRY -->|contains 1:N| HOOK
  RUNTIME -->|starts 1:N| RUN
  RUN -->|captures 1:1| SNAPSHOT
  SNAPSHOT -->|references 1:N| HOOK
  RUN -->|constructs 1:1| RESULT
  RUN -->|emits 1:N| EVENT
```
