# LLM Streaming V1

> 状态：方案确认中
> 目标：把非流式 `LLMProvider.complete()` 升级为"非流式 + 流式双轨"，让 CLI 体感"打字机效果"、让 observability 能准确测 TTFT，同时不破坏 v1-mini 的"唯一 run loop / 协议单一真源 / 事件只走 EventSink"三条架构约束。

## 文档导航

- [模块拆分](./02-module-breakdown.md) — 5 个模块的职责、边界、依赖、风险
- [数据与状态](./04-data-and-state.md) — `LLMStreamChunk` / parser 内部状态 / Event payload / SSE 事件映射表
- [验证与演进](./05-validation-and-evolution.md) — 测试用例清单（54 个） + 演进路线
- [测试用例详细设计](./06-test-cases-detailed.md) — 关键用例的完整输入/输出数据 + 断言骨架 + 测试辅助工厂
- [Task 映射](./90-task-map.md) — 模块 → task 名 → 推进顺序

## 背景

本方案是 [上级 README](../README.md) 里**模块 F · 流式响应 + TTFT** 的独立 x-spec。上级 README 在当前建议里明确写：

> 第 3 步：F · `llm-streaming`（**必须先独立跑一次 `x-spec`**，然后 `x-req` → `x-plan` → `x-dev`）

模块 F 是 llm-provider-v0.2 六个模块里**唯一涉及 Protocol 形状变更**的模块；上级 [02-module-breakdown.md](../02-module-breakdown.md) 第 210-272 行已经梳理过"为什么只加一个 stream=True 参数不成立"的 11 层改动面。本 spec 的目的是在正式 x-req 之前，把"到底怎么落、参考谁、用什么 parser、如何保持架构边界"讲清楚。

## 参考来源

2026-04-22 调研了两个开源实现，结论如下：

### `other/openai`（openai-agents-python）· **核心思路可借鉴，类型基座不可搬**

- `other/openai/src/agents/models/chatcmpl_stream_handler.py`（787 行）是一个"把 OpenAI Chat Completions chunk 流归一化为 OpenAI **Responses API** 事件流"的状态机
- 输出类型深度绑定 `openai.types.responses.*`（`ResponseOutputText` / `ResponseReasoningItem` / `ResponseFunctionToolCall` / 各种 `*Event`），是 OpenAI SDK 内部类型
- kongming 没有 Responses API 这套层级事件类型，只有扁平的 `LLMResponse(message, finish_reason, usage, provider_metadata)` + `Event(kind, payload)`
- 硬搬 = 引入第三套协议，违反约束 1"协议单一真源"
- **可借鉴**：`StreamingState` 累积模式（text / reasoning / tool_calls 按 index 分组）、多厂商 delta 字段探测

### `other/hermes-agent` · **实战蓝本，直接对齐**

- `other/hermes-agent/run_agent.py:4643` `_interruptible_streaming_api_call` 是 Hermes 的 chat completions 流式主入口
- Hermes **不使用 zai SDK**（虽然它支持 GLM / Z.AI），实际调用 OpenAI Python SDK + base_url 指向 `https://api.z.ai/api/paas/v4/chat/completions`，走**统一的 OpenAI Chat Completions 流式协议**
- Hermes 假设 GLM / DeepSeek / Qwen / Kimi 等国产厂商都原生暴露 OpenAI-compatible chat completions stream，**不给每个厂商写专门 parser**
- 验证点（hermes-agent `run_agent.py`）：
  - `4766`：`reasoning_text = getattr(delta, "reasoning_content", None) or getattr(delta, "reasoning", None)` —— 双字段探测
  - `4773`：`delta.content` 直接 append 到 `content_parts`
  - `4798-4832`：`delta.tool_calls` 按 `tc_delta.index` 聚合，`function.name` / `function.arguments` 字符串 `+=` 拼接
  - `4833-4839`：`extra_content` 优先取 `tc_delta.extra_content`，fallback `tc_delta.model_extra["extra_content"]`
  - `4707`：请求 payload 必带 `"stream_options": {"include_usage": True}`
  - `4854-4888`：流结束拼 mock SimpleNamespace（非流式 shape）
  - `4863-4867`：对每个 tool_call 的 `arguments` 跑 `json.loads`，任一 fail → `effective_finish_reason = "length"`
  - `1824-1864` `_extract_reasoning`：非流式也按 `reasoning → reasoning_content → reasoning_details[*].summary/thinking/content/text` 顺序收集

### Hermes 里**必须一并抄的一段防御代码**

`run_agent.py:4732-4737` + `4803-4816`：**Ollama / LM Studio 会对并行 tool_calls 重用同一个 `index=0`**，靠 `_last_id_at_idx` + `_active_slot_by_idx` 按 id 变化分 slot。

```python
if (delta_id and raw_idx in _last_id_at_idx and delta_id != _last_id_at_idx[raw_idx]):
    new_slot = max(tool_calls_acc, default=-1) + 1
    _active_slot_by_idx[raw_idx] = new_slot
```

这段是 OpenAI 自家 `chatcmpl_stream_handler.py` **没有**的防御。kongming 配置支持本地 LM Studio / Ollama，如果直接抄 OpenAI 官方 handler 会掉坑；必须抄 Hermes 这段。

## 方案目标

V1 只解决四件事：

1. **建立统一流式契约**：`LLMStreamChunk` 数据类（provider-agnostic）+ `LLMProvider.stream()` 可选方法
2. **复刻 Hermes 的 OpenAI-compatible chunk parser**：双字段 reasoning 探测 + index 聚合 + Ollama 防御 + json.loads 校验
3. **Anthropic 独立 parser**：SSE 事件名不同（`content_block_delta` / `message_delta` / 等），不能共用一个 handler，但产物同样是 `LLMStreamChunk`
4. **Runner / Host / CLI 最小化集成**：EventKind 扩枚举（不新增 Protocol）、CLIStreamSink 渲染打字机效果、tool_call + approval 仍按"完整 message 再审批"的现路径

## 范围边界

**包含**

- `core/contracts.py` 新增 `LLMStreamChunk` 数据类 + `LLMProvider.stream(req) -> AsyncIterator[LLMStreamChunk]` 可选方法
- `core.contracts.EventKind` 枚举新增 `"content.delta"` / `"reasoning.delta"` / `"llm.chunk.first"` / `"llm.stream.end"` 四个值
- 新增 `executors/llm/openai_compat_stream_parser.py`（OpenAI-compatible chunk normalizer，借鉴 Hermes 逻辑）
- 新增 `executors/llm/anthropic_stream_parser.py`（Anthropic Messages SSE parser）
- `OpenAIResponsesProvider.stream()` 实现（httpx SSE + `stream_options.include_usage`）
- `AnthropicMessagesProvider.stream()` 实现
- `OpenAIResponsesProvider._parse_response` 非流式路径**也补齐**多字段 reasoning 兼容（对齐 Hermes `_extract_reasoning`）
- Runner `_drive_turns` 分支：当 provider 支持 stream 且 sink 订阅了 delta 事件时走流式链路；流结束时聚合的 Message 等价非流式 `LLMResponse.message`，后续 tool_call / approval / session.append 逻辑完全复用
- 新增 `host/cli_stream_sink.py`：`EventSink` 实现，收 `content.delta` / `reasoning.delta` 时 print 不换行 + flush
- `SessionEngine.build()` 增加流式开关：`cfg.stream.enabled: bool = False`（默认关，兼容现有 e2e）
- 契约测试：stream vs non-stream 在相同 stub 响应下产出等价 session history / trace events / final Result

**不包含**

- **不引入** `openai` Python SDK 或 `zai` SDK；继续走 `httpx` + 手写 SSE 行缓冲
- **不支持"流中暂停审批再续流"**：tool_call 的 delta 累加仍在 provider 内完成，audit/approval 发生在流结束之后（大多数 provider 不支持续流，Hermes / other/openai 都这么做）
- **不 emit 每个 chunk 为独立 Event**：只 emit `llm.chunk.first`（TTFT）+ 每次 delta 通过 `content.delta` / `reasoning.delta` 汇聚；`llm.stream.end` 在流结束时一条
- **不做 HTTP/2**（httpx 需要额外 `http2=True` + `h2` 依赖，ROI 低）
- **不做 chunk-level raw_dump**：raw_dump 仍在流结束后一次性落盘累积内容（opt-in 语义不变）
- **不支持 tool_call 流式展示**：UI 层看到 tool_call 时已经是完整 JSON（Hermes 也是这个策略）
- **不做 session 存 chunk 历史**：session 只存完整 assistant Message，chunk 是纯瞬态

## 关键设计

### 1. 新契约：`LLMStreamChunk`

放进 `core/contracts.py`。字段按最小可用原则设计：

```python
@dataclass(frozen=True)
class LLMStreamChunk:
    """provider-agnostic 流式增量。"""
    kind: Literal[
        "reasoning.delta",            # 思考内容增量
        "content.delta",              # 正文增量
        "tool_call.start",            # 拿到 name+call_id 才首发
        "tool_call.arguments.delta",  # 工具参数逐片
        "tool_call.end",              # 工具完整累加结束
        "message.done",               # 整条 assistant message 聚合完毕
    ]
    delta: str = ""
    index: int = 0                    # content / tool_call 的槽位
    tool_call_id: str | None = None
    tool_name: str | None = None
    message: Message | None = None    # 仅 message.done 时填
    finish_reason: FinishReason | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    provider_metadata: dict[str, Any] = field(default_factory=dict)
```

**核心约束**：最后一个 chunk 必须 `kind="message.done"` 且 `message` / `finish_reason` / `usage` / `provider_metadata` 都是完整值。runner 直接用 `chunk.message` 当这一轮的 assistant 消息，等价非流式 `LLMResponse.message`。

### 2. 流式能力通过独立 Protocol 引入

**决策**：**不动** `LLMProvider` 主 Protocol，新增独立的 `SupportsLLMStream` Protocol；支持流式的 provider 实现之，runner 用 `isinstance` 探测能力。这样：

- 现有 `LLMProvider` 形状完全不变，所有既有 stub / mock / provider 零改动自动"不支持流式"
- 不需要在 `BaseLLMProvider` 里写一个"默认抛 NotImplementedError"的假方法（那会让 Protocol 语义和结构语义互相打架）
- 流式能力可被第三方 provider 选择性实现，不强制全员升级

```python
# core/contracts.py
@runtime_checkable
class LLMProvider(Protocol):
    async def complete(self, request: LLMRequest) -> LLMResponse: ...


@runtime_checkable
class SupportsLLMStream(Protocol):
    """流式能力 Protocol，与 LLMProvider 正交。

    具备该能力的 provider 必须同时满足 LLMProvider；runner 用
    isinstance(llm, SupportsLLMStream) 做能力探测。
    """
    def stream(self, request: LLMRequest) -> AsyncIterator[LLMStreamChunk]: ...
```

**runner 探测逻辑**：

```python
if cfg.stream.enabled and isinstance(llm, SupportsLLMStream):
    response = await self._consume_stream(llm, llm_request, state)
else:
    response = await self._safe_llm_complete(llm, llm_request)
```

**不再**依赖 `NotImplementedError` 异常来做控制流——异常是错误信号，不应当被用作"可选能力缺失"的正常路径。

### 3. EventKind 扩枚举，不新增 Protocol

按约束 7"事件只走 EventSink，v0.2+ 不新增 Protocol"，流式内容**走现有 EventSink**：

```python
EventKind = Literal[
    "run.start", "run.end", "turn.start", "turn.end",
    "llm.request", "llm.response",
    "tool.call.start", "tool.call.end",
    "approval.request", "approval.decision",
    "error",
    # 新增：
    "content.delta",       # payload: {"delta": str, "index": int}
    "reasoning.delta",     # payload: {"delta": str}
    "llm.chunk.first",     # payload: {"elapsed_ms": int}  (TTFT 信号)
    "llm.stream.end",      # payload: {"chunk_count": int, "finish_reason": str}
]
```

CLI 侧新增 `CLIStreamSink(EventSink)` 实现，**无状态机**，只按事件类型做纯渲染：

- 看到 `content.delta` → `print(payload["delta"], end="", flush=True)`
- 看到 `reasoning.delta` → 灰色前景色 print（构造参数 `reasoning_color` 控制，可禁用）
- 看到 `llm.stream.end` → print 换行

**CLIStreamSink 故意不感知 tool_call**。tool_call 出现后是否继续接收 content.delta，由 runner 决定是否 emit（见 §6 "tool_call 与 content suppression"）。这避免了 sink 做策略决策。

`JsonlTraceSink` 的 `EventSink` Protocol 形状**不变**，但需要新增一个 `delta_sampling` **构造参数**来控制是否落 delta 事件：

- 默认 `none`：不把 `content.delta` / `reasoning.delta` 写入 trace.jsonl（delta 对离线分析价值低；一轮对话可能产生几百条 delta event 会让 trace 膨胀）
- `periodic`：每 N 个同 kind 的 delta 合并成一条写入
- `full`：全量写（调试用）

Sink 侧的 Protocol 不变意味着 runner / EventSink 调用链零改动；新增参数只在 sink 构造时注入。

### 4. OpenAI-compatible chunk parser（核心借鉴 Hermes）

新建 `executors/llm/openai_compat_stream_parser.py`，实现 `OpenAICompatStreamParser.parse()`：

**输入**：`AsyncIterator[dict]`（httpx SSE 行解出的 raw chunk JSON）
**输出**：`AsyncIterator[LLMStreamChunk]`

**状态机字段**：

```python
content_parts: list[str] = []
reasoning_parts: list[str] = []
tool_calls_acc: dict[int, _PartialCall] = {}
_last_id_at_idx: dict[int, str] = {}         # Ollama 防御
_active_slot_by_idx: dict[int, int] = {}     # Ollama 防御
tool_gen_notified: set[int] = set()           # "name 出现才发 tool_call.start" 节流
finish_reason: str | None = None
usage_obj: dict | None = None
model_name: str | None = None
```

**处理逻辑**（严格对齐 Hermes 4744-4852）：

1. 每个 chunk 先更新 `last_chunk_time`
2. `chunk.choices` 为空时尝试抽 `chunk.model` / `chunk.usage`（GLM / OpenAI 都在最后一个空 choice 的 chunk 里送 usage）
3. `delta.reasoning_content or delta.reasoning` 非空 → append `reasoning_parts` + yield `LLMStreamChunk(kind="reasoning.delta", delta=...)`
4. `delta.content` 非空 → append `content_parts` + yield `LLMStreamChunk(kind="content.delta", delta=...)`
5. `delta.tool_calls` 非空 → 按 `tc_delta.index` 聚合
   - **Ollama 防御**：如果 `delta_id` 非空且与 `_last_id_at_idx[raw_idx]` 不同 → 分配 `new_slot`
   - 累加 `function.name` / `function.arguments` 字符串
   - 优先 `tc_delta.extra_content`，fallback `model_extra["extra_content"]`
   - 拿到完整 name 且没发过 `tool_call.start` → yield `LLMStreamChunk(kind="tool_call.start", tool_name=..., tool_call_id=..., index=idx)`
   - arguments 有增量 → yield `LLMStreamChunk(kind="tool_call.arguments.delta", delta=..., index=idx)`
6. 流读完：
   - 对每个 tool_call 的 arguments 跑 `json.loads` 校验，任一 fail → `effective_finish_reason = "length"`
   - 按 `sorted(tool_calls_acc)` 顺序产出 `LLMStreamChunk(kind="tool_call.end", index=idx, ...)`
   - 拼 `Message.assistant(content=full_content, tool_calls=...)`
   - yield 终态 `LLMStreamChunk(kind="message.done", message=..., finish_reason=..., usage=..., provider_metadata=...)`

**关键防御**（Hermes 没显式写但 kongming 要补）：

- SSE 行缓冲需要处理 `data: [DONE]` 哨兵
- `chunk.choices[0]` 可能为空 dict（某些本地模型会送空心跳）
- `tc_delta.index` 可能为 `None`（用 `tc_delta.index or 0`，对齐 Hermes 4800）
- `delta.reasoning_content` 和 `delta.reasoning` 偶尔**同时存在**（某些兼容实现会同时塞）→ 只取 `reasoning_content`，避免双倍累积

### 5. Anthropic Messages SSE parser（独立文件）

新建 `executors/llm/anthropic_stream_parser.py`。Anthropic 与 OpenAI 共享同一个 `sse_reader`，但 `sse_reader` 返回 `(event_name: str | None, data: dict)` 二元组——OpenAI parser 丢掉 `event_name`（它的 SSE 只发 `data:` 行、不带 `event:` 声明），Anthropic parser 两项都要用（因为 Anthropic 的 block 类型 / message 生命周期依赖 `event:` 行）：

| SSE 事件 | 语义 | 映射到 `LLMStreamChunk` |
|---|---|---|
| `message_start` | 流开始，含 model / usage 骨架 | 记录到 state，不 yield |
| `content_block_start`（type=text） | 正文 block 开始 | 不 yield，记录 index |
| `content_block_start`（type=thinking） | reasoning block 开始 | 不 yield |
| `content_block_start`（type=tool_use） | tool_call 开始，含 id / name | yield `tool_call.start` |
| `content_block_delta`（type=text_delta） | 正文增量 | yield `content.delta` |
| `content_block_delta`（type=thinking_delta） | reasoning 增量 | yield `reasoning.delta` |
| `content_block_delta`（type=input_json_delta） | tool_call arguments 增量 | yield `tool_call.arguments.delta` |
| `content_block_stop` | block 结束 | tool_call block 触发 `tool_call.end` |
| `message_delta` | 带 `stop_reason` / `usage.output_tokens` | 更新 state |
| `message_stop` | 流结束 | yield 终态 `message.done` |

不与 OpenAI parser 共用 handler 的原因：

- 事件名 / 数据 schema 完全不同（OpenAI 是 `delta.xxx`，Anthropic 是独立 SSE 事件）
- 共用 handler 会把两种状态机揉一起，调试噩梦（other/openai 源码的 `thinking_blocks` 兼容段正是这种"混着写"最脏的段落）
- **两个 parser 共享同一个 `LLMStreamChunk` 输出契约**，后续 runner / sink 完全无感

### 6. Runner 最小改动（保"唯一 run loop"约束）

`core/runner.py::_drive_turns` 在 `response = await self._safe_llm_complete(llm, llm_request)` 这一跳做分支：

```python
if self._stream_enabled and isinstance(llm, SupportsLLMStream):
    response = await self._consume_stream(llm, llm_request, state)
else:
    response = await self._safe_llm_complete(llm, llm_request)
```

`_consume_stream(llm, req, state)` 的语义：

- 启动计时
- 维护 turn 级状态：`tool_call_seen: bool = False`、`chunk_count: int = 0`
- `async for chunk in llm.stream(req):`
  - `chunk_count += 1`
  - 首次非空 chunk → emit `Event(kind="llm.chunk.first", payload={"elapsed_ms": ..., "model": ...})`
  - `kind="content.delta"`：
    - **若 `tool_call_seen` 且 `cfg.stream.suppress_content_after_tool_call`** → 不 emit（suppression 在 runner 内完成）
    - 否则 → emit `Event(kind="content.delta", payload={"delta": ..., "index": ...})`
  - `kind="reasoning.delta"` → emit `Event(kind="reasoning.delta", payload={"delta": ...})`
  - `kind="tool_call.start"` → 设置 `tool_call_seen = True`；**不 emit 为 EventSink 事件**（EventKind 里没有对应条目；runner 仅用此 kind 翻转内部 flag）。真正的 `"tool.call.start"` 事件仍由既有的 `_execute_tool_calls` 路径在 approval 之前 emit，语义与非流式一致
  - `kind="tool_call.arguments.delta"` / `"tool_call.end"` → 仅用于 runner 内部累积断言（debug log 可选），不 emit 到 sink
  - `kind="message.done"` → 退出循环，构造等价 `LLMResponse`：
    ```python
    return LLMResponse(
        message=chunk.message,
        finish_reason=chunk.finish_reason,
        usage=chunk.usage,
        provider_metadata=chunk.provider_metadata,
        raw=None,
    )
    ```
- emit `Event(kind="llm.stream.end", payload={"chunk_count": ..., "finish_reason": ..., "content_chars": ..., "reasoning_chars": ..., "tool_call_count": ..., "truncated_args": ...})`

**关键保证**：

1. `_consume_stream` 返回的 `LLMResponse` 与非流式等价，后续 `session.append(assistant_message)` / tool_call 回填 / approval 链路**一行代码都不改**
2. EventKind 枚举**只**新增 4 个值（`content.delta` / `reasoning.delta` / `llm.chunk.first` / `llm.stream.end`）；`tool_call.start/arguments.delta/end` 只是 parser 产出的 `LLMStreamChunk.kind`，**不**映射为 `EventKind`。这是"唯一 run loop"+"事件只走 EventSink"两条约束下的最小扩面
3. suppression 的唯一决策点在 runner。CLIStreamSink 只收 emit 出来的 delta 事件——所以"见到 tool_call 后停止看到 content.delta"是由 runner 不 emit 做到，不是 sink 主动过滤

### 7. tool_call + approval 交互（最关键的设计决策）

**问题**：流式下模型可能流到一半出 tool_call，此时要不要"流中暂停" → approval → 续流？

**答案**：不要。原因：

- 大多数 OpenAI-compatible / Anthropic provider 不支持"流中断 → 续流"语义，只能重发
- 即使 OpenAI 官方 stream 也是在流完整个 message（含 tool_call 完整累加）后一次性给 `finish_reason="tool_calls"`
- Hermes 和 other/openai 都是这个策略

**落地**：

- Runner 仍按现路径：流式 provider 在 `message.done` 时把完整 Message（含所有 tool_calls 的完整 arguments）一次性交给 runner
- runner 照常走 `_execute_tool_calls` → `approval.decide` → `tool.execute` 链路
- 流式阶段对 CLI 的可见变化：runner 在见到 `LLMStreamChunk(kind="tool_call.start")` 之后，**不再 emit 新的 `content.delta` 事件**（由 `cfg.stream.suppress_content_after_tool_call` 控制，默认 True）。这意味着 CLIStreamSink 也看不到这些被压制的 content delta——suppression 的唯一执行点是 runner。

**副作用**：如果模型在流中先说"我来用 read_file 工具..."这段引导文字（即 content.delta 先到，之后才来 tool_call.start），用户在流式下仍会看到这前半段——因为 runner 只压"tool_call 出现之后"的内容，不回退已 emit 的 delta。这是"流式更啰嗦"的天然代价，与 Hermes `run_agent.py:4775-4795` 的 `if not tool_calls_acc: _fire_stream_delta()` 分支同一量级的妥协。V1 不做"回退已打字符"（需要终端 `\r` + clear-line 支持），V2 再评估。

### 8. 配置与开关

`stream` 是**顶层配置节**，挂在 `Config` 下而非 `ModelConfig` 下。三个字段分属不同职责层：

- `stream.enabled` / `stream.read_timeout` 是 runtime/provider 层的开关
- `stream.suppress_content_after_tool_call` 控制 runner 在流式下的 emit 策略
- `stream.trace.delta_sampling` 控制 trace sink 对 delta 事件的落盘策略

```yaml
stream:
  enabled: false                        # 默认关，渐进启用
  read_timeout: 120.0                   # 流式读超时（秒）。本地 endpoint 自动上调至 model.timeout
  suppress_content_after_tool_call: true  # runner 在见到 tool_call.start 后是否停止 emit content.delta
  trace:
    delta_sampling: none                # none/periodic/full；JsonlTraceSink 对 delta 事件的落盘策略
    periodic_batch_size: 20             # delta_sampling=periodic 时每批合并多少条
```

**归属原因**：`delta_sampling` 属于 trace sink、`suppress_content_after_tool_call` 属于 runner emit 策略、`enabled` / `read_timeout` 属于 provider——它们跨 observability / host / runtime，不属于"模型连接"（ModelConfig 的职责域）。

env 覆盖：

- `KONGMING_STREAM_ENABLED=1` → `stream.enabled`
- `KONGMING_STREAM_READ_TIMEOUT=...` → `stream.read_timeout`
- `KONGMING_STREAM_SUPPRESS_CONTENT_AFTER_TOOL_CALL=0` → `stream.suppress_content_after_tool_call`
- `KONGMING_STREAM_DELTA_SAMPLING=periodic` → `stream.trace.delta_sampling`
- `KONGMING_STREAM_PERIODIC_BATCH_SIZE=50` → `stream.trace.periodic_batch_size`

## 验证原则

V1 交付后必须能回答：

1. **等价性**：相同 LLMRequest 在 stream=True / False 两种模式下，`Result.final_message` / `session.history()` / emit 的非 delta 事件**完全等价**（契约测试）
2. **TTFT**：`llm.chunk.first` 事件距离 `llm.request` < 500ms（本地 GLM 实测）
3. **Ollama 兼容**：mock 一组 "index=0 被两个不同 id 复用" 的 chunk 流，parser 能正确分 slot（契约测试覆盖 Hermes `_last_id_at_idx` 逻辑）
4. **reasoning 多字段**：stub 响应分别用 `reasoning_content` / `reasoning` / `reasoning_details[*]` 三种格式，parser 都能抽出（契约测试）
5. **arguments 截断**：模拟 tool_call arguments 流到一半中断，`message.done` 的 `finish_reason == "length"`（契约测试）
6. **trace 不膨胀**：默认 `delta_sampling=none` 时，一次流式调用的 trace.jsonl 行数与非流式**不超过 +3**（`llm.chunk.first` + `llm.stream.end` + 可能的 content finish 汇总）
7. **approval 不破**：tool_call 流式场景下，approval.decide 仍然拿到完整 arguments，执行链路与非流式一致

## 与 llm-provider-v0.2 其他模块的关系

- **依赖**：强烈建议 A（provider_metadata）+ D（httpx 连接复用）先完成
  - A 已落地，流式也要透传 `provider_metadata`
  - D 未做：流式的 TTFT 优化会被 TLS 握手抵消（每次 stream 新建 client = 100-300ms 花在握手）。**本 spec 强烈建议 D 作为 F 的前置完成**，README 里第 104 行已经提过
- **独立**：与 B（reasoning effort）/ C（tools schema 压缩）/ E（tools 动态筛选）无直接依赖

## 风险与决策

1. **Protocol 形状变更** —— 这是 llm-provider-v0.2 六个模块里唯一一个。风险缓解：不改 `LLMProvider` 主 Protocol 形状；**新增** `SupportsLLMStream` 独立 Protocol 表达流式能力；runner 用 `isinstance` 探测能力并回退 `complete()` 非流式路径。所有现有 e2e / 测试 stub 不需要改——它们结构上不具备 `stream()`，自然不会被 isinstance 命中。
2. **Anthropic parser 必须独立** —— 不要妄想"一个 handler 通吃"。other/openai 源码里混写 thinking_blocks 的段落就是前车之鉴。
3. **Ollama index 复用** —— 必须一并移植 Hermes 的 `_last_id_at_idx` 防御，否则本地并行 tool_call 会错乱。契约测试必须覆盖。
4. **trace 膨胀** —— delta 事件不能全量落盘。默认 `delta_sampling=none`，只有调试场景才开 full。
5. **httpx SSE 行缓冲** —— httpx 本身没内置 SSE 解析器。V1 选项：
   - **方案 A**：加 `httpx-sse` 依赖（官方维护，30 行 API）
   - **方案 B**：自写 30 行行缓冲 + `data: ` 前缀解析 + `[DONE]` 哨兵
   - **V1 建议方案 B**：零新依赖，代码量可控，便于自定义（例如处理 GLM 某些 chunk 缺 `\n\n` 分隔的兼容问题）

## 当前建议

1. 先完成 llm-provider-v0.2 README 推荐的 D（httpx 连接复用），避免 TTFT 指标被 TLS 握手污染
2. 然后按 [`./02-module-breakdown.md`](./02-module-breakdown.md) 的 5 个模块顺序推进
3. 第一批 task 只覆盖 OpenAI-compatible 流式（模块 A + B + D + E），Anthropic 流式（模块 C）作为独立 task 跟进
4. 本方案完成后，再进入 `x-req` / `x-plan` / `x-dev`
