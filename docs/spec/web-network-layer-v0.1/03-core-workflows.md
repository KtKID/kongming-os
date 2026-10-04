# 03 Core Workflows

## 协议帧（v0.1 在 Claude 频道引入 `kind` 维度做心跳判别）

```ts
// 客户端 → 服务端
{ kind: "ping", ts: number }   // ts = Date.now()

// 服务端 → 客户端
{ kind: "pong", ts: number }   // 原样 echo client 的 ts
```

### Claude 频道判别字段：v0.1 双轨共存（业务 `type` + 心跳 `kind`）

Claude 频道现有 `ClaudeCodeC2SFrame` 联合用 `type` 字段判别（`claude-command` / `abort-session` / `check-session-status` 等 6 个 type，**没有** ping 分支）；后端 `claude_code/route.py::_dispatch` 也只识别这 6 个 type，**不识别 ping**。

v0.1 选择**双轨共存**而非把 ping 塞进 type 联合，原因如下：

| 选项 | 形态 | 取舍 |
| --- | --- | --- |
| **X（v0.1 采用）** | 心跳帧 `{ kind: "ping", ts }`，业务帧仍走 `type`；前端先按 `"kind" in frame` 走心跳，否则按 `type` 走业务路由；后端复用 `PingFrame.kind` / `PongFrame.kind` 既有 schema | ✅ 心跳层跨频道一致（generic / thread-status 全用 `kind`）<br>✅ 不动业务帧 union，零回归风险<br>⚠️ Claude 频道判别字段双轨；v0.2 C 阶段统一为 `frameType` 后双轨自动消失 |
| Y（不采用） | 把 ping 加入 ClaudeCodeC2SFrame 联合：`{ type: "ping", ts }` | ❌ Claude 频道自定义 ping schema 跟 generic 不一致<br>❌ v0.2 接其他频道时心跳层要按 channel 分支处理判别字段<br>❌ 后端要为 Claude 单独定义 ClaudePingFrame |

### 复用现状

- 后端 `src/web/protocol/ws_frames.py::PingFrame.kind: Literal["ping"]` / `PongFrame.kind: Literal["pong"]` **直接复用**，network 层不重新定义
- 前端 v0.1 在 `web/src/network/tools.ts` 加 `buildPingFrame(ts)` / `isHeartbeatFrame(raw)` —— 后者按 `"kind" in raw && (raw.kind === "ping" || raw.kind === "pong")` narrowing
- 后端 `claude_code/route.py::_dispatch` 必须**新增** `kind == "ping"` 分支（通过 `network_manager.handle_inbound`），见 dev-checklist 7.1-7.2
- 字段名 v0.1 仍 `kind`，v0.2 C 阶段批量改 `frameType` 把 type/kind 双轨合并为单轨

## 工作流 1：Claude 频道建连 + 稳态心跳

```mermaid
sequenceDiagram
  participant Comp as ClaudeCodeView
  participant Hook as useClaudeCodeWS
  participant NM as NetworkManager (前端)
  participant HB as Heartbeat 实例
  participant WS as WebSocket
  participant Route as /ws/claude-code
  participant NMS as NetworkManager (后端)
  participant HBS as Heartbeat 实例 (后端)

  Comp->>Hook: useClaudeCodeWS(threadId)
  Hook->>NM: openChannel("claude", threadId)
  NM->>WS: new WebSocket(url)
  NM->>HB: new Heartbeat(config, hooks)
  WS-->>NM: onopen
  NM->>HB: start()
  WS->>Route: WS handshake
  Route->>NMS: register("claude", ws) → conn_id
  NMS->>HBS: new Heartbeat (server-side)

  loop 每 intervalMs (30s)
    HB->>WS: hooks.sendPing(ts=T)
    WS->>Route: { kind: "ping", ts: T }
    Route->>NMS: handle_inbound(conn_id, frame)
    NMS->>HBS: handle_inbound_frame(frame)
    HBS-->>NMS: { kind: "pong", ts: T }
    NMS->>Route: send(conn_id, pong_frame)
    Route->>WS: { kind: "pong", ts: T }
    WS->>NM: onmessage
    NM->>HB: handlePong(T)
    HB-->>HB: latencyMs = now() - T<br/>missedPongs = 0
    HB-->>NM: hooks.onLatency(latencyMs)
    NM-->>Comp: connectionStatusStore.setClaudeWsLatency(latencyMs)
    Note over NM: state 切换走独立 setClaudeWsState<br/>(onopen 触发一次，不在心跳循环里)
  end
```

## 工作流 2：半开连接判死（中间代理 idle 切了 TCP）

```mermaid
sequenceDiagram
  participant HB as Heartbeat
  participant WS as WebSocket
  participant Route as /ws/claude-code

  Note over WS,Route: 中间代理 idle 切断 TCP<br/>但客户端 readyState 仍 OPEN
  HB->>WS: sendPing(T1)
  Note over HB: pongTimer 启动 (timeoutMs=10s)
  Note over HB: 10s 过 → missedPongs=1
  HB->>WS: sendPing(T2)
  Note over HB: 10s 过 → missedPongs=2
  HB->>WS: sendPing(T3)
  Note over HB: 10s 过 → missedPongs=3 ≥ maxMissed
  HB->>WS: hooks.closeForReconnect()
  WS->>WS: ws.close()
  WS-->>NM: onclose
  NM->>HB: stop() + delete from map
  NM->>NM: scheduleReconnect (exponential backoff)
```

**判死时间上限** = `intervalMs × maxMissed + timeoutMs` = `30 × 3 + 10` = **100 秒**

## 工作流 3：visibilitychange 兜底（用户切回前台立即探测）

```mermaid
sequenceDiagram
  participant User
  participant Doc as document
  participant NM as NetworkManager
  participant HB1 as Heartbeat (claude)
  participant HB2 as Heartbeat (future: codex...)

  User->>Doc: tab 切到后台
  Note over HB1,HB2: setInterval 被 Chrome 节流<br/>(≥ 1min/次)
  User->>Doc: tab 切回前台
  Doc->>NM: visibilitychange (hidden=false)

  par 并发对所有活跃 Heartbeat 调 probe
    NM->>HB1: probe()
    HB1->>HB1: sendPing 立即
  and
    NM->>HB2: probe()
    HB2->>HB2: sendPing 立即
  end

  Note over NM: probe 失败的连接会通过 maxMissed<br/>触发主动 close 重连
```

**v0.1 实际只有 1 个 Heartbeat 实例（claude）**，但 NetworkManager 用 `for...of heartbeats.values()` 循环 probe，**天然支持 v0.2 多连接扩展**——不需要重写。

## 工作流 4：多 Heartbeat 实例并发（多频道接入后场景预演）

v0.2 时同一个浏览器 tab 可能同时有 3-6 个 WS 连接（generic + claude + thread-status + codex + scheduler + workspace-shell），每个连接独立心跳：

```
NetworkManager.heartbeats: Map<conn_id, Heartbeat>
  ├─ conn_id="claude:thread-abc"        → Heartbeat A
  ├─ conn_id="generic:thread-xyz"       → Heartbeat B
  ├─ conn_id="thread-status:global"     → Heartbeat C
  ├─ conn_id="codex:thread-def"         → Heartbeat D
  ├─ conn_id="scheduler:global"         → Heartbeat E
  └─ conn_id="workspace-shell:sid-1"    → Heartbeat F
```

每个 Heartbeat 内部独立的 timer / missedPongs / latencyMs，互不污染。v0.1 用单测验证两个 Heartbeat 实例并存且独立工作（其中一个被打挂不影响另一个）。

## 工作流 5：客户端发送业务帧（非心跳）

业务侧（如 `ClaudeCodeView` 调 `socket.send(claudeCommand)`）：

```mermaid
sequenceDiagram
  participant Comp as Component
  participant Hook as useClaudeCodeWS
  participant NM as NetworkManager
  participant WS

  Comp->>Hook: send(claudeCommandFrame)
  Hook->>NM: send(conn_id, frame)
  NM->>WS: ws.send(JSON.stringify(frame))
```

**铁律**：业务组件不直接拿到 `WebSocket` 引用，只通过 hook → NetworkManager 间接调。这样：
- 心跳、重连、状态聚合都不需要业务侧关心
- 未来切换底层传输（如换 SSE / WebTransport）只动 NetworkManager 一处

## 不在 v0.1 范围

- **断线重连后续接活跃 SDK run**（`check-session-status` + `replace_writer`）→ v0.2 另立 spec `web-claude-session-resume-v0.2`
- **`claude_history` backfill 断线期间内容** → 同上
- **跨 channel broadcast**（NetworkManager.broadcast(channel, frame)） → v0.2 B2 收编旧 broadcaster 时一起做
