# Dev Report — unified-scheduled-run-ownership — 20260731

## 根因

旧 ticker 同时承担到期扫描、`asyncio.Task` 创建、并发限流、inflight 集合和
shutdown drain。定时任务的 `task_id/run_id/session_id/thread_id` 已经存在，运行期
缺少 `run_id → 真实 TaskRegistry handle` 的唯一 owner。结果是 REPLACE 与 shutdown
只能修改 durable run 行，旧 Runner、tool 子进程和迟到 finalizer 仍可能继续执行。

## 实现

- `ScheduledRunManager` 成为 live run 唯一门户，持有 reservation/run/task 索引、
  单调 submission sequence、per-task ALLOW/FORBID/REPLACE 准入、Manager
  Semaphore、真实取消和 shutdown。
- ticker 收敛为 `Store.reserve_due_tasks → submit_scheduled_run`，其模块内没有
  run task、semaphore、inflight 集合和结果等待。
- scheduled root 通过注入的 `ScheduledRunDispatcher` 进入
  `ScheduledRunHostDispatcher → HostDispatcher → AgentManager → TaskRegistry`；
  TaskRegistry 已注册的同一 Task 直接 await
  `ExecutionBridge → SessionEngine.run → Runner.run`。bridge 内没有 Runner
  `create_task`，stable thread 与 fresh session 同时保留。
- `scheduler.run_portal` 提供 ticker 与 ScheduleTool 的最小 Protocol；
  application live owner 通过依赖倒置消费 dispatcher Protocol，20 条
  import-linter 合同保持绿色。
- `DueTaskReservation.reservation_id` 和 `ScheduledRunSubmitReceipt` 固定提交身份；
  fingerprint 覆盖 reservation 的完整 frozen payload，重试返回相同 run/session，
  preset、approval、delivery 等任一字段冲突都会在启动副作用前失败。
- Store 新增 exact-run 读取、terminal CAS、全量 stale recovery 与精确取消；
  durable `CANCELLED` 抢占旧 finalizer，迟到 terminal 进入 diagnostic incident。
- RUNNING 首写失败会生成 FAILED terminal 与 incident，started 生命周期帧保持 0。
  Manager 等待 HostDispatcher/TaskRegistry 收口，进入 `FINISHING` 后移除 live
  索引并完成 durable result future，再统一发布所有 completed/failed/cancelled
  的 finished 帧；阻塞生命周期 sink 仍由 owner 持有到关闭收口。
- shutdown 先给全部 cell 冻结取消原因，再并发收口 running 与 pending，避免
  semaphore 释放时等待槽位的 run 偷跑。
- CLI ticker、Web lifespan 与 ScheduleTool `run_now` 共享进程内同一个
  `ScheduledRunManager`；startup 先恢复 stale RUNNING，shutdown 顺序为
  ticker stop → Manager close → runtime close。
- `cron.run.started/finished` 进入 Python/TypeScript wire 真源；面板从
  `SchedulerManager` 的 durable result 与 live Manager 投影组合状态，ALLOW 多 run
  按 run_id 独立维护。`cron.run.completed` 只承载 delivery 消息；面板收到
  `cron.run.finished` 后才发起 REST refresh 和终态收口。

## QA Gate R1 修复

- issue-1：删除 `ExecutionBridge.execute` 公共旁路；新增 frozen
  `RunExecutionOverrides`，cron 的 provider/tools/sinks/run ID 通过
  `SessionEngine.run` 进入唯一 Runner。task approval 使用 transform 叠加在
  SessionEngine 已装配的 SafetyGatedApproval 外层，无法替换安全门户。watchdog
  只取消 TaskRegistry 已登记的当前 `agent-run-*` Task。
- issue-2：取消先用 Store CAS 写 durable `CANCELLED` winner，再中断
  HostDispatcher。`_run_cell` 不再等待 result future；delivery await 收到取消后
  由 Manager finally 读取 winner、清理资源并发布 future，阻塞投递回归测试在
  1 秒超时内稳定完成。
- issue-3：submit 占位时分配单调 submission sequence；准入只观察更早 cell。
  back-to-back FORBID 测试证明较早 receipt 稳定获胜。
- issue-4：lifecycle sink 归 ScheduledRunManager；finished 回调内观察到 durable
  terminal 且 `has_live_task(task_id) == False`，取消 winner 同样收到 finished。
- issue-5：reservation fingerprint 改为完整 dataclass canonical JSON SHA-256；
  input 与 preset 冲突都返回同一稳定 collision。
- issue-6：薄链路使用真实 SessionEngine、Runner、SafetyGatedApproval、工具调用、
  HostDispatcher、TaskRegistry 和 Store；外部 LLM 使用可控 fake。另有真实 bridge
  阻塞 delivery 取消、finished→REST 面板刷新与 Python/TS wire 测试。

## QA Gate R2 修复

- issue-1：watchdog 触发后优先形成 `INACTIVITY_TIMEOUT`，覆盖真实 Runner 顶层
  吞 `CancelledError` 并返回 cancelled Result 的路径；新增真实
  SessionEngine/Runner 反例测试。
- issue-2：将 Web 注入重命名为 `interactive_approval_factory`，返回值只作为
  ConsentResolver 的人工终点。`InteractiveApprovalRebinder` 由 runtime
  `SafetyGatedApproval` 实现，复用 DangerGuard、处置模式、thread permissions
  与事件链；HardBlock 对抗测试证明允许型人工终点无法替换安全 owner。
- issue-3：live cell 新增 `FINISHING`。durable terminal、live 索引释放和
  result future 先收口，finished 生命周期通知随后执行；`aclose` 会继续持有
  FINISHING owner，阻塞 sink 测试证明结果可读且关闭等待完整。
- issue-4：所有 terminal 入口统一调用 `_update_task_last_run_at`，覆盖正常 CAS、
  FORBID/pending skip、外部取消和 RUNNING 首写失败。
- issue-5：cancel reason 使用首写者语义；shutdown 只填充尚未设置原因的 cell。
  用户取消与 shutdown 交错测试固定 `user_interrupt` winner。
- issue-6：新增真实
  `ScheduledRunManager → WebDeliverySink → CronWSBroker frame → cron REST`
  薄链路，finished frame 与 REST terminal 对齐同一 run/status/result；
  前端集成测试只替换 HTTP/WS 运输边界，收到 finished 后穿过真实
  `listTaskRuns → runFromDTO → store.loadRuns` 加载 terminal，并在
  `SchedulerRunsPanel` 显示结果摘要。
- 追加资源硬化：尚未执行首步的 owner 被立即取消时由取消方补齐 terminal/future；
  per-task admission lock 使用引用计数，在最后一个准入协程退出后回收。

## QA Gate R3 修复

- issue-1：前端终态可见性测试返回真实 `CronTaskDTO/CronRunDTO` 的 HTTP fake；
  production `apiGet`、`listTaskRuns`、`runFromDTO`、Zustand `loadRuns` 和
  `SchedulerRunsPanel` 全部走真实实现。测试断言两个真实 REST path、DTO
  `final_message_excerpt` 映射和最终可见文本。
- issue-2：Web `_scheduler_interactive_approval_factory` 与相关 task helper 改为
  `ScheduledTask → ApprovalProvider | None` 显式合同，mypy 会检查 consent-only
  工厂边界。

## QA Gate 最终复核

- 独立 reviewer 对 R3 裁剪边界复核通过：P0/P1/P2/P3 均为 0。
- issue-1 定向 Vitest 通过 7 条；issue-2 定向 mypy 通过。
- Gate ② 最终结论：PASS。

## 红灯证据

- `test_scheduled_run_ownership_contracts.py` 首轮 3 个失败：reservation 字段、
  exact-run CAS 和全量 stale recovery 尚未存在。
- `test_scheduled_run_manager.py` 首轮 import 失败：统一 live owner 模块尚未存在。
- shutdown 对抗测试首次卡住：running 释放 global semaphore 后，pending owner
  在顺序取消窗口进入 dispatcher。close 改为先冻结全部取消原因并并发收口后转绿。
- HostDispatcher 子代理合同测试首次观察到 child 与 root child-result 两次调用；
  断言收敛到 child `user_message` 调用，固定测试真正关心的审批/thread 坐标。
- QA R2 新增 6 条最小反例首次全部失败：阻塞 finished sink 超时、shutdown
  覆盖 user cancel、互动审批替换 HardBlock、真实 Runner 超时误记 cancelled、
  RUNNING 首写失败与投递中取消均遗漏 `last_run_at`。同一组测试在修复后全绿。
- Playwright scheduler lifecycle 当前环境启动 `127.0.0.1:5174` 时得到
  `EPERM`；提升本地回环权限的请求被运行额度策略拒绝。后端真实 TestClient/e2e、
  前端 scheduler unit 和 TypeScript typecheck 均已通过。

## 关键文件

- `src/application/scheduled_runs/manager.py`
- `src/application/scheduled_runs/execution_bridge.py`
- `src/application/agents/registry.py`
- `src/hosts/shared/host_dispatcher.py`
- `src/scheduler/domain.py`
- `src/scheduler/run_portal.py`
- `src/scheduler/store.py`
- `src/scheduler/ticker.py`
- `src/scheduler/runtime_factory.py`
- `src/hosts/web/protocol/ws_frames.py`
- `web/src/protocol.ts`
- `tests/unit/scheduler/test_scheduled_run_manager.py`
- `tests/e2e/test_scheduled_run_thread_launch_e2e.py`

## Gate ① 验证证据

```verify
id: SC01-ticker-submit-only
scenario: SC_01
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduler_ticker.py::test_tick_submits_each_reservation_without_creating_live_task
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC02-identity-before-start
scenario: SC_02
cmd: .venv/bin/pytest -q tests/e2e/test_scheduled_run_thread_launch_e2e.py::test_ticker_launches_scheduled_run_through_real_thread_task_chain
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC03-manager-max-inflight
scenario: SC_03
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduled_run_manager.py::test_manager_max_inflight_owns_pending_runs
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC04-allow-fresh-independent
scenario: SC_04
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduled_run_manager.py::test_allow_keeps_independent_fresh_sessions
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC05-forbid-live-owner
scenario: SC_05
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduled_run_manager.py::test_forbid_back_to_back_submissions_keep_earlier_winner tests/unit/scheduler/test_scheduled_run_manager.py::test_forbid_records_second_trigger_without_starting_runner
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC06-replace-real-handle-and-pid
scenario: SC_06
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduled_run_manager.py::test_replace_interrupts_real_registered_run_before_new_start tests/unit/test_task_registry.py::test_kill_and_wait_real_subprocess_no_zombie
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC07-first-terminal-wins
scenario: SC_07
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduled_run_ownership_contracts.py::test_cancelled_terminal_rejects_late_completed_write
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC08-cancel-reasons-and-watchdog
scenario: SC_08
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduled_run_manager.py::test_user_cancel_has_distinct_durable_reason tests/unit/scheduler/test_scheduled_run_manager.py::test_immediate_cancel_before_owner_first_step_publishes_result tests/unit/scheduler/test_scheduled_run_manager.py::test_user_cancel_reason_wins_when_shutdown_overlaps_interrupt tests/unit/scheduler/test_scheduler_execution_bridge.py::test_watchdog_cancels_inactive_runner tests/e2e/test_scheduled_run_thread_launch_e2e.py::test_real_runner_watchdog_persists_inactivity_timeout tests/e2e/test_scheduled_run_thread_launch_e2e.py::test_cancel_during_blocked_delivery_publishes_terminal_without_deadlock
cwd: .
expect_exit: 0
expect_contains: 6 passed
mode: auto
```

```verify
id: SC09-running-persist-compensation
scenario: SC_09
cmd: .venv/bin/pytest -q tests/e2e/test_scheduled_run_thread_launch_e2e.py::test_running_persistence_failure_closes_live_owner_and_records_incident
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC10-shutdown-collects-all
scenario: SC_10
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduled_run_manager.py::test_close_collects_running_and_pending_and_rejects_new_submissions tests/unit/scheduler/test_scheduled_run_manager.py::test_finished_notification_cannot_hide_durable_result_or_live_cleanup tests/unit/scheduler/test_scheduled_run_manager.py::test_finished_idempotency_cells_are_pruned_to_fixed_limit
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC11-stable-thread-fresh-session
scenario: SC_11
cmd: .venv/bin/pytest -q tests/e2e/test_scheduled_run_thread_launch_e2e.py::test_ticker_launches_scheduled_run_through_real_thread_task_chain
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC12-persist-before-lifecycle-frame
scenario: SC_12
cmd: .venv/bin/pytest -q tests/e2e/test_scheduled_run_thread_launch_e2e.py::test_ticker_launches_scheduled_run_through_real_thread_task_chain tests/e2e/test_scheduled_run_thread_launch_e2e.py::test_manager_finished_frame_matches_terminal_rest_projection tests/unit/web/test_cron_run_protocol.py tests/unit/web/test_cron_delivery.py::test_websink_run_started_broadcasts_cron_started_frame tests/unit/web/test_cron_delivery.py::test_websink_run_finished_broadcasts_cron_finished_frame
cwd: .
expect_exit: 0
expect_contains: 11 passed
mode: auto
```

```verify
id: SC13-cron-plan-preserved
scenario: SC_13
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduler_execution_bridge.py::test_bridge_passes_tool_context_metadata_to_runner tests/unit/scheduler/test_scheduler_execution_bridge.py::test_silent_marker_short_circuits_to_silent tests/unit/scheduler/test_scheduler_execution_bridge.py::test_disallowed_bare_names_are_trimmed tests/unit/scheduler/test_execution_bridge_preset_misconfig.py::test_w4_preset_hit_overrides_agent_spec_default_model tests/unit/scheduler/test_execution_bridge_approval_mode.py::test_interactive_factory_only_rebinds_runtime_safety_consent tests/unit/safety/test_safety_contract_redlines.py::test_rebinding_interactive_approval_preserves_runtime_hard_block tests/e2e/test_cron_hard_block_in_trust_e2e.py::test_hard_block_in_trust_still_rejected_no_audit
cwd: .
expect_exit: 0
expect_contains: 7 passed
mode: auto
```

```verify
id: SC14-startup-recovery-order
scenario: SC_14
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduled_run_ownership_contracts.py::test_recover_stale_runs_closes_every_running_allow_run tests/unit/test_cli_main_scheduler.py::test_cli_starts_ticker_when_scheduler_enabled tests/unit/test_web_app_lifespan_scheduler.py::test_lifespan_starts_ticker_when_scheduler_enabled
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC15-web-panel-durable-results
scenario: SC_15
cmd: .venv/bin/pytest -q tests/e2e/test_scheduled_run_thread_launch_e2e.py::test_manager_finished_frame_matches_terminal_rest_projection tests/e2e/test_cron_router_e2e.py::test_cron_router_full_lifecycle
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC15-frontend-live-results
scenario: SC_15
cmd: pnpm exec vitest run src/modules/scheduler/__tests__/useSchedulerRealtime.test.tsx src/modules/scheduler/__tests__/api.test.ts
cwd: web
expect_exit: 0
expect_contains: 12 passed
mode: auto
```

```verify
id: SC16-reservation-exactly-once
scenario: SC_16
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduled_run_manager.py::test_concurrent_duplicate_and_conflicting_reservation_are_deterministic
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC17-replace-pending-owner
scenario: SC_17
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_scheduled_run_manager.py::test_replace_cancels_same_task_pending_before_it_gets_global_slot
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

## 补充质量证据

- scheduler、Safety、HostDispatcher、ScheduleTool、Web protocol/runtime factory
  与 cron e2e：`633 passed, 1 skipped`；skip 为需要真实外部模型的 opt-in 用例。
- scheduler 前端 unit：`31 passed`；`pnpm typecheck` exit 0。
- Ruff：通过；mypy：13 个本轮核心生产文件通过。
- import-linter：`20 kept, 0 broken`；`git diff --check` exit 0。
