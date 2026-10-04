# task-progress-single-owner · 开发清单

> spec: docs/spec/workflow-task-progress-single-owner-v3
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 定义 schema v2、五态和 control mode；实现唯一 Manager 状态机、依赖校验、foreground 替换、幂等与 runtime 终态迁移 | SC_01, SC_02, SC_03, SC_04, SC_05, SC_07, SC_09, SC_11 | J1、J5、J6、J7、J10；持锁单次迁移与终态不可回退 | src/sessions/task_progress_models.py, src/sessions/task_progress_manager.py, src/sessions/_task_progress_repository.py, src/sessions/__init__.py, tests/unit/test_session_task_progress.py | None | [x] ✅ | issue-2 |
| T2 | 删除 workflow 内存镜像和全量同步；task-flow 初始化不可变骨架；把模型工具收敛为 start/next 命令并保留内部 lifecycle 终态入口 | SC_06, SC_07, SC_08, SC_09, SC_14 | J2、J3、J5、J9、J11；LLM 无状态字段写权，artifact 只作计划证据 | src/application/agent_workflows/manager.py, src/application/agent_workflows/strategies/task_flow/strategy.py, src/tools/builtin/task_progress_tool.py, src/tools/__init__.py, src/tools/agent_workflow_tool.py, tests/unit/test_agent_workflow_manager.py, tests/unit/test_agent_workflow_task_flow.py, tests/unit/tools/builtin/test_task_progress_tool.py, tests/e2e/test_task_flow_workflow.py | T1 | [x] ✅ | issue-1, issue-2 |
| T3 | 将 schema v2 放入 Python/TS wire 真源；收敛 router 为 GET 投影；前端基于显式 current 坐标和五态渲染 | SC_10, SC_12 | J4、J6、J8；Python/TS 1:1 合同与 Web 只读投影 | src/hosts/web/protocol/rest_models.py, src/hosts/web/routers/thread_task_progress.py, web/src/protocol.ts, web/src/hooks/useThreadTaskProgress.ts, web/src/components/ThreadTaskProgressPopover.tsx, tests/unit/web/test_thread_task_progress_router.py, web/src/hooks/__tests__/, web/src/components/__tests__/ | T2 | [x] ✅ | issue-3 |
| T4 | 建立真实 Manager→file→REST→Web 的 smoke 与 fake LLM 薄 E2E，写 dev-report verify 证据并复跑全量 Gate ① | SC_08, SC_10, SC_12, SC_13, SC_14 | SC13；内部消费者与用户可见链路必须穿过真实 owner | tests/e2e/test_task_flow_workflow.py, tests/unit/web/test_thread_task_progress_router.py, web/tests/e2e/, docs/spec/workflow-task-progress-single-owner-v3/tasks/task-progress-single-owner/reports/ | T3 | [x] ✅ | issue-4, issue-5, issue-6, issue-7 |
