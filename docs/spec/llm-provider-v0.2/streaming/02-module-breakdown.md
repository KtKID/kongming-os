# LLM Streaming V1 Modules

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 是否可进 task |
|---|---|---|---|---|
| A. 流式契约与 parser 底座 | `LLMStreamChunk` + `SupportsLLMStream` Protocol + `OpenAICompatStreamParser` | 无 | 方案确认 | 是 |
| B. OpenAI-compatible provider 流式接入 | `OpenAIResponsesProvider.stream()` + 非流式 reasoning 多字段兼容 + raw_dump 累积 | A | 方案确认 | 是 |
| C. Anthropic Messages provider 流式接入 | `AnthropicStreamParser` + `AnthropicMessagesProvider.stream()` | A | 方案确认 | 是（B 之后） |
| D. Runner / Host / CLI 流式集成 | Runner `_consume_stream` + EventKind 扩枚举 + `CLIStreamSink` + 配置开关 | A + B | 方案确认 | 是 |
| E. 契约测试与回归 | stream ↔ non-stream 等价性、Ollama 防御、reasoning 多字段、arguments 截断、TTFT | A + B + C + D | 方案确认 | 是 |

## 模块 A：流式契约与 parser 底座

**职责**

- 建立 provider-agnostic 的流式数据契约
- 把 Hermes `run_agent.py:4744-4852` 的状态机逻辑实现成独立的 `OpenAICompatStreamParser`
- 引入独立 `SupportsLLMStream` Protocol，让 runner 用 `isinstance` 做能力探测，保持 `LLMProvider` 主 Protocol 形状不变

**包含范围**

- `core/contracts.py` 新增 `LLMStreamChunk` dataclass
- `core/contracts.py` 新增 `SupportsLLMStream` Protocol（**不动** `LLMProvider` 主 Protocol）
- `core/contracts.py` 的 `EventKind` Literal 新增 `"content.delta"` / `"reasoning.delta"` / `"llm.chunk.first"` / `"llm.stream.end"`（共 4 个，不含 `tool_call.*`——见下方"风险与讨论点"）
- `executors/llm/base.py` **不**为 `BaseLLMProvider` 添加 `stream()` 默认实现——流式能力通过结构化缺失表达，不通过异常
- 新建 `executors/llm/sse_reader.py`：~40 行 httpx async SSE 行缓冲，函数签名 `iter_sse_events(response) -> AsyncIterator[tuple[str | None, dict]]`，保留最近一条 `event:` 行的事件名（OpenAI parser 丢弃、Anthropic parser 使用）
- 新建 `executors/llm/openai_compat_stream_parser.py`：
  - `OpenAICompatStreamParser.parse(events: AsyncIterator[tuple[str | None, dict]]) -> AsyncIterator[LLMStreamChunk]`（输入是 `sse_reader.iter_sse_events` 的产物，parser 只读二元组第二项）
  - 状态字段：`content_parts` / `reasoning_parts` / `tool_calls_acc` / `_last_id_at_idx` / `_active_slot_by_idx` / `tool_gen_notified` / `usage_obj` / `model_name` / `finish_reason`
  - 严格对齐 Hermes 的处理顺序：`reasoning_content or reasoning` → `content` → `tool_calls`（含 Ollama index 复用防御）
  - 流结束阶段：跑 `json.loads` 校验每个 tool_call.arguments，任一失败 → `finish_reason = "length"`
  - 终态产出 `kind="message.done"` 的 `LLMStreamChunk`，含完整 Message / finish_reason / usage / provider_metadata

**不包含范围**

- 不实现任何 provider 的真实 HTTP 调用（留给模块 B / C）
- 不涉及 runner / host / cli 任何改动（留给模块 D）
- 不做 trace 落盘策略（留给模块 D 配合 `JsonlTraceSink` 的新增 `delta_sampling` 构造参数）

**风险与讨论点**

- **流式能力如何表达？**
  - V1 决定：新增 `SupportsLLMStream` 独立 Protocol；**不**往 `LLMProvider` 主 Protocol 里加 `stream()`；**不**用 `NotImplementedError` 做控制流。runner 以 `isinstance(llm, SupportsLLMStream)` 探测能力。现有 stub / mock / provider 零改动自动表达"不支持流式"。
- **parser 是否直接吃 `httpx.Response` 对象？**
  - 决定：不。parser 输入是 `AsyncIterator[tuple[str | None, dict]]`（已解好的 SSE 事件），这样 parser 可以单元测试（不依赖真实 HTTP）；SSE 行缓冲 + JSON parse 在 `sse_reader.py` 独立测试。
- **Ollama / LM Studio 的 index 复用防御代码是否可抽成独立函数？**
  - 决定：`tool_calls_acc` 的更新逻辑封装成 `_apply_tool_call_delta(tc_delta, state)` 私有方法，Ollama 防御在函数内完成，方便单测用 fake delta 打各种边界。
- **`tool_call.start/arguments.delta/end` 是否升为 EventKind？**
  - 决定：**不升**。它们只是 parser 内部产出的 `LLMStreamChunk.kind`，runner 消费后用于触发内部状态（如 `tool_call_seen` flag 控制 content suppression），不 emit 到 EventSink。这避免 EventKind 面积过度扩张；若未来确有 sink 侧观测需求，单独走"扩 EventKind"PR 即可。

**task 建议**

- task 名：`llm-streaming-v1-foundation`
- 是否进入 x-req：是
- 原因：后续两个 provider + runner 集成的公共底座；改动集中在 contracts.py + 两个新文件；无 sibling 依赖

---

## 模块 B：OpenAI-compatible provider 流式接入

**职责**

- 让 `OpenAIResponsesProvider` 支持 `stream()` 方法
- 把非流式 `_parse_response` 的 reasoning 提取也对齐 Hermes `_extract_reasoning` 多字段兼容
- 流式场景下的 raw_dump 策略：累积后一次性落盘（不破坏现有 opt-in 契约）

**包含范围**

- `executors/llm/openai_responses.py` 实现 `stream(req) -> AsyncIterator[LLMStreamChunk]`：
  - 新增 `_build_stream_payload(req)`：复用 `_build_payload`，追加 `"stream": True` + `"stream_options": {"include_usage": True}`
  - `httpx.AsyncClient.stream("POST", url, json=payload, headers=headers)` 拿 SSE
  - 用 `sse_reader` 把响应体切成 `AsyncIterator[dict]`
  - 喂给 `OpenAICompatStreamParser.parse()`，yield 出 `LLMStreamChunk`
- `_parse_response` 非流式路径**也**补齐 reasoning 多字段兼容：
  - 按 `message.reasoning` → `message.reasoning_content` → `message.reasoning_details[*].summary/thinking/content/text` 顺序抽
  - 收集结果塞进 `provider_metadata["reasoning_content"]`（保留现有 500 字符截断逻辑）
- 流式 raw_dump：
  - 流开始时初始化 `_stream_dump_buffer: list[dict]`
  - 每个 chunk 追加到 buffer
  - 流结束（拿到 `message.done`）时调 `dump_raw_llm_interaction(..., response_body={"chunks": buffer, "parsed": ...})`
  - 保持现有 opt-in 语义（`cfg.trace.raw_llm=True` 或 `KONGMING_TRACE_RAW_LLM=1` 才 dump）
- 超时策略：流式用分离的 connect / read timeout（对齐 Hermes 4708-4713）
  - `connect=30s`、`read=max(cfg.stream_read_timeout, cfg.model.timeout)`、`write=cfg.model.timeout`
  - 本地 endpoint 自动上调 read timeout（对齐 Hermes 4698-4703）

**不包含范围**

- 不改 `complete()` 非流式方法的请求路径
- 不实现 Anthropic 流式（留给模块 C）
- 不改 runner / host / cli（留给模块 D）

**风险与讨论点**

- SSE 行缓冲 vs 依赖 `httpx-sse`？
  - 决定：自写 `sse_reader.py`，避免新增外部依赖；30 行可控
- `httpx.AsyncClient` 是否流式专用 client 独立管理？
  - V1 决定：与现有 `_do_complete` 共用 client 管理策略（当前是每次 `async with`，待模块 D（connection reuse）完成后自动获益）；流式不额外做连接池
- `json.loads` 校验失败 → `finish_reason="length"` 是否会造成 runner 错误重试？
  - 不会：runner 只看 `message.tool_calls` 是否存在，不以 finish_reason 触发重试（参考 runner.py 约 373 行注释"核心只看 tool_calls"）。finish_reason="length" 仅用于 observability / 后续成本分析

**task 建议**

- task 名：`llm-streaming-v1-openai-provider`
- 是否进入 x-req：是（A 完成后）
- 原因：改动集中于一个文件 + 新增 sse_reader；能独立验证 GLM-5 / Gemma 流式

---

## 模块 C：Anthropic Messages provider 流式接入

**职责**

- 新建 `AnthropicStreamParser`：消费 Anthropic Messages SSE 事件序列，产出同一套 `LLMStreamChunk`
- `AnthropicMessagesProvider.stream()` 实现

**包含范围**

- 新建 `executors/llm/anthropic_stream_parser.py`：
  - 状态机处理 Anthropic 的 SSE event types：`message_start` / `content_block_start` / `content_block_delta` / `content_block_stop` / `message_delta` / `message_stop`
  - `content_block_delta` 区分 `text_delta` / `thinking_delta` / `input_json_delta` 三种子类型
  - 输出与 OpenAI parser 完全相同的 `LLMStreamChunk` 序列
- `executors/llm/anthropic_messages.py` 实现 `stream(req) -> AsyncIterator[LLMStreamChunk]`：
  - payload 追加 `"stream": true`
  - httpx SSE 行缓冲复用 `sse_reader.py`（Anthropic 也用 `data: {...}\n\n` 格式，只是 event 种类不同）
  - 喂给 `AnthropicStreamParser.parse()`
- Anthropic 专属：`message_delta.usage.output_tokens` 累积到 `usage_obj["completion_tokens"]`；`message_start.message.usage.input_tokens` → `usage_obj["prompt_tokens"]`

**不包含范围**

- 不追求和 OpenAI parser 共用一份代码（两套 SSE 协议差异大，强共用会互相污染状态机）
- 不支持 Anthropic 的 fine-grained tool streaming（`input_json_delta` 直接当 arguments 字符串增量处理，不解析中间 JSON schema）

**风险与讨论点**

- Anthropic 的 `thinking_delta` 是否与 OpenAI 的 `reasoning_content` 语义等价？
  - V1 决定：等价，都 yield `kind="reasoning.delta"`。CLI 侧 CLIStreamSink 统一渲染
- MiniMax 走 `anthropic_messages` 路径时流式是否可用？
  - V1 保守：MiniMax 流式先不列入 V1 支持矩阵（对齐 reasoning-adapter-v1 的"MiniMax 保守接入"原则）；等 Anthropic 原生流式稳定后再扩

**task 建议**

- task 名：`llm-streaming-v1-anthropic-provider`
- 是否进入 x-req：是（A 完成后；可与 B 并行，也可等 B 先落地）
- 原因：独立 parser + 独立 provider 改动；与 OpenAI 路径解耦

---

## 模块 D：Runner / Host / CLI 流式集成

**职责**

- 让 runner 在不破坏"唯一 run loop"的前提下消费流式 chunk
- 让 CLI 具备打字机渲染能力
- 把流式能力通过配置暴露给用户

**包含范围**

- `core/runner.py`:
  - `Runner.__init__` 增加 `stream_enabled: bool = False` + `suppress_content_after_tool_call: bool = True` 参数
  - 新增私有方法 `_consume_stream(llm, req, state) -> LLMResponse`，维护 turn 级状态 `tool_call_seen: bool = False`：
    - 首次非空 chunk → emit `Event(kind="llm.chunk.first", payload={"elapsed_ms": ..., "model": ...})`
    - `kind="content.delta"`：若 `tool_call_seen and suppress_content_after_tool_call` → **不 emit**；否则 emit `Event(kind="content.delta", payload={"delta": ..., "index": ...})`
    - `kind="reasoning.delta"` → emit `Event(kind="reasoning.delta", payload={"delta": ...})`
    - `kind="tool_call.start"` → **设置 `tool_call_seen = True`**；不 emit 为 EventSink 事件（既有 `tool.call.start` 事件仍由 `_execute_tool_calls` 在 approval 前 emit，语义与非流式一致）
    - `kind="tool_call.arguments.delta"` / `"tool_call.end"` → 仅用于内部累积断言（debug log 可选），不 emit
    - `kind="message.done"` → 组装等价 `LLMResponse` 返回
    - emit `Event(kind="llm.stream.end", payload={"chunk_count": ..., "finish_reason": ..., "content_chars": ..., "reasoning_chars": ..., "tool_call_count": ..., "truncated_args": ...})`
  - `_drive_turns` 里 `response = await self._safe_llm_complete(...)` 分支（**isinstance 能力探测，不依赖异常控制流**）：
    ```python
    if self._stream_enabled and isinstance(llm, SupportsLLMStream):
        response = await self._consume_stream(llm, llm_request, state)
    else:
        response = await self._safe_llm_complete(llm, llm_request)
    ```
- 新建 `host/cli_stream_sink.py`（`EventSink` 实现）：**无状态机**
  - `content.delta` → `sys.stdout.write(delta); sys.stdout.flush()`
  - `reasoning.delta` → 可配灰色前景（ANSI `\x1b[90m...\x1b[0m`），构造参数 `reasoning_color=None` 禁用
  - `llm.stream.end` → `print()` 打换行（结束本轮流式渲染）
  - `tool.call.start` → `print()` 打换行（既有 EventKind；流式下用于在 tool UI 前收尾字流）
  - 其他 kind → 忽略
  - **不自行判断"tool_call 是否出现"**——runner 已通过"不 emit 被压制的 content.delta"完成 suppression
- `observability/trace_sink.py::JsonlTraceSink` **新增构造参数** `delta_sampling: Literal["none","periodic","full"] = "none"` + `periodic_batch_size: int = 20`（`EventSink` Protocol 形状不变）：
  - `none`：不落 `content.delta` / `reasoning.delta` 事件
  - `periodic`：同 kind 每 N 个合并写一次
  - `full`：全量
- **顶层** `StreamConfig` 挂在 `Config` 下（**不**放 `ModelConfig`；归属拆分见 04-data-and-state.md §6）：
  - `stream.enabled: bool = False`
  - `stream.read_timeout: float = 120.0`
  - `stream.suppress_content_after_tool_call: bool = True`
  - `stream.trace.delta_sampling: Literal["none","periodic","full"] = "none"`
  - `stream.trace.periodic_batch_size: int = 20`
- env 覆盖：`KONGMING_STREAM_ENABLED` / `KONGMING_STREAM_READ_TIMEOUT` / `KONGMING_STREAM_SUPPRESS_CONTENT_AFTER_TOOL_CALL` / `KONGMING_STREAM_DELTA_SAMPLING` / `KONGMING_STREAM_PERIODIC_BATCH_SIZE`
- `executors/agent_runtime/session_engine.py::SessionEngine.build()` 按 `cfg.stream.enabled` 决定：
  - 构造 Runner 时传 `stream_enabled=True` + `suppress_content_after_tool_call=cfg.stream.suppress_content_after_tool_call`
  - 自动追加 `CLIStreamSink` 到 event_sinks（仅当 `cfg.host.kind == "cli"`）
  - `JsonlTraceSink` 按 `cfg.stream.trace.delta_sampling` / `periodic_batch_size` 初始化

**不包含范围**

- 不改 `host.HostAdapter` / `SessionBridge` 的对外接口（CLIStreamSink 以 EventSink 身份接入，不新增 Protocol）
- 不做 Ctrl-C 中断流式的特殊处理（V1 沿用 Runner 现有的异常中断路径；流式中断的优雅语义留给 v2）
- 不实现 `content.delta` 的 "已打字撤回"（tool_call suppression 仅压制未开始的 content delta，不回退已打出的字符）

**风险与讨论点**

- `CLIStreamSink` 顺序 vs 并发：Runner 的 `_emit` fan-out 是顺序的，CLIStreamSink 的 print 不会与其他 sink 的 trace 写盘争抢（但要保证 JsonlTraceSink 内部是 async-safe）
- `delta_sampling="periodic"` 的批量策略边界：是否要在流结束时强制 flush 剩余 buffer？→ 必须 flush，否则最后一批 delta 丢失
- `stream_enabled=True` 但 provider 不支持时的用户体感：
  - runner 回退 non-stream，但用户期待的 "打字机效果" 没出现
  - V1 决定：runner 回退时 emit 一条 `Event(kind="error", payload={"source":"stream_fallback", "reason": "provider not supported"})`，CLI 可选展示一次性警告

**task 建议**

- task 名：`llm-streaming-v1-runtime-integration`
- 是否进入 x-req：是（A + B 完成后）
- 原因：这是流式链路真正走通的 task；改动分散（runner + host + config + runtime 四层）但每层改动都很薄

---

## 模块 E：契约测试与回归

**职责**

- 把本方案 7 条验证原则固化成回归测试
- 建立"流式 ↔ 非流式等价性"作为长期质量底座

**包含范围**

- 新增 `tests/unit/test_openai_compat_stream_parser.py`：
  - 基础：纯 content delta 序列 → 拼成 `message.done`
  - reasoning 多字段：分别用 `reasoning_content` / `reasoning` / 同时出现三种场景，parser 只取 `reasoning_content`（不双倍）
  - tool_call 单个：分 3 chunk 送 name + arguments + 结束，拿到完整 Message
  - **Ollama index 复用**：index=0 被两个不同 id 复用，parser 正确分 slot
  - arguments 截断：最后一个 chunk 的 arguments 是半截 JSON，终态 `finish_reason="length"`
  - 空 choices chunk 抽 model / usage
- 新增 `tests/unit/test_anthropic_stream_parser.py`：
  - Anthropic SSE 基础事件序列 → 等价 `LLMStreamChunk` 序列
  - `thinking_delta` 映射到 `reasoning.delta`
  - `input_json_delta` 累积成 `tool_call.arguments.delta`
- 新增 `tests/unit/test_sse_reader.py`：
  - `data: {...}\n\n` 正常切分
  - `data: [DONE]` 哨兵终止
  - 跨 chunk 拼接（一个 JSON 被分到两个 HTTP 包里）
- 新增 `tests/e2e/test_stream_equivalence.py`：
  - 用 stub LLM 响应同一组 chunks 既做非流式拼接也做流式 yield
  - 断言：`Result.final_message.content` 相等、`session.history()` 等价、emit 的非 delta 事件序列等价
- 扩 `tests/e2e/conftest.py`：
  - 新增 `StubLLMStreamProvider`：从预录制的 chunk 序列 yield；实现 `stream()` + `complete()`（满足 `SupportsLLMStream` Protocol）
  - 现有 `StubLLMProvider` **不改**：结构上没有 `stream()`，`isinstance(stub, SupportsLLMStream)` 自动为 False；runner 回退路径天然触发（不是用 `NotImplementedError` 控制流）
- 新增 `tests/e2e/test_ttft_event.py`：
  - 断言 `llm.chunk.first` 事件被 emit 且 `elapsed_ms` 字段存在

**不包含范围**

- 不做真实远端 provider 流式测试（保持 unit + e2e 靠 stub，远端验证靠手工 smoke-dump）
- 不做性能基准测试（TTFT 具体数值留给手工验证）

**风险与讨论点**

- `StubLLMStreamProvider` 的实现要跟 OpenAI SDK stream response 的 chunk 对象结构完全一致，包括 `model_extra` / `extra_content` 等字段（Hermes 在意这些）
  - 决定：stub 直接产 dict，parser 用 `.get()` 而非属性访问；契约测试覆盖 dict + SimpleNamespace 两种
- stream 与 non-stream 的 `provider_metadata` 是否**字段等价**？
  - V1 要求：`reasoning_content` / `model` / `request_id` / `cached_tokens` / `reasoning_tokens` 这 5 个字段两种模式下存在性一致；值可能不完全相同（流式下 cached_tokens 有时拿不到），契约测试只断言"存在性"不断言"相等"

**task 建议**

- task 名：`llm-streaming-v1-contract-tests`
- 是否进入 x-req：是（D 完成后）
- 原因：这是 V1 能否长期稳定演进的质量底座；也是后续要加新 provider 流式时的 baseline
