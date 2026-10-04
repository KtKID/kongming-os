# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| Pending Input Runtime Gate | `web-chat-pending-input-runtime-gate-v0.1` | 无 | DoD#1、DoD#2、DoD#3、DoD#7 | 高 | 可进入 x-req | 先验证最大竞态风险 |
| Pending Input Protocol | `web-chat-pending-input-protocol-ui-v0.1` | Runtime Gate DTO 草案 | DoD#6、DoD#7、DoD#8 | 中 | 可进入 x-req | Python/TS 同步改 |
| Pending Queue UI | `web-chat-pending-input-protocol-ui-v0.1` | Pending Input Protocol | DoD#6、DoD#7、DoD#8 | 中 | 可进入 x-req | 与 ChoicePanel 同区域排序 |
| Choice/Avatar Submission Bridge | `web-chat-pending-input-choice-avatar-bridge-v0.1` | Runtime Gate | DoD#4、DoD#5 | 中 | 可进入 x-req | 复用 choice 文本格式化 |
| Verification and Contract Tests | `web-chat-pending-input-contract-tests-v0.1` | 全部生产模块 | DoD#8 | 低 | 可进入 x-req | 可随各 task 分摊落地 |

## 建议开发顺序

1. `web-chat-pending-input-runtime-gate-v0.1`：先做 `ThreadManager` 门户、`ThreadCell` 队列状态、单 run gate、normal / Stop drain、skip drain。
2. `web-chat-pending-input-protocol-ui-v0.1`：同步 Python/TS DTO 和 WebSocket 帧，建立 Chat 队列面板，拆分 Composer running 提交语义。
3. `web-chat-pending-input-choice-avatar-bridge-v0.1`：把 `choice.submit` 和 Avatar 输入改成 adapter，走 `ThreadManager`。
4. `web-chat-pending-input-contract-tests-v0.1`：补齐跨前后端 smoke、多 tab snapshot 和协议漂移测试；也可以拆入前 3 个 task 的 DoD。

## PoC 建议

优先 PoC Runtime Gate：用 fake `ThreadCell` 和 fake run task 连续提交两条 `user.input`，断言只有一个 `current_run_task`，第二条进入 queue，normal 和 user_interrupt 完成后能 drain。该 PoC 通过后，再推进协议与 UI。

## 任务拆分边界

| task | 输入 | 输出 | 完成信号 |
|------|------|------|----------|
| Runtime Gate | 现有 `ThreadManager` / `ThreadCell` / route run start 事实 | 后端统一入口、队列状态、drain policy | DoD#1、DoD#2、DoD#3、DoD#7 通过 |
| Protocol + UI | Runtime Gate DTO 和 WebSocket 广播点 | Python/TS 协议、Queue Panel、Composer 状态拆分 | DoD#6、DoD#7 前端部分通过 |
| Choice/Avatar Bridge | Runtime Gate 方法和现有 choice/avatar 入口 | choice priority、Avatar adapter、错误转译 | DoD#4、DoD#5 通过 |
| Contract Tests | 全部实现入口 | 协议漂移、route、Manager、UI、smoke 覆盖 | DoD#8 通过 |

## 仍留在方案层的问题

- ErrorCode 是否正式扩展 `pending_input_queue_full`，x-req 阶段基于现有 ErrorFrame 结构决定。
- pending queue 是否需要长期持久化，首版按内存真源处理。
- runtime refresh failed 后是否保留可恢复草稿，首版只定义 skip drain。

## 进入 x-req 的模块

全部 5 个模块均可进入 x-req。Runtime Gate 是 P0 先行模块，Protocol + UI 与 Choice/Avatar Bridge 可在 Runtime Gate 门户签名稳定后并行。
