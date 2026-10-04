# 验证与演进

本文档把 [README.md](./README.md) 里的 7 条验证原则和 [04-data-and-state.md](./04-data-and-state.md) 里的 7 条不变式落成**具体的测试用例清单**，并给出 V1 完成后的演进路线。

> **测试用例详细设计**：本文档是清单视图（用例名 + 一句话描述）。每个关键用例的**完整输入数据、期望输出、断言骨架**在 [`./06-test-cases-detailed.md`](./06-test-cases-detailed.md)，含测试辅助工厂函数（`make_openai_chunk` / `make_anthropic_event` / `RecordingEventSink` / `StubLLMStreamProvider` 等），可直接照抄实现。

所有测试均按 v1-mini 的测试分层组织：`tests/unit/` 为纯函数单测，`tests/e2e/` 为多组件集成测试。

## 1. 测试矩阵总览

| 测试层级 | 文件 | 覆盖模块 | 用例数（目标） |
|---|---|---|---|
| Unit | `tests/unit/test_sse_reader.py` | 模块 A | 7 |
| Unit | `tests/unit/test_openai_compat_stream_parser.py` | 模块 A | 15+ |
| Unit | `tests/unit/test_anthropic_stream_parser.py` | 模块 C | 8 |
| Unit | `tests/unit/test_openai_responses_reasoning_fallback.py` | 模块 B | 4 |
| Unit | `tests/unit/test_cli_stream_sink.py` | 模块 D | 6 |
| E2E | `tests/e2e/test_stream_equivalence.py` | 模块 D + E | 5 |
| E2E | `tests/e2e/test_stream_ttft_event.py` | 模块 D | 2 |
| E2E | `tests/e2e/test_stream_approval_flow.py` | 模块 D + 安全 | 3 |
| E2E | `tests/e2e/test_stream_fallback.py` | 模块 D | 4 |

**合计约 54 个测试用例**。

## 2. 模块 A：流式契约与 parser 底座

### 2.1 `tests/unit/test_sse_reader.py`

| # | 用例 | 输入 | 预期 |
|---|---|---|---|
本节断言 `iter_sse_events(response) -> AsyncIterator[tuple[str | None, dict]]` 的契约，含 event name 保留与 OpenAI/Anthropic 双 SSE 方言兼容。

| # | 用例 | 输入 | 预期 |
|---|---|---|---|
| A.1 | `test_openai_style_single_chunk` | `b'data: {"id":"x"}\n\n'` | yield 一次 `(None, {"id":"x"})` |
| A.2 | `test_openai_style_multi_chunk` | 两次 `data:` 行 | 两次 `(None, dict)`，顺序保留 |
| A.3 | `test_done_sentinel_terminates` | `data: {"id":"x"}\n\ndata: [DONE]\n\ndata: {"id":"y"}\n\n` | 只 yield 一次；`[DONE]` 后 StopAsyncIteration |
| A.4 | `test_line_span_tcp_packets` | 分 3 个 TCP 段发一条 JSON | yield 完整拼好的 JSON |
| A.5 | `test_skip_heartbeat_comment_lines` | 混入 `:ping\n\n` 注释行 | 跳过；不 yield |
| A.6 | `test_malformed_json_warns_and_skips` | `data: {broken\n\ndata: {"ok":true}\n\n` | yield `(None, {"ok":true})` + warning log，不抛 |
| A.7 | `test_anthropic_style_event_name_preserved` | `event: message_start\ndata: {"type":"message_start"}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta"}\n\n` | 依次 yield `("message_start", {...})` 与 `("content_block_delta", {...})`；event name 在对应 data 行发出后重置为 None |

### 2.2 `tests/unit/test_openai_compat_stream_parser.py`

#### 基础场景（覆盖不变式 1、5）

| # | 用例 | 输入 chunks 序列（简化） | 预期 |
|---|---|---|---|
| A.7 | `test_pure_content` | 3 个 `delta.content="a" / "b" / "c"` + `usage` chunk | chunks yield: 3×`content.delta` + `message.done`；`message.content=="abc"`；`finish_reason=="stop"` |
| A.8 | `test_empty_stream` | 只一个 `choices=[]` + `[DONE]` | yield: 只 `message.done`；`message.content is None`；`finish_reason=="stop"` |
| A.9 | `test_last_chunk_is_always_message_done` | 任意非空流 | 断言序列最后一个 chunk 的 `kind == "message.done"` |

#### reasoning 双字段探测（覆盖验证原则 #4）

| # | 用例 | 输入 | 预期 |
|---|---|---|---|
| A.10 | `test_reasoning_content_only` | `delta.reasoning_content="思考"`（无 `reasoning`） | yield `reasoning.delta("思考")`；`message.content is None`（纯思考无正文） |
| A.11 | `test_reasoning_fallback_field` | `delta.reasoning="thinking"`（无 `reasoning_content`） | yield `reasoning.delta("thinking")` |
| A.12 | `test_both_reasoning_fields_no_double_count` | 同一 chunk 同时带 `reasoning_content="A"` 和 `reasoning="B"` | 只取 `reasoning_content`；yield 一次 `reasoning.delta("A")`；内部 reasoning_parts 总长 == 1（不是 2） |
| A.13 | `test_reasoning_then_content_mixed` | `reasoning.delta` × 2 → `content.delta` × 2 → `message.done` | yield 顺序保持；最终 `message.content=="<content拼接>"`，`reasoning` 通过 `provider_metadata["reasoning_content"]` 透传 |

#### tool_call 聚合（覆盖不变式 3、4、6）

| # | 用例 | 输入 | 预期 |
|---|---|---|---|
| A.14 | `test_single_tool_call` | 3 chunks：`id+name` / `args part 1` / `args part 2` + finish_reason="tool_calls" | yield: `tool_call.start`(一次) → 2×`arguments.delta` → `tool_call.end` → `message.done`；`message.tool_calls[0].arguments == {...}` |
| A.15 | `test_tool_call_start_throttle` | 6 个 delta，全部 index=0 且都带 id+name 片段 | `tool_call.start` 在序列中只出现 1 次 |
| A.16 | `test_parallel_tool_calls` | 两个不同 index（0 和 1）交错 | yield 两组 start/delta/end；`message.tool_calls` 长度=2，顺序按 index 升序 |

#### Ollama / LM Studio 防御（覆盖不变式 7、验证原则 #3）

| # | 用例 | 输入 | 预期 |
|---|---|---|---|
| A.17 | `test_ollama_index_reuse` | chunks 全部 `index=0`，但 id 前半段是 `call_A`、后半段是 `call_B` | `message.tool_calls` 长度=2；两条独立记录；args 各自完整 |
| A.18 | `test_null_index_fallback_to_zero` | chunk 的 `tc_delta.index=None` | 按 index=0 处理；单 slot 累积 |

#### arguments 截断防御（覆盖验证原则 #5）

| # | 用例 | 输入 | 预期 |
|---|---|---|---|
| A.19 | `test_truncated_args_marks_length` | tool_call arguments 累积到 `'{"path":"/tmp'`（非合法 JSON） | `finish_reason=="length"`；`tool_call.end` 仍然 yield（不丢 tool_call） |
| A.20 | `test_valid_args_keeps_original_finish` | 合法 JSON arguments + provider 给 `finish_reason="tool_calls"` | 最终 `finish_reason=="tool_calls"` |

#### 元数据抽取

| # | 用例 | 输入 | 预期 |
|---|---|---|---|
| A.21 | `test_model_id_from_choices_empty_chunk` | 第一个 chunk `choices=[]` 带 `model="glm-5.1"` | `message.done.provider_metadata["model"] == "glm-5.1"` |
| A.22 | `test_usage_from_last_chunk` | 最后一个 chunk `choices=[]` 带 `usage={"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}` | `message.done.usage` 三字段完整 |

## 3. 模块 B：OpenAI-compatible provider 流式接入

### 3.1 `tests/unit/test_openai_responses_reasoning_fallback.py`

这是"搭便车修复"——非流式 `_parse_response` 现在也支持多字段 reasoning 兼容（对齐 Hermes `_extract_reasoning`）。

| # | 用例 | 输入（非流式响应 body） | 预期 |
|---|---|---|---|
| B.1 | `test_parse_response_reasoning_content` | `message.reasoning_content="思考"` | `provider_metadata["reasoning_content"]=="思考"`（截断 500 内） |
| B.2 | `test_parse_response_reasoning_top_level` | `message.reasoning="thinking"`（无 `reasoning_content`） | `provider_metadata["reasoning_content"]=="thinking"` |
| B.3 | `test_parse_response_reasoning_details_array` | `message.reasoning_details=[{"summary":"A"},{"text":"B"}]` | `provider_metadata["reasoning_content"]=="AB"`（按 summary/thinking/content/text 顺序抽） |
| B.4 | `test_parse_response_no_reasoning` | 三个字段都不存在 | `provider_metadata` 里无 `reasoning_content` key |

### 3.2 流式 provider 集成测试（合并到 E2E，见 §6）

OpenAI provider `stream()` 方法的单测价值低（本质是 "SSE reader + parser 拼起来"），放到 E2E 层用 stub 模拟整个链路更有意义。

## 4. 模块 C：Anthropic Messages provider 流式接入

### 4.1 `tests/unit/test_anthropic_stream_parser.py`

| # | 用例 | 输入 SSE 事件序列 | 预期 |
|---|---|---|---|
| C.1 | `test_pure_text_block` | `message_start → content_block_start(text) → content_block_delta(text_delta × 3) → content_block_stop → message_delta(stop_reason="end_turn") → message_stop` | 3×`content.delta` + `message.done`；`finish_reason=="stop"` |
| C.2 | `test_thinking_block_maps_to_reasoning_delta` | 事件包含 `content_block_start(thinking) → thinking_delta × 2 → content_block_stop` | 2×`reasoning.delta`；`provider_metadata["reasoning_content"]` 非空 |
| C.3 | `test_tool_use_block` | `content_block_start(tool_use, id=x, name=y) → input_json_delta × 2 → content_block_stop → message_delta(stop_reason="tool_use")` | `tool_call.start` + 2×`arguments.delta` + `tool_call.end` + `message.done`；`finish_reason=="tool_calls"` |
| C.4 | `test_mixed_text_and_tool_use` | text block + tool_use block 顺序交织 | 正确 yield，index 独立计数 |
| C.5 | `test_stop_reason_mapping` | 分别用 `end_turn` / `max_tokens` / `tool_use` / `refusal` / `unknown_xyz` | 映射到 `stop` / `length` / `tool_calls` / `error` / `other` |
| C.6 | `test_usage_accumulation` | `message_start.usage.input_tokens=100` + `message_delta.usage.output_tokens=50` | `message.done.usage == {"prompt_tokens":100, "completion_tokens":50, "total_tokens":150}` |
| C.7 | `test_ping_event_skipped` | 流中间混 `event: ping` | 不 yield，不抛错 |
| C.8 | `test_error_event_raises_provider_error` | `event: error\ndata: {"error":{"type":"overloaded","message":"busy"}}` | 抛 `ProviderError` 且 `details` 含 type/message |

## 5. 模块 D：Runner / Host / CLI 流式集成

### 5.1 `tests/unit/test_cli_stream_sink.py`

| # | 用例 | 输入 Event | 预期 stdout |
|---|---|---|---|
| D.1 | `test_content_delta_no_newline` | `Event(content.delta, {"delta":"你", "index":0})` × 2 | stdout 收到 `"你"` + `"你"`；无换行 |
| D.2 | `test_reasoning_delta_gray_color` | `Event(reasoning.delta, {"delta":"思考"})` | stdout 含 `\x1b[90m` + `"思考"` + `\x1b[0m` |
| D.3 | `test_reasoning_color_disabled` | 构造 `CLIStreamSink(reasoning_color=None)`，emit reasoning.delta | stdout 无 ANSI 代码；纯文本 |
| D.4 | `test_stream_end_prints_newline` | `Event(llm.stream.end, {...})` | stdout 末尾 `"\n"` |
| D.5 | `test_tool_call_start_breaks_line` | 先 emit `content.delta("引导")`，再 `tool.call.start` | stdout: `"引导"` + `"\n"` 分隔 |
| D.6 | `test_sink_renders_without_internal_state` | 直接给 sink emit 一系列 content.delta（不 emit tool.call.start） | sink 全部写出，证明 sink 无状态机——suppression 不是 sink 的职责 |

### 5.2 `tests/e2e/test_stream_ttft_event.py`

| # | 用例 | 场景 | 预期 |
|---|---|---|---|
| D.7 | `test_ttft_event_emitted` | Stub provider yield 两个 chunk（sleep 100ms 在第一个 chunk 前） | `llm.chunk.first` event 被 emit 且 `elapsed_ms >= 100` 且 `< 1000` |
| D.8 | `test_ttft_only_once_per_turn` | Stub yield 5 个 chunk | `llm.chunk.first` event 全 run 只 emit 1 次 |

### 5.3 `tests/e2e/test_stream_fallback.py`

| # | 用例 | 场景 | 预期 |
|---|---|---|---|
| D.9 | `test_stream_enabled_but_provider_not_capable` | cfg.stream.enabled=True，provider 未实现 `stream()`（即 `isinstance(llm, SupportsLLMStream) is False`） | runner 直接走 `complete()`；Result 正常返回；不 emit 额外 error 事件（能力缺失是正常路径，不是错误） |
| D.10 | `test_stream_disabled_uses_complete` | cfg.stream.enabled=False，provider 实现了 stream() | runner 仍走 complete()；不调用 stream()（断言 mock 未被调用） |
| D.11 | `test_runner_suppresses_content_after_tool_call` | Stub 流式产出：content.delta × 2 → tool_call.start → content.delta × 2 → message.done，`cfg.stream.suppress_content_after_tool_call=True` | runner emit 的 `content.delta` 事件只有 2 条（前半段）；`tool_call.start` 之后的 2 条 content.delta 不 emit 到 sink |
| D.12 | `test_runner_no_suppression_when_disabled` | 同 D.11 但 `suppress_content_after_tool_call=False` | runner emit 4 条 `content.delta` 事件（不压制） |

## 6. 跨模块契约测试（模块 E）

### 6.1 `tests/e2e/test_stream_equivalence.py`

**这是 V1 的核心质量门**。把"stream ↔ non-stream 等价性"固化为长期回归。

用 `StubLLMStreamProvider` 喂预录制的 chunk 序列，同时用 `StubLLMProvider` 直接返回等价的完整 `LLMResponse`，断言两条路径的产出等价。

| # | 用例 | 场景 | 等价性断言 |
|---|---|---|---|
| E.1 | `test_pure_text_equivalence` | 简单问答"你好" → "你好！" | `Result.final_message.content` 相等；`session.history()` 两种模式等价（逐条消息字段比对） |
| E.2 | `test_with_reasoning_equivalence` | 带 reasoning_content 的响应 | 等价性同上；`provider_metadata["reasoning_content"]` 两模式都有且前缀匹配（流式可能有截断差异，断言 `startswith` 而非相等） |
| E.3 | `test_tool_call_equivalence` | 单 tool_call 全流程（含工具执行 + 第二 turn 回答） | 整个 2 turn Result 等价；tool_call.arguments 严格相等 |
| E.4 | `test_parallel_tool_calls_equivalence` | 两个并行 tool_calls | tool_calls 数量、顺序、arguments 都相等 |
| E.5 | `test_non_delta_events_equivalence` | 断言 emit 的事件序列（过滤掉 `*.delta` / `llm.chunk.first` / `llm.stream.end`）两种模式完全一致 | 事件 kind 序列 + 关键 payload 字段完全相等 |

### 6.2 `tests/e2e/test_stream_approval_flow.py`

流式下 tool_call + approval 的交互（V1 的关键设计决策）。

| # | 用例 | 场景 | 预期 |
|---|---|---|---|
| E.6 | `test_approval_happens_after_stream_end` | 流中途 yield tool_call，approval provider 记录被调用时机 | approval.decide() 在 `llm.stream.end` event 之后调用 |
| E.7 | `test_approval_reject_path` | approval 返回 rejected | 流式正常完整拿到 tool_call；runner 按现有路径把 rejected 结果喂回模型；第二 turn 继续流式 |
| E.8 | `test_content_streamed_before_tool_call_detected` | chunk 顺序：`content.delta("我来查询...")` → `tool_call.start` → `content.delta("后半段")`（被 runner 压制） | stdout 包含"我来查询..."；不含"后半段"；断言 suppression 在 runner emit 层完成（sink 没收到被压制的 delta） |

### 6.3 测试基础设施新增

```python
# tests/e2e/conftest.py

class StubLLMStreamProvider:
    """可配置的流式 stub。按预录制的 chunk 序列 yield。"""

    def __init__(self, chunk_sequences: list[list[dict]]) -> None:
        """每次 stream() 调用消耗一个 chunk 序列。"""
        self._sequences = iter(chunk_sequences)
        self._stream_calls = 0
        self._complete_calls = 0

    async def complete(self, req: LLMRequest) -> LLMResponse:
        self._complete_calls += 1
        # 把下一组 chunks "假装" 跑完再拼完整 response，作为 non-stream 等价路径
        chunks = next(self._sequences)
        ...

    async def stream(self, req: LLMRequest) -> AsyncIterator[LLMStreamChunk]:
        self._stream_calls += 1
        chunks = next(self._sequences)
        # 喂给 OpenAICompatStreamParser（复用生产代码！）
        ...
```

**复用生产 parser 的关键意义**：`StubLLMStreamProvider` 的 `stream()` 方法**不重写 parser 逻辑**，而是把预录制的 raw chunk 喂给真实的 `OpenAICompatStreamParser`。这样 E2E 等价性测试同时验证了 parser 的正确性。

## 7. 本地手工验证清单（不进 CI）

以下场景靠真实 provider 验证，不写到 pytest（需要网络 + 真实 API key）：

### 7.1 TTFT 实测

```bash
# 步骤：
# 1. KONGMING_STREAM_ENABLED=1 KONGMING_TRACE_RAW_LLM=1 make cli
# 2. 输入 "你好"
# 3. 观察 CLI 打字机效果
# 4. jq '.payload.elapsed_ms' .kongming/trace.jsonl | grep chunk.first
# 预期：<500ms（已完成 httpx-client-reuse 模块 D 后）
```

### 7.2 Ollama 并行 tool_call

```bash
# 步骤：
# 1. 启动本地 Ollama 带 llama-3.1（支持 parallel tool_calls）
# 2. 配置 kongming 指向 localhost:11434
# 3. 触发会让模型同时调用 read_file 和 list_dir 的 prompt
# 4. 观察 trace.jsonl 中 tool.call.start 事件数量是否 = 2
# 预期：2 条独立 tool_call，不合并也不丢
```

### 7.3 GLM-5 reasoning 流式

```bash
# 步骤：
# 1. 配置 model.name=glm-5，reasoning_effort=high
# 2. 问一个复杂推理题
# 3. 观察 CLI：先看到灰色 reasoning 流（预期用时较长），再看到白色 content 流
# 4. jq '.payload.reasoning_chars' .kongming/trace.jsonl | grep stream.end
# 预期：reasoning_chars > 0（GLM 的 reasoning 链被正确抽取）
```

## 8. 性能基线

V1 交付后应当满足：

| 指标 | 目标 | 验证方式 |
|---|---|---|
| TTFT（本地 GLM-5） | < 500 ms | `llm.chunk.first.elapsed_ms` 平均值 |
| TTFT（远端 GLM-5，Global endpoint） | < 1500 ms | 同上 |
| trace.jsonl 膨胀（默认 `delta_sampling=none`） | 与非流式相比 +2~3 行/run | 对比非流式 trace 行数 |
| 单 run 内存占用（流式 vs 非流式） | 差异 < 5% | 手工 `psutil` 观察 |
| parser 单测覆盖率 | > 90% | `make coverage` |

## 9. 演进路线（V1 完成之后）

V1 故意不做的东西，等真实数据出来后再决定是否进 V2：

### 9.1 可能进入 V2 的方向

- **流式 Ctrl-C 中断的优雅语义**：目前靠 runner 现有异常路径兜底；V2 可能加一个 `CancellationToken` 或直接在 provider 层支持 `anyio.CancelScope`
- **MiniMax 在 Anthropic 路径下的流式**：V1 保守不做，等 V1 稳定后扩测真实端点
- **tool_call streaming 的 UI**：V1 的 `stream.suppress_content_after_tool_call` 是简单策略（runner 见到 tool_call.start 后不再 emit content.delta）；V2 可能把 `tool_call.start/arguments.delta/end` 升为正式 EventKind，或引入"流中预告 tool_call 名称 + 参数片段"的专用 UI 事件
- **多 provider fallback**：流中途连接断 → 切备用 provider 续写
- **HTTP/2 支持**：需要 `httpx[http2]` 和 h2 依赖，ROI 到实测再定
- **`content.delta` 的撤回语义**：当检测到 tool_call 时回退已打字符（需要终端支持 `\r` + clear-line）

### 9.2 已知不做的边界（V1 / V2 都不做）

- **流中暂停 → 人工审批 → 续流**：大多数 provider 不支持此语义，工程代价 > 收益
- **session 存 chunk 历史**：chunk 是纯瞬态，存了也没有业务价值
- **chunk-level raw_dump**：raw_dump 仍在流结束后一次性累积落盘；不破坏 opt-in 语义

### 9.3 灰度策略

V1 的配置开关 `cfg.stream.enabled` 默认 False。上线顺序：

1. **第 1 周**：CI / 本地开发测试 `enabled=True`；生产保持 False
2. **第 2 周**：实测真实 CLI 体验 2-3 天，观察 CLIStreamSink 是否稳定
3. **第 3 周**：推默认 `enabled=True`，保留 env `KONGMING_STREAM_ENABLED=0` 作紧急关闭开关

如果任何阶段发现 E2E 等价性断言失败、trace 膨胀超标、TTFT 未达目标，立即回退上一阶段。

## 10. 与现有 fix-report 的关系

V1 完成后，应该产出一份 `docs/fixes/YYYYMMDD-llm-streaming-v1/fix-report.md`，记录：

- 实施过程中发现的 Hermes 行号偏移（如有）
- Ollama 分 slot 防御的实际命中情况（是否真的需要）
- 非流式 `_parse_response` reasoning 多字段兼容修复带来的历史 trace 数据变化（B.1-B.4 的搭便车修复副作用）

这些会成为 V2 规划的数据输入。
