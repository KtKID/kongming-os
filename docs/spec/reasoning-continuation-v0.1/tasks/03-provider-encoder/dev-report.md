# Dev Report — 03-provider-encoder — 20260808-010000

## 改动文件清单

- `src/infrastructure/llm_providers/base.py`（`messages_to_openai_format` assistant 分支：reasoning_state 展开为 wire envelope）
- `src/infrastructure/llm_providers/anthropic_messages.py`（`_split_system_and_convert` assistant 分支：reasoning_state 展开为 content blocks）
- `tests/unit/test_reasoning_encoder.py`（新增 8 测试）

## 实现说明

### encoder 重放逻辑（SC_05）
当 assistant Message 含 `reasoning_state` 时，encoder 用 state 的 payload_json 作为发送真源，跳过从 normalized Message 手动重建：
- **OpenAI**（`messages_to_openai_format`）：`json.loads(payload_json)` 直接作为 wire message item，含 `role/content/reasoning_content/tool_calls` 原值原序。显示文本 content 不参与重放。
- **Anthropic**（`_split_system_and_convert`）：`json.loads(payload_json)` 作为 assistant content blocks，含 thinking(text+signature)/tool_use 原值原序。

### 跨厂商拒绝（SC_21）
format 不匹配时（如 OpenAI encoder 收到 ANTHROPIC_CONTENT_BLOCKS），抛 `ProviderError("reasoning_continuation_format_unsupported")`，HTTP 请求不发出。

### 无 state 路径（INV-12）
无 reasoning_state 的 assistant 保持既有 normalized Message 重建路径，续推逻辑不触发。

## 红灯证据

| 任务 | 命令 | 预期 | 实际 |
|---|---|---|---|
| T4 | `pytest test_reasoning_encoder.py::TestSC05StateIsSendSource` | state 覆盖显示文本 | 实现前 encoder 不识别 reasoning_state，wire 无 reasoning_content；实现后 2 passed |
| T5 | `pytest test_reasoning_encoder.py::TestSC21CrossVendorFormatRejected` | 跨厂商 format 拒绝 | 实现前 encoder 无 format 检查；实现后 2 passed |

## 验证证据

```verify
id: S1
scenario: SC_05
cmd: uv run pytest -q tests/unit/test_reasoning_encoder.py::TestSC05StateIsSendSource
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: S2
scenario: SC_21
cmd: uv run pytest -q tests/unit/test_reasoning_encoder.py::TestSC21CrossVendorFormatRejected
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: S3
scenario: SC_05
cmd: uv run pytest -q tests/unit/test_reasoning_encoder.py::TestToolResultWireEncoding tests/unit/test_reasoning_encoder.py::TestNoStateKeepsRebuildPath
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

```verify
id: S4
scenario: SC_05
cmd: uv run mypy src/infrastructure/llm_providers/base.py src/infrastructure/llm_providers/anthropic_messages.py
cwd: .
expect_exit: 0
expect_contains: Success: no issues found
mode: auto
```

## 自检结论

本人（x-dev）已在本机运行全部 auto verify 命令，并确认结果与本报告一致：
- encoder 8 passed；既有测试 42 passed（1 pre-existing 失败与本 task 无关）
- mypy no issues、ruff all passed

本报告由 x-dev 于 2026-08-08T01:00:00Z 生成。
