# 01 Goals And Boundaries

## Goals

- Claude 频道 `/ws/claude-code` 连接在用户**停留 ≥ 60 秒不交互**的场景下不被中间代理 / NAT 切断
- 浏览器后台 tab 切回前台后，**1 秒内**完成一次主动探测，确认连接活/死
- 连接进入"半开"（client 以为 OPEN 实际已断）时，**≤ `intervalMs + timeoutMs`** 内识别并触发重连
- latency RTT 可观测，顶栏球能显示真实数字（不是 null）

## Success Criteria

- nginx `proxy_read_timeout 60s` 反代下，Claude 频道空闲 5 分钟仍能正常收到下一条 SDK 消息
- DevTools Network 面板能看到约每 `intervalMs` 一次的 ping/pong 文本帧
- 拔网线 → 30 秒内顶栏球转 `reconnecting`，恢复后转 `open`
- Layout 顶栏在 Claude 频道展示 latency 数字（不是空白）

## Non-Goals（v0.1 严格排除）

- 不覆盖 generic_chat / codex 通道（它们已有自己的心跳，**不动**）
- 不引入全局 `NetworkManager` 跨通道抽象（v0.1 保持 socket-per-channel 独立实现）
- **不做 session resume**：连接断开重连后，活跃 run 怎么续接、断线期间内容怎么 backfill —— 推到 v0.2
- 不解决"同一 thread 多 tab 同时保活"
- 不动 SDK 内部（保活只在 WS 传输层）

## Constraints

- 前后端继续复用现有 `thread_id` 绑定模型
- Claude 通道继续复用现有 `SessionManager`，本 spec 不改其接口
- UI 只在 `backend_kind=claude_code` 时暴露 Claude 连接球，避免 generic / codex 误导
- **心跳数值常量必须走配置真源**（`cfg.web.ws_heartbeat_interval_ms` 三件套），不在 `claude-ws.ts` 重新硬编码
- **前后端必须同 commit 上线**：客户端发 ping 但后端不识别 → 客户端永远收不到 pong → 死循环重连。详见 [05-validation-and-evolution.md](./05-validation-and-evolution.md#上线约束)
