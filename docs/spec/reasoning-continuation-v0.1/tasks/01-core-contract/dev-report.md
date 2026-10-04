# Dev Report — 01-core-contract — 20260807-180000

## 改动文件清单

- `src/core/message.py`（新增 `ReasoningStateFormat`、`ReasoningContinuationState`、`Message.reasoning_state` 字段与 `assistant()` 工厂参数）
- `tests/unit/test_message.py`（新增 14 个单元测试）
- `docs/spec/reasoning-continuation-v0.1/tasks/01-core-contract/dev-checklist.md`（状态推进）

## 实现说明

本 task 是 reasoning-continuation-v0.1 的契约地基，无直接 Scenario 承接（checklist Scenario IDs 全为 None）。
所有下游 task（02 provider decoder/encoder、04 sessions、05 runner）依赖此处产出的 `ReasoningContinuationState` 类型。

实现要点（对应 spec INV-01 / J1 / J8）：

1. `ReasoningStateFormat(StrEnum)` 封闭取值 `OPENAI_CHAT_ASSISTANT` / `ANTHROPIC_CONTENT_BLOCKS`，
   符合 AGENTS 约束「有限取值用 StrEnum」。StrEnum 继承 str，JSON 可序列化且与历史字符串字面值相等（向后兼容）。
2. `ReasoningContinuationState(frozen=True)` 三字段 `format / model / payload_json`。
   `payload_json: str` 而非 `dict[str, Any]`：frozen dataclass 内保持深层不可变，避免 mutable dict 被外部改写；
   字符串载体让 Session serializer 直接往返，core 不解析 opaque 内容。
3. `Message.reasoning_state` 插在 `tool_calls` 之后、`tool_call_id` 之前（assistant 语义字段归组），
   默认 `None`。`assistant()` 工厂新增 `reasoning_state` 关键字参数。
4. `__all__` 导出 `ReasoningContinuationState` 与 `ReasoningStateFormat`。

下游兼容性：新增字段有默认值 `None`，现有所有 `Message(...)` 构造点（`outcome.py`、`session_store.py`、
`input_assembler.py` 等）均用关键字参数，不受影响。旧 session payload 缺 `reasoning_state` 时反序列化读取为 `None`（INV-05，具体往返由 task-04 覆盖）。

## 红灯证据

本 task 是新增数据结构，无既有实现可破坏。实现前先写测试确认新类型不存在时的失败状态：

| 任务 | 命令 | 预期 | 实际 |
|---|---|---|---|
| T4 | `uv run pytest -q tests/unit/test_message.py` | 14 个测试通过，覆盖枚举/frozen/payload 往返/字段分离/旧记录兼容 | 实现前 `ImportError: cannot import name 'ReasoningContinuationState'`；实现后 14 passed |

## 验证证据

> 本 task 无 Scenario 承接（纯基础设施），checklist Scenario IDs 全为 None，verify 对账范围为空。
> `ReasoningContinuationState` 类型是 SC_07（三 backend 等价往返）的前提——`test_message.py` 验证其 frozen / payload_json 往返特性，
> session 维度的完整往返由 task-04 承接。以下 auto 块以 SC_07 作为类型基础证据回指。

```verify
id: S1
scenario: SC_07
cmd: uv run pytest -q tests/unit/test_message.py
cwd: .
expect_exit: 0
expect_contains: 14 passed
mode: auto
```

```verify
id: S2
scenario: SC_07
cmd: uv run mypy src/core/message.py tests/unit/test_message.py
cwd: .
expect_exit: 0
expect_contains: Success: no issues found
mode: auto
```

```verify
id: S3
scenario: SC_07
cmd: uv run ruff check src/core/message.py tests/unit/test_message.py && uv run lint-imports
cwd: .
expect_exit: 0
expect_contains: All checks passed
mode: auto
```

## 自检结论

本人（x-dev）已在本机运行全部 auto verify 命令，并确认结果与本报告一致：
- `pytest`：14 passed
- `mypy`：Success, no issues
- `ruff check` + `lint-imports`：All checks passed / 20 contracts kept, 0 broken

本报告由 x-dev 于 2026-08-07T18:00:00Z 生成。
