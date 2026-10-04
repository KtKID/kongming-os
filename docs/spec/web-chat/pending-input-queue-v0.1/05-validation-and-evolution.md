# 验证策略与演进

## 验证策略

### Manager 状态机测试

- `repo:tests/unit/web/test_pending_input_runtime_gate.py`
  - 连续两次 `submit_user_input(...)` 只创建一个 `current_run_task`。
  - active run 期间第二条写入 pending queue。
  - 第 21 条返回 `pending_input_queue_full`。
  - normal 完成后 drain 第一条。
  - user_interrupt 完成后 drain 第一条。
  - runtime_refresh_failed、evicted、shutdown、deleted 跳过 drain。
  - update / cancel / promote 只作用于 queued 项。

- `repo:tests/unit/web/test_pending_input_choice_priority.py`
  - `choice_response` 排在普通 `user_message` 前。
  - 多个 choice response 保持 FIFO。
  - 普通输入 FIFO 保持稳定。

### 后端路由与桥接测试

- `repo:tests/unit/web/test_pending_input_ws_routes.py`
  - `user.input` route 调用 `ThreadManager.submit_user_input(...)`。
  - `choice.submit` route 复用 `format_choice_submit_as_user_input(frame)` 后调用 `submit_choice_result(...)`。
  - 满队列错误转成前端可展示 frame。

- `repo:tests/unit/web/test_pending_input_avatar_bridge.py`
  - `AvatarAssistantManager` 调用 `ThreadManager.submit_avatar_input(...)`。
  - Avatar accepted 语义保持。
  - active run 时 Avatar 输入入队，idle 时立即启动。

### 协议漂移测试

- `repo:tests/unit/web/test_pending_input_protocol.py`
  - Python `PendingInputDTO` 与 snapshot / changed / started frame 序列化字段完整。
  - unknown field、默认值、错误 reason 行为明确。

- `repo:web/src/protocol.__tests__/pendingInputProtocol.contract.test.ts`
  - TS 类型 fixture 与 Python fixture 对齐。
  - `Record<string, unknown>` 用于 metadata / details。
  - `pending_input_queue_full` 过渡错误字段可被 UI 识别。

### 前端交互测试

- `repo:web/src/pages/__tests__/Chat.pendingInputQueue.test.tsx`
  - 输入框上方渲染 `PendingInputQueuePanel`。
  - ChoicePanel 与 PendingInputQueuePanel 排序稳定。
  - running 时 Composer 仍可提交普通文本。
  - 模型切换、工具切换等禁用语义保持。
  - 满队列错误展示明确文案。

- `repo:web/src/modules/pending-input/__tests__/PendingInputQueuePanel.test.tsx`
  - snapshot 渲染最多 20 条。
  - 编辑、删除、上移、下移按钮发送正确 frame。
  - started frame 移除对应队列项。

### 跨前后端 smoke

- `repo:tests/e2e/web/test_pending_input_queue_smoke.py`
  - 启动 fake Web generic_chat。
  - 发送第一条 `user.input` 进入 active run。
  - active run 期间发送普通输入、choice response、Avatar 输入。
  - 断言后端只存在一个 `current_run_task`。
  - 断言队列 snapshot 按 choice priority 排序。
  - 完成当前 run 后 drain 第一条。

- `repo:web/e2e/pending-input-queue.spec.ts`
  - 两个浏览器上下文订阅同一 thread。
  - Tab A 入队，Tab B 看到 snapshot。
  - Tab B 编辑 / 删除 / 调整顺序，Tab A 同步变化。
  - 刷新后队列与后端 snapshot 一致。

## 验收命令建议

本 spec 阶段不运行测试。进入 x-dev 后建议按风险顺序执行：

```bash
uv run pytest tests/unit/web/test_pending_input_runtime_gate.py -v
uv run pytest tests/unit/web/test_pending_input_ws_routes.py -v
pnpm exec vitest run web/src/pages/__tests__/Chat.pendingInputQueue.test.tsx
```

执行命令以仓库根目录为工作目录；上方“验证策略”里的 `repo:` 只用于标注文件归属。

## 演进路线

### 本轮 x-req / x-dev

- [ ] 建立 `ThreadManager` runtime gate。
- [ ] 新增后端 pending queue state。
- [ ] 新增 Python/TS pending input protocol。
- [ ] 改造 `user.input`、`choice.submit`、Avatar 输入入口。
- [ ] 实现输入框上方队列 UI。
- [ ] 补齐 Manager、route、protocol、UI、smoke 测试。

### 后续 1-2 轮

- [ ] x-req 阶段决定 ErrorCode 是否正式扩展 `pending_input_queue_full`。
- [ ] 为队列项增加来源标签和更详细的 preview。
- [ ] 增加 pending input 操作 audit event。
- [ ] 为 runtime refresh failed 增加恢复提示。

### 长期方向

- 支持队列持久化恢复。
- 支持 workflow task 视图读取 pending queue。
- 支持批量清空和暂停 drain。
- 支持多输入来源的可视化过滤。

## P0 验证关注点

- `current_run_task` 单写入口必须可通过测试证明。
- drain policy 必须覆盖 normal、user_interrupt、runtime_refresh_failed、evicted、shutdown、deleted。
- 协议双侧字段必须有 fixture 锁定。
- 前端 running 提交能力必须与模型/工具切换禁用语义解耦。
