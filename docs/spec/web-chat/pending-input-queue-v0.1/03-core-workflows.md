# 核心流程

## 流程 1：普通输入入队与立即启动

1. 前端发送 `user.input`。
2. WebSocket route 只解析 frame 并调用 `ThreadManager.submit_user_input(...)`。
3. `ThreadManager` 获取目标 `ThreadCell` 和 `pending_input_lock`。
4. 当前 `cell.current_run_task` 为空或已结束时，`ThreadManager._start_pending_input_run(...)` 立即启动 run。
5. 当前 thread 有 active run 时，`ThreadManager._submit_pending_input(...)` 校验队列容量。
6. 队列未满时创建 `PendingInputDTO`，`priority=user_message`，写入 `cell.pending_inputs`。
7. 后端广播 `pending-input.changed` 或 snapshot，前端在输入框上方展示队列。
8. 队列已满时返回 `pending_input_queue_full`，前端展示明确错误并保留输入草稿。

Runtime Gate 图见 `./diagrams.md#runtime-gate`。

## 流程 2：choice priority 与 FIFO

1. 前端发送 `choice.submit`。
2. WebSocket route 调用 `format_choice_submit_as_user_input(frame)` 生成稳定 user input 文本。
3. route 调用 `ThreadManager.submit_choice_result(...)`。
4. idle 时 choice result 立即启动下一轮 run。
5. running 时 choice result 进入同一 pending queue，`priority=choice_response`。
6. `ThreadManager` 排序时把所有 `choice_response` 放在 `user_message` 前。
7. 多个 choice response 依据 sequence 保持提交顺序。
8. 当前 run 完成后 drain 第一条，因此 choice response 优先于普通 queued message 启动。

Choice/Avatar Bridge 图见 `./diagrams.md#choiceavatar-bridge`。

## 流程 3：run normal 完成后 drain

1. 当前 run task 完成，完成回调携带 `completion_reason=normal`。
2. `ThreadManager` 清理 `cell.current_run_task`。
3. `ThreadManager._drain_next_run(...)` 获取 lock 并检查 cell 生命周期状态。
4. cell 仍 active 时，从排序后的 pending queue 取第一条。
5. 后端广播 `pending-input.started`，并从 snapshot 中移除该项。
6. `ThreadManager._start_pending_input_run(...)` 启动下一轮 run。
7. 消息历史顺序保持“当前 run 用户消息 → assistant 回复 → 下一条 pending input 作为新 user message”。

状态流转见 `./diagrams.md#数据关系状态流转`。

## 流程 4：Stop 后 drain

1. 用户点击 Stop。
2. 当前 run 按既有 cancel 流程收尾。
3. `Runner.run()` 产出 cancelled 结果，completion reason 归一为 `user_interrupt`。
4. Web host 完成当前 run 的状态、trace、tool_result 配对收口。
5. `ThreadManager` 清理 `current_run_task` 后执行 `_drain_next_run(...)`。
6. pending queue 第一条启动下一轮 run。
7. 前端收到 started / changed 帧，队列 UI 更新。

关键语义：Stop 只取消当前 run；已经排队的普通输入仍表达用户后续意图。

## 流程 5：eviction / shutdown / delete skip drain

1. 当前 run 结束或被取消时，完成回调携带生命周期原因。
2. completion reason 属于 `runtime_refresh_failed`、`evicted`、`shutdown`、`deleted` 时，`ThreadManager` 清理当前 run 状态。
3. `ThreadManager` 跳过 `_drain_next_run(...)`。
4. 后端根据原因广播队列清空、错误或 thread 不可用状态。
5. 前端保留可解释错误或移除当前 thread UI，避免在失效 runtime / cell 上继续启动 run。

该流程保护 cell eviction、server shutdown 和 thread 删除期间的状态一致性。

## 流程 6：多 tab snapshot 与重连

1. Tab A 和 Tab B 连接同一 thread。
2. 后端在 subscribe / reconnect 时发送 `pending-input.snapshot`。
3. 任一 tab 提交、编辑、删除、上移、下移队列项时，WebSocket route 调用 `ThreadManager`。
4. `ThreadManager` 更新后端真源，并向所有订阅连接广播 changed frame。
5. 各 tab 丢弃本地推断结果，以最新 snapshot / changed frame 渲染。
6. Tab 刷新后重新订阅，立即看到后端当前队列。

Protocol 和 Queue UI 图见 `./diagrams.md#protocol` 与 `./diagrams.md#queue-ui`。

## 流程 7：前端 running 时提交

1. Chat 页检测当前 thread isRunning。
2. Composer 文本提交保持可用。
3. 模型切换、工具切换、附件等依旧遵守原禁用语义。
4. 用户提交文本后，前端发送普通 `user.input`。
5. 后端决定立即启动或入队，前端只根据响应和队列 frame 更新 UI。

该流程把“是否运行中”和“是否允许排队提交文本”拆成两个 UI 状态。
