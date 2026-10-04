# 数据与状态

本文档是 LLM Streaming V1 所有数据结构的**权威定义**。任何新增字段、改字段语义、改 kind 枚举值，必须先在本文档更新再落代码。

所有 Python 类型标注均按 v1-mini 现有风格：Python 3.11+ 语法、`from __future__ import annotations`、PEP 604 Union（`X | None`）。

## 1. 新增协议类型（core 层）

以下三个定义全部放进 [`src/core/contracts.py`](../../../src/core/contracts.py)（协议单一真源约束）。

### 1.1 `LLMStreamChunk`

provider-agnostic 的流式增量事件。所有 provider 的 `stream()` 方法都必须 yield 这个类型。

```python
@dataclass(frozen=True)
class LLMStreamChunk:
    """provider-agnostic 流式增量。

    一次完整的流结束后，必须有且只有一个 kind="message.done" 的 chunk 作为终态。
    runner 把该 chunk 的 message / finish_reason / usage / provider_metadata
    当作等价 LLMResponse 使用，后续 tool_call / approval / session.append
    链路与非流式完全一致。
    """

    kind: Literal[
        "reasoning.delta",
        "content.delta",
        "tool_call.start",
        "tool_call.arguments.delta",
        "tool_call.end",
        "message.done",
    ]
    delta: str = ""
    index: int = 0
    tool_call_id: str | None = None
    tool_name: str | None = None
    message: Message | None = None
    finish_reason: FinishReason | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    provider_metadata: dict[str, Any] = field(default_factory=dict)
```

#### 字段必填矩阵

下表标注每个 `kind` 下字段的状态：必填 / 可选 / 忽略。runner 与 sink 实现必须严格按此矩阵判断字段。

| 字段 | `reasoning.delta` | `content.delta` | `tool_call.start` | `tool_call.arguments.delta` | `tool_call.end` | `message.done` |
|---|---|---|---|---|---|---|
| `delta` | 必填非空 | 必填非空 | 忽略 | 必填非空 | 忽略 | 忽略 |
| `index` | 忽略 | 默认 0 | 必填 ≥ 0 | 必填 ≥ 0 | 必填 ≥ 0 | 忽略 |
| `tool_call_id` | 忽略 | 忽略 | 必填非空 | 可选 | 必填非空 | 忽略 |
| `tool_name` | 忽略 | 忽略 | 必填非空 | 忽略 | 必填非空 | 忽略 |
| `message` | 忽略 | 忽略 | 忽略 | 忽略 | 忽略 | 必填非 None |
| `finish_reason` | 忽略 | 忽略 | 忽略 | 忽略 | 忽略 | 必填非 None |
| `usage` | 忽略 | 忽略 | 忽略 | 忽略 | 忽略 | 必填（可为空 dict） |
| `provider_metadata` | 忽略 | 忽略 | 忽略 | 忽略 | 忽略 | 必填（可为空 dict） |

#### 序列不变式（parser 必须保证）

1. **kind 排序**：`message.done` 必须是流的最后一个 chunk；之前可以任意顺序穿插其他 kind
2. **tool_call 三元组**：同一个 `index` 下 `tool_call.start` 必须在所有 `tool_call.arguments.delta` 之前；`tool_call.end` 必须在该 index 的所有 delta 之后
3. **tool_call.start 的唯一性**：同一 `index` 只能发一次 `tool_call.start`（靠 `tool_gen_notified: set[int]` 状态节流）
4. **delta 非空约束**：任何 `*.delta` kind 的 chunk 必须携带非空 `delta`；空字符串场景应当被 parser 合并掉，不向外 yield
5. **message.done 等价性**：`message.content` 必须等于流过程中所有 `content.delta` 的 `delta` 字段顺序拼接；`message.tool_calls` 必须包含所有 `tool_call.end` 产生的 tool_call（按 `index` 升序）
6. **tool_call.end 只承载定位信息**：`tool_call.end` chunk 只写 `index` / `tool_call_id` / `tool_name` 三字段（如字段矩阵所示），**不包含** `arguments` 完整字符串或 `extra_content`。完整 tool_call（含合法 JSON 化的 arguments 与 extra_content）**只能**通过 `message.done.message.tool_calls` 获取。任何只订阅 `tool_call.*` kind 的外部消费者都不应假设能从流中独立重建完整 tool_call——这是本方案刻意的"终态收口"设计

### 1.2 流式能力 Protocol（`SupportsLLMStream`）

**决策**：`LLMProvider` 主 Protocol **不扩展**。流式能力由独立的 `SupportsLLMStream` Protocol 声明，支持流式的 provider 同时实现两者；runner 以 `isinstance` 做能力探测，避免用 `NotImplementedError` 作控制流。

```python
@runtime_checkable
class LLMProvider(Protocol):
    async def complete(self, request: LLMRequest) -> LLMResponse: ...


@runtime_checkable
class SupportsLLMStream(Protocol):
    """流式能力 Protocol，与 LLMProvider 正交。

    调用约定：
    - runner 不 await stream() 本身，直接拿 AsyncIterator
    - provider 在 iterator 内部处理 HTTP / SSE / 累积
    - runner 消费完所有 chunk（直到见到 kind="message.done" 的终态）
    - 非 message.done 结束 = 流中断 = 由 provider 抛 ProviderError；
      runner 不靠 iterator 耗尽来推断终态
    """
    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]: ...
```

**`BaseLLMProvider` 与 Stub 的行为**：

- `BaseLLMProvider` **不**提供 `stream()` 默认实现（结构上缺失）
- 现有 `StubLLMProvider` / 测试 stub **不**改：不实现 `stream()` 就自动不被 `isinstance(..., SupportsLLMStream)` 命中
- 支持流式的 provider（V1 为 `OpenAIResponsesProvider` / `AnthropicMessagesProvider`）显式实现 `stream()` 方法

runner 探测：

```python
if cfg.stream.enabled and isinstance(llm, SupportsLLMStream):
    response = await self._consume_stream(llm, llm_request, state)
else:
    response = await self._safe_llm_complete(llm, llm_request)
```

### 1.3 `EventKind` 枚举新增

```python
EventKind = Literal[
    # 既有：
    "run.start", "run.end",
    "turn.start", "turn.end",
    "llm.request", "llm.response",
    "tool.call.start", "tool.call.end",
    "approval.request", "approval.decision",
    "error",
    "history.compact",
    # V1 新增：
    "content.delta",
    "reasoning.delta",
    "llm.chunk.first",
    "llm.stream.end",
]
```

#### 新 Event 的 payload schema

所有 payload 都是 `dict[str, Any]`，但约定以下 schema。`JsonlTraceSink` 与 `CLIStreamSink` 按这个 schema 读：

**`Event(kind="content.delta")`**:
```python
payload = {
    "delta": str,         # 本 chunk 的正文增量，非空
    "index": int,         # content 槽位，V1 始终为 0（单正文 block）
}
```

**`Event(kind="reasoning.delta")`**:
```python
payload = {
    "delta": str,         # 本 chunk 的思考链增量，非空
}
```

**`Event(kind="llm.chunk.first")`**:
```python
payload = {
    "elapsed_ms": int,    # 从 llm.request emit 到第一个 chunk 抵达的耗时（毫秒）
    "model": str | None,  # chunk 里若带 model 字段则透传
}
```

**`Event(kind="llm.stream.end")`**:
```python
payload = {
    "chunk_count": int,           # 整个流共收到多少个 chunk（含 message.done）
    "finish_reason": str,         # 最终 finish_reason
    "content_chars": int,         # 最终 message.content 的字符长度
    "reasoning_chars": int,       # 累积 reasoning 字符长度（可为 0）
    "tool_call_count": int,       # 最终 tool_calls 数量
    "truncated_args": bool,       # 是否因 JSON 不合法触发了 finish_reason="length"
}
```

## 2. Parser 内部状态（实现层）

以下类型**不进 core.contracts**，只在 `executors/llm/openai_compat_stream_parser.py` / `executors/llm/anthropic_stream_parser.py` 内部使用。

### 2.1 OpenAI-compatible parser 状态

```python
@dataclass
class _OpenAIParserState:
    """OpenAI-compatible chunk parser 的累积状态。

    字段命名对齐 Hermes run_agent.py:4729-4743，便于 review 时直接对比行号。
    """

    # 内容累积
    content_parts: list[str] = field(default_factory=list)
    reasoning_parts: list[str] = field(default_factory=list)

    # tool_calls 累积：key 为 slot（Ollama 防御后的最终槽位）
    tool_calls_acc: dict[int, _PartialCall] = field(default_factory=dict)

    # Ollama / LM Studio 并行 tool_call 防御
    _last_id_at_idx: dict[int, str] = field(default_factory=dict)
    _active_slot_by_idx: dict[int, int] = field(default_factory=dict)

    # tool_call.start 节流（同一 slot 只发一次）
    tool_gen_notified: set[int] = field(default_factory=set)

    # 流级元数据
    finish_reason: str | None = None
    usage_obj: dict[str, Any] | None = None
    model_name: str | None = None
    response_id: str | None = None
    system_fingerprint: str | None = None

    # 计数（供 llm.stream.end payload 填充）
    chunk_count: int = 0
```

### 2.2 `_PartialCall`（tool_call 累积槽位）

```python
@dataclass
class _PartialCall:
    """单个 tool_call 的累积状态，对应 Hermes run_agent.py:4819-4824 的 dict。

    字符串字段使用 += 累积（OpenAI 约定 function.arguments 是 JSON 字符串流）。
    """

    id: str = ""                  # tool_call.id，首次非空 chunk 写入后不再变
    name: str = ""                # function.name 字符串累积
    arguments: str = ""           # function.arguments 字符串累积
    extra_content: Any = None     # 最后一次非 None 的 extra_content（优先 tc_delta.extra_content，fallback model_extra["extra_content"]）

    @property
    def arguments_is_valid_json(self) -> bool:
        if not self.arguments or not self.arguments.strip():
            return True   # 空 arguments 不算截断
        try:
            json.loads(self.arguments)
            return True
        except json.JSONDecodeError:
            return False
```

### 2.3 Anthropic parser 状态

```python
@dataclass
class _AnthropicParserState:
    """Anthropic Messages SSE parser 的累积状态。"""

    # Anthropic 按 content_block 索引，不是 OpenAI 的 tool_calls[*].index
    content_blocks: dict[int, _AnthropicBlock] = field(default_factory=dict)

    # 流级元数据
    stop_reason: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    model_name: str | None = None
    message_id: str | None = None
    chunk_count: int = 0


@dataclass
class _AnthropicBlock:
    """Anthropic content_block 的累积状态。block_type 决定后续怎么映射。"""

    block_type: Literal["text", "thinking", "tool_use"]
    text: str = ""                # text / thinking block 的累积
    tool_use_id: str = ""         # tool_use block 的 id
    tool_name: str = ""           # tool_use block 的 name
    tool_input_json: str = ""     # tool_use block 的 input_json_delta 累积
```

## 3. SSE 原始数据格式

OpenAI Chat Completions 与 Anthropic Messages 都走 Server-Sent Events。`executors/llm/sse_reader.py` 负责行缓冲与 JSON 解包。

### 3.1 SSE 线传格式

**OpenAI-compatible**（GLM / DeepSeek / Kimi / Qwen / OpenAI 官方）：只发 `data:` 行，不带 `event:` 声明：

```
data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":"hi"}}]}\n\n
data: {"id":"chatcmpl-xxx","choices":[{"delta":{"content":" there"}}]}\n\n
data: [DONE]\n\n
```

**Anthropic Messages**：每条记录**先** `event:` **再** `data:`，Anthropic parser 必须依赖事件名区分 text/thinking/tool_use block：

```
event: message_start\ndata: {"type":"message_start","message":{...}}\n\n
event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text"}}\n\n
event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n
event: message_stop\ndata: {"type":"message_stop"}\n\n
```

### 3.2 `sse_reader.py` 契约

**关键决策**：`sse_reader` 返回 `tuple[str | None, dict]`——第一项是最近一条 `event:` 行的事件名（如无则 `None`），第二项是 `data:` 行解析出的 JSON dict。OpenAI parser 只用第二项；Anthropic parser 两项都用。**避免给两个 provider 各写一份行缓冲 / JSON 解包**。

```python
async def iter_sse_events(
    response: httpx.Response,
) -> AsyncIterator[tuple[str | None, dict[str, Any]]]:
    """从 httpx 流式 Response 中逐条 yield (event_name, data) 二元组。

    - `event:` 行：记入"当前 event_name"状态，不 yield
    - `data: [DONE]`：立即终止（StopAsyncIteration）
    - `data: {...}`：yield (current_event_name, parsed_dict)，然后清空 event_name
      （SSE 规范：每个 message 的 event 字段在 data 发送后失效）
    - `:...` 注释行（心跳）/ `retry:` 行 / 空行：跳过
    - 处理跨 TCP 包的行拼接（buffer + b"\\n\\n" 分隔符）
    - JSON 解析失败的行：emit 一条 log.warning 后跳过，不抛异常（防御本地模型偶发脏数据）
    """
```

**历史遗留命名说明**：本方案早期草稿把函数命名为 `iter_sse_data` 且只返回 dict——这是基于"只处理 OpenAI-compatible"的错误假设。正式实现以本文档的 `iter_sse_events` + 二元组为准。

## 4. OpenAI-compatible chunk 字段探测表

parser 对每个 chunk 的处理字段一览。**所有字段访问都用 `.get()` 或 `getattr(..., default)`**（因为各厂商会随意增删字段）。

### 4.1 Chunk 顶层字段

| 字段路径 | 类型 | 处理 | 来源验证 |
|---|---|---|---|
| `chunk.id` | str | 写入 `state.response_id` | OpenAI / GLM / DeepSeek |
| `chunk.model` | str \| null | 写入 `state.model_name`（每 chunk 都可能有） | OpenAI / GLM |
| `chunk.system_fingerprint` | str \| null | 写入 `state.system_fingerprint` | OpenAI |
| `chunk.usage` | dict \| null | 写入 `state.usage_obj`（只在最后一个 chunk 带；要求请求带 `stream_options.include_usage=True`） | OpenAI / GLM |
| `chunk.choices` | list \| null | 长度为 0 时跳 delta 处理（仍抽 model / usage） | 通用 |

### 4.2 `chunk.choices[0].delta` 字段

| 字段路径 | 类型 | 处理 | 来源验证 |
|---|---|---|---|
| `delta.content` | str \| null | 非空 → append `content_parts` + yield `content.delta` | 通用 |
| `delta.reasoning_content` | str \| null | 非空 → append `reasoning_parts` + yield `reasoning.delta` | OpenAI o-series / GLM / DeepSeek R1 |
| `delta.reasoning` | str \| null | `reasoning_content` 缺席时作为 fallback | Qwen / 部分 DeepSeek 封装 |
| `delta.refusal` | str \| null | V1 不处理（非流式也未覆盖） | OpenAI |
| `delta.tool_calls` | list \| null | 见 §4.3 | 通用 |
| `delta.role` | str \| null | V1 不处理（固定 assistant） | 通用 |

**双字段探测规则**（对齐 Hermes 4766）：

```python
reasoning_text = (
    getattr(delta, "reasoning_content", None)
    or getattr(delta, "reasoning", None)
)
```

**不同时处理两个字段**，避免某些兼容实现同时塞两处导致双倍累积。

### 4.3 `delta.tool_calls[i]` 字段

| 字段路径 | 类型 | 处理 |
|---|---|---|
| `tc_delta.index` | int \| null | `raw_idx = tc_delta.index or 0`；用于 `_active_slot_by_idx` 查槽 |
| `tc_delta.id` | str \| null | 首次非空时写入 slot.id；每次非空都更新 `_last_id_at_idx[raw_idx]` |
| `tc_delta.type` | str \| null | V1 忽略（假设永远是 function） |
| `tc_delta.function.name` | str \| null | `slot.name += tc_delta.function.name` |
| `tc_delta.function.arguments` | str \| null | `slot.arguments += tc_delta.function.arguments` |
| `tc_delta.extra_content` | Any | 优先赋值 |
| `tc_delta.model_extra["extra_content"]` | Any | fallback 赋值（Hermes 4834-4835） |

### 4.4 Ollama / LM Studio 并行 tool_call 防御流程图

```
新 tc_delta 到达
   │
   ├── raw_idx = tc_delta.index or 0
   │
   ├── raw_idx not in _active_slot_by_idx ?
   │     └── _active_slot_by_idx[raw_idx] = raw_idx  (初始化)
   │
   ├── delta_id 非空 and raw_idx in _last_id_at_idx and delta_id != _last_id_at_idx[raw_idx] ?
   │     └── 这是"同一 index 但新 id" → 分 new_slot
   │          new_slot = max(tool_calls_acc.keys(), default=-1) + 1
   │          _active_slot_by_idx[raw_idx] = new_slot
   │
   ├── delta_id 非空 ?
   │     └── _last_id_at_idx[raw_idx] = delta_id   (追踪最新 id)
   │
   └── slot = _active_slot_by_idx[raw_idx]
       → 后续所有累积写入 tool_calls_acc[slot]
```

## 5. Anthropic SSE 事件 → `LLMStreamChunk` 映射表

Anthropic Messages API 的 SSE event 种类与 OpenAI 完全不同，不能共用 parser。以下是完整映射：

| Anthropic SSE `event` | SSE `data` 关键字段 | parser 动作 | yield 的 `LLMStreamChunk` |
|---|---|---|---|
| `message_start` | `message.id` / `message.model` / `message.usage.input_tokens` | 写入 state.message_id / model_name / input_tokens | 不 yield |
| `content_block_start`（`content_block.type="text"`） | `index` | 注册 block 为 text 类型 | 不 yield |
| `content_block_start`（`content_block.type="thinking"`） | `index` | 注册 block 为 thinking 类型 | 不 yield |
| `content_block_start`（`content_block.type="tool_use"`） | `index` / `content_block.id` / `content_block.name` | 注册 block 为 tool_use，写入 tool_use_id / tool_name | `tool_call.start(tool_call_id=..., tool_name=..., index=...)` |
| `content_block_delta`（`delta.type="text_delta"`） | `index` / `delta.text` | `block.text += delta.text` | `content.delta(delta=delta.text, index=0)` |
| `content_block_delta`（`delta.type="thinking_delta"`） | `index` / `delta.thinking` | `block.text += delta.thinking` | `reasoning.delta(delta=delta.thinking)` |
| `content_block_delta`（`delta.type="input_json_delta"`） | `index` / `delta.partial_json` | `block.tool_input_json += delta.partial_json` | `tool_call.arguments.delta(delta=delta.partial_json, index=...)` |
| `content_block_stop` | `index` | 对 tool_use block：构造完整 tool_call 进入累积；对 text/thinking：无操作 | 仅 tool_use block：`tool_call.end(tool_call_id=..., tool_name=..., index=...)` |
| `message_delta` | `delta.stop_reason` / `usage.output_tokens` | 写入 state.stop_reason / output_tokens | 不 yield |
| `message_stop` | — | 触发终态聚合 | `message.done(message=..., finish_reason=..., usage=..., provider_metadata=...)` |
| `ping` | — | 心跳，跳过 | 不 yield |
| `error` | `error.type` / `error.message` | 抛 ProviderError | — |

**content `index` 映射规则**：Anthropic 每个 content_block 有独立 index，但 kongming 的 `LLMStreamChunk.index` 对 `content.delta` 始终映射为 0（单正文 block 语义）。tool_use block 的 index 映射保留原始值。

**finish_reason 映射表**（对齐现有 `anthropic_messages.py` 的非流式逻辑）：

| Anthropic `stop_reason` | kongming `finish_reason` |
|---|---|
| `end_turn` | `stop` |
| `stop_sequence` | `stop` |
| `tool_use` | `tool_calls` |
| `max_tokens` | `length` |
| `refusal` | `error` |
| 其他 | `other` |

## 6. `Config.stream` 配置结构（顶层，非 ModelConfig）

**归属决策**：`stream` 是顶层 `Config` 的子节，与 `trace` / `cli` / `runner` 等并列；**不**放到 `ModelConfig` 下。理由：

- `ModelConfig` 的职责域是"单个模型的连接 / 鉴权 / 采样参数 / reasoning 能力"——是 provider 层的本地配置
- 流式涉及三个不同层：
  - `enabled` / `read_timeout` → provider 层
  - `suppress_content_after_tool_call` → runner emit 策略
  - `trace.delta_sampling` / `trace.periodic_batch_size` → trace sink
- 混进 ModelConfig 会让"切模型"无端拖动 trace 行为；拆到顶层后每层读各自的子字段

新增到 `src/config_loader/models.py`：

```python
class StreamTraceConfig(BaseModel):
    """流式下 trace sink 对 delta 事件的处理策略。"""
    model_config = ConfigDict(extra="forbid")

    delta_sampling: Literal["none", "periodic", "full"] = "none"
    """JsonlTraceSink 对 content.delta / reasoning.delta 事件的落盘策略。
    - none: 不落盘（默认；避免 trace.jsonl 膨胀几十倍）
    - periodic: 同 kind 每 N 个合并成一条
    - full: 全量（调试用）
    """

    periodic_batch_size: int = 20
    """delta_sampling=periodic 时每批合并多少条 delta。"""


class StreamConfig(BaseModel):
    """流式响应的总开关与行为配置。顶层配置节。"""
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    """是否启用流式。False 时 runner 走 complete() 非流式路径。"""

    read_timeout: float = 120.0
    """流式 HTTP 读超时（秒）。本地 endpoint 自动上调至 model.timeout。"""

    suppress_content_after_tool_call: bool = True
    """runner 在见到 LLMStreamChunk(kind="tool_call.start") 之后是否停止
    emit 后续 content.delta 事件到 EventSink。默认 True 避免 tool_call 期间
    出现嘈杂的 chatty 引导文字打断 CLI 的 tool 审批 UI。"""

    trace: StreamTraceConfig = Field(default_factory=StreamTraceConfig)


class Config(BaseModel):
    # ... 既有字段（model / runner / session / trace / logging / host / approval / tool / compactor / retry / cli）
    stream: StreamConfig = Field(default_factory=StreamConfig)
```

### 6.1 Env 覆盖映射（对齐现有 `KONGMING_*` 风格）

| Env var | 覆盖字段 | 类型转换 |
|---|---|---|
| `KONGMING_STREAM_ENABLED` | `stream.enabled` | `"1"/"true"/"yes"` → True，其他 False |
| `KONGMING_STREAM_READ_TIMEOUT` | `stream.read_timeout` | float 转换，失败回退 120.0 |
| `KONGMING_STREAM_SUPPRESS_CONTENT_AFTER_TOOL_CALL` | `stream.suppress_content_after_tool_call` | bool 转换 |
| `KONGMING_STREAM_DELTA_SAMPLING` | `stream.trace.delta_sampling` | 直接赋值；非合法值回退 `"none"` + warning |
| `KONGMING_STREAM_PERIODIC_BATCH_SIZE` | `stream.trace.periodic_batch_size` | int 转换，失败回退 20 |

## 7. CLIStreamSink 实现契约

新建 `src/host/cli_stream_sink.py`。**Sink 无状态机、无策略决策**——所有 "见到 tool_call 后压制 content" 的逻辑都在 runner 侧以"不 emit"的方式完成，sink 只负责按事件类型做纯渲染：

```python
class CLIStreamSink:
    """EventSink 实现。把流式 delta 渲染到 stdout，实现打字机效果。"""

    def __init__(
        self,
        *,
        stdout: TextIO | None = None,
        reasoning_color: str | None = "\x1b[90m",      # 灰色，None 禁用
        reasoning_color_reset: str = "\x1b[0m",
    ) -> None: ...

    async def emit(self, event: Event) -> None:
        # content.delta    → stdout.write(delta); stdout.flush()
        # reasoning.delta  → 灰色前景 print（若 reasoning_color is not None）
        # llm.stream.end   → print() 打换行（结束本轮流式渲染）
        # tool.call.start  → print() 打换行（既有 EventKind，非流式也 emit；
        #                    流式下用于在 tool UI 前收尾视觉上的字流）
        # 其他 kind        → 忽略
        ...
```

**suppression 的执行点在 runner**：当 `cfg.stream.suppress_content_after_tool_call=True` 且 runner 见到 `LLMStreamChunk(kind="tool_call.start")` 后，后续 `content.delta` 事件**不被 emit**——sink 根本收不到，不需要自行判断。这是本方案"策略决策不下放到 sink"的具体落地。

**线程安全**：runner 的 `_emit` fan-out 是顺序的，不并发；不用加锁。但 stdout 本身的 flush 在某些终端下有锁；V1 不做异步 print 抽象。

## 8. 数据流时序图（核心场景）

### 8.1 单轮纯文本流式（无 tool_call）

```
User: "你好"
  │
  runner._drive_turns
    │
    ├─ emit Event(turn.start, turn=1)
    ├─ emit Event(llm.request, payload={...})
    │
    ├─ chunks = llm.stream(req)                          ← OpenAIResponsesProvider
    │     │
    │     ├─ httpx stream POST /chat/completions
    │     ├─ async for line in sse_reader: ...
    │     │     ├─ chunk_1: delta.content="你"        → yield content.delta("你")
    │     │     ├─ chunk_2: delta.content="好"        → yield content.delta("好")
    │     │     ├─ chunk_3: delta.content="！"        → yield content.delta("！")
    │     │     ├─ chunk_4: choices=[], usage={...}   → state.usage_obj 写入
    │     │     └─ chunk_5: [DONE]                     → (sse_reader 终止)
    │     │
    │     └─ yield message.done(message=Message.assistant("你好！"), usage=...)
    │
    ├─ 对每个 chunk：
    │     ├─ chunk_1 首发 → emit Event(llm.chunk.first, elapsed_ms=123)
    │     │                   → emit Event(content.delta, delta="你", index=0)
    │     │                   → CLIStreamSink 打印 "你"（flush）
    │     ├─ chunk_2     → emit Event(content.delta, delta="好", index=0)
    │     ├─ chunk_3     → emit Event(content.delta, delta="！", index=0)
    │     └─ message.done → 构造等价 LLMResponse，跳出循环
    │
    ├─ emit Event(llm.stream.end, chunk_count=5, finish_reason="stop", content_chars=3)
    ├─ CLIStreamSink 收到 → 打印换行
    │
    ├─ session.append(assistant_message)
    ├─ emit Event(llm.response, payload={...})
    ├─ emit Event(turn.end, turn=1)
    └─ return Result(final_message=Message.assistant("你好！"), ...)
```

### 8.2 单轮带 tool_call 流式

```
User: "读一下 /tmp/x.txt"
  │
  runner._drive_turns
    │
    ├─ chunks = llm.stream(req)
    │     │
    │     ├─ chunk_1: delta.content="我来读文件..."  → yield content.delta("我来读文件...")
    │     ├─ chunk_2: delta.tool_calls[0]: id="call_abc", function.name="read_file"
    │     │                                           → yield tool_call.start(index=0, tool_name="read_file", tool_call_id="call_abc")
    │     ├─ chunk_3: delta.tool_calls[0]: function.arguments='{"pa'
    │     │                                           → yield tool_call.arguments.delta(index=0, delta='{"pa')
    │     ├─ chunk_4: delta.tool_calls[0]: function.arguments='th":"/tmp/x.txt"}'
    │     │                                           → yield tool_call.arguments.delta(index=0, delta='th":"/tmp/x.txt"}')
    │     ├─ chunk_5: finish_reason="tool_calls"
    │     ├─ chunk_6: [DONE]
    │     │
    │     └─ 流结束阶段：
    │           ├─ json.loads('{"path":"/tmp/x.txt"}') 成功 → finish_reason 保持 "tool_calls"
    │           ├─ yield tool_call.end(index=0, tool_name="read_file", tool_call_id="call_abc")
    │           └─ yield message.done(message=..., finish_reason="tool_calls", ...)
    │
    ├─ runner 收到 LLMStreamChunk 并决策 emit：
    │     chunk_1 (content.delta "我来读文件...")    → emit Event(content.delta) （tool_call 还没出现）
    │                                                → CLIStreamSink 打印 "我来读文件..."
    │     chunk_2 (tool_call.start)                  → 设置 runner.tool_call_seen=True
    │                                                → **不**作为 EventSink 事件 emit
    │     （后续若还有 content.delta，runner 因 suppress_content_after_tool_call=True
    │      直接不 emit——CLIStreamSink 根本收不到，无需自行判断）
    │     注意：前半段的 "我来读文件..." 已经打印出去了——
    │          V1 不回退已打字符（需要终端 \r + clear-line 支持，留给 V2 评估）
    │
    ├─ message.done → runner 拿到完整 Message（含 tool_calls）
    ├─ runner._execute_tool_calls：
    │     ├─ approval.decide（approved）
    │     ├─ ReadFileTool.execute({"path":"/tmp/x.txt"})
    │     └─ session.append(tool_result)
    │
    └─ 进入下一个 turn（继续 while True）
```

## 9. 不变式清单（parser 单测必须覆盖）

这些是 parser 必须保证的恒等关系，测试用例直接断言：

1. **content 等价性**：`message.content == "".join([c.delta for c in chunks if c.kind == "content.delta"])`
2. **reasoning 等价性**：`"".join(reasoning_parts) == "".join([c.delta for c in chunks if c.kind == "reasoning.delta"])`（状态内部累积 == 外部 emit 汇总）
3. **tool_calls 顺序**：`message.tool_calls[i].call_id == chunks[*].tool_call_id`（按每个 tool_call.end 的 index 升序）
4. **tool_calls arguments 等价性**：对每个 tool_call，`tc.arguments_json == "".join([c.delta for c in chunks if c.kind == "tool_call.arguments.delta" and c.index == tc.index])`（拼接后须能 json.loads）
5. **kind 终态**：chunks 序列的最后一个 chunk 必然是 `kind="message.done"`
6. **tool_call.start 节流**：对每个 `index`，`sum(1 for c in chunks if c.kind == "tool_call.start" and c.index == i) <= 1`
7. **Ollama 分 slot**：若两个不同 `id` 在同一原始 index 下出现，最终 `message.tool_calls` 应有两条独立记录

所有不变式的具体测试用例见 [`./05-validation-and-evolution.md`](./05-validation-and-evolution.md)。
