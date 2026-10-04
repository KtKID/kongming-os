# 03 Core Workflows

## 协议帧（前后端真源）

```ts
// 客户端 → 服务端
{ type: "ping", ts: number }   // ts = Date.now()

// 服务端 → 客户端
{ type: "pong", ts: number }   // ts 直接 echo 回 client 的 ts，client 用来算 RTT
```

字段名一律 `type`（**不**用 `kind`），跟 `claude-command` / `abort-session` / `check-session-status` 风格一致。`ts` 是毫秒整数，echo 模型让客户端独立算 RTT，无需服务端时钟同步。

## 稳态心跳

```mermaid
sequenceDiagram
  participant Browser
  participant Socket as ClaudeCodeSocket
  participant Route as /ws/claude-code

  Browser->>Socket: connect()
  Socket->>Route: WS handshake
  Route-->>Socket: open
  Socket->>Socket: startHeartbeat()<br/>setInterval(intervalMs)

  loop 每 intervalMs（默认 30s）
    Socket->>Route: { type: "ping", ts: T }
    Note over Socket: pongTimer 启动（timeoutMs）
    Route-->>Socket: { type: "pong", ts: T }
    Socket->>Socket: latencyMs = now() - T<br/>missedPongs = 0
    Socket->>Browser: onLatency(latencyMs) → store
  end
```

## 半开判死

```mermaid
sequenceDiagram
  participant Socket as ClaudeCodeSocket
  participant Route as /ws/claude-code

  Socket->>Route: ping (T1)
  Note over Route: 中间代理 idle 超时，TCP 已断<br/>但客户端 readyState 仍 OPEN
  Note over Socket: timeoutMs 过 → missedPongs++<br/>（1 次）
  Socket->>Route: ping (T2)
  Note over Socket: 超时 → missedPongs = 2
  Socket->>Route: ping (T3)
  Note over Socket: 超时 → missedPongs = 3 ≥ maxMissed
  Socket->>Socket: ws.close() → onclose → scheduleReconnect()
```

判死时间上限 = `intervalMs * maxMissed + timeoutMs`（默认 30s × 3 + 10s ≈ **100 秒**）。可以接受 —— 比 OS TCP keepalive 默认 2h 快 70 倍。

## 后台 tab 兜底（visibilitychange）

**为什么必须有**：Chrome 后台 tab 把 `setInterval` 节流到 ≥ 1min/次，定时 ping 失效。

```mermaid
sequenceDiagram
  participant User
  participant Doc as document
  participant Hook as useClaudeCodeWS
  participant Socket as ClaudeCodeSocket

  User->>Doc: tab 切到后台
  Note over Socket: setInterval 被浏览器节流<br/>心跳变稀疏
  User->>Doc: tab 切回前台
  Doc-->>Hook: visibilitychange (hidden=false)
  Hook->>Socket: probe()
  Socket->>Socket: 立即 sendPing()<br/>若 timeoutMs 内无 pong → 主动 close 重连
```

`ClaudeCodeSocket.probe()` 是公开方法：

```ts
/** 立即发一次 ping 探测连接是否真活；用于 visibilitychange 兜底 */
probe(): void {
  if (this.state === "open") this.sendPing();
}
```

## 状态机（含 latency 上报）

```mermaid
stateDiagram-v2
  [*] --> closed
  closed --> connecting: connect()
  connecting --> open: onopen<br/>startHeartbeat
  open --> reconnecting: maxMissed 判死<br/>或 onclose
  reconnecting --> connecting: backoff 到期
  open --> closed: close()<br/>stopHeartbeat
  reconnecting --> failed: ≥ MAX_RETRY (10)
```

每次 `handlePong` 后通过 `onLatency` 回调把 RTT 抛给 `useClaudeCodeWS`，hook 调 `setClaudeWs(state, latencyMs)` 把真值写进 store —— 替换当前硬编码的 `null`。

## 不在 v0.1 范围

reconnect 成功后**怎么续接活跃 run** / **怎么 backfill 历史消息** —— 推到 v0.2。v0.1 重连只做"连上"，不做"接回"。
