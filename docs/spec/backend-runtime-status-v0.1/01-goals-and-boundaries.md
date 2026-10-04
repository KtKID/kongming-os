# 目标与边界

## 要解决的问题

当前仓库对“后端状态”有多份局部真相：

- 进程真相在 `src/web/ctl.py`
- cell 真相在 `ThreadManager`
- `/ws/thread-status` 和 `/ws/cron` 各自维护连接池
- approval inbox 复用 `/ws/thread-status` 但单独维护 subscriber/pending
- same-thread 多 tab 由 `WebSocketFanout` 聚合
- `claude_code` / `codex` 额外持有活跃 session 表

这导致三个高频问题很难直接回答：

1. 当前到底有多少 server 侧链接
2. 一个激活 thread/session 到底算几份运行实例
3. 一个 tab 和两个 tab 的差异落在 cell、chat ws、global ws 的哪一层

## 目标

v0.1 要给出一份统一答案：

- 进程层：Web 服务是否存活，PID/端口/日志路径是什么
- 运行实例层：当前有多少活跃 cell，各自属于哪个 thread
- 连接层：当前有多少 `thread-status`、`cron`、per-thread chat ws
- session 层：当前有多少活跃 Claude/Codex session
- 语义层：同一 thread 两个 tab 是 1 个 cell + 2 条聊天连接

## 成功标准

满足下面 5 条，即可认为 v0.1 成功：

1. 打开一个 Web 页时，状态页能解释它会占哪些 server 侧连接。
2. 打开两个 tab 指向同一 thread 时，状态页能同时显示 `cell=1` 和 `chat_ws_connections=2`。
3. `generic_chat`、`claude_code`、`codex` 三类聊天路径都有独立链路定义。
4. CLI 与 Web 页面输出同一套字段，不出现两份口径。
5. 文档中的链路图能一一映射到当前代码对象。

## 观察边界

### v0.1 纳入统一快照的对象

- Web 进程状态
- `ThreadManager._cells`
- `ThreadStatusBroadcaster.connection_count`
- `CronWSBroker.connection_count`
- `ApprovalInboxBroadcaster.subscriber_count`
- `ApprovalInboxBroadcaster.pending_count`
- per-cell `WebSocketFanout.client_count`
- `claude_session_manager.list_active()`
- `codex_session_manager.list_active()`

### v0.1 明确不纳入统一快照的对象

- 浏览器本地 store
- 代理层连接数
- uvicorn/ASGI worker 级 socket 细节
- provider SDK 内部 `httpx` socket 级连接数
- 操作系统 fd 总数

## 首版策略

### Web 侧

继续复用现有 `/manage` 页面，不新建独立长连接：

- 进入页面后沿用 Layout 已建立的 `/ws/thread-status`
- 进入页面后沿用 Layout 已建立的 `/ws/cron`
- 状态快照通过 REST 拉取
- 首版增量刷新继续用轮询

### CLI 侧

CLI 直接消费统一快照模型：

- server 未启动时，退化到进程层状态
- server 已启动时，输出完整 runtime snapshot
- 支持人类可读表格和 JSON 两种形态

## 关键术语

### connection

一个 server 侧可观测的活跃连接对象。v0.1 重点是 WebSocket 连接，不把 HTTP 短请求算进统一“链接总数”。

### cell

一个已 boot 的 thread 运行实例。一个 `cell` 绑定一个 `thread_id`，持有 runtime、bridge、adapter 和 event sinks。

### session

provider 侧活跃会话实体。它和 `cell` 不同：

- `cell` 是 kongming Web 后端内存对象
- `session` 是 Claude/Codex service 维护的活跃 provider 会话

### tab

浏览器页面实例。一个 tab 通常会建立两条固定全局连接：

- `/ws/thread-status`
- `/ws/cron`

如果 tab 打开聊天页，还会额外建立一条聊天路径连接。
