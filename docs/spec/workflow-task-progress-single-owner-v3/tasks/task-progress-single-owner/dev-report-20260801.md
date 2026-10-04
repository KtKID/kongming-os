# task-progress-single-owner · 开发报告

实现 schema v2 单一 foreground 进度板。`SessionTaskProgressManager` 统一初始化、LLM start/next 与 runtime 生命周期迁移；task-flow artifact 保持初始计划证据；Web REST 只读并通过 Python/TS 协议真源投影五态。

## 主要改动

- 删除 workflow 内存进度镜像、整快照同步和 REST PUT 写入口。
- LLM 仅能调用 `advance_task_progress` 的 `start`/`next`，运行时路径保留精确 failed/cancelled 终态。
- task-flow parser 校验依赖闭包并拒绝初始 status；前端直接使用 snapshot 的 workflow_id/title。

```verify
id: sc01-foreground
scenario: SC_01
cmd: uv run pytest tests/unit/test_task_progress_state_machine_v3.py::test_open_replaces_foreground_and_writes_schema_v2 -q
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 60
mode: auto
```

```verify
id: sc02-start-next
scenario: SC_02
cmd: uv run pytest tests/unit/test_task_progress_state_machine_v3.py::test_llm_start_and_next_are_single_atomic_transition -q
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 60
mode: auto
```

```verify
id: sc03-atomic-next
scenario: SC_03
cmd: uv run pytest tests/unit/test_task_progress_state_machine_v3.py::test_llm_start_and_next_are_single_atomic_transition -q
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 60
mode: auto
```

```verify
id: sc04-final-next
scenario: SC_04
cmd: uv run pytest tests/unit/test_task_progress_state_machine_v3.py::test_final_next_completes_flow_and_replay_is_idempotent -q
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 60
mode: auto
```

```verify
id: sc05-dependency
scenario: SC_05
cmd: uv run pytest tests/unit/test_task_progress_state_machine_v3.py::test_rejects_invalid_dependency_and_stale_workflow_without_mutation tests/unit/test_agent_workflow_task_flow.py::test_parser_rejects_state_injection_and_invalid_dependencies -q
cwd: .
expect_exit: 0
expect_contains: passed
timeout: 60
mode: auto
```

```verify
id: sc06-tool-fields
scenario: SC_06
cmd: uv run pytest tests/unit/tools/builtin/test_task_progress_tool.py::test_rejects_arbitrary_state_or_shape_fields -q
cwd: .
expect_exit: 0
expect_contains: 3 passed
timeout: 60
mode: auto
```

```verify
id: sc07-runtime-terminal
scenario: SC_07
cmd: uv run pytest tests/unit/test_task_progress_state_machine_v3.py::test_runtime_terminal_states_are_exact_and_cannot_regress tests/unit/test_agent_workflow_interrupt_business_flow.py -q
cwd: .
expect_exit: 0
expect_contains: passed
timeout: 60
mode: auto
```

```verify
id: sc08-recoverable-error
scenario: SC_08
cmd: uv run pytest tests/unit/tools/builtin/test_task_progress_tool.py::test_recoverable_tool_argument_error_keeps_active_step_in_progress -q
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 60
mode: auto
```

```verify
id: sc09-owner-guard
scenario: SC_09
cmd: uv run pytest tests/unit/test_task_progress_state_machine_v3.py::test_rejects_invalid_dependency_and_stale_workflow_without_mutation tests/unit/test_task_progress_state_machine_v3.py::test_llm_commands_reject_runtime_owned_snapshot -q
cwd: .
expect_exit: 0
expect_contains: 2 passed
timeout: 60
mode: auto
```

```verify
id: sc10-web-projection
scenario: SC_10
cmd: npm run test:unit -- src/hooks/__tests__/useThreadTaskProgress.test.tsx src/components/__tests__/ThreadTaskProgressPopover.test.tsx
cwd: web
expect_exit: 0
expect_contains: Test Files  2 passed
timeout: 90
mode: auto
```

```verify
id: sc11-concurrency
scenario: SC_11
cmd: uv run pytest tests/unit/test_task_progress_state_machine_v3.py::test_concurrent_identical_next_is_idempotent -q
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 60
mode: auto
```

```verify
id: sc12-wire-contract
scenario: SC_12
cmd: uv run pytest tests/unit/web/test_thread_task_progress_router.py::test_protocol_payload_rejects_unknown_and_missing_v2_fields tests/unit/web/test_thread_task_progress_router.py::test_put_route_is_absent -q
cwd: .
expect_exit: 0
expect_contains: 2 passed
timeout: 90
mode: auto
```

```verify
id: sc13-task-flow-e2e
scenario: SC_13
cmd: uv run pytest tests/e2e/test_task_flow_workflow.py -q
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 90
mode: auto
```

```verify
id: sc14-artifact-owner
scenario: SC_14
cmd: uv run pytest tests/e2e/test_task_flow_workflow.py -q
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 90
mode: auto
```

```verify
id: sc06-strategy-catalog
scenario: SC_06
cmd: uv run pytest tests/unit/test_agent_workflow_task_flow.py::test_task_flow_description_keeps_fixed_progress_tool_out_of_input_payload -q
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 60
mode: auto
```

```verify
id: sc07-runtime-reentry
scenario: SC_07
cmd: uv run pytest tests/unit/test_agent_workflow_roundtable_review.py::test_roundtable_review_strategy_writes_review_board -q
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 60
mode: auto
```

```verify
id: sc12-ts-wire-contract
scenario: SC_12
cmd: npm run typecheck && npm run test:unit -- src/protocol.task-progress.contract.test.ts
cwd: web
expect_exit: 0
expect_contains: 1 passed
timeout: 120
mode: auto
```

```verify
id: sc13-browser-single-owner
scenario: SC_13
cmd: pnpm exec playwright test task-progress-single-owner.spec.ts --project=chromium --reporter=list
cwd: web
expect_exit: 0
expect_contains: 1 passed
timeout: 120
mode: auto
```

```verify
id: sc13-real-web-manager
scenario: SC_13
cmd: pnpm exec playwright test --config playwright.task-progress-single-owner.config.ts --project=chromium
cwd: web
expect_exit: 0
expect_contains: 1 passed
timeout: 120
mode: auto
```
