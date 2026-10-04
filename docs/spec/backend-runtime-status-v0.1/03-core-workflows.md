# 核心链路

本文件只画“当前链接链路”和“状态页首版如何消费它们”。

## 0. 固定全局链接

已登录用户打开任意 Web 页面后，Layout 会固定挂两条全局链接：

- `/ws/thread-status`
- `/ws/cron`

```mermaid
sequenceDiagram
    participant Tab as Browser Tab
    participant Layout as Layout.tsx
    participant StatusWS as /ws/thread-status
    participant StatusBroadcaster as ThreadStatusBroadcaster
    participant Inbox as ApprovalInboxBroadcaster
    participant CronHost as SchedulerDrawerHost
    participant CronWS as /ws/cron
    participant CronBroker as CronWSBroker

    Tab->>Layout: mount
    Layout->>StatusWS: connect
    StatusWS->>StatusBroadcaster: attach(websocket)
    StatusWS->>Inbox: attach(websocket)
    Layout->>CronHost: mount
    CronHost->>CronWS: connect
    CronWS->>CronBroker: attach(websocket)
```

结论：

- 1 个 tab 至少占 2 条 server 侧全局 WS
- 2 个 tab 至少占 4 条 server 侧全局 WS

## 1. Manage 页面链路

`/manage` 当前没有专用 WS。它复用上面的两条固定全局 WS，再加 `GET /api/manage/cells` 轮询。

```mermaid
sequenceDiagram
    participant Tab as Browser Tab
    participant Layout as Layout.tsx
    participant Manage as ManagePage
    participant API as GET /api/manage/cells
    participant TM as ThreadManager

    Tab->>Layout: mount
    Layout->>Manage: render /manage
    Manage->>API: initial fetch
    API->>TM: list_cells()
    TM-->>API: CellSummaryDTO[]
    API-->>Manage: response
    loop every 5 seconds
        Manage->>API: poll /api/manage/cells
        API->>TM: list_cells()
        TM-->>API: latest cells
        API-->>Manage: response
    end
```

状态页 v0.1 建议：

- 保持这个模型
- 新增 `GET /api/manage/runtime-status`
- 不新增 `/ws/manage-status`

## 2. generic_chat 链路

generic_chat thread 会在固定全局 WS 之外，再建立一条 `/ws/threads/{thread_id}`。

```mermaid
sequenceDiagram
    participant Tab as Browser Tab
    participant Chat as Chat.tsx
    participant ThreadWS as /ws/threads/{thread_id}
    participant TM as ThreadManager
    participant Cell as ThreadCell
    participant Fanout as WebSocketFanout
    participant Bridge as SessionBridge
    participant Runtime as SessionEngine

    Tab->>Chat: open generic_chat thread
    Chat->>ThreadWS: connect
    ThreadWS->>TM: boot_or_attach(thread_id)
    alt cell does not exist
        TM->>Cell: create ThreadCell
        Cell->>Fanout: create
    end
    TM->>Cell: attach_ws(websocket)
    Cell->>Fanout: attach_ws(websocket)
    ThreadWS->>Bridge: run_once(user.input)
    Bridge->>Runtime: execute turn
    Runtime-->>Fanout: events via WSEventSink
    Fanout-->>Tab: S2C frames
```

结论：

- 1 条激活的 generic_chat thread 通常对应 1 个 cell
- 1 个 tab 对应这条 thread 的 1 条聊天 WS
- 同一 thread 的多个 tab 共享 1 个 cell，聊天 WS 条数累加到 fanout

## 3. claude_code 链路

claude_code thread 会在固定全局 WS 之外，再建立一条 `/ws/claude-code?thread_id=...`。

```mermaid
sequenceDiagram
    participant Tab as Browser Tab
    participant View as ClaudeCodeView
    participant ClaudeWS as /ws/claude-code?thread_id=...
    participant Route as claude_code.route
    participant Sessions as claude_session_manager
    participant Service as ClaudeCodeService
    participant Broadcaster as /ws/thread-status broadcasters

    Tab->>View: open claude_code thread
    View->>ClaudeWS: connect
    ClaudeWS->>Route: auth + thread validation
    View->>Service: send user input
    Service->>Sessions: register/rename active session
    Service-->>ClaudeWS: normalized stream frames
    Service-->>Broadcaster: emit thread-status / approval events
    ClaudeWS-->>Tab: Claude message stream
```

结论：

- `claude_code` 路径的聊天连接不进入 `ThreadCell`
- 活跃 provider session 由 `claude_session_manager` 统计
- 状态页要同时显示 `chat_ws` 和 `claude_active_sessions`

## 4. codex 链路

codex thread 会在固定全局 WS 之外，再建立一条 `/ws/codex?thread_id=...`。

```mermaid
sequenceDiagram
    participant Tab as Browser Tab
    participant View as CodexView
    participant CodexWS as /ws/codex?thread_id=...
    participant Route as codex.route
    participant Sessions as codex_session_manager
    participant Service as CodexService
    participant Broadcaster as /ws/thread-status broadcasters

    Tab->>View: open codex thread
    View->>CodexWS: connect
    CodexWS->>Route: auth + thread validation
    View->>Service: send user input
    Service->>Sessions: register active session
    Service-->>CodexWS: codex stream frames
    Service-->>Broadcaster: emit thread-status / usage events
    CodexWS-->>Tab: Codex message stream
```

结论：

- `codex` 路径同样不复用 `ThreadCell`
- 状态页要把 `codex_active_sessions` 作为独立指标看待

## 5. workspace-shell 链路

workspace-shell 只在聊天页里打开对应面板后才建立。

```mermaid
sequenceDiagram
    participant Tab as Browser Tab
    participant Panel as WorkspaceShellPanel
    participant ShellWS as /ws/workspace-shell?thread_id=...
    participant Route as workspace_shell router
    participant Proc as WorkspaceShellProcess

    Tab->>Panel: open shell panel
    Panel->>ShellWS: connect
    ShellWS->>Route: auth + thread lookup + workspace_root resolution
    Route->>Proc: start PTY process
    Proc-->>ShellWS: shell-status / shell-output
    ShellWS-->>Tab: shell frames
```

当前限制：

- server 侧还没有全局 registry 记录活跃 `workspace-shell` 连接数
- v0.1 状态页可以先把它标记为“未纳入统一计数”
- 如果要纳入，需要先补一个 registry 模块

## 6. 同一 thread 两个 tab 链路

这是最容易混淆的一条链路。

```mermaid
sequenceDiagram
    participant TabA as Tab A
    participant TabB as Tab B
    participant ThreadWS as /ws/threads/{thread_id}
    participant TM as ThreadManager
    participant Cell as ThreadCell
    participant Fanout as WebSocketFanout

    TabA->>ThreadWS: connect same thread_id
    ThreadWS->>TM: boot_or_attach(thread_id)
    TM->>Cell: create if absent
    Cell->>Fanout: attach_ws(Tab A)

    TabB->>ThreadWS: connect same thread_id
    ThreadWS->>TM: boot_or_attach(thread_id)
    TM->>Cell: reuse existing cell
    Cell->>Fanout: attach_ws(Tab B)

    Note over TM,Cell: cell count stays 1
    Note over Fanout: client_count becomes 2
```

统一语义：

- `cells_total`：按 `thread_id` 去重
- `chat_ws_connections_total`：按活跃 websocket 数累加
- 因此“一个激活 thread/session 对话是一个 cell”在 generic_chat 路径成立
- “两个 tab 打开同一 thread”是 1 个 cell + 2 条聊天 WS

## 7. 链路总表

| 场景 | 固定全局 WS | 页面专属 WS | cell 变化 | provider session 变化 |
|------|-------------|-------------|-----------|------------------------|
| 任意页面打开 1 个 tab | `/ws/thread-status` + `/ws/cron` | 无 | 无 | 无 |
| `/manage` | 同上 | 无 | 无 | 无 |
| `generic_chat` | 同上 | `/ws/threads/{thread_id}` | +1 或复用 | 无 |
| `claude_code` | 同上 | `/ws/claude-code?thread_id=...` | 无 | Claude active session +1 或复用 |
| `codex` | 同上 | `/ws/codex?thread_id=...` | 无 | Codex active session +1 或复用 |
| 打开 shell 面板 | 同上 | `/ws/workspace-shell?thread_id=...` | 无 | 无 |
