# Dev Report — 05-runner-validation-gate — 20260809

## 改动文件清单

- `src/core/contracts/llm_provider.py`（续推校验结果、失败种类与 provider 的实际 reasoning gate Protocol）
- `src/core/contracts/__init__.py`（公共合同导出）
- `src/core/runner.py`（同模型 state 发送投影、reasoning plan 门禁和工具副作用前校验）
- `src/infrastructure/llm_providers/base.py`（OpenAI-compatible replay envelope 校验、请求/模型默认 effort 的统一解析与实际 reasoning gate）
- `src/infrastructure/llm_providers/openai_responses.py`、`src/infrastructure/llm_providers/anthropic_messages.py`（复用统一的有效 effort 解析）
- `tests/unit/test_runner_reasoning_projection.py`（SC_06、SC_09、SC_10、SC_15、SC_16、SC_25）
- `tests/unit/test_reasoning_continuation_validation.py`（两类真实 provider validator 的错误坐标）
- `docs/spec/reasoning-continuation-v0.1/tasks/05-runner-validation-gate/dev-checklist.md`（完成状态）

## 实现说明

Runner 从 Session / context snapshot 获取完整历史后，按当前 `LLMRequest.model` 创建发送副本：同模型的 `reasoning_state` 原样保留，其他模型的 state 仅在副本中置空。Session 历史没有删除或改写，因此同模型的后续 run 可以继续带回 state，模型切换也仍可保留可读文字、tool calls 和 tool results。

严格门禁以 provider 解析后的实际 reasoning plan 为真源。当前请求显式指定 `low`、`medium`、`high`、`max`，或请求为空时模型默认 effort 实际启用 reasoning，且响应含 tool calls 时，Runner 在 assistant append、approval 和工具 execute 前检查 state 存在、模型一致，并调用当前 provider 的格式与逐项 tool-call 校验；所有失败统一返回 `reasoning_continuation_invalid` 与脱敏 `violation_kind`。显式 `none` 保持普通 tool-loop 路径。

OpenAI-compatible validator 检查 assistant envelope、`tool_calls` 的 id/name/JSON arguments；Anthropic validator 检查有序 content blocks 中的 `tool_use` id/name/input。Runner 只读取 frozen 合同字段和失败枚举，provider-native payload 的解析保持在 provider 边界。

既有 `test_core_runner_basic.py` 和 E2E `StubLLMProvider` 在 `reasoning_effort` 启用且返回 tool calls 时同步构造匹配的测试 replay state，保持它们模拟的 provider 合同与新的严格门禁一致。

## 红灯证据

| 任务 | 命令 | 实现前实际 | 实现后结果 |
|---|---|---|---|
| T1 / T7 | `uv run pytest tests/unit/test_runner_reasoning_projection.py -q` | 模型 B 请求仍携带模型 A 的 `reasoning_state` | SC_25 通过 |
| T2 | 同上 | 缺 state / 模型不匹配时进入下一次 LLM 调用，错误为 stub 响应耗尽 | SC_06 在 assistant append、approval、execute 前返回 `reasoning_continuation_invalid` |
| T2 | `uv run pytest tests/unit/test_reasoning_continuation_validation.py -q` | `ReasoningContinuationViolationKind` 尚不存在，测试收集 ImportError | OpenAI 与 Anthropic validator 均返回确定性失败种类 |
| issue-1 / T2,T5 | `uv run pytest -q tests/unit/test_runner_reasoning_projection.py::test_provider_default_reasoning_effort_keeps_pre_side_effect_gate` | `reasoning_effort=None` 绕过门禁，四次工具执行后以 max turns 失败 | provider 默认 `high` 的真实 encoder payload 启用 reasoning，缺 state 在任何副作用前返回 `reasoning_continuation_invalid` |

## 验证证据

```verify
id: S1
scenario: SC_06
cmd: uv run pytest -q tests/unit/test_reasoning_continuation_validation.py tests/unit/test_runner_reasoning_projection.py::test_missing_state_fails_before_assistant_append_approval_and_tool_execution tests/unit/test_runner_reasoning_projection.py::test_provider_default_reasoning_effort_keeps_pre_side_effect_gate tests/unit/test_runner_reasoning_projection.py::test_model_mismatch_fails_before_assistant_append_approval_and_tool_execution tests/unit/test_runner_reasoning_projection.py::test_real_provider_tool_call_mismatch_fails_before_side_effects
cwd: .
expect_exit: 0
expect_contains: 7 passed
mode: auto
```

```verify
id: S2
scenario: SC_09
cmd: uv run pytest -q tests/unit/test_runner_reasoning_projection.py::test_same_model_new_run_replays_persisted_state
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S3
scenario: SC_10
cmd: uv run pytest -q tests/unit/test_runner_reasoning_projection.py::test_steer_keeps_active_same_model_state_in_next_request
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S4
scenario: SC_15
cmd: uv run pytest -q tests/unit/test_runner_reasoning_projection.py::test_reasoning_disabled_tool_loop_keeps_normalized_path
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S5
scenario: SC_16
cmd: uv run pytest -q tests/unit/test_runner_reasoning_projection.py::test_multi_tool_state_replayed_once_and_results_stay_paired
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S6
scenario: SC_25
cmd: uv run pytest -q tests/unit/test_runner_reasoning_projection.py::test_model_switch_filters_state_from_request_and_preserves_session
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S7
scenario: SC_06
cmd: uv run mypy src/core/contracts/llm_provider.py src/core/contracts/__init__.py src/core/runner.py src/infrastructure/llm_providers/base.py src/infrastructure/llm_providers/openai_responses.py src/infrastructure/llm_providers/anthropic_messages.py tests/unit/test_runner_reasoning_projection.py tests/unit/test_reasoning_continuation_validation.py
cwd: .
expect_exit: 0
expect_contains: Success: no issues found
mode: auto
```

```verify
id: S8
scenario: SC_06
cmd: uv run ruff check src/core/contracts/llm_provider.py src/core/contracts/__init__.py src/core/runner.py src/infrastructure/llm_providers/base.py src/infrastructure/llm_providers/openai_responses.py src/infrastructure/llm_providers/anthropic_messages.py tests/unit/test_runner_reasoning_projection.py tests/unit/test_reasoning_continuation_validation.py && uv run lint-imports
cwd: .
expect_exit: 0
expect_contains: Contracts: 20 kept, 0 broken.
mode: auto
```

## 自检结论

T1–T7 已完成。`xdev verify` 覆盖 SC_06、SC_09、SC_10、SC_15、SC_16、SC_25 的全部自动证据。Context compaction 的 state-free summary projection、checkpoint replacement 与重启读取由独立 Task 06 承接。
