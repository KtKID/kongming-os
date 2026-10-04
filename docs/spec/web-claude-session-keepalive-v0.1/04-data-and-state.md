# 04 Data And State

## Header State

`connectionStatusStore` 现已区分三类连接（字段已落地）：

- `statusWs*`：全局 `/ws/thread-status`
- `threadWs*`：generic_chat 正文 `/ws/threads/{id}`
- `claudeWs*`：Claude 正文 `/ws/claude-code`

字段（**v0.1 不新增**，只是让 `claudeWsLatencyMs` 接入真值）：

```ts
claudeWsState: "closed" | "connecting" | "open" | "reconnecting" | "failed";
claudeWsLatencyMs: number | null;   // 当前永远 null → v0.1 改为真实 RTT
claudeWsActive: boolean;
```

## Heartbeat Config（配置真源）

**强制规则**：心跳数值常量统一走 `cfg.web.ws_heartbeat_*` 三件套，**不在 claude-ws.ts 立新常量**。

```ts
// useClaudeCodeWS.ts
const config = useHeartbeatConfig();   // GET /api/config/client
const socket = new ClaudeCodeSocket(threadId, config);
```

后端配置项（`src/config_loader/models.py::WebConfig`，**已存在**）：

| 配置 | 默认值 | 语义 |
| --- | --- | --- |
| `ws_heartbeat_interval_ms` | 30000 | ping 间隔 |
| `ws_heartbeat_timeout_ms` | 10000 | 单次 pong 超时 |
| `ws_heartbeat_max_missed` | 3 | 连续丢几次判死 |

跟 `ThreadSocket` / `useThreadStatusWS` 共用 —— 所有通道一个倒计时配置。

## Socket 内部状态（v0.1 新增）

`ClaudeCodeSocket` 加 8 个字段（直接抄 `ThreadSocket`，不发明新模式）：

```ts
private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
private pongTimer: ReturnType<typeof setTimeout> | null = null;
private missedPongs = 0;
private _latencyMs: number | null = null;
private _heartbeatConfig: HeartbeatConfig;
private pendingPingTs: number | null = null;
private latencyListeners = new Set<(ms: number) => void>();  // 新增：让 hook 订阅 RTT
// + getter: latencyMs
```

## v0.2 待定（不在 v0.1 范围）

session resume 需要的状态字段：

- `liveSessionIdByThread`
- `lastFrameAtByThread`
- `lastHealthyAtByThread`
- `resumeCheckPendingByThread`

v0.1 **不要**为这些字段在 store 里占位 —— YAGNI，等 v0.2 真做时再加。
