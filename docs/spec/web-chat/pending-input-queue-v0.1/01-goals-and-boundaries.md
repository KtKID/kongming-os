# 目标与完成标准

## 需求要点

1. 同一个 thread 有 active run 时，普通用户输入进入队列；idle 时立即启动下一轮。
2. 队列最多 20 条，第 21 条返回 `pending_input_queue_full`，前端展示明确错误。
3. run 结束后 `ThreadManager` 立刻 drain 下一条；用户点 Stop 后当前 run 收尾完成，再按队列发送第一条；thread 删除、cell eviction、server shutdown、runtime refresh 失败时跳过 drain。
4. `user.input`、`choice.submit`、Avatar 输入都交给 `ThreadManager` 统一入口，不在各自路由里直接管理 `current_run_task`。
5. `choice.submit` 进入同一个队列，`priority=choice_response`，并优先排在普通 queued message 前面；多个 choice response 保持提交顺序。
6. 队列真源在后端 `ThreadManager` / `ThreadCell`；前端只渲染后端 snapshot，以支持多 tab、刷新、重连一致性。
7. 输入框上方渲染独立队列 UI，支持最多 20 条，用户可编辑、删除、调整顺序；队列变化通过 WebSocket 帧同步。

## 系统目标

为 Web generic_chat 建立一个同 thread 的普通输入队列，让所有普通 run start 都经过 `ThreadManager`。目标是保证一个 thread 同一时间只有一个 `current_run_task`，后续输入以有序队列承接，run 收尾后按照 completion reason drain，并通过后端 snapshot 驱动前端 UI。

## 完成目标（DoD）

- [ ] 同一 thread 快速连续发送两条 `user.input` 时只存在一个 `current_run_task`，第二条进入 pending queue。
- [ ] 当前 run 正常完成后，队列第一条立即成为下一轮 run，顺序和消息历史一致。
- [ ] 用户 Stop 当前 run 后，cancel 收尾完成，队列第一条继续发送；evict、shutdown、delete 不触发 drain。
- [ ] `choice.submit` 与 `user.input` 共享 `ThreadManager` gate，running 时 choice response 入队且优先于普通 queued message。
- [ ] Avatar chat 不再直接覆盖 `current_run_task`，提交行为与 Web 普通输入一致。
- [ ] 后端广播 pending input snapshot / changes，前端输入框上方展示队列，支持编辑、删除、调整顺序，多 tab / 重连一致。
- [ ] 队列上限 20 生效，第 21 条返回 `pending_input_queue_full`。
- [ ] Python/TS 协议、后端路由测试、Manager 状态机测试、前端交互测试、跨前后端 smoke 覆盖到位。

## 范围边界

**包含**：
- Web generic_chat 普通输入 pending queue。
- 后端 `ThreadCell.pending_inputs` 和 `pending_input_lock`。
- `ThreadManager.submit_user_input()`、`submit_choice_result()`、`submit_avatar_input()`、`cancel_pending_input()`、`update_pending_input()`、`promote_pending_input()`。
- `ThreadManager._submit_pending_input()`、`_start_pending_input_run()`、`_drain_next_run()`。
- `PendingInputDTO`、snapshot / changed / started 帧。
- 前端 `PendingInputQueuePanel`、队列 store / manager、20 条计数和错误展示。
- Stop、normal、evict、shutdown、delete、runtime refresh failed 的 drain 判定。

**不包含**：
- 跨 thread 或跨设备的全局发送队列。
- pending input 长期持久化恢复。
- tool call 执行队列和 approval 队列。
- CLI/TUI 队列展示。
- 历史消息排序或消息回放改造。

## 关键约束

- `current_run_task` 的普通运行入口由 `ThreadManager` 收口，WebSocket routes 和 Avatar adapter 只提交请求。
- 队列真源在后端 `ThreadCell`，前端只消费后端 snapshot 和 change frame。
- `choice.submit` 使用现有 `format_choice_submit_as_user_input(frame)` 归一化文本，再进入统一提交路径。
- 协议新增字段必须同步 `repo:src/hosts/web/protocol/ws_frames.py` 与 `repo:web/src/protocol.ts`。
- 前端共享协议类型只能从 `repo:web/src/protocol.ts` 导入。
- 验证代码进入 `repo:tests/` 或 `repo:web/src/pages/__tests__/` 等固定测试目录，采用可重复测试。
- 图集统一在 `./diagrams.md`，本文只保留文字和链接。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD#1 单 thread 连续发送只保留一个 active run | Pending Input Runtime Gate + Pending Input Protocol | `web-chat-pending-input-runtime-gate-v0.1` | 待实现 |
| DoD#2 normal 完成后 drain 第一条 | Pending Input Runtime Gate | `web-chat-pending-input-runtime-gate-v0.1` | 待实现 |
| DoD#3 Stop 后 drain，evict/shutdown/delete 跳过 | Pending Input Runtime Gate + Verification and Contract Tests | `web-chat-pending-input-runtime-gate-v0.1` | 待实现 |
| DoD#4 choice priority 和共享 gate | Pending Input Runtime Gate + Choice/Avatar Submission Bridge + Pending Input Protocol | `web-chat-pending-input-choice-avatar-bridge-v0.1` | 待实现 |
| DoD#5 Avatar 走统一入口 | Choice/Avatar Submission Bridge + Pending Input Runtime Gate | `web-chat-pending-input-choice-avatar-bridge-v0.1` | 待实现 |
| DoD#6 后端广播和前端可编辑队列 | Pending Input Protocol + Pending Queue UI | `web-chat-pending-input-protocol-ui-v0.1` | 待实现 |
| DoD#7 20 条上限和错误展示 | Pending Input Runtime Gate + Pending Input Protocol + Pending Queue UI | `web-chat-pending-input-runtime-gate-v0.1`、`web-chat-pending-input-protocol-ui-v0.1` | 待实现 |
| DoD#8 测试覆盖 | Verification and Contract Tests + 全部生产模块 | `web-chat-pending-input-contract-tests-v0.1` | 待实现 |

## 风险边界

- 高风险：run 完成回调和 Stop cancel 收尾期间的 drain 时机，需要避免重复启动和漏 drain。
- 中风险：choice priority 改变现有 active run 拒绝语义，需要与相邻 choice spec 的错误处理保持一致。
- 中风险：Composer 允许 running 时提交普通输入后，工具、模型切换、附件等禁用语义需要拆开。
- 低风险：队列 UI 编辑、删除、排序属于后端 snapshot 驱动的常规交互。

关键状态流转见 `./diagrams.md#数据关系状态流转`。
