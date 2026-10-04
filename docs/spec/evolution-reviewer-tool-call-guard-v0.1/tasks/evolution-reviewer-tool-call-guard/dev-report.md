# Dev Report — evolution-reviewer-tool-call-guard — 20260727-084420

## 改动文件清单

- `src/core/contracts/llm_provider.py`
- `src/core/contracts/streaming.py`
- `src/core/contracts/event_sink.py`
- `src/core/contracts/__init__.py`
- `src/core/errors.py`
- `src/core/runner.py`
- `src/runtime_assembly/session_engine.py`
- `src/evolution/reviewer_runtime.py`
- `src/evolution/trigger_diagnostics.py`
- `tests/unit/test_runner_tool_call_contract.py`
- `tests/unit/test_evolution_reviewer_runtime.py`
- `tests/e2e/test_evolution_tool_call_guard_web.py`
- `tests/e2e/test_self_evolution_e2e.py`
- `docs/modules/核心/README.md`
- `docs/modules/进化/README.md`
- `docs/spec/evolution-reviewer-tool-call-guard-v0.1/spec.md`
- `docs/spec/evolution-reviewer-tool-call-guard-v0.1/tasks/evolution-reviewer-tool-call-guard/dev-checklist.md`
- `docs/spec/evolution-reviewer-tool-call-guard-v0.1/tasks/evolution-reviewer-tool-call-guard/diagram.md`
- `docs/spec/evolution-reviewer-tool-call-guard-v0.1/tasks/evolution-reviewer-tool-call-guard/dev-report.md`

## 红灯证据

生产实现前已运行新增测试并保留以下失败事实：

| 任务 | 命令 | 预期 | 实际 |
|---|---|---|---|
| T2 | `uv run pytest -q tests/unit/test_runner_tool_call_contract.py` | Runner 接受 run 级合同参数并进入行为断言 | exit 1；`6 failed, 1 passed`；6 个严格合同用例均在入口得到 `TypeError: Runner.run() got an unexpected keyword argument 'llm_tool_call_contract'`，未启用合同的既有 `tool_unavailable` 回归通过 |
| T4 | `uv run pytest -q tests/unit/test_evolution_reviewer_runtime.py` | reviewer sink 接受工具过滤/日志坐标，child run 透传严格合同 | exit 1；`3 failed, 3 passed`；两个 sink 用例得到 `_RecordingEventSink.__init__() got an unexpected keyword argument 'allowed_tool_name'`，runtime 用例得到缺少 `max_turns` 与 `llm_tool_call_contract` 参数 |

这些红灯测试保持为普通测试，生产修复后由同一测试文件转绿。

## 验证证据

```verify
id: S1
scenario: SC_01
cmd: uv run pytest -q tests/unit/test_runner_tool_call_contract.py::test_stream_contract_retries_once_with_transient_correction_and_clean_history tests/unit/test_evolution_reviewer_runtime.py::test_recording_event_sink_logs_contract_violation_without_sensitive_payload
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: S2
scenario: SC_02
cmd: uv run pytest -q tests/unit/test_runner_tool_call_contract.py::test_stream_contract_retries_once_with_transient_correction_and_clean_history
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S3
scenario: SC_03
cmd: uv run pytest -q tests/unit/test_runner_tool_call_contract.py::test_stream_contract_second_violation_fails_without_cancel_or_tool_events tests/e2e/test_evolution_tool_call_guard_web.py::test_evolution_guard_second_violation_emits_one_failed_notice
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: S4
scenario: SC_04
cmd: uv run pytest -q tests/unit/test_runner_tool_call_contract.py::test_non_stream_contract_rejects_before_content_session_and_tool_side_effects
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S5
scenario: SC_05
cmd: uv run pytest -q tests/e2e/test_evolution_tool_call_guard_web.py::test_evolution_guard_retries_185_documents_and_emits_one_completed_notice tests/e2e/test_self_evolution_e2e.py::test_self_evolution_run_child_reviewer_and_write_files
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: S6
scenario: SC_06
cmd: uv run pytest -q tests/unit/test_runner_tool_call_contract.py::test_contract_missing_required_call_retries_with_distinct_violation
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S7
scenario: SC_07
cmd: uv run pytest -q tests/unit/test_runner_tool_call_contract.py::test_contract_rejects_second_declared_call_before_any_execution
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S8
scenario: SC_08
cmd: uv run pytest -q tests/unit/test_evolution_reviewer_runtime.py::test_recording_event_sink_keeps_only_tool_events
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S9
scenario: SC_09
cmd: uv run pytest -q tests/unit/test_runner_tool_call_contract.py::test_stream_contract_retries_once_with_transient_correction_and_clean_history tests/unit/test_runner_tool_call_contract.py::test_stream_contract_second_violation_fails_without_cancel_or_tool_events tests/unit/test_runner_tool_call_contract.py::test_stream_close_error_preserves_violation_log_and_corrective_retry tests/unit/test_runner_tool_call_contract.py::test_strict_stream_rejects_non_closable_iterator_before_consumption
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

```verify
id: S10
scenario: SC_10
cmd: uv run pytest -q tests/unit/test_runner_tool_call_contract.py::test_runner_without_contract_keeps_tool_unavailable_behavior
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S11
scenario: SC_11
cmd: uv run pytest -q tests/unit/test_runner_tool_call_contract.py::test_contract_discards_valid_prefix_when_later_tool_is_undeclared tests/unit/test_runner_tool_call_contract.py::test_non_stream_contract_discards_valid_prefix_before_accepted_events
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

## 自检结论

本人（x-dev）已在本机运行全部 auto verify 命令，并确认结果与本报告一致。

补充质量证据：

- `uv run mypy src`：440 个源文件通过。
- `uv run ruff check .`：通过。
- `uv run lint-imports`：20 个架构合同通过。
- 最终聚焦 Runner/reviewer/native/E2E：28 passed；更宽的相关测试集在新增反例前为 180 passed，另有 1 个未改动的旧 Web replay 测试因旧版 model 配置字段产生基线失败。
- 全量 `uv run pytest -q`：收集阶段受 15 个既有基线错误阻断，包含 safety 已删除常量导入和 Web 测试包导入冲突。

本报告由 x-dev 于 2026-07-27T08:44:20Z 生成。
