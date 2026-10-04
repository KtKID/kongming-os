# Dev Report — scheduler-task-lifecycle — 20260729

## 根因

旧版 `ScheduledTask` 同时保存 `enabled` 和 `state`，其中 `state` 混入
`running/completed/failed` 等单次执行结果。ticker、ExecutionBridge、REST 和前端
分别写或解释这些字段，形成多个 owner。典型后果包括 recurring 执行失败后任务
被展示为 failed、one-shot 在领取时伪造完成时间、`last_run_at` 早于真实终态，
以及前端无法同时表达“任务已耗尽、当前仍有 live run”。

## 修复

- `ScheduledTask.lifecycle` 成为任务调度状态唯一真源，取值为
  `scheduled/paused/disabled/exhausted/deleted`。
- `ScheduledRun.status` 独立保存每次执行结果；`SchedulerManager` 组合
  lifecycle、latest run status 和 live runtime status。
- recurring 领取后保持 `scheduled` 并推进 `next_run_at`；one-shot 领取时原子转
  `exhausted`、清空 `next_run_at`，领取阶段不写 `last_run_at`。
- ExecutionBridge 落 terminal run 后把 `finished_at` 写入 task `last_run_at`。
- schema v6 对 v5 `enabled + state` 做确定性保留式迁移：先写唯一备份，再映射
  lifecycle，并用最新 terminal run `finished_at` 纠正 `last_run_at`。解析或写入
  失败时原 v5 文件保持原样。
- cron REST DTO 迁入 Python protocol 真源，TypeScript 1:1 复刻；旧
  `enabled/state` 字段从 wire 删除。
- scheduler 页面分别展示 lifecycle、最近 run 和 live run；筛选只读取 lifecycle。

## Gate② R1 修复

- Web lifespan 注入共享 `SchedulerManager`；cron REST 的 task 查询、投影、更新、
  暂停、恢复、删除和手动运行请求统一经 Manager 公共方法。
- `latest_run_status` 只取最近 terminal run；`live_runtime_status` 扫描全部 live
  run。前端按 `run_id` 维护 live 集合，一条 run 完成后仍会保留 sibling running。
- Python/TS 补齐全部 scheduler REST DTO 的默认值、nullability 和响应 wrapper；
  feature 局部 `CronRunMessagesDTO` 已删除。
- v5 迁移失败后重启会按原字节识别并复用已有备份；原子替换后的异常会把
  `scheduled_tasks.json` 恢复为原 v5 字节。
- Playwright 改用隔离的真实 FastAPI、SchedulerManager、Store 和
  ExecutionBridge；浏览器通过真实 REST 读取两组投影并验证刷新、筛选和可见 badge。

## 红灯证据

- `test_one_shot_reservation_atomically_exhausts_without_last_run_at`：旧实现领取时写
  `last_run_at` 并用 completed 表达任务状态；预期 `exhausted + last_run_at=None`。
- `test_v5_to_v6_preserves_tasks_and_corrects_lifecycle_and_last_run`：旧 Store
  `SCHEMA_VERSION=5` 且缺少保留式迁移；预期 v5 多状态 fixture 全量保留并生成唯一备份。
- `test_patch_lifecycle_disabled`：旧 REST PATCH 接受 `enabled` 并返回 `state`；
  预期只接受 `lifecycle`。
- 前端 typecheck：旧 scheduler fixtures 仍声明 `enabled/state`，新 VM 合同要求
  `lifecycle/latestRunStatus/liveRuntimeStatus`。
- Playwright 首轮真实浏览器测试到达刷新后断言，因“已调度”同时命中筛选按钮和
  badge 触发 strict locator 红灯；收紧到 badge 元素后同一测试转绿。

## 关键文件

- `src/scheduler/domain.py`
- `src/scheduler/store.py`
- `src/scheduler/manager.py`
- `src/application/scheduled_runs/execution_bridge.py`
- `src/hosts/web/protocol/rest_models.py`
- `src/hosts/web/routers/cron.py`
- `web/src/protocol.ts`
- `web/src/modules/scheduler/`
- `tests/unit/scheduler/test_task_lifecycle_v6.py`
- `web/tests/e2e/scheduler-lifecycle.spec.ts`
- `docs/modules/定时任务/README.md`

## 验证证据

```verify
id: SC15-recurring-failed-run-orthogonal
scenario: SC_15
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_execution_bridge_preset_misconfig.py::test_w1_misconfigured_preset_id_yields_failed_run
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC16-oneshot-reservation-terminal-and-live-projection
scenario: SC_16
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_task_lifecycle_v6.py::test_one_shot_reservation_atomically_exhausts_without_last_run_at tests/unit/scheduler/test_task_lifecycle_v6.py::test_exhausted_one_shot_can_have_live_running_projection tests/unit/scheduler/test_execution_bridge_preset_misconfig.py::test_one_shot_execution_bridge_finishes_exhausted_task
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC17-v5-migration-backup-and-failure
scenario: SC_17
cmd: .venv/bin/pytest -q tests/unit/scheduler/test_task_lifecycle_v6.py::test_v5_to_v6_preserves_tasks_and_corrects_lifecycle_and_last_run tests/unit/scheduler/test_task_lifecycle_v6.py::test_v5_migration_write_failure_keeps_source_and_backup tests/unit/scheduler/test_task_lifecycle_v6.py::test_v5_migration_failure_after_replace_restores_source_and_reuses_backup
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC23-scheduler-rest-protocol-strictness
scenario: SC_23
cmd: .venv/bin/pytest -q tests/unit/test_web_protocol_round_trip.py::test_scheduler_rest_dto_round_trip_and_strictness
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC26-scheduler-ui-orthogonal-status
scenario: SC_26
cmd: pnpm test:unit src/modules/scheduler/__tests__/SchedulerTaskRow.test.tsx src/modules/scheduler/__tests__/selectors.test.ts
cwd: web
expect_exit: 0
expect_contains: 10 passed
mode: auto
```

## 补充质量证据

- scheduler 后端、schedule tool 与 Web protocol：`635 passed`。
- cron 真实 TestClient / e2e：`167 passed`（主矩阵 165 + 聚焦复跑 2）。
- scheduler 前端 unit：`53 passed`；`pnpm typecheck` exit 0。
- Playwright SC_26：`1 passed`，贯穿真实 FastAPI → SchedulerManager → Store /
  ExecutionBridge → REST → 页面抽屉、筛选和刷新；后端/WS 连接正常。
- Ruff：通过；mypy：16 个生产文件通过。

RAG 按用户要求跳过。
