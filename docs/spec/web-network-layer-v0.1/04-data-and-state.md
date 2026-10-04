# 04 Data And State

## 协议帧（v0.1 复用现有）

复用 `src/web/protocol/ws_frames.py` 既存：

```python
class PingFrame(BaseModel):
    kind: Literal["ping"] = "ping"
    ts: int | None = None   # 客户端时间戳

class PongFrame(BaseModel):
    kind: Literal["pong"] = "pong"
    timestamp_ms: int       # server 当前时间（信息性，不参与 RTT）
    ts: int | None = None   # 原样 echo client 的 ts，用于 RTT
```

前端 `web/src/network/tools.ts` 新增对应工厂（**不**重复定义类型，从 `@/protocol` import 既有 `PingFrame` / `PongFrame`）：

```ts
import type { PingFrame, PongFrame } from "@/protocol";

export function buildPingFrame(ts: number): PingFrame { ... }
export function isHeartbeatFrame(raw: unknown): raw is PingFrame | PongFrame { ... }
```

## Heartbeat 内部状态字段

每个 `Heartbeat` 实例持有：

| 字段 | 类型 | 语义 |
| --- | --- | --- |
| `_config` | `HeartbeatConfig` | 来自 `cfg.web.ws_heartbeat_*` 真源；构造时传入 |
| `_hooks` | `HeartbeatHooks` | 与外界交互的 4 个回调 |
| `_heartbeat_timer` | timer handle | `setInterval` / `asyncio.Task` |
| `_pong_timer` | timer handle | 单次 pong 超时 |
| `_missed_pongs` | int | 连续未回的次数 |
| `_pending_ping_ts` | int \| None | 最近一次未确认 ping 的时间戳 |
| `_latency_ms` | int \| None | 最近一次 RTT |
| `_started` | bool | 状态机是否在跑（防止 start 重入）|

## HeartbeatConfig（来自后端配置真源）

```ts
interface HeartbeatConfig {
  intervalMs: number;     // 默认 30000，来源 cfg.web.ws_heartbeat_interval_ms
  timeoutMs: number;      // 默认 10000，来源 cfg.web.ws_heartbeat_timeout_ms
  maxMissed: number;      // 默认 3，来源 cfg.web.ws_heartbeat_max_missed
}
```

**禁止**：
- 不允许在 `network/` 立常量 `const DEFAULT_HEARTBEAT = { ... }`
- 不允许 claude 频道单独覆盖参数（统一一份 = "所有频道公用一个倒计时配置"）

获取链路：
```
后端 cfg.web.ws_heartbeat_*  ─→  GET /api/config/client  ─→  useHeartbeatConfig()
                                                              ↓
                                                          networkManager
                                                              ↓
                                                          new Heartbeat(config, hooks)
```

## NetworkManager 内部状态

### 前端

```ts
class NetworkManager {
  // connection_id 命名规则: `${channel}:${threadId}` 或 `${channel}:global`
  private sockets = new Map<string, WebSocket>();
  private heartbeats = new Map<string, Heartbeat>();
  private listeners = new Map<string /*channel*/, Set<Listener>>();
  private retryCounters = new Map<string, number>();
  private retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
}
```

### 后端

```python
@dataclass
class ConnectionInfo:
    conn_id: str
    channel: str               # "claude" / 未来 "generic" 等
    thread_id: str | None
    websocket: Any             # FastAPI WebSocket
    registered_at_ms: int

class NetworkManager:
    _connections: dict[str, ConnectionInfo]
    _heartbeats: dict[str, Heartbeat]
    _lock: asyncio.Lock
```

## connection_id 命名约定

- `claude:<thread_id>` — Claude 频道，per-thread
- `generic:<thread_id>` — v0.2 接入
- `codex:<thread_id>` — v0.2 接入
- `thread-status:global` — v0.2 接入（全局单例）
- `cron:global` — v0.2 接入
- `scheduler:global` — v0.2 接入
- `shell:<session_id>` — v0.2 workspace-shell

## connectionStatusStore（前端，**字段不动 + setter 拆分**）

字段保持现状，**新增两个独立 setter 替换原 `setClaudeWs(state, latencyMs)`**。原 setter 一次写两个字段会让"心跳更新 latency"误覆盖"生命周期切换的 state"。

```ts
// web/src/stores/connectionStatus.ts
{
  claudeWsState: "closed" | "connecting" | "open" | "reconnecting" | "failed";
  claudeWsLatencyMs: number | null;
  claudeWsActive: boolean;

  // 旧 API（v0.1 移除）：
  //   setClaudeWs(state, latencyMs): void
  //
  // 新 API（v0.1 加这两个，原 setter 直接删；不留 alias）：
  setClaudeWsState(state: ClaudeSocketState): void;
  setClaudeWsLatency(ms: number | null): void;
  setClaudeWsActive(active: boolean): void;  // 已有，不动
}
```

### 真源分离的理由

| 字段 | 真源 | 触发时机 |
| --- | --- | --- |
| `claudeWsState` | NetworkManager 的连接生命周期 | onopen / onclose / 判死 / 重连阶段切换 |
| `claudeWsLatencyMs` | Heartbeat 每次 `handlePong` | 每 30s 一次 |
| `claudeWsActive` | hook mount / unmount | 进入 / 离开 Claude 频道页 |

合并 setter = 三个真源被迫一处更新 = 心跳每次更新 latency 都得先读 state 回写，竞态 + 多此一举。拆分后各管各的字段，互不污染。

### 同步关系

- NetworkManager 内 socket 状态变化 → 调 `setClaudeWsState(next)`
- Heartbeat onLatency 回调 → manager 调 `setClaudeWsLatency(ms)`
- `useClaudeCodeWS` mount/unmount → 调 `setClaudeWsActive(true/false)`

v0.1 只接 Claude，所以只动 `claudeWs*` 三个 setter；`threadWs*` / `statusWs*` 不动（v0.2 接其他频道时再考虑同样拆分）。

## 后端配置（**已存在**，无需新增）

`src/config_loader/models.py::WebConfig`：

| 配置项 | 默认 | 已存在 |
| --- | --- | --- |
| `ws_heartbeat_interval_ms` | 30000 | ✅ |
| `ws_heartbeat_timeout_ms` | 10000 | ✅ |
| `ws_heartbeat_max_missed` | 3 | ✅ |

`/api/config/client` 端点已经把这三个字段透传给前端（被 `useHeartbeatConfig` 消费）。**v0.1 不动配置层**。
