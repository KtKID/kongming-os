# 数据与状态

## 核心快照模型

```python
from dataclasses import dataclass
from typing import Literal


@dataclass
class ProcessStatus:
    running: bool
    phase: Literal["stopped", "starting", "running"]
    pid: int | None
    host: str
    port: int
    url: str | None
    log_path: str


@dataclass
class GlobalWSCounters:
    thread_status_connections: int
    cron_connections: int
    approval_subscribers: int


@dataclass
class ProviderSessionCounters:
    claude_active_sessions: int
    codex_active_sessions: int


@dataclass
class ActiveCellSnapshot:
    thread_id: str
    thread_name: str
    backend_kind: Literal["generic_chat", "claude_code", "codex"]
    preset_id: str
    cwd: str
    status: Literal["idle", "running", "awaiting_approval"]
    pending_approval_count: int
    chat_ws_connections: int
    last_active_at: float


@dataclass
class RuntimeStatusSnapshot:
    process: ProcessStatus
    global_ws: GlobalWSCounters
    provider_sessions: ProviderSessionCounters
    cells_total: int
    chat_ws_connections_total: int
    approval_pending_total: int
    workspace_shell_connections: int | None
    cells: list[ActiveCellSnapshot]
    generated_at_ms: int
```

## 字段语义

### `cells_total`

`ThreadManager` 当前活跃 `ThreadCell` 的数量。

### `chat_ws_connections_total`

所有 generic_chat cell 的 `WebSocketFanout.client_count` 之和。

### `global_ws.thread_status_connections`

`ThreadStatusBroadcaster.connection_count`。

### `global_ws.cron_connections`

`CronWSBroker.connection_count`。

### `global_ws.approval_subscribers`

`ApprovalInboxBroadcaster.subscriber_count`。当前它与 `/ws/thread-status` 共用同一端点，但仍保留单独字段，方便排查 broadcaster 状态异常。

### `approval_pending_total`

`ApprovalInboxBroadcaster.pending_count`。

### `provider_sessions.*`

来自 `SessionManager.list_active()` 的计数。它们是 provider 活跃会话数，不等同于 cell 数。

### `workspace_shell_connections`

v0.1 允许为 `None`，表示当前代码没有全局 registry，无法可靠统计。

## 原始真值与推导值

### 原始真值

- `thread_status_connections`
- `cron_connections`
- `approval_subscribers`
- `cells_total`
- `chat_ws_connections_total`
- `provider_sessions.*`

### 推导值

- `estimated_tabs`
- “一个 tab 平均占多少连接”
- “某类页面总数”

v0.1 页面只展示原始真值。推导值可以显示在帮助文案里，但不进入主快照 schema。

## 数据来源矩阵

| 字段 | 当前代码真源 | 当前支持情况 | 备注 |
|------|--------------|--------------|------|
| `process.running/pid/port` | `src/web/ctl.py` | 已支持 | 当前已有 |
| `cells_total` | `ThreadManager._cells` | 已支持 | 已有 `list_cells()` |
| `cells[].status` | `ThreadCell.status` | 已支持 | 仅 generic_chat |
| `cells[].pending_approval_count` | `WebHostAdapter.pending_approval_count` | 已支持 | 仅 generic_chat |
| `cells[].chat_ws_connections` | `WebSocketFanout.client_count` | 已支持 | 仅 generic_chat |
| `thread_status_connections` | `ThreadStatusBroadcaster.connection_count` | 已支持 | 全局 |
| `cron_connections` | `CronWSBroker.connection_count` | 已支持 | 全局 |
| `approval_subscribers` | `ApprovalInboxBroadcaster.subscriber_count` | 已支持 | 全局 |
| `approval_pending_total` | `ApprovalInboxBroadcaster.pending_count` | 已支持 | 全局 |
| `claude_active_sessions` | `claude_session_manager.list_active()` | 已支持 | 全局 |
| `codex_active_sessions` | `codex_session_manager.list_active()` | 已支持 | 全局 |
| `workspace_shell_connections` | 无 | 缺失 | 需新 registry |

## 边界矩阵

| 对象 | 当前有没有 server 侧真值 | 是否纳入 v0.1 | 原因 |
|------|--------------------------|----------------|------|
| Web 进程 | 有 | 是 | 必需 |
| global ws | 有 | 是 | 必需 |
| per-thread generic_chat ws | 有 | 是 | 必需 |
| Claude/Codex active session | 有 | 是 | 必需 |
| workspace-shell ws | 无 | 否 | 先补 registry |
| provider HTTP socket pool | 无稳定真值 | 否 | 观测成本高 |
| 浏览器 HTTP polling 请求数 | 无稳定真值 | 否 | 不属于长连接 |
