# scheduler-task-lifecycle · 开发清单

> spec: docs/spec/nightly-p1-single-owner-hardening-v1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 用 TaskLifecycleState 替换持久化 enabled+TaskState，定义转移矩阵和 schema v5→v6 原子备份迁移 | SC_15, SC_16, SC_17 | J13、J16；持久化迁移与回滚 | src/scheduler/domain.py, src/scheduler/store.py, src/scheduler/manager.py | None | [x] ✅ | None |
| T2 | 调整 reserve/ExecutionBridge：one-shot 领取转 exhausted，last_run_at 只由 terminal run.finished_at 写入，recurring lifecycle 保持 scheduled | SC_15, SC_16 | J15；task/run 正交 | src/scheduler/store.py, src/application/scheduled_runs/execution_bridge.py, src/tools/builtin/schedule_tool.py | T1 | [x] ✅ | None |
| T3 | 将 cron REST DTO 收口协议真源并分开展示 lifecycle、latest run 与 live runtime status | SC_15, SC_16, SC_23, SC_26 | J14；Python/TS 双侧真源 | src/hosts/web/protocol/, src/hosts/web/routers/cron.py, web/src/protocol.ts, web/src/modules/scheduler/ | T2 | [x] ✅ | None |
| T4 | 覆盖 v5 fixture 迁移、reservation 并发、真实 SchedulerManager/REST/frontend mapper 与页面 E2E，并同步文档 | SC_15, SC_16, SC_17, SC_23, SC_26 | J20；迁移、并发、用户可见证据 | tests/unit/scheduler/, tests/unit/web/, web/src/modules/scheduler/**/__tests__/, web/tests/e2e/, docs/modules/定时任务/README.md | T3 | [x] ✅ | None |
