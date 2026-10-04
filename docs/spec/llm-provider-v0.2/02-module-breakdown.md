# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 优先级 |
|---|---|---|---|---|
| A · provider_metadata | 把 provider 返回的厂商扩展字段透传到 LLMResponse → event → trace | 无 | 方案确认 | P0 |
| B · reasoning 等级 | 让 user 控制 reasoning_effort / thinking 深度 | A（数据反馈） | 方案确认 | P1 |
| C · tools schema 压缩 | 删除 tools schema 里的冗余 description 等 | A（量化） | 方案确认 | P1 |
| D · httpx client 复用 | provider 级单例 AsyncClient + 生命周期管理 | 无 | 方案确认 | P1 |
| E · tools 动态筛选 | 按用户 intent 筛选要发的 tools schema | C（schema 已压缩后再看动态） | 探索中 | P2 |
| F · 流式响应 + TTFT | request `stream:true` + chunk 回填 + CLI 流式渲染 | 无直接，但架构影响大 | 探索中 | P3 |

---

## 模块 A

**模块名**：provider_metadata 接入（可观测性基础）

**职责**：把 LLM provider 返回的厂商扩展字段系统性地收集起来，存到 `LLMResponse.provider_metadata`，runner emit `llm.response` 事件时透传给 trace。让后续任何成本/性能/行为分析都有原始数据。

**包含范围**：

- `core/contracts.py` 的 `LLMResponse` 增加 `provider_metadata: dict[str, Any]` 字段
- `openai_responses.py` 的 `_parse_response` 把以下字段提进 metadata：
  - `reasoning_content`（choices[0].message）
  - `reasoning_tokens`（usage.completion_tokens_details）
  - `cached_tokens`(usage.prompt_tokens_details)
  - `request_id` / `id`
  - `model`（服务端回显，可能和请求不同）
  - `system_fingerprint`（如有）
- `anthropic_messages.py` 对应字段（Anthropic 有 `stop_reason` / `cache_creation_input_tokens` / `cache_read_input_tokens` 等）
- `core/runner.py::_drive_turns` emit `llm.response` 事件时把 metadata 平铺进 payload
- 更新 6 个相关测试（`test_core_runner_basic.py` / `test_native_runtime.py` / `test_trace_sink.py` 等）断言字段能被传递

**不包含范围**：

- 不做任何 metadata 的业务解读（不判断 reasoning_content 是否合理，只是如实透传）
- 不做账单倒推（tokens → cost 映射留给后续业务层）
- 不改 raw_dump（它已经是完整 dump，不走 metadata 链路）

**依赖**：无

**风险与讨论点**：

- `provider_metadata` 作为开放 dict 而不是强类型，短期灵活（支持任何 provider 特定字段），但长期对类型安全不友好 → 决定：v0.2 先用 dict；v0.3+ 如果字段稳定再考虑 TypedDict
- `reasoning_content` 可能很长（单次 415 tokens 已经很大，复杂对话可能几 KB），全量塞进 event.payload 会让 trace.jsonl 膨胀 → 决定：event payload 里 reasoning_content 按前 500 字符截断 + 总长度；完整内容只在 raw_dump 里有
- Anthropic 字段名和 OpenAI 不同（stop_reason vs finish_reason），但 `provider_metadata` 里保留原始字段名（不强行归一化），让 downstream 自己判断

**task 建议**：

- task 名：`llm-provider-metadata`
- 是否进入 x-req：**是，立即**
- 原因：所有其他模块的 ROI 都要靠这个数据来衡量

---

## 模块 B

**模块名**：reasoning 等级控制

**职责**：让用户通过配置或 LLMRequest 控制模型思考深度，避免简单对话被默认 "deep thinking" 吃掉 10x reasoning tokens。

**包含范围**：

- `config_loader.models.ModelConfig` 增加 `reasoning_effort: Literal["low", "medium", "high"] | None` 字段（默认 None，不发）
- `LLMRequest.metadata` 约定一个键 `reasoning_effort` 作 per-call 覆盖
- `openai_responses._build_payload` 根据 provider 类型把字段映射成各自特定参数：
  - OpenAI o1 系：`reasoning_effort`
  - 智谱 GLM-Z / 5.1：`thinking: {type: "enabled"|"disabled", depth}`
  - 其他兼容 provider：skip 不发（保持兼容）
- 加一套 provider capability 声明（比如常量 `PROVIDERS_SUPPORTING_REASONING_EFFORT`）避免给不支持的 provider 乱发字段导致 400

**不包含范围**：

- 不做自动决策（"简单对话就用 low"）—— v0.2 只提供开关，智能决策留给 v0.3+
- 不动 runner / session_engine（只在 provider 层消费）

**依赖**：模块 A（需要 reasoning_tokens 指标验证开关真的生效）

**风险与讨论点**：

- 厂商参数名不统一（`reasoning_effort` vs `thinking` vs `enable_cot`），要么按 provider 各自映射要么统一个内部枚举 → 选后者：对外一个 `reasoning_effort` 枚举，内部 `_build_payload` 各自映射
- 本地模型（LM Studio / Ollama）通常不支持，发了会 400 → provider 初始化时查询一次 / 用静态白名单 → 选后者（静态白名单在 provider 子类声明）

**task 建议**：

- task 名：`reasoning-effort-control`
- 是否进入 x-req：是（A 完成后）
- 原因：独立可量化收益；改动面仅 2 个文件（models + openai_responses）

---

## 模块 C

**模块名**：tools schema 压缩

**职责**：减少每轮 prompt 里 tools schema 占用的 tokens。当前 4 个内建 tool 的 schema ~500 tokens 是 prompt 的 95%+，压缩后期望 250 tokens 以内。

**包含范围**：

- 审视 `tools/file_tools.py` / `shell_tool.py` 里的 `input_schema` 常量，识别冗余
- 制定压缩规则：
  - `description` 保留主句，去掉 "（v1-mini...）" 之类内部注释
  - `properties.*.description` 对常见参数（path / content / timeout）可省略
  - 保留 `required` 列表（模型依赖这个判断必填）
- 给每个 tool 写一条 "压缩前 vs 压缩后" 的 e2e，通过 stub 响应验证模型还能调用（不回归）
- `LLMRequest.tools` 传到 `_build_payload` 的 schema 转换前，**不在** provider 层二次压缩 —— 压缩逻辑放在 tool 定义本身

**不包含范围**：

- 不动 ToolRegistry 接口
- 不改模型如何看 tool_call response 的逻辑

**依赖**：模块 A（要用 `prompt_tokens_details.cached_tokens` / `prompt_tokens` 量化节省）

**风险与讨论点**：

- 压缩过度可能让模型调工具错误率上升（边界参数没 description 就乱传）→ 只压缩"显然冗余"的，边界参数保留 description
- 压缩后和模型 caching 的关系：cache 是前缀匹配，压缩改了前缀会让 cache 失效一次 → 一次性 ship，不要反复改

**task 建议**：

- task 名：`tools-schema-compaction`
- 是否进入 x-req：是（A 完成后）
- 原因：可量化、低风险、改动集中

---

## 模块 D

**模块名**：httpx client 复用

**职责**：让 provider 复用 TLS 连接，省掉每次 `_do_complete` 重新握手的 100-300ms。

**包含范围**：

- `OpenAIResponsesProvider` 改成持有 `self._client: httpx.AsyncClient | None`
- 新增 `_ensure_client()` 方法：首次调用时构造带 `httpx.Limits(max_keepalive_connections=5, keepalive_expiry=30.0)` 的 client
- 新增 `async def aclose()` 方法（显式关闭）
- `SessionEngine` 需要在生命周期结束时关 client → 加 `async def aclose()`，内部调 `llm.aclose()`
- `SessionBridge.run_loop()` 结束 / `cli/main.py` 的 `_run` finally 分支调 runtime.aclose()
- `AnthropicMessagesProvider` 也做同样改造（保持两个 provider 接口一致）
- 补测试：同一 provider 实例连续两次 `_do_complete`，确认没有重新握手（用 `monkeypatch` 统计 `httpx.AsyncClient` 构造次数）

**不包含范围**：

- 不做连接池 tuning（max_connections / keepalive_expiry 用默认保守值）
- 不做 HTTP/2（httpx 需要额外 `http2=True` + h2 依赖，不值得）

**依赖**：无

**风险与讨论点**：

- 长时间 idle 后服务端可能主动断连，下次请求要处理重连 → httpx 自己会 retry，测试覆盖掉
- 测试环境的 `httpx.AsyncClient` mock 逻辑要更新 → 可能需要改既有 stub 模式（但概率不大，既有 test 都走 stub_llm 绕开）
- `aclose()` 链路穿透 runtime → provider：如果忘记 close 会有 asyncio "unclosed client" 警告 → 必须有 finally 兜底

**task 建议**：

- task 名：`httpx-client-reuse`
- 是否进入 x-req：是（A 之外最独立的一项，可以并行）
- 原因：性能收益立等可见；改动局部但影响两个 provider + runtime + cli 四层

---

## 模块 E

**模块名**：tools 动态筛选

**职责**：根据用户当前 message 内容，智能决定本轮只发哪些 tools schema。例如用户说"看看这个文件"只发 `read_file` / `list_dir`。

**包含范围（初版）**：

- 简单规则引擎：
  - 关键词匹配：message 里有 "文件/file/读/read/看" → 发 file tools；有 "命令/run/执行" → 发 shell tools
  - 兜底：无匹配全发（保持向后兼容）
- 可配置开关 `cfg.tool.dynamic_selection: bool`，默认 false（保守）
- 可在 LLMRequest.metadata 里传 `tool_hint: list[str]` override 规则
- 完整 e2e 验证：不同 prompt 下 stub_llm 收到的 tools 数量不同

**不包含范围（留 v0.3+）**：

- LLM-based 的意图识别（让一个便宜小模型先判断）
- 多轮对话里的"本轮已用过 X，本轮继续用 X"的状态追踪
- RAG 风格的 tool vector search

**依赖**：模块 C 完成后再做

**风险与讨论点**：

- 规则引擎必然有漏判（用户自然语言无穷）→ 必须有"全发"兜底 + 监控"本该触发 tool 但没发 schema"的情况
- **这个模块的价值比 C/D 小**：如果 C 已经把 schema 压到 250 tokens，E 再省 30% 也只有几十 tokens 绝对值 → 本方案把 E 排到 P2 就是这个原因
- 有可能做了 E 发现 ROI 低于维护成本而回退 → 要做就要接受"随时下线"的可能

**task 建议**：

- task 名：`tools-dynamic-selection`
- 是否进入 x-req：**否**，先让 C 跑 2 周实际数据看绝对值值不值
- 原因：依赖前置 + ROI 待验证

---

## 模块 F

**模块名**：流式响应 + TTFT

**职责**：支持 `stream: true`，让用户体感"打字机效果"；同时给 observability 加 `llm.chunk.first` 事件准确测 TTFT。

### 为什么"只加一个 stream=True 参数"不成立

直觉上流式 = 请求多一个 bool。实际上这是**数据流从"点到点"改成"点到流"**的范式转换，涉及 11 个层：

| # | 层 | 改动 |
|---|---|---|
| 1 | `core.contracts.LLMProvider` Protocol | 加 `stream_complete(req) -> AsyncIterator[LLMChunk]` 方法；不动既有 `complete()` 保持向后兼容 |
| 2 | `core.contracts` 数据类 | 新增 `LLMChunk` 类（含 delta content / delta tool_calls / usage / finish_reason） |
| 3 | 两个 provider | `OpenAIResponsesProvider` + `AnthropicMessagesProvider` 都要实现 `stream_complete`；OpenAI 的 SSE 格式和 Anthropic 的格式不同，各自解析 |
| 4 | `core.runner._drive_turns` | 改成 `async for chunk in llm.stream_complete(req)`，累加 delta 拼完整 message；**tool_calls 的 delta 按 index 累加 arguments 字符串**（OpenAI 规范特殊） |
| 5 | `host.HostAdapter` | 加 `async def write_output_chunk(text: str)` 接口；老的 `write_output` 保留兜底 |
| 6 | `host.CLIAdapter` | stdout 不换行 + flush 实现打字机效果；Ctrl-C 在流中要能中断 |
| 7 | `host.SessionBridge.run_once` | 决定"把 chunk 还是完整 message 发给 adapter" —— 答案是两条都要（chunk → UI，完整 message → session.append） |
| 8 | Approval 链路对齐 | 流式下 tool_call 发到一半时能 approval 吗？**不能**——大多数 provider 不支持"流中暂停续流"；落地方案：流完整个 assistant message（含 tool_calls 的完整累加）再进 approval。这破坏了"边流边看"的直觉但是架构上唯一可行 |
| 9 | `observability` event kind | 新增 `llm.chunk.first`（TTFT 信号）、`llm.stream.end`；**不 emit 每个 chunk**，否则 trace.jsonl 一轮就几百行。`JsonlTraceSink` 要考虑 batched flush 或降采样 |
| 10 | `raw_dump` 兼容 | 当前 dump 在 `response.json()` 后触发；流式没有一次性 json，要在累加完后再 dump，且要决定是否 dump 原始 SSE 字节流 |
| 11 | 测试基础设施 | `tests/e2e/conftest.py` 的 `StubLLMProvider` 只能 yield 完整 response；新增 `StubLLMStreamProvider` 能 yield chunks 序列；所有既有 e2e 要加 stream/non-stream **契约对等性**测试（相同输入两种模式结果 equivalent） |

### 额外隐式改动

- `LLMRequest.stream: bool = False`（最表面那个）
- 错误处理：非流式是 httpx.post 一次成败；流式连接建立后中途断开 → 部分拿到的 chunks 算不算？重试策略完全不同
- `config_loader.models`：加 `model.stream: bool` 配置项 + 环境变量白名单
- 文档：README "如何使用" 段要加流式说明

### 为什么不能和 A/B/C/D/E 混做

F **唯一涉及 Protocol 形状变更**。其他 5 个模块都只是在**现有 Protocol 之下**调整实现细节。Protocol 变了意味着：

1. 两个 provider 都得同时支持流/非流两条路径 —— 修 bug 时要两路并行查
2. Test 矩阵翻倍（每个 e2e 都要跑 stream + non-stream）
3. Review 心智负担暴涨——review 一个 "加开关" 的改动，实际要验证 11 个层的状态机迁移是否正确

### 真实改动面预估

- 源码：~8-10 个文件，新增 ~400 行、修改 ~150 行
- 测试：~6-8 个新 test 文件，既有 e2e 扩展 stream 版本
- 合并 diff 体积 ~1500 行 → **单 task review 天花板**

### 包含范围（交给后续独立 x-spec 正式规划）

下面是"大致涉及面"，真正细节留给 F 自己的 x-spec 迭代：

- `LLMRequest` / `LLMResponse` / 新 `LLMChunk` 数据类
- `openai_responses._do_complete` 拆成 stream / non-stream 两路
- `runner._drive_turns` 消费流式
- `host.HostAdapter` 加 `write_output_chunk(text)` 接口
- `cli.repl` + `CLIAdapter` 支持流式 stdout
- 新 event kind：`llm.chunk.first`、`llm.stream.end`
- trace sink 批量 flush 策略

**不包含范围**：

- 不做 tool_calls 流式（OpenAI 的 tool_call 流式格式复杂，非流式即可）
- 不改 session 存储（仍然存完整 message，不存 chunk 历史）

**依赖**：无直接依赖，但 A/D 最好先落地（A 让 metadata 链路先稳；D 让连接层稳定不拖累流式）

**风险与讨论点**：

- **这是本方案里唯一涉及 Protocol 改动的模块**，要特别小心对 anthropic provider 的影响
- 流式 + tool_call + approval 链路交互复杂：模型发流开始 → 判断要调 tool → 流停住 → approval → 执行 → 续流？实测发现大多数 provider 不支持"流中暂停续流"，需要改成"发完 tool_call 再 approval"
- 体感收益巨大（非流式 1s 首字 vs 流式 200ms 首字），但实施风险也最大
- 必须做 contract tests：stream 和 non-stream 两种模式下 session history / trace 事件 / final Result 等价

**task 建议**：

- task 名：`llm-streaming`
- 是否进入 x-req：**否**，等 A-E 全部落地后再正式立项
- 原因：架构改动 + 风险最大 + 收益最慢兑现（要改 CLI adapter 才能真正体感）
