# pending-input-queue-v0.1

> 状态：方案确认
> 目标：为 Web generic_chat 增加同 thread 的普通输入队列，统一 user.input、choice.submit、Avatar 输入的 run 启动入口，避免并发 run 覆盖 current_run_task，并在输入框上方展示可编辑的最多 20 条队列。

## 系统目标

Web generic_chat 当前有多条入口能启动同一个 thread 的下一轮 run：普通 `user.input`、`choice.submit` 和 Avatar 输入。这个 spec 将这些入口统一收口到 `ThreadManager`，让同 thread active run 期间的后续普通输入进入后端队列，run 收尾后按规则 drain 下一条，前端只展示后端 snapshot，保证多 tab、刷新、重连看到同一队列。

## 需求覆盖

1. 同一个 thread 有 active run 时，普通用户输入进入队列；idle 时立即启动下一轮。
2. 队列最多 20 条，第 21 条返回 `pending_input_queue_full`，前端展示明确错误。
3. run 结束后 `ThreadManager` 立刻 drain 下一条；用户点 Stop 后当前 run 收尾完成，再按队列发送第一条；thread 删除、cell eviction、server shutdown、runtime refresh 失败时跳过 drain。
4. `user.input`、`choice.submit`、Avatar 输入都交给 `ThreadManager` 统一入口管理 `current_run_task`。
5. `choice.submit` 进入同一个队列，`priority=choice_response`，优先排在普通 queued message 前面；多个 choice response 保持提交顺序。
6. 队列真源在后端 `ThreadManager` / `ThreadCell`；前端只渲染后端 snapshot。
7. 输入框上方渲染独立队列 UI，支持最多 20 条，用户可编辑、删除、调整顺序；队列变化通过 WebSocket 帧同步。

## 最小可用路径

用户在同一 thread 的当前 run 执行期间再次输入 → WebSocket route 调用 `ThreadManager.submit_user_input()` → 后端将输入加入 `ThreadCell.pending_inputs` 并广播 snapshot → Chat 页在输入框上方展示可编辑队列 → 当前 run normal 或 user_interrupt 收尾 → `ThreadManager._drain_next_run()` 取下一条启动 run → 多 tab 收到 `pending-input.started` / changed 帧并同步队列。

## 范围边界

**包含**：
- Web generic_chat 同 thread pending input queue。
- `user.input`、`choice.submit`、Avatar 输入统一 run start gate。
- 后端队列上限 20 条和 `pending_input_queue_full` 错误。
- choice response 优先级和 FIFO 规则。
- Stop 后 drain、normal drain、evict/delete/shutdown/runtime refresh failed skip drain。
- WebSocket snapshot / changed / started 同步帧。
- 输入框上方队列面板，支持编辑、删除、上移、下移。

**不包含**：
- 跨 thread 队列。
- 队列长期持久化。
- CLI/TUI 队列 UI。
- 模型 tool call 级调度队列。
- workflow artifact 队列视图。

## 现状与复用

- `repo:src/hosts/web/websocket/routes.py` 的 `user.input` 分支直接调用 `_start_run_once_task(...)` 并设置 `cell.current_run_task`。
- `repo:src/hosts/web/websocket/routes.py` 的 `choice.submit` 分支 active run 时拒绝，然后调用 `_start_run_once_task(...)`。
- `repo:src/hosts/web/websocket/routes.py` 已有 `format_choice_submit_as_user_input(frame)`，可复用为 choice 文本归一化。
- `repo:src/hosts/web/threads/manager.py` 当前只有 `_start_first_message_run(...)` 直接启动首条消息 continuation，缺统一普通 run start 门户。
- `repo:src/hosts/web/threads/cell.py` 的 `ThreadCell` 已有 `current_run_task`、`runtime_preset_id`、`preset_refresh_lock`，适合新增 `pending_inputs` / `pending_input_lock`。
- `repo:src/hosts/web/avatar/assistant_manager.py` 当前 `_start_run_task(...)` 直接创建 avatar run task 并设置 `cell.current_run_task`。
- `repo:src/hosts/web/protocol/ws_frames.py` 与 `repo:web/src/protocol.ts` 是 Web wire 协议双侧真源。
- `repo:web/src/pages/Chat.tsx` 当前在输入框上方渲染 `ChoicePanel` 再渲染 `Composer`，pending queue panel 应放在同一区域。
- `repo:web/src/pages/Chat.tsx` 当前 `Composer disabled` 包含 `isRunning`，队列功能需要允许 running 时提交普通输入，并保留工具/模型切换等禁用语义。
- 相邻 spec `user-choice-tool-v0.1` 提供 `choice.submit` 语义和 UI 区域参考。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| Pending Input Runtime Gate | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1pending-input-runtime-gate) | 是 | `ThreadManager` 统一提交、入队、启动和 drain |
| Pending Input Protocol | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2pending-input-protocol) | 是 | Python/TS 双侧 DTO 与 WebSocket 帧 |
| Pending Queue UI | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3pending-queue-ui) | 是 | 输入框上方队列面板和操作 store |
| Choice/Avatar Submission Bridge | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4choiceavatar-submission-bridge) | 是 | choice 与 Avatar 适配到 `ThreadManager` |
| Verification and Contract Tests | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-5verification-and-contract-tests) | 是 | 并发 gate、协议漂移、UI、多 tab 覆盖 |

## 文档导航

- [图集：总览 + 各模块局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

该 spec 可整体进入 x-req。优先拆 `web-chat-pending-input-runtime-gate-v0.1`，先验证 `ThreadManager` 并发 gate、drain 规则和 `current_run_task` 单写入口；协议与 UI task 并行推进，Choice/Avatar 桥接跟随 Runtime Gate 合入。
