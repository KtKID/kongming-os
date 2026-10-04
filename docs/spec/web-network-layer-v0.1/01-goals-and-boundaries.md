# 01 Goals And Boundaries

## Goals

- 用户痛点：Claude 频道空闲约 60 秒就停止刷新（中间代理 idle 切断 + 客户端无应用层心跳）
- **v0.1 目标**：建立网络层抽象（`NetworkManager` + 独立 `Heartbeat` 脚本），让 Claude 频道接入并治掉"1 分钟掉线"
- 为 v0.2 其他频道接入 / 旧 broadcaster 收编 / 协议字段统一**预留扩展点**（多 `Heartbeat` 并存、channel 抽象、frameType 字段）

## Success Criteria

| 指标 | 验证方式 |
|---|---|
| Claude 频道 **5 分钟空闲不掉线**（nginx idle 60s 反代下）| 浏览器手测 + playwright e2e |
| Claude 频道 ping/pong 文本帧每 30 秒一次（默认 intervalMs）| DevTools Network |
| 拔网线 ≤ 100 秒识别死连接转 `reconnecting` | 手测 + 集成测 |
| 顶栏 Claude 球显示真实 latency 数字（非 `null`）| Layout 视觉验收 |
| `Heartbeat` 类可独立 new 多个实例并发跑互不干扰 | 单元测试（vitest + pytest）|
| `network/tools.*` 不被业务层 import | import-linter / eslint 红线 |

## Non-Goals（v0.1 严格排除）

- ❌ **不接入** generic_chat / codex / thread-status / scheduler / workspace-shell 任何频道（v0.2 B1'）
- ❌ **不收编** 现有 3 个 broadcaster（`ApprovalInboxBroadcaster` / `CronWSBroker` / `thread_status_ws`）（v0.2 B2）
- ❌ **不修改** 协议字段名（`kind` / `type` 不动；v0.2 C 阶段统一为 `frameType`）
- ❌ **不动** `WebSocketFanout`（留原位，v0.2 评估是否搬入 `src/network/`）
- ❌ **不动** `useThreadStatusWS` 等剩余频道 hook 的内联心跳代码（v0.2 后续删除；generic 旧链路已在 B1'-generic 删除）
- ❌ **不做 session resume**：连接断开重连后怎么续接活跃 SDK run、断线期间消息怎么 backfill（v0.2 另立 spec `web-claude-session-resume-v0.2`）
- ❌ **不引入** SharedWorker / ServiceWorker 等后台真心跳方案（v0.3+）

## Constraints

### 架构边界

- 业务组件 / hook **不允许**直接 `new WebSocket()`；必须通过 `networkManager.openChannel(...)`（v0.1 仅 claude 路径强制；其他频道 v0.2 才收口）
- `src/network/` 和 `web/src/network/` **不依赖任何业务模块**（不能 import claude_code / threads / approval / cron 等业务包）
- 业务模块**可以** import `network/manager`，**不能** import `network/tools`
- 后端 `src/network/` 不被 `src/core/` import（保持 core 零 sibling 依赖原则不变）

### 数值真源

- 心跳参数（`intervalMs` / `timeoutMs` / `maxMissed`）必须走 `cfg.web.ws_heartbeat_*` 三件套（**已存在**），不在 `network/` 立新常量
- 所有频道未来共用同一份心跳配置（"所有通道公用一个倒计时配置"原则）

### 上线约束

- A + B1 必须**前后端同 commit 上线**（客户端发 ping 但老后端不识别 → 死循环重连）
- A + B1 必须**作为单个 PR 提交**（A 独立无法验证，B1 没 A 没架子）
