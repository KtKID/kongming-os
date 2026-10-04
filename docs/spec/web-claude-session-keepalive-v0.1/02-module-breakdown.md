# 02 Module Breakdown

## Components

| Component | Responsibility |
| --- | --- |
| `web/src/lib/claude-ws.ts` | Claude 频道传输层 client；本 spec 在此加 **心跳 ping/pong 状态机** + **latency RTT** + **maxMissed 判死 → close 触发重连** |
| `web/src/hooks/useClaudeCodeWS.ts` | React 生命周期桥；本 spec 在此加 **visibilitychange 监听**（切回前台立即探测）+ **把 `useHeartbeatConfig` 拿到的配置传给 `ClaudeCodeSocket`** + **真实 latency 上报到 store**（不再传 `null`） |
| `web/src/hooks/useHeartbeatConfig.ts` | 配置真源 hook（**已存在**）；本 spec 复用，不新增配置项 |
| `web/src/stores/connectionStatus.ts` | 顶栏读取的全局连接状态源（**字段已存在**）；本 spec 让 `claudeWsLatencyMs` 接入真值 |
| `web/src/components/Layout.tsx` | 根据 `backend_kind` 条件渲染 Claude 连接球（**已存在**）；本 spec 验证 latency 展示生效 |
| `src/web/integrations/claude_code/route.py` | Claude WS endpoint；本 spec 在 `_dispatch` 加 **ping 帧识别 + 同步回 pong**，**echo 回客户端 ts** |
| `src/web/shared/session_manager.py` | 活跃 Claude session 表与 `replace_writer`（**已存在**）；**v0.1 不改**，留给 v0.2 |

## Design Decisions

| 决策 | 选 A | 不选 B 的理由 |
| --- | --- | --- |
| 心跳帧判别字段 | `{ type: "ping", ts: number }` / `{ type: "pong", ts: number }` | **不**用 `kind`。Claude 通道历来用 `type` 判别（claude-command / abort-session / check-session-status），保持一致；跟 generic_chat 的 `kind` 风格分离避免误导 |
| 心跳数值来源 | 复用 `useHeartbeatConfig` 拉的 `cfg.web.ws_heartbeat_interval_ms` 三件套 | **不**在 `claude-ws.ts` 单独硬编码常量。违反"数值常量必须走配置真源"+"所有通道公用一个倒计时配置" |
| 后台 tab 兜底 | `useClaudeCodeWS` 监听 `visibilitychange`，切回前台立即调用 `socket.probe()` 触发一次 ping | **不**改用 SharedWorker 或 Web Worker 维持后台心跳（v0.1 复杂度过大） |
| 灰度策略 | 前后端原子提交（同 commit） | **不**做客户端单边发 ping 等后端响应 200 OK 切换（开发期不做过度兼容；详见 05 §上线约束） |

## Immediate Delta

| 文件 | 加什么 |
| --- | --- |
| `claude-ws.ts` | 8 个心跳字段 + `startHeartbeat` / `stopHeartbeat` / `sendPing` / `handlePong` / `probe`（公开方法）+ 在 `onmessage` 拦 `type === "pong"` 处理 |
| `useClaudeCodeWS.ts` | 调 `useHeartbeatConfig` → 构造 `ClaudeCodeSocket(threadId, config)` + `document.addEventListener("visibilitychange", ...)` + `socket.onLatency` 监听 → `setClaudeWs(state, latencyMs)` |
| `route.py::_dispatch` | 加 `elif type == "ping":` 分支 → `await websocket.send_json({"type": "pong", "ts": frame["ts"]})` |
