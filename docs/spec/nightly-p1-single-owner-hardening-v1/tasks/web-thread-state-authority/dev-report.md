# Dev Report — web-thread-state-authority — 20260729

## 根因与修复

原实现同时存在三组重复状态 owner：

1. `ChatManager` 在 transport 发送前直接把 canonical thread 状态写成
   `responding`，把“点击发送”误当成“服务端已经运行”。
2. thread-status 只推增量，缺少 active snapshot、全局 sequence 和 run identity；
   新页面、重连页面以及同 thread 连续 run 无法可靠判断当前状态。
3. approval 卡片点击后由前端立即删除，失败回执和双 tab 竞争会丢失重试入口。

修复增加 `ThreadStatusManager` 作为 active map、sequence、run generation、连接队列
和 writer 的唯一 owner。所有 generic、Claude、Codex publisher 在 provider
启动前取得 run lease 并注册可中断 task，再向 Manager 发布；新连接先排 snapshot，
status、approval、usage、pong 共用单连接 writer。慢连接的阻塞 send 由同一 writer
取消并发送 1013，客户端依靠重连 snapshot 恢复。

前端把 transport dispatch 与服务端 canonical status 分成两个 store。
`threadStatus` 只接受当前 connection generation 的 snapshot/delta，snapshot 全量
replace，terminal 删除 active 项；`threadDispatch` 保存短暂 dispatching/error。
Composer 在发送失败时保留文本、reasoning、附件和引用；Claude/Codex 新建会话的
首发 buffer 同时保存 wire 输入与原始草稿，自动首发继续携带完整输入，失败时恢复
完整原始草稿，成功前不生成用户气泡。

approval 卡片改为 pending/submitting/error。resolve 期间卡片和 remember candidate
保持可见，失败回执恢复按钮；只有服务端 remove 或新 snapshot omission 删除卡片，
remove 后到达的 result 被幂等忽略。

Q3 修复把 approval snapshot 的取样和发送排队放进 broadcaster 同一锁边界，
确保 snapshot、add、remove 形成全序。thread-status delta 与 snapshot 都由 Python
Pydantic 模型生成 JSON Schema 和 TypeScript，codegen check 同时比较两份产物。
双浏览器 E2E 使用真实 `ApprovalManager + InboxEventSink` 仲裁相反 allow/reject
决议，并验证只接受一次且只有 approved 决议继续一次工具执行。

## 基线红灯形状

基线 diff 可回放三条确定失败：

- `ChatManager.sendMessage` 在 provider 发送前调用 `markThreadRunning`；
  `sendMessage 只写 dispatch 交互态` 用例会得到 canonical `responding`。
- `useApprovalInbox.resolve` 发送后立即 `removeLocal`；
  `accepted=false 保留卡片可重试` 用例会得到空卡片集合。
- 基线没有 `ThreadStatusManager`、snapshot、sequence 和 run generation；
  Manager 并发测试与双侧协议 round-trip 无法导入或校验。

## 变更边界

- 后端 owner：`src/hosts/web/websocket/thread_status_manager.py`
- WS 适配与单 writer：`src/hosts/web/websocket/thread_status.py`
- publisher：generic EventSink、Claude、Codex、dashboard usage/network
- wire 真源：`src/hosts/web/protocol/`、`web/src/protocol.ts`、
  `web/src/protocol/ws-thread-status.ts` 和生成 schema
- 前端：`ChatManager`、三频道发送入口、`threadStatus`、`threadDispatch`、
  `useThreadStatusWS`、approval inbox
- 测试：Manager/真实 FastAPI WS、前端 reducer、协议漂移和两个独立浏览器上下文
- 文档：`docs/modules/Web前端/README.md`

## 验证证据

```verify
id: SC06-active-snapshot
scenario: SC_06
cmd: uv run pytest -q tests/unit/web/test_thread_status_manager.py::test_attach_first_frame_is_active_snapshot_then_sequence_delta tests/unit/web/integrations/test_provider_status_lease_order.py
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC07-attach-terminal-order
scenario: SC_07
cmd: uv run pytest -q tests/unit/web/test_thread_status_manager.py::test_attach_and_terminal_share_one_ordered_lock_boundary tests/unit/web/approvals/global_inbox/test_broadcaster.py::TestConcurrency::test_snapshot_enqueue_precedes_concurrent_add tests/unit/web/approvals/global_inbox/test_broadcaster.py::TestConcurrency::test_snapshot_enqueue_precedes_concurrent_remove
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC09-slow-connection-overflow
scenario: SC_09
cmd: uv run pytest -q tests/unit/web/test_thread_status_manager.py::test_slow_connection_overflow_closes_only_that_connection
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC27-stale-run-lease
scenario: SC_27
cmd: uv run pytest -q tests/unit/web/test_thread_status_manager.py::test_stale_terminal_cannot_clear_new_run
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC23-protocol-round-trip
scenario: SC_23
cmd: uv run pytest -q tests/unit/test_web_protocol_round_trip.py tests/unit/web/test_thread_status_protocol_codegen.py
cwd: .
expect_exit: 0
expect_contains: passed
mode: auto
```

```verify
id: SC01-send-failure-draft
scenario: SC_01
cmd: pnpm exec vitest run src/chat/__tests__/runtime.smoke.test.ts src/components/__tests__/Composer.test.tsx src/components/__tests__/ClaudeCodeView.test.tsx src/components/__tests__/CodexView.test.tsx src/stores/__tests__/threads.test.ts -t "transport 失败|onSubmit 返回 false|创建后的首条消息发送失败|pending 模式下发送首条消息"
cwd: web
expect_exit: 0
expect_contains: passed
mode: auto
```

```verify
id: SC02-dispatch-canonical-split
scenario: SC_02
cmd: pnpm exec vitest run src/chat/__tests__/runtime.smoke.test.ts -t "sendMessage 只写 dispatch 交互态"
cwd: web
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC08-reconnect-generation
scenario: SC_08
cmd: pnpm exec vitest run src/stores/__tests__/threadStatus.test.ts
cwd: web
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC03-resolve-failure-retry
scenario: SC_03
cmd: pnpm exec vitest run src/features/approval-inbox/__tests__/useApprovalInbox.test.ts -t "sender 返回 false|remember resolve"
cwd: web
expect_exit: 0
expect_contains: passed
mode: auto
```

```verify
id: SC04-remove-late-result
scenario: SC_04
cmd: pnpm exec vitest run src/features/approval-inbox/__tests__/useApprovalInbox.test.ts -t "authoritative remove 后忽略 late resolve_result"
cwd: web
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC05-double-browser-resolve
scenario: SC_05
cmd: pnpm exec playwright test --config=playwright.thread-state-authority.config.ts --grep "两个浏览器同时审批"
cwd: web
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC24-browser-snapshot-reconnect
scenario: SC_24
cmd: pnpm exec playwright test --config=playwright.thread-state-authority.config.ts --grep "后打开与重连浏览器"
cwd: web
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC25-double-browser-authoritative-remove
scenario: SC_25
cmd: pnpm exec playwright test --config=playwright.thread-state-authority.config.ts --grep "两个浏览器同时审批"
cwd: web
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

## 补充质量证据

- `pnpm typecheck`：通过。
- `pnpm protocol:check`：生成协议与提交文件逐字节一致。
- 目标 Python Ruff/mypy：通过。
- 静态残留扫描：生产路径无 `ThreadStatusBroadcaster`、`get_broadcaster`、
  `markThreadRunning` 和 canonical `setStatus` 调用。

本报告由 x-dev 于 2026-07-29 生成。
