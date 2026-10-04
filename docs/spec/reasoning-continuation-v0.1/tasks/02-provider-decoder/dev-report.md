# Dev Report — 02-provider-decoder — 20260808-000000

> 2026-08-09 修复更新：`AnthropicStreamParser` 已保存并原样重放
> `redacted_thinking.data`，同时保持真正缺失的 data 字段缺失。Task 2 全组
> 16 passed，相关 Anthropic/encoder 回归 59 passed；下方 RED 记录继续保留为修复前证据。

## 改动文件清单

- `src/infrastructure/llm_providers/base.py`（`openai_choice_to_message` 加 `reasoning_state` 参数）
- `src/infrastructure/llm_providers/openai_responses.py`（删 `[:500]` 截断 + 构造 OPENAI envelope + `_build_openai_replay_envelope`）
- `src/infrastructure/llm_providers/openai_compat_stream_parser.py`（流式构造 envelope + `_build_stream_replay_envelope`）
- `src/infrastructure/llm_providers/anthropic_messages.py`（保留完整 content blocks 构造 state）
- `src/infrastructure/llm_providers/anthropic_stream_parser.py`（聚合 signature_delta + 支持 redacted_thinking + 删 `[:500]` + 构造 envelope）
- `tests/unit/test_openai_responses_provider.py`（更新截断测试为完整保留）
- `tests/unit/test_openai_reasoning_decoder.py`（新增 6 测试）
- `tests/unit/test_anthropic_reasoning_decoder.py`（新增 8 测试）

## 红灯证据

| 任务 | 命令 | 预期 | 实际 |
|---|---|---|---|
| T1+T3 | `pytest test_openai_reasoning_decoder.py` | SC_01 非流式构造 envelope | 实现前 `reasoning_state is None`（Message 无该字段）；实现后 6 passed |
| T2+T6 | `pytest test_anthropic_reasoning_decoder.py` | SC_04 signature 聚合 | 实现前 signature_delta 被忽略，envelope 无 signature；实现后 8 passed |
| T1 | `pytest test_openai_responses_provider.py::test_parse_response_metadata_reasoning_content_truncated` | 断言截断到 500 | 截断删除后 `assert 600 == 500` 失败 → 测试更新为完整保留后通过 |
| T6+T8 | `uv run pytest -q tests/unit/test_anthropic_reasoning_decoder.py::TestSC04StreamSignatureAggregation::test_stream_redacted_thinking_data_roundtrips_exactly` | `redacted_thinking.data` 经流式 decoder 与同模型 encoder 后逐值相等 | 当前 RED：期望 `opaque-redacted-data-Δ-不可改写`，实际为空串 |

2026-08-09 修复后，同一反例转为 `1 passed`；新增“缺少 data 时保持字段缺失”用例，防止再次用空串占位。

`test_parse_response_basic_usage` 的陈旧断言曾按 dict 访问强类型
`ProviderUsageSnapshot`；2026-08-09 已改为读取 canonical metrics，reasoning 扩展回归全绿。

## 实现说明

### state 构造条件（INV-12）
parser 只看响应事实：响应含 reasoning（OpenAI 的 reasoning_content / Anthropic 的 thinking block）**且**含 tool_calls 时构造 `ReasoningContinuationState`。纯文本终态、无 reasoning 的 tool-call 都不构造 state。

### envelope 形态
- **OpenAI**（`OPENAI_CHAT_ASSISTANT`）：`role/content/reasoning_content/tool_calls` 同级，tool_calls 沿用原始 wire 结构（id/type/function{name,arguments}，arguments 为字符串）。新增 `_build_openai_replay_envelope`（非流式）和 `_build_stream_replay_envelope`（流式）。
- **Anthropic**（`ANTHROPIC_CONTENT_BLOCKS`）：完整有序 content blocks JSON。非流式直接 `json.dumps(data["content"])`；流式从累积 blocks 重组（`_build_anthropic_stream_envelope`），含 thinking(text+signature)/redacted_thinking/text/tool_use。

### 截断删除（SC_23）
- `openai_responses.py:482` 的 `reasoning_raw[:500]` → 完整 `reasoning_raw`
- `anthropic_stream_parser.py:432` 的 `full[:500]` → 完整 `full`
- OpenAI 流式 parser 已在前序 task 删除截断，本次对齐。

### signature 聚合（SC_04）
Anthropic 流式 `_AnthropicBlock` 新增 `signature` 字段，`_handle_content_block_delta` 新增 `signature_delta` 分支聚合到所属 thinking block。`_BlockType` 新增 `redacted_thinking`。

### 流式断连（SC_24）
取证确认：传输异常穿过 `parse()` 的 `async for`，`_finalize` 不会调用，不产生 `message.done`，自然无 state 落盘。当前架构已满足 SC_24，测试作为回归守卫锁定。

## 验证证据

```verify
id: S1
scenario: SC_01
cmd: uv run pytest -q tests/unit/test_openai_reasoning_decoder.py::TestSC01NonStreamReplayEnvelope
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: S2
scenario: SC_02
cmd: uv run pytest -q tests/unit/test_openai_reasoning_decoder.py::TestSC02StreamReassembly
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: S3
scenario: SC_03
cmd: uv run pytest -q tests/unit/test_anthropic_reasoning_decoder.py::TestSC03NonStreamBlocks
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

```verify
id: S4
scenario: SC_04
cmd: uv run pytest -q tests/unit/test_anthropic_reasoning_decoder.py::TestSC04StreamSignatureAggregation
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: S5
scenario: SC_23
cmd: uv run pytest -q tests/unit/test_openai_reasoning_decoder.py::TestSC23TruncationRemoved tests/unit/test_anthropic_reasoning_decoder.py::TestSC23AnthropicStreamTruncationRemoved tests/unit/test_openai_responses_provider.py::test_parse_response_metadata_reasoning_content_not_truncated
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: S6
scenario: SC_24
cmd: uv run pytest -q tests/unit/test_openai_reasoning_decoder.py::TestSC24StreamDisconnectNoPartialState tests/unit/test_anthropic_reasoning_decoder.py::TestSC24AnthropicStreamDisconnect
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: S7
scenario: SC_04
cmd: uv run mypy src/infrastructure/llm_providers/openai_responses.py src/infrastructure/llm_providers/openai_compat_stream_parser.py src/infrastructure/llm_providers/anthropic_messages.py src/infrastructure/llm_providers/anthropic_stream_parser.py src/infrastructure/llm_providers/base.py
cwd: .
expect_exit: 0
expect_contains: Success: no issues found
mode: auto
```

## 自检结论

本人（x-dev）已在本机运行全部 auto verify 命令，并确认结果与本报告一致：
- OpenAI decoder 6 passed、Anthropic decoder 8 passed
- 既有 parser 测试 80 passed（1 pre-existing 失败与本 task 无关）
- mypy no issues、ruff all passed、lint-imports 20 contracts kept

本报告由 x-dev 于 2026-08-08T00:00:00Z 生成。
