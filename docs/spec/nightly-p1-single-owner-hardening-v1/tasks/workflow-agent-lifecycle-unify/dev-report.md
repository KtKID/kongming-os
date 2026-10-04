# Dev Report — workflow-agent-lifecycle-unify — 20260729

## 根因与修复

workflow child 由 `SubAgentManager` 直接调用 `SessionEngine.run()`，普通 child 由
`AgentManager` 管理；Web `/subagents` 再读取独立 lifecycle registry。一次 child
因此拥有执行、状态和 Web 投影三个 owner，identity、终态、取消和 retention 无法
形成同一条事实链。

修复后所有 workflow child 都通过已 boot 父 `AgentManager.spawn()` 派生，
`TaskRegistry` 保存冻结 `TaskIdentity` 和可变生命周期字段。`AgentManager`、
`HostDispatcher`、ThreadManager 与 REST route 只传递 `TaskProjection`。live 记录
全量保留，指定 thread 的终态只保留最新 200 条；终态写入采用首次转换生效的幂等
规则。缺少父 manager 或 parent identity 时，workflow 在目录、TaskRecord、审计和
LLM 副作用前失败。

旧 `application/subagents/manager.py` 与 `lifecycle.py` 已删除；任务值对象迁到
`application/agent_workflows/task_models.py`。CLI、Web runtime 和 live/策略测试
均迁到新入口。

## 红灯证据

- `uv run pytest -q tests/unit/test_task_registry.py -k
  'workflow_task_projection or retention'`：旧 `TaskRecord` 不接受 `thread_id`，
  `TaskRegistry` 不接受 `max_terminal_records`，测试在构造 owner 时失败；预期是
  running/terminal 共用 identity，A thread 溢出只裁剪 A 最旧 5 条终态。
- `uv run pytest -q
  tests/unit/test_agent_workflow_manager.py::test_workflow_without_parent_agent_manager_fails_before_child_side_effects`：
  旧路径实际输出 `DID NOT RAISE`；预期 manager 缺失与 identity 缺失两个轴都抛
  `RuntimeError`，且 spawn 请求数、parent mailbox、workflow 目录均为零。
- `uv run pytest -q tests/unit/test_agent_workflow_interrupt_business_flow.py
  tests/unit/test_workflow_cancel_propagation.py`：旧路径超时，实际
  `child_cancelled_count=0`；预期父 workflow 取消后已 spawn child 的 LLM/tool
  收到取消。
- `uv run pytest -q tests/unit/test_agent_workflow_manager.py -k usage`：旧路径
  实际 child usage 为 `{}`；预期保留
  `{"input_uncached_tokens": 5, "output_total_tokens": 2}` 和真实 `turn_count`。
- Q3 反例
  `uv run pytest -q tests/unit/test_agent_manager.py::test_local_child_cancel_keeps_registry_open_for_sibling_spawn`：
  修复前 child A 局部取消把 registry 设为 closed，child B 的 `spawn()` 抛
  `SpawnRejected`；预期 B 成功登记并进入真实 AgentManager run bridge。
- 所有红灯产物均固化在上述普通 pytest 用例中；无 `skip`、`xfail` 或放宽断言。

## 关键改动

- `src/application/agents/registry.py`
- `src/application/agents/manager.py`
- `src/application/agents/subagent_tools.py`
- `src/application/agent_workflows/manager.py`
- `src/application/agent_workflows/task_models.py`
- `src/hosts/shared/host_dispatcher.py`
- `src/hosts/web/routers/thread_subagents.py`
- `src/hosts/web/run.py`
- `src/hosts/cli/main.py`
- `src/core/outcome.py`
- `web/src/protocol.ts`
- `tests/support/workflow_agent_tree.py`
- `tests/support/workflow_strategy_manager.py`
- workflow、TaskRegistry、REST 和中断相关 unit/e2e 测试
- Agent、Web、执行器与 workflow 模块文档

## 验证证据

```verify
id: SC12-spawn-registry-rest-identity
scenario: SC_12
cmd: uv run pytest -q tests/e2e/test_workflow_task_registry_rest_smoke.py tests/unit/web/test_thread_subagents_router.py
cwd: .
expect_exit: 0
expect_contains: 5 passed
mode: auto
```

```verify
id: SC13-terminal-retention
scenario: SC_13
cmd: uv run pytest -q tests/unit/test_task_registry.py::test_workflow_task_projection_keeps_identity_across_terminal_transition tests/unit/test_task_registry.py::test_retention_prunes_only_oldest_terminal_records tests/unit/test_task_registry.py::test_run_result_terminal_status_is_preserved
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

```verify
id: SC14-parent-owner-early-failure
scenario: SC_14
cmd: uv run pytest -q tests/unit/test_agent_workflow_manager.py::test_workflow_without_parent_agent_manager_fails_before_child_side_effects
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC12-workflow-cancel-propagation
scenario: SC_12
cmd: uv run pytest -q tests/unit/test_agent_workflow_interrupt_business_flow.py tests/unit/test_workflow_cancel_propagation.py tests/unit/test_workflow_runtime_registry.py
cwd: .
expect_exit: 0
expect_contains: 10 passed
mode: auto
```

## 补充质量证据

- workflow 聚焦矩阵：`112 passed, 4 skipped`；4 项均需显式真实模型环境。
- Ruff：相关 production、test 与 support 文件通过。
- mypy：49 个相关 production/support 文件通过。
- import-linter：20 个架构合同通过。
- Web `tsc --noEmit`：通过。
- Web threads store：`10 passed`。
- Web protocol codegen check：通过。
- Web 全量 unit 当前有 3 个文件、19 个既有失败；失败集中于
  `ChatTimelineStore` 与 `CodexProjectsTree`，与 child projection 协议无关。
- `git diff --check`：通过。

本报告由 x-dev 于 2026-07-29 生成；RAG 按用户要求跳过。
