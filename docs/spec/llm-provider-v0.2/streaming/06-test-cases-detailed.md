# 测试用例详细设计

本文档把 [`05-validation-and-evolution.md`](./05-validation-and-evolution.md) 里的用例清单升级为**可直接照抄实现**的详细设计：每个关键用例给完整输入数据、期望输出数据、断言骨架。

## 覆盖策略

54 个用例不全量展开——那会让文档膨胀到无人读。本文档聚焦**示范性用例**，它们：

- 覆盖所有 [7 条序列不变式](./04-data-and-state.md#序列不变式parser-必须保证)
- 覆盖所有 [7 条验证原则](./README.md#验证原则)
- 展示每类测试的数据构造风格，其余用例按模板自行补全

| 层 | 示范用例 | 不变式 / 原则覆盖 |
|---|---|---|
| sse_reader | A.1 / A.3 / A.7 | 单条 / `[DONE]` 终止 / Anthropic event name 保留 |
| OpenAI parser | A.7 / A.12 / A.14 / A.17 / A.19 | 基础等价 / reasoning 双字段不重 / tool_call 聚合 / Ollama 防御 / 截断降级 |
| Anthropic parser | C.1 / C.3 | text block 基础 / tool_use block（含 `input_json_delta`） |
| Runner 集成 | D.11 | runner-level suppression |
| 等价性 | E.3 | stream ↔ non-stream tool_call 等价 |

其余用例（A.2/A.4-A.6/A.8-A.11/A.13/A.15-A.16/A.18/A.20-A.22/B.1-B.4/C.2/C.4-C.8/D.1-D.10/D.12/E.1-E.2/E.4-E.5/E.6-E.8）按本文档的数据构造风格在 task 执行期间补齐。

## 0. 测试辅助工具

在 `tests/unit/conftest.py`（或 `tests/unit/streaming/fixtures.py`）实现以下工厂函数，避免每个用例重复写字典字面量。

### 0.1 OpenAI chunk 工厂

```python
# tests/unit/streaming/fixtures.py
from typing import Any

def make_openai_chunk(
    *,
    id: str = "chatcmpl-test",
    model: str | None = "test-model",
    content: str | None = None,
    reasoning_content: str | None = None,
    reasoning: str | None = None,
    tool_calls: list[dict] | None = None,
    finish_reason: str | None = None,
    usage: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """构造一个符合 OpenAI Chat Completions stream 形状的 chunk dict。

    保持 None 字段不写入（对齐真实 API 行为；parser 走 .get() 路径）。
    """
    delta: dict[str, Any] = {}
    if content is not None:
        delta["content"] = content
    if reasoning_content is not None:
        delta["reasoning_content"] = reasoning_content
    if reasoning is not None:
        delta["reasoning"] = reasoning
    if tool_calls is not None:
        delta["tool_calls"] = tool_calls

    choice: dict[str, Any] = {"index": 0, "delta": delta}
    if finish_reason is not None:
        choice["finish_reason"] = finish_reason

    chunk: dict[str, Any] = {"id": id, "choices": [choice]}
    if model is not None:
        chunk["model"] = model
    if usage is not None:
        chunk["usage"] = usage
        chunk["choices"] = []  # OpenAI/GLM：usage chunk 的 choices 为空
    return chunk


def make_tool_call_delta(
    *,
    index: int = 0,
    id: str | None = None,
    name: str | None = None,
    arguments: str | None = None,
    extra_content: Any = None,
) -> dict[str, Any]:
    """构造 delta.tool_calls[i] 形状。"""
    out: dict[str, Any] = {"index": index}
    if id is not None:
        out["id"] = id
    if name is not None or arguments is not None:
        func: dict[str, Any] = {}
        if name is not None:
            func["name"] = name
        if arguments is not None:
            func["arguments"] = arguments
        out["function"] = func
    if extra_content is not None:
        out["extra_content"] = extra_content
    return out
```

### 0.2 Anthropic SSE event 工厂

```python
def make_anthropic_event(
    event_name: str,
    data: dict[str, Any],
) -> tuple[str, dict[str, Any]]:
    """Anthropic parser 输入格式：(event_name, data)。
    data 里习惯带 "type" 字段，与 event_name 相同。"""
    data.setdefault("type", event_name)
    return (event_name, data)


def anthropic_text_delta_stream(text_chunks: list[str]) -> list[tuple[str | None, dict]]:
    """生成最简 Anthropic SSE 序列：message_start → text block → message_stop。"""
    events: list[tuple[str | None, dict]] = [
        make_anthropic_event("message_start", {
            "message": {
                "id": "msg_test",
                "model": "claude-test",
                "usage": {"input_tokens": 10, "output_tokens": 0},
            },
        }),
        make_anthropic_event("content_block_start", {
            "index": 0,
            "content_block": {"type": "text", "text": ""},
        }),
    ]
    for chunk in text_chunks:
        events.append(make_anthropic_event("content_block_delta", {
            "index": 0,
            "delta": {"type": "text_delta", "text": chunk},
        }))
    events.extend([
        make_anthropic_event("content_block_stop", {"index": 0}),
        make_anthropic_event("message_delta", {
            "delta": {"stop_reason": "end_turn"},
            "usage": {"output_tokens": 5},
        }),
        make_anthropic_event("message_stop", {}),
    ])
    return events
```

### 0.3 `LLMStreamChunk` 断言助手

```python
def assert_message_done_equivalent(
    chunks: list[LLMStreamChunk],
    *,
    expected_content: str | None,
    expected_tool_call_count: int = 0,
    expected_finish_reason: FinishReason = "stop",
) -> None:
    """断言流最后一个 chunk 是 message.done，且聚合字段符合预期。"""
    assert chunks, "chunks is empty"
    last = chunks[-1]
    assert last.kind == "message.done", f"last kind is {last.kind}"
    assert last.message is not None
    assert last.message.content == expected_content
    n_tool = len(last.message.tool_calls or [])
    assert n_tool == expected_tool_call_count
    assert last.finish_reason == expected_finish_reason


def collect_content_deltas(chunks: list[LLMStreamChunk]) -> str:
    return "".join(c.delta for c in chunks if c.kind == "content.delta")


def collect_reasoning_deltas(chunks: list[LLMStreamChunk]) -> str:
    return "".join(c.delta for c in chunks if c.kind == "reasoning.delta")
```

---

## 1. sse_reader 测试

文件：`tests/unit/test_sse_reader.py`

### 1.1 `test_openai_style_single_chunk`（A.1）

```python
async def test_openai_style_single_chunk() -> None:
    raw = b'data: {"id":"x","choices":[{"delta":{"content":"hi"}}]}\n\n'
    response = _mock_response_with_bytes(raw)

    events: list[tuple[str | None, dict]] = [e async for e in iter_sse_events(response)]

    assert events == [
        (None, {"id": "x", "choices": [{"delta": {"content": "hi"}}]}),
    ]
```

### 1.2 `test_done_sentinel_terminates`（A.3）

```python
async def test_done_sentinel_terminates() -> None:
    raw = (
        b'data: {"id":"x"}\n\n'
        b'data: [DONE]\n\n'
        b'data: {"id":"should_not_be_seen"}\n\n'
    )
    response = _mock_response_with_bytes(raw)

    events = [e async for e in iter_sse_events(response)]

    # [DONE] 后一切被截断
    assert events == [(None, {"id": "x"})]
```

### 1.3 `test_anthropic_style_event_name_preserved`（A.7）

```python
async def test_anthropic_style_event_name_preserved() -> None:
    raw = (
        b'event: message_start\n'
        b'data: {"type":"message_start","message":{"id":"msg_1"}}\n\n'
        b'event: content_block_delta\n'
        b'data: {"type":"content_block_delta","index":0,'
        b'"delta":{"type":"text_delta","text":"hi"}}\n\n'
        b'event: message_stop\n'
        b'data: {"type":"message_stop"}\n\n'
    )
    response = _mock_response_with_bytes(raw)

    events = [e async for e in iter_sse_events(response)]

    assert events[0][0] == "message_start"
    assert events[0][1]["message"]["id"] == "msg_1"
    assert events[1][0] == "content_block_delta"
    assert events[1][1]["delta"]["text"] == "hi"
    assert events[2][0] == "message_stop"

    # 关键断言：event name 在对应 data yield 后必须重置（不 leak 到后续无 event: 的行）
    # 用一段"data 不带 event: 前缀"的后续输入验证
```

### `_mock_response_with_bytes` 辅助（contest 级）

```python
class _FakeStreamingResponse:
    """模拟 httpx.Response 的 aiter_bytes()。"""
    def __init__(self, raw: bytes, chunk_size: int = 4096) -> None:
        self._raw = raw
        self._chunk_size = chunk_size

    async def aiter_bytes(self):
        for i in range(0, len(self._raw), self._chunk_size):
            yield self._raw[i : i + self._chunk_size]

def _mock_response_with_bytes(raw: bytes, *, chunk_size: int = 4096):
    return _FakeStreamingResponse(raw, chunk_size)
```

**跨包场景（A.4）**：`chunk_size=3` 强制把 JSON 切到 3 字节段，断言拼回原样。

---

## 2. OpenAI-compatible parser 测试

文件：`tests/unit/test_openai_compat_stream_parser.py`

### 2.1 `test_pure_content`（A.7 基础等价）

```python
async def test_pure_content() -> None:
    events = [
        (None, make_openai_chunk(content="a")),
        (None, make_openai_chunk(content="b")),
        (None, make_openai_chunk(content="c")),
        (None, make_openai_chunk(
            content=None,
            finish_reason="stop",
            usage={"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
        )),
    ]
    parser = OpenAICompatStreamParser()
    chunks = [c async for c in parser.parse(_async_iter(events))]

    # 不变式 1 + 5：message.done 是最后一个；message.content == 三段拼接
    assert_message_done_equivalent(chunks, expected_content="abc")

    # 中间有且仅有 3 条 content.delta，顺序保留
    content_chunks = [c for c in chunks if c.kind == "content.delta"]
    assert [c.delta for c in content_chunks] == ["a", "b", "c"]

    # usage 正确透传
    assert chunks[-1].usage == {
        "prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8,
    }
```

### 2.2 `test_both_reasoning_fields_no_double_count`（A.12 双字段不重）

**覆盖不变式**：reasoning_content 和 reasoning 同时存在时，parser 只取 `reasoning_content`，不双倍累积。这是 Hermes run_agent.py:4766 双字段 fallback 规则的关键语义。

```python
async def test_both_reasoning_fields_no_double_count() -> None:
    events = [
        (None, make_openai_chunk(
            reasoning_content="A",    # 优先
            reasoning="B",            # 不应被计
        )),
        (None, make_openai_chunk(content="hi", finish_reason="stop")),
    ]
    parser = OpenAICompatStreamParser()
    chunks = [c async for c in parser.parse(_async_iter(events))]

    # 只有 reasoning_content 被累积
    assert collect_reasoning_deltas(chunks) == "A"

    # 不含 "B"
    assert "B" not in collect_reasoning_deltas(chunks)

    # 验证 yield 条数（3 条：1×reasoning.delta + 1×content.delta + 1×message.done）
    assert len(chunks) == 3
    assert chunks[0].kind == "reasoning.delta"
    assert chunks[0].delta == "A"
```

### 2.3 `test_single_tool_call`（A.14 tool_call 聚合）

**覆盖不变式 2、3、6**：tool_call 三元组顺序 / tool_call.start 节流 / tool_call.end 只承载定位信息。

```python
async def test_single_tool_call() -> None:
    events = [
        # chunk 1: 首次出现 tool_call，带 id + name，还没有 arguments
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, id="call_abc", name="read_file"),
        ])),
        # chunk 2: arguments 前半段
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, arguments='{"pa'),
        ])),
        # chunk 3: arguments 后半段
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, arguments='th":"/tmp/x.txt"}'),
        ])),
        # chunk 4: finish
        (None, make_openai_chunk(content=None, finish_reason="tool_calls")),
    ]
    parser = OpenAICompatStreamParser()
    chunks = [c async for c in parser.parse(_async_iter(events))]

    # 提取 kind 序列验证顺序（不变式 2）
    kinds = [c.kind for c in chunks]
    assert kinds == [
        "tool_call.start",
        "tool_call.arguments.delta",
        "tool_call.arguments.delta",
        "tool_call.end",
        "message.done",
    ]

    # 不变式 3：tool_call.start 只出现 1 次
    assert kinds.count("tool_call.start") == 1

    # 不变式 6：tool_call.end 不承载完整 arguments
    end_chunk = next(c for c in chunks if c.kind == "tool_call.end")
    assert end_chunk.delta == ""  # end 本身 delta 为空
    assert end_chunk.tool_name == "read_file"
    assert end_chunk.tool_call_id == "call_abc"
    assert end_chunk.index == 0

    # 完整 arguments 只能从 message.done 重建
    done = chunks[-1]
    assert done.kind == "message.done"
    assert done.message.tool_calls is not None
    assert len(done.message.tool_calls) == 1
    tc = done.message.tool_calls[0]
    assert tc.call_id == "call_abc"
    assert tc.tool_name == "read_file"
    assert tc.arguments == {"path": "/tmp/x.txt"}
    assert done.finish_reason == "tool_calls"
```

### 2.4 `test_ollama_index_reuse`（A.17 本地模型并行 tool_call 防御）

**这是本方案对标 Hermes run_agent.py:4803-4816 的关键防御代码**。Ollama / LM Studio 对并行 tool_calls **重用同一个 `index=0`**，靠 id 变化区分。若 parser 不做防御会把两个 tool_call 合并成一个。

```python
async def test_ollama_index_reuse() -> None:
    """模拟 Ollama：两个并行 tool_call 都在 index=0，靠 id 区分。"""
    events = [
        # 第一个 tool_call：id=call_A
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, id="call_A", name="read_file"),
        ])),
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, arguments='{"path":"/a.txt"}'),
        ])),
        # 第二个 tool_call：id=call_B，还是 index=0（Ollama 不分 index）
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, id="call_B", name="list_dir"),
        ])),
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, arguments='{"path":"/tmp"}'),
        ])),
        (None, make_openai_chunk(content=None, finish_reason="tool_calls")),
    ]
    parser = OpenAICompatStreamParser()
    chunks = [c async for c in parser.parse(_async_iter(events))]

    # 不变式 7：两个不同 id 在同一原始 index 下必须分出两条独立记录
    done = chunks[-1]
    assert done.kind == "message.done"
    assert done.message.tool_calls is not None
    assert len(done.message.tool_calls) == 2

    # 第一个 slot（原始 index=0）
    tc0 = done.message.tool_calls[0]
    assert tc0.call_id == "call_A"
    assert tc0.tool_name == "read_file"
    assert tc0.arguments == {"path": "/a.txt"}

    # 第二个 slot（parser 分到 new_slot）
    tc1 = done.message.tool_calls[1]
    assert tc1.call_id == "call_B"
    assert tc1.tool_name == "list_dir"
    assert tc1.arguments == {"path": "/tmp"}

    # 两条 tool_call.start 都出现了（不变式 3：每个 slot 只触发一次）
    starts = [c for c in chunks if c.kind == "tool_call.start"]
    assert len(starts) == 2
    assert {s.tool_call_id for s in starts} == {"call_A", "call_B"}

    # 两条 tool_call.end 分别属于不同 slot
    ends = [c for c in chunks if c.kind == "tool_call.end"]
    assert len(ends) == 2
    assert {e.tool_call_id for e in ends} == {"call_A", "call_B"}
```

### 2.5 `test_truncated_args_marks_length`（A.19 截断降级）

**覆盖验证原则 #5**：tool_call arguments 累积到非合法 JSON → `finish_reason="length"`。对齐 Hermes 4863-4867。

```python
async def test_truncated_args_marks_length() -> None:
    """模拟流在 tool_call arguments 中途被 max_tokens 截断。"""
    events = [
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, id="call_x", name="read_file"),
        ])),
        # 只收到不完整 JSON: '{"path":"/tmp'（缺引号 + 缺 }）
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, arguments='{"path":"/tmp'),
        ])),
        # provider 原本给的是 tool_calls 但实际上 args 不合法
        (None, make_openai_chunk(content=None, finish_reason="tool_calls")),
    ]
    parser = OpenAICompatStreamParser()
    chunks = [c async for c in parser.parse(_async_iter(events))]

    done = chunks[-1]
    assert done.kind == "message.done"

    # 关键断言 1：finish_reason 被降级为 "length"
    assert done.finish_reason == "length"

    # 关键断言 2：tool_call.end 仍被 yield（不丢 tool_call）
    assert any(c.kind == "tool_call.end" for c in chunks)

    # 关键断言 3：message.tool_calls 里的 arguments 是原始字符串
    # （parser 不修复非法 JSON；下游看到 length 自然不应执行）
    assert done.message.tool_calls is not None
    tc = done.message.tool_calls[0]
    # 注意：tc.arguments 字段类型是 dict —— 截断场景下 parser 应如何填？
    # 决策：截断时 arguments 字段填 {"__raw__": "{\"path\":\"/tmp"}，
    # 与既有非流式路径 openai_choice_to_message 的 JSONDecodeError 分支语义一致
    # （见 src/executors/llm/base.py:266）
    assert tc.arguments == {"__raw__": '{"path":"/tmp'}
```

---

## 3. Anthropic Messages parser 测试

文件：`tests/unit/test_anthropic_stream_parser.py`

### 3.1 `test_pure_text_block`（C.1 基础）

```python
async def test_pure_text_block() -> None:
    events = anthropic_text_delta_stream(["hi", " there"])
    parser = AnthropicStreamParser()
    chunks = [c async for c in parser.parse(_async_iter(events))]

    # 基础等价
    assert_message_done_equivalent(
        chunks,
        expected_content="hi there",
        expected_finish_reason="stop",
    )

    # 2 条 content.delta + 1 条 message.done
    assert [c.kind for c in chunks] == [
        "content.delta", "content.delta", "message.done",
    ]

    # usage 累积：input + output
    assert chunks[-1].usage == {
        "prompt_tokens": 10,
        "completion_tokens": 5,
        "total_tokens": 15,
    }
```

### 3.2 `test_tool_use_block`（C.3 工具调用 + input_json_delta 累积）

**关键点**：Anthropic 的 tool arguments 用 `input_json_delta.partial_json` 送，parser 字符串累积后 json.loads。

```python
async def test_tool_use_block() -> None:
    events = [
        make_anthropic_event("message_start", {
            "message": {
                "id": "msg_y",
                "model": "claude-test",
                "usage": {"input_tokens": 20, "output_tokens": 0},
            },
        }),
        # 开启 tool_use block
        make_anthropic_event("content_block_start", {
            "index": 0,
            "content_block": {
                "type": "tool_use",
                "id": "toolu_abc",
                "name": "read_file",
                "input": {},
            },
        }),
        # 逐片送 partial_json
        make_anthropic_event("content_block_delta", {
            "index": 0,
            "delta": {"type": "input_json_delta", "partial_json": '{"path'},
        }),
        make_anthropic_event("content_block_delta", {
            "index": 0,
            "delta": {"type": "input_json_delta", "partial_json": '":"/tmp/x.txt"}'},
        }),
        make_anthropic_event("content_block_stop", {"index": 0}),
        make_anthropic_event("message_delta", {
            "delta": {"stop_reason": "tool_use"},
            "usage": {"output_tokens": 12},
        }),
        make_anthropic_event("message_stop", {}),
    ]
    parser = AnthropicStreamParser()
    chunks = [c async for c in parser.parse(_async_iter(events))]

    # 序列：tool_call.start → 2×arguments.delta → tool_call.end → message.done
    kinds = [c.kind for c in chunks]
    assert kinds == [
        "tool_call.start",
        "tool_call.arguments.delta",
        "tool_call.arguments.delta",
        "tool_call.end",
        "message.done",
    ]

    # tool_call.start 含 Anthropic 的 tool id / name
    start = chunks[0]
    assert start.tool_call_id == "toolu_abc"
    assert start.tool_name == "read_file"
    assert start.index == 0

    # message.done.message.tool_calls 含完整 arguments
    done = chunks[-1]
    assert done.finish_reason == "tool_calls"  # tool_use → tool_calls 映射
    assert done.message.tool_calls is not None
    tc = done.message.tool_calls[0]
    assert tc.tool_name == "read_file"
    assert tc.arguments == {"path": "/tmp/x.txt"}
```

---

## 4. Runner 流式集成测试（suppression）

文件：`tests/e2e/test_stream_approval_flow.py`（或新建 `test_stream_suppression.py`）

### 4.1 `test_runner_suppresses_content_after_tool_call`（D.11）

**这是 P1-2 决议落地的关键验证**：suppression 在 runner emit 层完成，sink 根本收不到被压制的 `content.delta` 事件。

```python
async def test_runner_suppresses_content_after_tool_call() -> None:
    """Stub 产出：content × 2 → tool_call.start → content × 2 → message.done
    预期：runner 只 emit 前 2 条 content.delta；后 2 条被压制不 emit。"""

    # Stub 预录制的 LLMStreamChunk 序列（已解析好，省去 parser 步骤）
    stream_chunks = [
        LLMStreamChunk(kind="content.delta", delta="我来查询", index=0),
        LLMStreamChunk(kind="content.delta", delta="文件：", index=0),
        LLMStreamChunk(
            kind="tool_call.start",
            index=0,
            tool_call_id="call_x",
            tool_name="read_file",
        ),
        LLMStreamChunk(kind="content.delta", delta="（这段应被压制）", index=0),
        LLMStreamChunk(kind="content.delta", delta="（这段也应被压制）", index=0),
        LLMStreamChunk(
            kind="tool_call.arguments.delta",
            index=0, delta='{"path":"/a"}',
        ),
        LLMStreamChunk(
            kind="tool_call.end",
            index=0, tool_call_id="call_x", tool_name="read_file",
        ),
        LLMStreamChunk(
            kind="message.done",
            message=Message.assistant(
                content="我来查询文件：（这段应被压制）（这段也应被压制）",
                tool_calls=[ToolCall(
                    call_id="call_x",
                    tool_name="read_file",
                    arguments={"path": "/a"},
                )],
            ),
            finish_reason="tool_calls",
            usage={"prompt_tokens": 10, "completion_tokens": 20, "total_tokens": 30},
        ),
    ]

    stub_llm = StubLLMStreamProvider(chunk_sequences=[stream_chunks])
    recording_sink = RecordingEventSink()  # 记录所有收到的 Event
    runner = Runner(
        event_sinks=[recording_sink],
        stream_enabled=True,
        suppress_content_after_tool_call=True,
    )

    result = await runner.run(
        user_input="读一下 /a",
        session=InMemorySession("sid"),
        agent_spec=_simple_spec_with_read_file(),
        llm=stub_llm,
        tools=_tool_lookup_with_read_file(),
        approval=_auto_approve(),
    )

    # 提取 emit 出的 content.delta 事件
    content_events = [
        e for e in recording_sink.events
        if e.kind == "content.delta"
    ]

    # 关键断言 1：只有前 2 条被 emit（"我来查询" + "文件："）
    assert len(content_events) == 2
    assert [e.payload["delta"] for e in content_events] == ["我来查询", "文件："]

    # 关键断言 2：被压制的 2 条内容不出现在任何 event 中
    all_event_deltas = "".join(
        e.payload.get("delta", "")
        for e in recording_sink.events
        if e.kind == "content.delta"
    )
    assert "（这段应被压制）" not in all_event_deltas
    assert "（这段也应被压制）" not in all_event_deltas

    # 关键断言 3：message 完整性不受影响（tool_calls + 完整 content 字符串完整透传）
    assert result.final_message.content == "我来查询文件：（这段应被压制）（这段也应被压制）"
    assert len(result.final_message.tool_calls or []) == 1
```

### 4.2 `test_runner_no_suppression_when_disabled`（D.12）

同上场景但 `suppress_content_after_tool_call=False` → 4 条 `content.delta` 全部 emit。断言主体相同，只改 `suppress_content_after_tool_call=False` + `assert len(content_events) == 4`。

---

## 5. 等价性测试（核心质量门）

文件：`tests/e2e/test_stream_equivalence.py`

### 5.1 `test_tool_call_equivalence`（E.3）

**用途**：把同一组预录制 chunks 分别走 stream 路径和 non-stream 路径，断言 `Result.final_message` / `session.history()` 等价。这是 V1 最重要的质量保险。

```python
async def test_tool_call_equivalence() -> None:
    # 预录制：一个 tool_call 的完整 chunk 序列
    recorded_events = [
        (None, make_openai_chunk(content="我查一下")),
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, id="call_eq", name="read_file"),
        ])),
        (None, make_openai_chunk(tool_calls=[
            make_tool_call_delta(index=0, arguments='{"path":"/eq.txt"}'),
        ])),
        (None, make_openai_chunk(content=None, finish_reason="tool_calls")),
    ]

    # 两个 stub 都用**同一份 parser 代码**聚合这组数据
    # —— 这样等价性测试同时验证了 parser 正确性

    # ---- 流式路径 ----
    stream_stub = StubLLMStreamProvider(recorded_events_sequences=[recorded_events])
    stream_runner = Runner(stream_enabled=True)
    stream_result = await stream_runner.run(
        user_input="读一下 /eq.txt",
        session=(stream_session := InMemorySession("s1")),
        llm=stream_stub,
        ...  # 省略 agent_spec / tools / approval（与下方一致）
    )

    # ---- 非流式路径 ----
    nonstream_stub = StubLLMProvider(
        responses=[_parse_recorded_events_to_response(recorded_events)]
    )
    nonstream_runner = Runner(stream_enabled=False)
    nonstream_result = await nonstream_runner.run(
        user_input="读一下 /eq.txt",
        session=(nonstream_session := InMemorySession("s2")),
        llm=nonstream_stub,
        ...
    )

    # ---- 等价性断言 ----
    # 1. final_message 内容等价
    assert stream_result.final_message.content == nonstream_result.final_message.content

    # 2. tool_calls 完全相等
    stream_tcs = stream_result.final_message.tool_calls or []
    non_tcs = nonstream_result.final_message.tool_calls or []
    assert len(stream_tcs) == len(non_tcs) == 1
    assert stream_tcs[0].call_id == non_tcs[0].call_id
    assert stream_tcs[0].tool_name == non_tcs[0].tool_name
    assert stream_tcs[0].arguments == non_tcs[0].arguments

    # 3. session history 等价（逐条消息字段）
    stream_hist = await stream_session.history()
    non_hist = await nonstream_session.history()
    assert len(stream_hist) == len(non_hist)
    for s_msg, n_msg in zip(stream_hist, non_hist):
        assert s_msg.role == n_msg.role
        assert s_msg.content == n_msg.content
        assert (s_msg.tool_calls or []) == (n_msg.tool_calls or [])

    # 4. turn_count 等价
    assert stream_result.turn_count == nonstream_result.turn_count
```

---

## 6. 辅助测试类

以下类放在 `tests/e2e/conftest.py`，既有 stub 保留，新增：

### 6.1 `RecordingEventSink`

```python
class RecordingEventSink:
    """EventSink 实现：把所有 Event 存到 list，供测试断言。"""
    def __init__(self) -> None:
        self.events: list[Event] = []

    async def emit(self, event: Event) -> None:
        self.events.append(event)
```

### 6.2 `StubLLMStreamProvider`

**关键设计**：**不重写 parser 逻辑**，直接复用生产 `OpenAICompatStreamParser`。这样等价性测试（§5）同时成为 parser 回归测试。

```python
class StubLLMStreamProvider:
    """满足 LLMProvider + SupportsLLMStream 的测试 stub。

    两种构造方式：
    - recorded_events_sequences: 给 (event_name, data) 序列，stream 时喂给生产 parser
    - chunk_sequences: 给 LLMStreamChunk 序列，stream 直接 yield（绕过 parser 做 runner 隔离测试）
    """

    def __init__(
        self,
        *,
        recorded_events_sequences: list[list[tuple[str | None, dict]]] | None = None,
        chunk_sequences: list[list[LLMStreamChunk]] | None = None,
    ) -> None:
        assert (recorded_events_sequences is None) != (chunk_sequences is None), \
            "exactly one of the two must be provided"
        self._events_seqs = iter(recorded_events_sequences or [])
        self._chunks_seqs = iter(chunk_sequences or [])
        self._use_events = recorded_events_sequences is not None

    async def complete(self, req: LLMRequest) -> LLMResponse:
        # 把 events 聚合成非流式响应（供等价性测试的 nonstream 侧复用同一数据源）
        if self._use_events:
            events = next(self._events_seqs)
            return _parse_recorded_events_to_response(events)
        # chunk 路径不该被用于 complete，若命中说明测试配置错了
        raise AssertionError("complete() called on chunk-driven stub")

    async def stream(self, req: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        if self._use_events:
            events = next(self._events_seqs)
            parser = OpenAICompatStreamParser()
            async for c in parser.parse(_async_iter(events)):
                yield c
        else:
            for c in next(self._chunks_seqs):
                yield c


def _parse_recorded_events_to_response(
    events: list[tuple[str | None, dict]],
) -> LLMResponse:
    """把预录制 events 合成非流式 LLMResponse（供等价性测试使用）。"""
    content_parts: list[str] = []
    tool_calls_raw: list[dict] = []
    finish_reason = "stop"
    usage: dict[str, Any] = {}
    for _, chunk in events:
        for choice in chunk.get("choices") or []:
            delta = choice.get("delta") or {}
            if delta.get("content"):
                content_parts.append(delta["content"])
            for tc in delta.get("tool_calls") or []:
                _merge_tool_call(tool_calls_raw, tc)
            if choice.get("finish_reason"):
                finish_reason = choice["finish_reason"]
        if chunk.get("usage"):
            usage = chunk["usage"]
    # 合成 OpenAI choices 响应，走现有 openai_choice_to_message 聚合路径
    synthetic_body = {
        "choices": [{
            "message": {
                "role": "assistant",
                "content": "".join(content_parts) or None,
                "tool_calls": tool_calls_raw or None,
            },
            "finish_reason": finish_reason,
        }],
        "usage": usage,
    }
    return _convert_openai_response(synthetic_body)
```

---

## 7. 其余用例的构造指南

没有在本文档展开的用例（A.2/A.4/A.5/A.6/A.8/A.9/A.10/A.11/A.13/A.15/A.16/A.18/A.20/A.21/A.22/B.*/C.2/C.4-C.8/D.1-D.10/D.12/E.1/E.2/E.4/E.5/E.6/E.7/E.8）按以下原则补齐：

| 类型 | 模板参考 | 数据构造工具 |
|---|---|---|
| sse_reader 边界 | §1.2 | 手写原始 bytes |
| OpenAI parser 单输入 | §2.1 | `make_openai_chunk` |
| OpenAI parser tool_call | §2.3 | `make_tool_call_delta` |
| Anthropic parser | §3.1 | `make_anthropic_event` |
| Runner 集成 | §4.1 | `RecordingEventSink` + 预录制 `LLMStreamChunk` 序列 |
| 等价性 | §5.1 | `StubLLMStreamProvider(recorded_events_sequences=...)` |
| 非流式 reasoning fallback | 参考 05 B.1-B.4 | 直接构造 response JSON |
| CLIStreamSink | 无依赖 | `io.StringIO` 接 stdout，断言 `getvalue()` |
| TTFT / fallback | 模拟 sleep + mock | `asyncio.sleep` + `monkeypatch` |

**必须遵守的契约**：

1. 所有 parser 测试用 `make_openai_chunk` / `make_anthropic_event` 工厂，不手写 dict 字面量
2. 所有等价性测试必须用 `StubLLMStreamProvider(recorded_events_sequences=...)` 模式，让 parser 代码在两路被同等驱动
3. 任何 `finish_reason = "length"` 断言必须显式覆盖"tool_call 不丢 + arguments 带 `__raw__` 标记"两件事
4. Ollama 防御类测试必须用 `index=0` 固定 + 两个不同 `id`，不能靠 `index=1` 作弊

---

## 8. 运行与回归

```bash
# 本地单测
uv run pytest tests/unit/test_sse_reader.py -v
uv run pytest tests/unit/test_openai_compat_stream_parser.py -v
uv run pytest tests/unit/test_anthropic_stream_parser.py -v

# 流式集成
uv run pytest tests/e2e/test_stream_equivalence.py -v
uv run pytest tests/e2e/test_stream_approval_flow.py -v

# 完整流式测试矩阵
uv run pytest tests/ -v -k "stream"

# 覆盖率（目标：parser 模块 ≥ 90%）
uv run pytest --cov=src/executors/llm/openai_compat_stream_parser \
              --cov=src/executors/llm/anthropic_stream_parser \
              --cov=src/executors/llm/sse_reader \
              --cov-report=term-missing
```

**CI 必跑矩阵**（按 x-dev 阶段的 `dev-checklist.md` 约定）：

- `make test-unit` — 所有新增 unit 测试必须通过
- `make test-e2e` — 等价性 + approval + fallback 三组必过
- `make lint` — 新增 parser 文件需满足 import-linter 合约（不能反向依赖 core）
- `make typecheck` — mypy 通过
