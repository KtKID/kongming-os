# 核心流程 + 时序

## 主流程：从用户发消息到 nutrient 写盘 + UI 卡片

```mermaid
flowchart TD
    classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
    classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
    classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

    A["用户在 claude thread 发消息<br/>P0 · 触发起点"]:::p0
    B["claude_code/route.py<br/>claude-command 入口"]:::p0
    C["EvolutionManager.notify_user_message<br/>P0 · 频道方调用的唯一 API"]:::p0
    D{"manager.enabled?"}
    E["state_store.record_parent_run<br/>P1 · 单例，manager 内部"]:::p1
    F{"cadence 满足?"}
    G["ClaudeTranscriptProvider.build_window<br/>P0 · 频道实现"]:::p0
    H["claude_evidence_selector<br/>P1 · task-1 产出"]:::p1
    I["_build_stub_parent_runtime<br/>P0 · 用 mini_registry + event_bus"]:::p0
    J["run_child_review<br/>P1 · 复用既有"]:::p1
    K["evolution_write tool<br/>P1 · 复用既有"]:::p1
    L["reviews/run-claude-*.json<br/>P1 · 落盘"]:::p1
    M["emit evolution.review.completed<br/>P1 · 含 run_id"]:::p1
    N["EvolutionEventBus.emit<br/>P0 · 按 thread_id 路由"]:::p0
    O["WsEventSink<br/>P1 · 频道方注册的 sink"]:::p1
    P["web 前端显示卡片<br/>P2 · 复用既有 UI"]:::p2
    Q["跳过<br/>P2 · no-op"]:::p2

    A --> B
    B --> C
    C --> D
    D -->|no| Q
    D -->|yes| E
    E --> F
    F -->|no| Q
    F -->|yes| G
    G --> H
    H --> G
    G --> I
    I --> J
    J --> K
    K --> L
    K --> M
    M --> N
    N --> O
    O --> P
```

## 时序图：完整的"连接 → 消息 → 断开"生命周期

```mermaid
sequenceDiagram
    participant Browser as Web Browser
    participant Route as claude_code/route.py
    participant App as app.state.evolution_manager
    participant Bus as EvolutionEventBus
    participant Provider as ClaudeTranscriptProvider
    participant Selector as claude_evidence_selector
    participant Stub as stub_parent_runtime
    participant Reviewer as run_child_review
    participant Tool as evolution_write
    participant State as state_store

    Note over Browser,Route: ① WS 连接建立
    Browser->>Route: WebSocket connect /ws/claude-code?thread_id=...
    Route->>Route: verify auth + thread_id
    Route->>App: app.state.evolution_manager.enabled?
    App-->>Route: True
    Route->>Route: sink = WsEventSink(ws, thread_id)
    Route->>App: register_event_route(thread_id, sink)
    App->>Bus: register(thread_id, sink)
    Route->>Browser: ws.accept()

    Note over Browser,Route: ② 用户发消息
    Browser->>Route: {type: claude-command, command: "..."}
    Route->>Route: asyncio.create_task(service.query(...))
    Note over Route: 用户主路径继续，下面是 fire-and-forget

    Route->>App: asyncio.create_task(<br/>notify_user_message(thread_id, ClaudeTranscriptProvider(...), cwd))
    Note over App: 以下全部异步、跟用户主路径解耦

    App->>State: record_parent_run(thread_id, ...)
    State-->>App: SessionLearningState(run_count=N)
    alt cadence 不满足
        App-->>App: return（no-op）
    end

    App->>Provider: build_window(run_id, max_messages)
    Provider->>Selector: build_claude_transcript_window(...)
    Selector-->>Provider: TranscriptWindow
    Provider-->>App: TranscriptWindow

    alt window.messages 为空
        App->>State: mark_review_result(status="skipped_empty_window")
        App-->>App: return
    end

    App->>Stub: _build_stub_parent_runtime()
    Note over Stub: 用 self._mini_registry + self._event_bus 装配
    Stub-->>App: SessionEngine
    App->>Reviewer: run_child_review(parent_runtime=stub, window, ...)
    Reviewer->>Reviewer: InMemorySession.append × N
    Reviewer->>Reviewer: spawn sub-agent, 跑 review prompt
    Reviewer->>Tool: evolution_write(review_result)
    Tool->>State: mark_review_result(status="written")
    Tool->>Bus: emit evolution.nutrient_written
    Bus->>Bus: 解析 run_id → thread_id
    Bus->>Browser: WsEventSink → ws.send_json({kind: system_notice, ...})
    Tool-->>Reviewer: outcome
    Reviewer->>Bus: emit evolution.review.completed
    Bus->>Browser: WsEventSink → ws.send_json(...)
    Reviewer-->>App: ChildReviewOutcome
    App->>Stub: await aclose()

    Note over Browser,Route: ③ WS 断开
    Browser-xRoute: disconnect
    Route->>App: unregister_event_route(thread_id)
    App->>Bus: unregister(thread_id)
```

## EvolutionManager 内部：mini_registry 装配（启动时一次）

```mermaid
sequenceDiagram
    participant Lifespan as web.app lifespan
    participant Manager as EvolutionManager.__init__
    participant Reg as ToolRegistry
    participant EvoTool as register_evolution_write_tool_if_enabled
    participant Bus as EvolutionEventBus
    participant Store as EvolutionStateStore + EvolutionStore

    Lifespan->>Manager: EvolutionManager(config, kongming_home)
    Manager->>Bus: EvolutionEventBus()  # 空 routes
    Manager->>Store: EvolutionStateStore(resolve_evolution_root)
    Manager->>Store: EvolutionStore(resolve_evolution_root)
    Manager->>Reg: ToolRegistry()  # 空 registry
    Manager->>EvoTool: register_evolution_write_tool_if_enabled(<br/>registry=Reg, config=cfg, event_sinks=[Bus])
    EvoTool->>Reg: registry.register(evolution_write_tool)
    Manager-->>Lifespan: manager instance
    Lifespan->>Lifespan: app.state.evolution_manager = manager
```

## EvolutionEventBus 路由细节

```mermaid
sequenceDiagram
    participant Reviewer as run_child_review
    participant Bus as EvolutionEventBus
    participant Routes as {thread_id: sink}
    participant SinkA as WsEventSink(ws_a)
    participant SinkB as WsEventSink(ws_b)

    Note over Reviewer: 跑完 review，emit 一系列事件
    Reviewer->>Bus: emit(Event(run_id="run-claude-thread-AAA-5", kind="evolution.review.completed"))
    Bus->>Bus: 正则解析 run_id → thread_id = "thread-AAA"
    Bus->>Routes: lookup("thread-AAA")
    Routes-->>Bus: SinkA
    Bus->>SinkA: emit(event)
    SinkA->>SinkA: ws.send_json(...)

    Note over Bus: thread-BBB 的事件不会路由到 ws_a
    Reviewer->>Bus: emit(Event(run_id="run-claude-thread-BBB-3", ...))
    Bus->>Routes: lookup("thread-BBB")
    Routes-->>Bus: SinkB
    Bus->>SinkB: emit(event)

    Note over Bus: 不存在的 thread_id 静默丢弃
    Reviewer->>Bus: emit(Event(run_id="run-claude-thread-CCC-1", ...))
    Bus->>Routes: lookup("thread-CCC")
    Routes-->>Bus: None
    Bus->>Bus: log.debug "no route for thread-CCC, dropping"
```

## 关键设计决策时序还原

### 决策 1：fire-and-forget 不阻塞用户主路径

```mermaid
sequenceDiagram
    participant User
    participant Route
    participant SDK
    participant Manager

    User->>Route: WS send {type: claude-command, ...}
    Route->>SDK: forward to claude SDK (asyncio.create_task)
    Note over SDK: 主路径继续 stream
    Route->>Manager: asyncio.create_task(notify_user_message(...))
    Note over Manager: 异步后台跑，跟用户响应解耦
    Route-->>User: 立刻继续接下一帧
```

### 决策 2：频道方零感知 evolution 内部装配

```mermaid
sequenceDiagram
    participant Route as claude_code/route.py
    participant Manager as EvolutionManager

    Note over Route,Manager: Route 看到的"接口面"只有这 4 个

    Route->>Manager: manager.enabled?
    Manager-->>Route: True/False

    Route->>Manager: manager.notify_user_message(thread_id, provider, cwd)
    Note over Manager: 内部：state_store, mini_registry,<br/>event_bus, stub_runtime, reviewer<br/>—— Route 全部不知道

    Route->>Manager: manager.register_event_route(thread_id, sink)
    Route->>Manager: manager.unregister_event_route(thread_id)
```

### 决策 3：未来 codex 接入零改 manager

```mermaid
sequenceDiagram
    participant CodexRoute as web/codex/route.py
    participant Manager as EvolutionManager

    Note over CodexRoute,Manager: M1.5 codex 接入只新增<br/>CodexTranscriptProvider + 3 行 hook，<br/>EvolutionManager 0 改

    CodexRoute->>Manager: manager.register_event_route(thread_id, sink)
    CodexRoute->>Manager: manager.notify_user_message(<br/>thread_id, CodexTranscriptProvider(...), cwd)
    Note over Manager: 接 CodexTranscriptProvider 跟接<br/>ClaudeTranscriptProvider 完全同样的协议
    CodexRoute->>Manager: manager.unregister_event_route(thread_id)
```

## 错误路径

| 场景 | 行为 |
|------|------|
| `manager.enabled == False` | 所有公开 API no-op，return |
| state_store 失败（IO 错误）| notify_user_message 顶层 except 吞 + log warning，本次跳过 |
| provider.build_window 抛异常 | provider 实现自身吞，但 manager 也加防御性 except 兜底 |
| window.messages 为空 | mark_review_result(status="skipped_empty_window") + return |
| `_build_stub_parent_runtime` 失败 | 顶层 except 吞 + log，本次跳过 |
| reviewer timeout | reviewer_runtime 已有 timeout 处理，manager 透传 outcome |
| evolution_write 失败 | reviewer_runtime 内部已处理（outcome.write_ok=False），manager 不重试 |
| event_bus 路由失败（sink 抛异常）| event_bus 内部吞 + log，不影响其它事件 |
| event_bus 路由不存在的 thread_id | 静默丢弃 + log.debug |

所有 manager 内部异常都吞掉 + log，**绝不冒泡到频道方**。
