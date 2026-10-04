# 05 Validation And Evolution

## 单元测试（必须沉淀为 pytest / vitest，不允许一次性脚本）

### 前端 vitest

`web/src/lib/__tests__/claude-ws.test.ts` 新增用例：

| 用例 | 验证 |
| --- | --- |
| `sends ping every intervalMs` | fake timer 推进 `intervalMs`，断言 `socket.send` 被以 `{ type: "ping", ts }` 调用 |
| `updates latencyMs on pong` | mock 收到 `{ type: "pong", ts: T }`，断言 `latencyMs` 接近 `now() - T` |
| `closes ws after maxMissed unanswered pings` | fake timer 推进 `intervalMs * maxMissed + timeoutMs`，断言 `ws.close()` 被调 |
| `probe() sends immediate ping` | 调 `socket.probe()`，断言 `send({ type: "ping", ...})` 立即发出 |
| `stops heartbeat on close()` | 调 `close()`，再推进 `intervalMs`，断言无 send |

`web/src/hooks/__tests__/useClaudeCodeWS.test.tsx` 新增：

| 用例 | 验证 |
| --- | --- |
| `passes heartbeat config from useHeartbeatConfig` | mock `apiGet` 返回自定义配置，断言 `ClaudeCodeSocket` 构造参数 |
| `calls probe() on visibilitychange visible` | dispatch `visibilitychange` event（`document.hidden=false`），断言 `socket.probe()` 被调 |
| `writes real latency to store` | mock socket emit latency=42，断言 `setClaudeWs("open", 42)` |

### 后端 pytest

`tests/unit/web/integrations/claude_code/test_route.py` 新增：

| 用例 | 验证 |
| --- | --- |
| `route_handles_ping_frame` | 客户端发 `{"type":"ping","ts":12345}`，断言收到 `{"type":"pong","ts":12345}` |
| `pong_echoes_ts_unchanged` | 不同 ts 值都原样 echo，不被改写 |

## 端到端（playwright）

`web/tests/e2e/claude-keepalive.spec.ts`：

| 场景 | 步骤 | 断言 |
| --- | --- | --- |
| 60 秒空闲后连接仍活 | 打开 Claude 频道 → wait 65s → 发送一条消息 | SDK 回流正常，无 reconnecting 状态 |
| 后台 tab 切回立即探测 | 打开 Claude 频道 → switch tab 30s → 切回 | DevTools 能看到切回瞬间一次 ping |
| 顶栏 latency 显示数字 | 打开 Claude 频道 → wait 一次 ping/pong | 顶栏球 hover 显示 `<数字> ms`，不是 `--` |

## 视觉验证

- Header 在 Claude 频道显示 2 个球：Claude 正文连接球（含 latency）+ 全局状态球
- Header 在 generic_chat 频道继续保持原样
- Header 在管理页不额外显示 Claude 球
- Claude WS 周期性发 `ping`，route 回 `pong`，顶栏 RTT 可更新
- Claude WS 连续 missed pong 超限后主动重连
- Claude WS `onopen` 会按最近 sessionId 自动发 `check-session-status`
- `session-status.isProcessing=false` 时前端会清掉残留 running 态

## 上线约束

**前后端必须同 commit 上线**。理由：

- 客户端发 ping 但后端不识别 → 后端要么忽略（客户端永远收不到 pong → maxMissed 触发死循环重连）、要么 reject 帧（更糟，直接 close 连接）
- 灰度发布只发前端 = 让所有用户立刻 1 分钟内被踢下线，**比当前 bug 还糟**
- history + live merge 策略收口

执行办法：

- `claude-ws.ts` / `useClaudeCodeWS.ts` / `route.py` 的改动放在**同一个 PR、同一个 commit**
- pre-merge CI 必须同时跑 vitest + pytest，任一挂掉不许合
- 不做 feature flag（v0.1 范围太小，不值得引入开关复杂度）
- `claude_history` 补断线窗口内已落盘内容并去重 merge

## Phase 演进

### v0.1（本 spec）

- app-level ping/pong + visibilitychange + latency 上报
- 解决"1 分钟掉线"和"切回前台不刷新"

### v0.2（另立 spec：`web-claude-session-resume-v0.2`）

- reconnect 后 `check-session-status(sessionId)`
- 活跃 run 用 `replace_writer` 续接
- 已落盘内容用 `claude_history` 补齐
- 关键设计点（需在 v0.2 解决）：
  - history vs replace_writer 调用**顺序**和**去重规则**
  - `replace_writer` 是从断点续推还是重推全 run
  - 多 tab 同时重连的所有权

### v0.3+（暂不规划）

- 跨通道统一 NetworkManager
- SharedWorker 维持后台真心跳
- 多 tab / 多 writer fanout 语义统一
