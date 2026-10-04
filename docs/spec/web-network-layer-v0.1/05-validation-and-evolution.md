# 05 Validation And Evolution

## 测试矩阵

### 前端单测（vitest）

**`web/src/network/__tests__/heartbeat.test.ts`** —— Heartbeat 类（核心，覆盖多实例并发）：

| 用例 | 验证 |
| --- | --- |
| `sends ping every intervalMs after start()` | fake timer 推 `intervalMs`，断言 `hooks.sendPing` 被调一次 |
| `updates latencyMs on handlePong with matching ts` | 模拟 sendPing → handlePong，断言 latency 接近 `now() - T` |
| `closes for reconnect after maxMissed unanswered pings` | fake timer 推 `intervalMs * maxMissed + timeoutMs`，断言 `closeForReconnect` 被调 |
| `probe() sends immediate ping outside interval` | start 后立即调 `probe()`，断言 sendPing 被立即触发 |
| `stop() halts heartbeat and pong timer` | stop 后推 `intervalMs`，断言无 sendPing |
| `start() is idempotent` | 连续两次 start，断言只跑一套 timer |
| **`two instances run independently`** | **同时 new 两个 Heartbeat，killing 一个不影响另一个的 latency / timer**（多连接扩展性核心验证）|
| `does not crash when hooks.onLatency throws` | listener 抛错时 Heartbeat 不传染 |

**`web/src/network/__tests__/manager.test.ts`** —— NetworkManager 类：

| 用例 | 验证 |
| --- | --- |
| `openChannel creates a socket + heartbeat pair` | 调 `openChannel("claude", "t1")`，断言 sockets / heartbeats Map 各加一项 |
| `closeChannel removes both maps and stops heartbeat` | 调 `closeChannel(connId)`，断言 Map 被删 + Heartbeat.stop 被调 |
| `multiple channels coexist without interference` | 同时 openChannel claude + generic（mock），断言两个 Heartbeat 实例 |
| `visibilitychange visible triggers probe on all heartbeats` | dispatch `visibilitychange` event，断言所有 Heartbeat.probe 被调 |
| `incoming pong frame is routed to correct heartbeat` | mock 一个 conn 收 pong，断言只对应 Heartbeat.handlePong 被调，其他不受影响 |
| `passes heartbeat config from useHeartbeatConfig` | inject config，断言 Heartbeat 构造参数正确 |

**`web/src/network/__tests__/tools.test.ts`** —— 工具函数：

| 用例 | 验证 |
| --- | --- |
| `buildPingFrame returns correct schema` | 调用返回 `{ kind: "ping", ts: T }` |
| `isHeartbeatFrame narrows correctly` | true 对 ping/pong，false 对其他 |
| `exponentialBackoff caps at MAX_BACKOFF_MS` | retryCount=99 时不超过上限 |

### 后端单测（pytest）

**`tests/unit/network/test_heartbeat.py`**：

| 用例 | 验证 |
| --- | --- |
| `handle_inbound_frame returns pong for ping with echoed ts` | inbound `{"kind":"ping","ts":12345}` → 返回含 `ts=12345` 的 pong dict |
| `handle_inbound_frame returns None for non-ping frame` | inbound `{"kind":"user.input"}` → 返回 None |
| `two heartbeat instances do not share state` | 同时 new 两个，互不污染 |

**`tests/unit/network/test_manager.py`**：

| 用例 | 验证 |
| --- | --- |
| `register creates connection + heartbeat pair` | mock ws 注册，断言 _connections / _heartbeats 各加一项 |
| `unregister removes both and stops heartbeat` | unregister 后两 dict 删除 |
| `handle_inbound routes ping to heartbeat` | 模拟 inbound ping，断言响应中含 pong |
| `handle_inbound routes non-ping to channel handler` | 注册 listener，模拟 inbound 业务帧，断言 listener 被调 |
| `get_network_manager returns singleton` | 调两次返回同一实例 |

### import 边界单测

**`tests/unit/network/test_import_boundary.py`**：

| 用例 | 验证 |
| --- | --- |
| `network does not import from business modules` | `importlib.import_module("network")` 跑通且依赖链无 `web.integrations.claude_code` 等 |
| `network/tools is not imported anywhere outside network/` | grep 全仓 `from network.tools` 只出现在 `network/` 内文件 |

前端：在 `web/src/network/__tests__/import-boundary.test.ts` 加 ad-hoc 验证：用 `glob('@/**/*.ts')` 扫源码确认 `@/network/tools` 只被 `@/network/` 引用。

### 端到端（playwright）

**`web/tests/e2e/claude-keepalive.spec.ts`**：

| 场景 | 步骤 | 断言 |
| --- | --- | --- |
| **60 秒空闲后连接仍活** | 打开 Claude 频道 → wait 65s → 发送一条消息 | SDK 回流正常，无 reconnecting 状态闪烁 |
| **后台 tab 切回立即探测** | 打开 Claude → 切其他 tab 30s → 切回 | DevTools Network 能看到切回瞬间一次 ping/pong |
| **顶栏 latency 显示数字** | 打开 Claude 频道 → wait 一次 ping/pong | 顶栏球 hover 显示 `<数字> ms` |
| **拔网恢复** | 打开 Claude → 模拟 offline → restore | 顶栏球转 `reconnecting` → `open`，消息回流 |

## 上线约束

**前后端必须同 commit 上线**（不可灰度）。理由（与 v0.1 keepalive 旧 spec 相同）：

- 客户端发 ping 但老后端不识别 → 客户端永远收不到 pong → maxMissed 触发死循环重连
- 灰度发布只发前端 = 让所有用户立即 1 分钟内被踢下线

执行办法：

- `manager.py` / `heartbeat.py` / `tools.py` 后端 3 文件 + `manager.ts` / `heartbeat.ts` / `tools.ts` 前端 3 文件 + claude_code/route.py 改造 + claude-ws.ts 接入 manager —— **同一个 PR 同一个 commit**
- pre-merge CI 同时跑 vitest + pytest + e2e
- 不引入 feature flag

## v0.1 完成判定（DoD）

- ✅ 单测全过（vitest + pytest）
- ✅ e2e 4 场景全过（playwright）
- ✅ import-linter 红线生效（CI 验证）
- ✅ 浏览器手测：Claude 频道空闲 ≥ 5 分钟仍能正常接收下一条消息
- ✅ 浏览器手测：切到其他 tab 5 分钟再切回，立即恢复刷新（无需手动刷页）
- ✅ 顶栏 Claude 球 latency 数字显示
- ✅ 至少 1 个 e2e 用例验证多 Heartbeat 实例并存（v0.1 时只能模拟，因为只接 1 个频道）

## Phase 演进

### v0.2（待立 spec）

- **B1'**：接入 generic / codex / thread-status / scheduler / workspace-shell 五个频道
  - 删除各 socket 类的内联心跳代码（70-80 行 × 多处），全部走 NetworkManager + Heartbeat
- **B2**：收编 3 个旧 broadcaster
  - `ApprovalInboxBroadcaster` → NetworkManager 的 channel="approval_inbox" 特例
  - `CronWSBroker` → channel="cron"
  - `thread_status_ws` 模块级订阅者管理 → channel="thread-status"
  - 直接废弃旧类（不留 deprecated alias）
- **C**：协议字段统一 `kind` / `type` → `frameType`
  - 改 `web/src/protocol.ts` (~1500 行)
  - 改 `src/web/protocol/ws_frames.py` 等 10+ 后端文件
  - 改前后端所有判别分支
- **session-resume**：另立 spec `web-claude-session-resume-v0.2`
  - reconnect 后 `check-session-status` 自动调用
  - `replace_writer` 续接活跃 SDK run
  - `claude_history` 补已落盘内容

### v0.3+（暂不规划）

- SharedWorker 维持后台真心跳（绕过 Chrome 节流）
- 跨通道 WebTransport / HTTP-3 升级
