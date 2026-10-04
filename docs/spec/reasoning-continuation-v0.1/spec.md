> spec_version: 3
> adversarial_risk_version: 3
> complexity: 5
> importance: 4
> risk_average: 4.5
> review_budget: full
> adversarial_review: complete

# reasoning-continuation-v0.1

## 任务目标

- 为 `generic_chat` 建立一等的 `ReasoningContinuationState` 合同，使 reasoning-enabled 模型产生 tool call 后，后续同模型 LLM 请求携带 provider 要求的完整续推状态。
- OpenAI-compatible 与 Anthropic-compatible provider 都把当前模型真实返回的 replay envelope 完整、有序、未修改地送回同一模型；encoder 校验 wire format，Runner 以 `state.model == request.model` 决定 state 的发送投影。
- `Message`、FileSession JSONL 与 FileSession checkpoint 在一次工具循环内保持续推状态完整；旧 FileSession payload 缺少该字段时继续按 `None` 读取。
- Kongming 内部统一使用 `Message(role="assistant", tool_calls, reasoning_state)` 与后续 `Message(role="tool", tool_call_id, ...)` 表达 reasoning 工具循环；provider adapter 只在 HTTP 边界编码厂商 message shape。
- provider 在 tool side effect 发生前完成续推状态的存在性、格式和 tool-call 一致性校验；严格失败形成稳定错误与零工具执行证据。
- Context compaction 以摘要和近期真实 user 消息替换 active context；summary 请求与成功 checkpoint replacement 均删除全部 `reasoning_state`，下一次普通请求不重放压缩前的 opaque state。
- trace、prompt-debug 与 Web history 只输出状态格式、模型、长度、条目数和摘要哈希；provider-native payload 仅进入 session 持久化与实际 LLM 请求。

## 非目标

- 跨真实 User Turn 的 provider/preset 来源坐标持久化进入后续规格；v0.1 只以 `ReasoningContinuationState.model` 与 `ReasoningStateFormat` 决定发送投影。
- OpenAI Responses API 的 reasoning items、`previous_response_id` 与 `encrypted_content` 进入独立 provider 规格；当前 `OpenAIResponsesProvider` 继续使用 `/chat/completions`。
- Gemini 原生 `thoughtSignature`、Kimi、Qwen 新 catalog preset 与对应 provider adapter 进入后续规格。
- Claude Code 与 Codex transport 保持各自 SDK/CLI session 语义；本规格只覆盖 `generic_chat`。
- reasoning 文本的 UI 展示策略、`reasoning.delta` 样式和 top-level `reasoning_content` 可读副本保持既有合同。
- provider 原始响应 dump 保持现有开发期诊断职责；本规格不把 raw dump 作为续推状态真源。
- 本规格不重命名现有 provider 类，不引入旧字段 shim，也不回填或改写历史 session 文件。
- provider adapter 禁止在协议之间翻译 reasoning state：`reasoning_content` 不转换为 `thinking`，`thinking.signature`、`redacted_thinking.data` 与 OpenAI `encrypted_content` 只接收并回放厂商原始返回值。
- SQLiteSession 与 InMemorySession 的 `reasoning_state` 持久化和等价往返不进入 v0.1 验收；本规格只验收 FileSession。

## 核心消息合同

Kongming 的语义真源保持一套 `Message` 序列。`ReasoningContinuationState` 是 assistant Message 的强类型可选字段，tool result 继续使用现有 tool Message；厂商 wire 对象不会进入 Runner、Session 或 compaction 的公共合同。

```python
class ReasoningStateFormat(StrEnum):
    OPENAI_CHAT_ASSISTANT = "openai_chat_assistant"
    ANTHROPIC_CONTENT_BLOCKS = "anthropic_content_blocks"


@dataclass(frozen=True)
class ReasoningContinuationState:
    format: ReasoningStateFormat
    model: str
    payload_json: str


# reasoning tool-loop 的内部顺序
Message(role="assistant", tool_calls=(...), reasoning_state=state)
Message(role="tool", tool_call_id="call_1", content="...", metadata={...})
```

`payload_json` 保存 provider 从真实响应提取的 canonical replay envelope。它允许完整保留签名、加密块和数组顺序，同时禁止 core 解析、猜测或合成 opaque 字段。Session serializer 直接往返 `reasoning_state`；Runner 先证明 `state.model` 等于当前请求模型，provider adapter 再根据 `state.format` 做以下边界编码：

| Kongming Message | OpenAI-compatible wire | Anthropic-compatible wire |
|---|---|---|
| assistant + `reasoning_state` + `tool_calls` | `role=assistant`，原样展开当前模型返回的 replay envelope | `role=assistant`，原样展开当前模型返回的有序 content blocks |
| tool result | `role=tool` + `tool_call_id` | `role=user` 的 `tool_result` block + `tool_use_id` |

Anthropic wire 中的 `role=user` 只表示该 API 的 tool-result transport 形态；Kongming Session 仍持久化 `role=tool`。任何 provider-specific 字段都来自当前模型的真实响应。

## 风险评分依据

- 模式：full。改动横跨核心消息合同、两类 provider 双向编解码、FileSession、Runner 工具副作用边界、ContextCompactionManager 与观测投影；预判 task risk 为 Q3，允许修改范围固定在这些模块及对应测试/文档，SQLiteSession、InMemorySession、Web wire、Claude Code、Codex transport 保持验收范围外。
- 剃刀检查：保留一个 frozen 状态对象、两个 wire format 枚举值、同模型来源门禁和模型兼容后缀固定四个必要概念，分别由 `J8`、`J3/J4`、`J21/J22/J23`、`J7` 与 `INV-01..13` 约束。provider/preset 来源坐标、原生 Responses、Gemini adapter、catalog provider 扩容和 provider rename 延后。
- 复杂度：5。该能力包含流式分片重组、opaque payload 完整持久化、跨 turn 投影、工具副作用前置门禁、checkpoint replacement 算法和超窗失败路径，命中核心算法与多阶段持久化一致性锚点。
- 重要性：4。所有 reasoning-enabled `generic_chat` 工具用户经过该链路；状态缺失会让第二次采样被 provider 拒绝，状态错配会让模型在工具已经执行后失去推理连续性。
- 预算升级：平均分 4.5 对应 `full`；复杂度 5 独立要求 `full`。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `core.message`、`core.contracts` | 目标/真源 | 新增 frozen `ReasoningContinuationState` 与 `ReasoningStateFormat(StrEnum)`；`Message.reasoning_state` 只挂在 reasoning-enabled assistant tool-call 消息 | 状态塞入 `metadata` 或 `provider_metadata` → 语义字段在组装/持久化时丢失 | `INV-01`：续推 payload 的唯一语义真源是 `Message.reasoning_state`；显示文本、metadata、raw dump 均不参与重放 | `J1`、`J2`、`J8` |
| `infrastructure.llm_providers.openai_*` | 目标 | 非流式与流式 parser 生成 OpenAI Chat assistant replay envelope；请求 encoder 对同模型状态做精确重放 | `reasoning_content` 被截断、flatten、拼入普通 content，或把 Responses items 塞入 Chat message → GLM 工具续写降质或请求失败 | `INV-02`：GLM envelope 只含官方示例确认的 `role/content/reasoning_content/tool_calls`，保持值和 tool-call 顺序；流式只允许 delta 聚合；Responses reasoning items 保持后续 adapter 边界 | `J3`、`J16`、`J20` |
| `infrastructure.llm_providers.anthropic_*` | 目标 | 非流式与流式 parser 保存完整有序 assistant content blocks；stream 消费 endpoint 实际返回的 opaque 数据；请求 encoder 原样重放整个 envelope | adapter 丢字段、重排 blocks 或跨模型发送 signature → endpoint 400 | `INV-03`：同一模型下一次请求的 assistant content 与其真实响应逐项深度相等；signature/data 按原值保留；adapter 不过滤 opaque block、不跨协议合成字段 | `J4`、`J17`、`J18`、`J19` |
| provider 响应校验 | 目标 | reasoning 已启用且响应含 tool calls 时，decoder 校验状态存在、格式合法、model 相同、normalized tool calls 与 replay envelope 一致 | 工具先执行、第二次采样才暴露状态错误 → 外部副作用已发生且 run 无法续写 | `INV-04`：状态校验先于 assistant append、approval 与 tool execute；失败时 tool 调用次数和 tool_result 数均为 0 | `J5`、`J10` |
| resolved model、`ResolvedReasoningPlan` | 上游/真源 | 一次 run 固定当前模型与 reasoning 开关；同模型的历史 state 可以进入后续 run 的发送投影 | 仅按 Anthropic/OpenAI 外层格式判定来源 → 不同模型互相收到无效签名 | `INV-13`：来源归属取 `state.model == request.model` 与 `state.format`；encoder 原样发送整个 envelope；模型变化时历史 state 从发送投影清除 | `J6`、`J13`、`J21`、`J23` |
| `FileSession` | 下游 | File JSONL message 与 checkpoint replacement 往返 `reasoning_state` | 当前 turn 第二次 `history()` / `context_snapshot()` 丢 state，或旧 File payload 解析失败 | `INV-05`：FileSession 对调用方提供的 Message/replacement 做完整往返；成功 context compaction 的 replacement 是显式 state-free 投影。缺字段旧记录稳定读取为 `None`；损坏 state 行按既有损坏记录策略处理 | `J2`、`J11` |
| `core.Runner`、`prompting.assembly` | 目标/上游 | 每次普通采样构造同模型投影：文字、tool calls 与 tool results 历史保持，`state.model` 等于请求模型的 state 原样重放；steer user 仍属于当前 run | 只按 wire format 判断来源 → 不同模型互相收到无效签名 | `INV-06`：同模型的历史 state 在后续 run 保留；模型变化时发送投影把历史 state 置为 `None`；同 run steer 保持 state | `J2`、`J9` |
| `ContextCompactionManager`、`FileSession` checkpoint | 目标 | TOOL_RESULT 压缩为 summary request 创建 state-free 发送投影；成功 replacement 仅含近期真实 user 消息与 summary，逐项删除 `reasoning_state` | opaque state 进入摘要请求或 checkpoint active context → 压缩后的下一请求错误重放旧 state | `INV-07`：summary request、checkpoint replacement 与重启后的 `context_snapshot()` 中全部 Message 的 `reasoning_state` 均为 `None`；checkpoint CAS 与 raw JSONL append-only 语义保持 | `J7`、`J14` |
| token estimator / context window | 下游 | 普通请求估算包含实际将发送的 replay envelope；压缩前的 state 体积参与触发判断，成功 replacement 重新估算 state-free 上下文 | 估算忽略 opaque state → 阈值晚触发并越过物理窗口 | `INV-08`：阈值判断使用 model-visible payload；大 state 单独跨阈值时进入压缩，成功 replacement 的后续请求没有 replay envelope | `J7`、`J12` |
| tool-call pairing / interrupt | 相关 | replay envelope 与 normalized Message 的每个 call id/name/arguments 一致；既有 cancel 占位结果语义保持 | state 内 tool call 与 Runner 执行对象分叉 → tool_result 回给错误 call | `INV-09`：执行与审批只读取 normalized `Message.tool_calls`；provider 在执行前证明 replay envelope 是同一组 calls；多 call 状态只重放一次 | `J10`、`J22` |
| reasoning config / model | 上游 | 同一模型跨 run 复用对应 state；模型切换产生新的发送投影 | 旧模型 signature/thinking block 进入新模型请求 → opaque 校验失败 | `INV-10`：state.model 必须等于下一次请求 model；切换模型时 Session 原记录保持，发送投影清除全部历史 `reasoning_state` | `J6`、`J13`、`J23` |
| trace、prompt debug、Web history | 下游/边界 | 为新增字段定义显式安全投影；Web history 继续生成既有 `NormalizedMessage` | dataclass/asdict 自动展开 opaque state → 隐藏 reasoning 或 signature 泄漏 | `INV-11`：事件、trace、prompt-debug、REST/WS payload 均不含 `payload_json` 及其可逆内容，只含 format/model/byte_length/item_count/sha256 | `J12` |
| 非 reasoning 与普通终态 | 相关 | reasoning disabled/unsupported 继续走 normalized Message 重建；无 tool calls 的终态 assistant 不保存语义 state | 新门禁扩大到普通模型 → 既有 Gemma/tool 路径失败或 session 膨胀 | `INV-12`：严格续推合同只作用于“本次请求已启用 reasoning 且响应含 tool calls”；终态 reasoning 继续走显示/审计路径 | `J6`、`J10` |

## 判断依据

> **现存缺陷标注**：`J3`、`J4` 中的“500 字符截断”“忽略 signature”“截断 reasoning metadata”只描述当前 HEAD 的改造起点，目标实现禁止复用这些行为。进入 `Message.reasoning_state`、Session 持久化或同模型普通 provider 请求的 reasoning state 必须完整、原序、未修改；UI/trace 只使用不可逆摘要元数据。Context compaction 形成独立的 state-free summary projection，并用它替换 active context。
>
> **必须移除的现存截断代码**：实现本规格时，以下两处 `[:500]` 截断必须删除——OpenAI 非流式 parser `src/infrastructure/llm_providers/openai_responses.py:482` 的 `reasoning_raw[:500]` 与 Anthropic 流式 parser `src/infrastructure/llm_providers/anthropic_stream_parser.py:432` 的 `full[:500]`；删除后保留完整原文。对照：OpenAI 流式 parser `openai_compat_stream_parser.py:347` 已于 session-jsonl-readable-v0.1 去掉该截断（保留完整 `full`），本规格对剩余两处执行同等修复，禁止保留任何形态的字符截断。

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | `Message.metadata` 的当前合同明确为“不参与语义”；续推状态需要独立强类型字段 | 仓库事实 | `src/core/message.py:33-68` 定义 Message 字段并声明 metadata 不参与语义，当前结构没有 reasoning state | 已确认 |
| J2 | Runner 每个 turn 从 `session.history()` / `context_snapshot()` 重新组装请求；assistant append 只把 reasoning 文本作为独立参数交给 session | 仓库事实 | `src/core/runner.py:998-1047,1145-1150`；`src/sessions/file_session.py:187-223,324-353` 显示 state 必须进入 Message 才能参与下一次组装 | 已确认 |
| J3 | **现存缺陷，目标实现禁止复用**：当前 OpenAI-compatible 请求构造器只序列化 content/tool_calls，四条 parser 路径的 reasoning 均不进入下一次请求；无法形成精确 replay envelope。其中非流式 parser 另把 reasoning 截断为 500 字符存入 provider_metadata，流式 parser 虽已去掉 500 截断、保留完整 reasoning 于 provider_metadata，但请求构造器仍不回传 | 仓库事实 | `src/infrastructure/llm_providers/base.py:209-265`（请求构造器不回传 reasoning）；`openai_responses.py:482`（非流式 `reasoning_raw[:500]`）；`openai_compat_stream_parser.py:347`（流式已去掉 `[:500]` 截断，注释标注 session-jsonl-readable-v0.1，但请求构造器仍不回传） | 已确认 |
| J4 | **现存缺陷，目标实现禁止复用**：当前 Anthropic 请求从 normalized Message 重建 text/tool_use；非流式 parser 忽略 thinking/redacted_thinking，流式 parser 忽略 signature_delta 并截断 reasoning metadata | 仓库事实 | `src/infrastructure/llm_providers/anthropic_messages.py:430-482,597-669`、`anthropic_stream_parser.py:267-291,405-433` | 已确认 |
| J5 | tool-use continuation 必须携带当前 endpoint 上一阶段返回、且该 endpoint 官方允许作为输入的 reasoning state；具体 message shape 由厂商协议决定 | 外部规范、用户任务 | 厂商逐项证据见“厂商协议证据矩阵”；用户明确要求禁止捏造 message 字段 | 已确认 |
| J6 | 当前正式 catalog 的 reasoning consumer 是 MiniMax/DeepSeek 的 Anthropic protocol 与 GLM 的 OpenAI protocol；Local Gemma 没有 reasoning capability | 仓库事实 | `config/model-providers.yaml:3-139`；`ProviderProtocol` 仅含 `OPENAI`、`ANTHROPIC` | 已确认 |
| J7 | 当前 TOOL_RESULT 压缩发生在完整工具批次落盘后、下一次模型请求前；现有 replacement 只保留近期 user 与 summary，天然不含 assistant `reasoning_state`；summary request 需要同样使用 state-free projection | 仓库事实、用户确认 | `src/core/runner.py:1200-1221`、`src/prompting/compaction/context_compaction_manager.py:210-320,410-433` | 已确认 |
| J8 | 最小核心合同使用 `ReasoningContinuationState(format, model, payload_json)`；`payload_json` 由 provider 直接从官方响应字段构造 canonical JSON replay envelope，保持 opaque 值与数组顺序且让 frozen dataclass 深层不可变 | LLM 推断、用户任务 | 当前 wire 全部为 JSON；字符串载体避免 `dict[str, Any]` 在 frozen 对象内继续可变。encoder 只能读取该 envelope，禁止从显示文本推演厂商字段 | 已确认 |
| J9 | 同模型跨 User Turn 保留 state；模型切换时清除 state 的发送投影；`RunState` 只负责当前 run 的 steer 时序 | 用户确认、仓库事实 | FileSession 保留完整历史；`Runner._drain_steer_buffer()` 会在同一 run 插入 user Message，state 归属取模型而非最后一条 user | 已确认 |
| J10 | provider 能根据当前 request 的 resolved reasoning payload判定严格合同；LLMResponse 返回 Runner 前完成校验，可保持零 tool side effect | 仓库事实、LLM 推断 | provider 的 `complete(request)` 同时拥有请求与完整响应；Runner 在 response 完整校验后才 append assistant、审批和执行工具（`src/core/runner.py:1120-1194`） | 已确认 |
| J11 | FileSession 的 message JSONL 与 checkpoint replacement 都通过 `_message_to_dict/_message_from_dict` 往返；新增可选字段可用缺失默认值读取旧 File 记录 | 仓库事实、用户任务 | `src/sessions/session_store.py:82-123`、`src/sessions/file_session.py:54-110,187-252,324-353`；用户确认 v0.1 只验收 FileSession | 已确认 |
| J12 | `LLMRequest.to_audit_dict()` 当前递归 dataclass 字段，新增 state 后会自动展开；prompt debug 与 Web history也各自投影 Message | 仓库事实 | `src/core/contracts/llm_provider.py:79-107`、`src/infrastructure/tracing/prompt_debug_dump.py:16-98`、`src/hosts/web/app_support/generic_history.py:15-121` | 已确认 |
| J13 | 当前 Runner 在一次 run 内固定 `AgentSpec.reasoning_effort`、resolved provider 与 model；工具 turn 之间复用同一 LLMProvider | 仓库事实 | `src/runtime_assembly/session_engine.py:401-576`、`src/core/runner.py:965-1047` | 已确认 |
| J14 | 本规格把 context-compaction-v0.2 的 replacement 合同收敛为 summary 接管压缩前会话上下文，opaque replay state 在压缩后的 active context 中删除 | 用户确认、仓库事实 | `docs/spec/context-compaction-v0.2/spec.md` 的 J13 让 summary 承载完整 tool batch；本规格把 provider-native state 排除在 summary request 与 replacement 之外 | 已确认 |
| J15 | 确定性测试需要穿过真实 provider encoder/parser、Runner、Tool 与 FileSession；GLM、MiniMax、DeepSeek 三个当前 provider 分别执行 credential-gated live E2E | 项目测试约束、LLM 推断 | MiniMax 与 DeepSeek 都走 Anthropic 外层协议；三条真实 API 链路共同证明同模型来源门禁与 A→A 原样回放成立 | 已确认 |
| J16 | GLM 官方工具示例把 `reasoning_content` 与 `content/tool_calls` 放在同一 `role=assistant` message，并要求历史 reasoning 完整、未修改、保持顺序；`clear_thinking=false` 控制跨 turn preserved thinking | 外部规范 | [GLM Thinking Mode](https://docs.z.ai/guides/capabilities/thinking-mode) 的 Interleaved/Preserved Thinking 与示例代码 | 已确认 |
| J17 | MiniMax-M3 的 Anthropic-compatible Function Call 必须把完整 `response.content` 作为 assistant message 加入历史；该列表含 thinking/text/tool_use 等返回 blocks，thinking blocks 原样回带 | 外部规范 | [MiniMax Anthropic SDK](https://platform.minimaxi.com/docs/api-reference/text-anthropic-api)“特别注意/Thinking 控制”；[MiniMax Messages API](https://platform.minimaxi.com/docs/api-reference/text-chat-anthropic) 给出 thinking+signature 响应结构 | 已确认 |
| J18 | DeepSeek 当前 Anthropic endpoint 官方支持 `thinking/text/tool_use/tool_result`，明确不支持 `redacted_thinking`；其 OpenAI endpoint 对带 tools 的请求要求完整回传 `reasoning_content`，缺失会 400 | 外部规范 | [DeepSeek Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api) compatibility table；[DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) Tool Calls | 已确认 |
| J19 | Claude 原生 Messages 工具循环要求完整、未修改地回传 assistant content；thinking signature 是 opaque 校验字段，redacted_thinking 同样保持 | 外部规范 | [Anthropic Thinking Tool Workflows](https://platform.claude.com/docs/en/build-with-claude/thinking-tool-workflows)；[Anthropic Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) | 已确认 |
| J20 | OpenAI 原生 reasoning continuity 属于 Responses API item 语义：使用 `previous_response_id`，或手工回放全部 output items；`store=false`/ZDR 回放 encrypted reasoning items | 外部规范 | [OpenAI Model Guidance](https://developers.openai.com/api/docs/guides/latest-model)“Persisted reasoning / Migration quickstart”；该能力保持 v0.1 非目标 | 已确认 |
| J21 | 字段级 allowlist 会把 opaque response envelope 变成框架维护的易漂移 schema；v0.1 采用同模型门禁 + format 校验 + 整体原样回放 | 用户任务、项目约束、LLM 推断 | 用户确认 A 模型签名只回 A 模型；AGENTS 约束 11 禁止 provider 自持 model 前缀白名单；MiniMax 官方要求完整回传 `response.content` | 已确认 |
| J22 | reasoning 工具循环的内部真源应由 framework-owned Message 序列表达；OpenAI 与 Anthropic 的 tool-result role/block 差异收敛在 provider encoder | 用户任务、外部规范、LLM 推断 | GLM 官方示例使用 `role=tool/tool_call_id`；Anthropic、MiniMax、DeepSeek 官方协议使用 `tool_result/tool_use_id` block。两类 wire 都能从 `Message(role="tool", tool_call_id, content)` 无损编码 | 已确认 |
| J23 | opaque reasoning/signature 在同模型的后续 run 内重放；切换模型时删除发送投影中的全部历史 state，Session 原记录继续保留 | 用户任务、仓库事实 | 用户确认不同模型的签名块无法互相验证；`ReasoningContinuationState.model` 是现有持久化合同中可用于投影的模型坐标 | 已确认 |

## 厂商协议证据矩阵

完整的跨厂商对照、endpoint/version 差异、原生载体与官方链接见执行器模块文档 `docs/modules/执行器/vendor-reasoning-protocols.md`（各厂商 Reasoning Continuation 协议要求）。本节只保留 v0.1 当前消费者及直接 adapter 边界。

| 当前消费者 | 当前项目协议 | 官方确认的返回/回传形态 | v0.1 允许发送的 reasoning state | 官方证据 |
|---|---|---|---|---|
| `bigmodel-glm5-1m`、`bigmodel-glm5` | OpenAI Chat-compatible | assistant message 同级字段 `content`、`reasoning_content`、`tool_calls`；工具结果使用 `role=tool` + `tool_call_id`；官方要求 interleaved/preserved reasoning 完整、未修改且有序 | 只从 GLM 响应聚合 `role/content/reasoning_content/tool_calls`；禁止增加 `thinking`、`signature`、`reasoning_details` | [GLM Thinking Mode](https://docs.z.ai/guides/capabilities/thinking-mode)、[GLM Chat Completion Reference](https://docs.z.ai/api-reference/llm/chat-completion) |
| `minimax-m3` | Anthropic-compatible Messages | 多轮 Function Call 把完整 `response.content` 作为 assistant message 回传；官方列举 thinking/text/tool_use blocks，并要求 thinking 原样保留；Anthropic-compatible response 示例含 `thinking.signature` | 完整回放 endpoint 实际返回且官方支持的 response content blocks；opaque 子字段逐值保留；禁止从文本生成 signature | [MiniMax Anthropic SDK](https://platform.minimaxi.com/docs/api-reference/text-anthropic-api)、[MiniMax Messages API](https://platform.minimaxi.com/docs/api-reference/text-chat-anthropic) |
| `deepseek`、`deepseek-pro` | Anthropic-compatible Messages | compatibility table 支持 `thinking`、`text`、`tool_use`、`tool_result`，明确不支持 `redacted_thinking`；官方 OpenAI-format Tool Calls 文档另行确认 reasoning 缺失会 400 | 回放 DeepSeek endpoint 实际返回的受支持 blocks；发送前拒绝 `redacted_thinking` 及其他官方标记 unsupported 的 block；禁止套用 Claude signature 必填规则 | [DeepSeek Anthropic API](https://api-docs.deepseek.com/guides/anthropic_api)、[DeepSeek Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode) |
| Claude 原生 Messages（通用 adapter 能力，当前内建 catalog 无 preset） | Anthropic Messages | tool use 期间完整、未修改地回传最后 assistant content；thinking 含 opaque signature；redacted_thinking 保持原块 | 完整回放官方 Messages content blocks；signature/data 只取响应原值 | [Anthropic Thinking Tool Workflows](https://platform.claude.com/docs/en/build-with-claude/thinking-tool-workflows)、[Anthropic Thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) |
| OpenAI 原生（后续规格） | Responses API | 使用 `previous_response_id` 续接 server-stored response；手工管理时重放全部 response output items；`store=false`/ZDR 使用 encrypted reasoning items | v0.1 不生成 Chat message 字段；后续 Responses adapter 按 item 原样回放 | [OpenAI Model Guidance](https://developers.openai.com/api/docs/guides/latest-model) |

矩阵用于确认各 endpoint 的真实响应形态和 E2E fixture。encoder 遇到错误 wire format 时在网络请求前返回 `reasoning_continuation_format_unsupported`；Runner 遇到来源 identity/model/tool-call 不一致时在工具副作用前返回 `reasoning_continuation_invalid`。合法 envelope 整体重放，框架不做字段级过滤。

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | `SC_01..SC_05`（response → state → session → next request）/ `SC_17`（真实内部链路） |
| 状态 | `SC_07..SC_10`、`SC_25`（FileSession、旧记录、同模型跨 run、steer、模型切换） |
| 时序 | `SC_06`（副作用前校验）/ `SC_11`（TOOL_RESULT compact → next LLM） |
| 资源 | `SC_13`（token 估算）；无新增长生命周期网络资源 |
| 不变量 | `影响边界与不变量` 的 `INV-01..INV-13` |
| 故障 | `SC_06`、`SC_14`、`SC_20` |

## 验收清单

### 单元测试

- [ ] OpenAI-compatible 非流式与流式响应分别生成完整 canonical replay envelope；下一请求深度比较 envelope 字段值与 tool-call 顺序。
- [ ] Anthropic-compatible 非流式与流式响应完整保留当前 endpoint 返回的 response blocks、opaque 子字段与顺序；MiniMax、DeepSeek 与 Claude fixture 都执行 A→A envelope 深度相等断言。
- [ ] 冲突哨兵同时设置显示 `reasoning_content=A` 与 semantic state `B`，实际 provider payload 读取 `B`。
- [ ] reasoning-enabled tool response 缺 state、state format 错误、model 错误或 tool call 投影冲突时，assistant append、approval、tool execute、tool_result 均为零。
- [ ] FileSession append/history、重新构造、checkpoint commit/context_snapshot 往返同一 state 等价；旧 File payload 缺字段读取为 `None`；损坏 state 走既有损坏记录策略。
- [ ] 同模型新 run 的请求发送投影保留历史 state；同 run steer 后仍保留当前 active tool-loop state。
- [ ] 模型发生切换时，Session 历史保持原 state，发给新模型的所有历史 Message 均为 `reasoning_state=None`。
- [ ] TOOL_RESULT compaction 的 summary request 使用 state-free 发送投影；成功 checkpoint replacement 只含近期真实 user 消息与 summary，逐条 `reasoning_state=None`。
- [ ] 重启 FileSession 后的 `context_snapshot()` 与下一次普通请求继续保持该 state-free replacement；原始 JSONL 历史保持 append-only。
- [ ] token estimator 用相同 messages 构造 `state=空` 与 `state=大 payload` 对抗值，后者单独跨过阈值并触发压缩；成功 replacement 的下一请求不带 replay envelope。
- [ ] request/response audit、trace、prompt-debug 与 Web history只出现 format/model/byte_length/item_count/sha256，全文搜索不到 sentinel payload。
- [ ] reasoning disabled 与无 reasoning capability 的 tool loop 保持既有 normalized Message 重建路径。
- [ ] 多个 tool calls 的 state 只重放一次，state tool calls、执行 calls 与 tool results 按 call id 一一配对。
- [ ] 同一普通 tool result 经 OpenAI 与 Anthropic encoder 后分别形成官方 `role=tool/tool_call_id` 与 `tool_result/tool_use_id` 形态，wire 中不存在猜测的 reasoning/signature 字段。
- [ ] 跨 wire-format fixture 分别把 Anthropic blocks 交给 OpenAI encoder、把 OpenAI assistant envelope 交给 Anthropic encoder；两条路径均在 HTTP 请求前返回稳定格式错误。
- [ ] OpenAI 非流式与 Anthropic 流式 parser 对长度 > 500 的 reasoning fixture 产出完整原文，`openai_responses.py:482` 与 `anthropic_stream_parser.py:432` 的 `[:500]` 截断已删除且不再回归（对应 `SC_23`）。

### Smoke 测试

- [ ] OpenAI-compatible 本地 fake transport 经真实 provider parser/encoder + Runner + FileSession + fake Tool 完成两次 LLM 请求，第二次请求含第一响应的完整 state，工具只执行一次。
- [ ] MiniMax 与 DeepSeek 两套 Anthropic-compatible fake transport 经真实 stream parser/encoder + Runner + FileSession + fake Tool 完成 tool loop；第二次请求的 assistant envelope 分别与各自第一次响应逐项深度相等。
- [ ] 启用极小 context window 后执行同一链路，真实 ContextCompactionManager 写 checkpoint；重启 FileSession 读取 checkpoint 后，replacement 与下一普通请求均不含 state。
- [ ] 流式响应在 message_stop 前中断（signature 未聚合完整）时不生成 state、不 append、不执行工具、不写 checkpoint，Session 不含 partial signature 记录（对应 `SC_24`）。

### E2E 测试

- 决策：需要
- 依据：厂商会严格校验 opaque signature/reasoning 字段，本地 fixture 能证明内部结构，真实 API 才能证明 provider wire 兼容性。
- [ ] credential-gated `bigmodel-glm5-1m`：真实工具调用至少进入第二次模型采样，第二次请求获成功响应，session 记录包含 OpenAI Chat state 摘要元数据且工具只执行一次。
- [ ] credential-gated `minimax-m3`：真实 thinking → tool_use → tool_result → thinking 链路成功，第二次采样无 signature/blocks 合同错误，session restart 后历史仍可读。
- [ ] credential-gated `deepseek-pro`：真实 Anthropic endpoint 完成 thinking → tool_use → tool_result → answer，第二次采样成功，出站 payload 不含 `redacted_thinking` 等 unsupported blocks。

## 测试驱动开发

1. `SC_01..SC_04` → 先写四个 provider parser/encoder RED 测试，分别覆盖 OpenAI/Anthropic 的 stream 与 non-stream。
2. `SC_05..SC_06` → 写冲突哨兵与副作用计数 RED 测试，证明语义真源和前置门禁。
3. `SC_07..SC_10`、`SC_25` → 写 FileSession round-trip、旧记录、同模型跨 run 投影、steer 与模型切换 RED 测试。
4. `SC_11..SC_13` → 写 summary state-free 投影、checkpoint replacement 删除 state、重启后无 state 与 token 差分 RED 测试。
5. `SC_14..SC_16`、`SC_21`、`SC_24` → 写观测隔离、普通路径、多 tool-call 配对、跨 wire-format 拒绝与流式断连不落盘 partial state 的 smoke RED 测试。
6. `SC_17` → 跑两类真实 provider adapter 的本地 deterministic smoke。
7. `SC_18`、`SC_19`、`SC_22` → 跑三个当前厂商的 credential-gated E2E；`SC_20..SC_21` → 最后复跑 corrupt-state 与 wrong-vendor-format failure smoke。
8. 实现满足测试的最小代码，重构后执行当前 task 全部 unit/smoke/e2e verify 块及静态/架构门禁。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | full | assumption:stream-partial-state-on-disconnect、assumption:compaction-state-projection | reasoning continuation state、tool-loop replay envelope、frozen dataclass payload_json、provider encoder format gate、signature opaque、context compaction state-free projection、model mismatch、Session serializer round-trip、pre-side-effect validation gate；Risk：tool-loop 续推状态在工具副作用后才暴露不一致，或压缩后仍泄漏 opaque state，导致已执行工具无法回滚、第二次采样被厂商拒绝或推理连续性断裂 | 无 | SC_04、SC_06、SC_11、SC_16、SC_20 | SC_12、SC_24 | skipped:no-corpus |

## Scenarios

### Scenario SC_01: OpenAI 非流式 tool response 精确重放 reasoning envelope

- **GIVEN** reasoning 已启用，OpenAI-compatible 响应 message 同时含多行 `reasoning_content`、text 与两个有序 tool calls，Runner 按既有流程产生两个对应 tool results
- **WHEN** provider 完成解析、session 往返，并构造同模型的下一次请求
- **THEN** 下一请求 assistant message 的 `role/content/reasoning_content/tool_calls` 与首个响应的 replay envelope 深度相等，两个现有 tool results 分别编码为 `role=tool/tool_call_id`，reasoning 字符零截断
- 测试层：unit
- 依据：用户任务 / `J3` / `INV-01` / `INV-02`
- 来源：initial-spec

### Scenario SC_02: OpenAI 流式分片重组保持 reasoning 与 tool arguments

- **GIVEN** reasoning 与两个 tool-call arguments 被拆成多个 SSE delta，分片边界落在 Unicode 字符与 JSON token 之间
- **WHEN** stream parser 消费到 message.done 并由 encoder 构造下一请求
- **THEN** canonical replay envelope 的 reasoning 字符串、tool call id/name/arguments 与完整分片拼接结果一致，顺序保持
- 测试层：unit
- 依据：`J3` / `INV-02`
- 来源：initial-spec

### Scenario SC_03: Anthropic 非流式 response blocks 按 endpoint 合同重放

- **GIVEN** MiniMax 响应依次含 thinking(signature)、text 与两个 tool_use blocks，DeepSeek 响应含其官方支持的 thinking/text/tool_use blocks，Runner 按既有流程产生两个对应 tool results
- **WHEN** 两个 provider 分别解析、session 往返并构造同一模型下的下一请求
- **THEN** MiniMax 完整回放 response.content，DeepSeek 完整回放受支持 blocks，两个现有 tool results 分别编码为 `tool_result/tool_use_id`；两条 payload 均与各自响应逐项深度相等且没有跨 endpoint 新增字段
- 测试层：unit
- 依据：用户任务 / `J4` / `J5` / `INV-03`
- 来源：initial-spec

### Scenario SC_04: Anthropic 流式 opaque delta 只按响应事实归并

- **GIVEN** Claude-format fixture 的 thinking text、signature、`redacted_thinking.data` 与 tool input JSON 分布在 stream event/block start 中，MiniMax/DeepSeek fixture 只提供各自 endpoint 实际支持的数据
- **WHEN** stream parser 处理 block start/delta/stop/message stop
- **THEN** message.done 携带可解析的完整 state，下一请求重放的 blocks 与各 fixture 聚合结果逐项相等；已出现的 opaque signature/data 逐值保持，真正缺失的字段继续缺失
- 测试层：unit
- 依据：`J4` / `INV-03`
- 来源：initial-spec

### Scenario SC_05: 显示 reasoning 与 semantic state 冲突时 state 是发送真源

- **GIVEN** 同一 assistant Message 的显示 `reasoning_content="DISPLAY_A"`，`reasoning_state.payload_json` 内 reasoning 为 `STATE_B`
- **WHEN** provider 构造同模型的下一次 LLM 请求
- **THEN** 实际 payload 含 `STATE_B` 且不含 `DISPLAY_A`，trace/Web 也不含 `STATE_B`
- 测试层：unit
- 依据：`J1` / `J8` / `INV-01` / `INV-11`
- 来源：initial-spec

### Scenario SC_06: 缺失续推状态在工具副作用前失败

- **GIVEN** provider 请求已启用 reasoning，响应含合法 normalized tool call，同时缺少协议要求的 replay state
- **WHEN** provider/Runner 处理完整响应
- **THEN** 返回稳定 `reasoning_continuation_invalid` 错误，assistant append、approval、tool execute 和 tool_result 计数全部为 0
- 测试层：smoke
- 依据：`J5` / `J10` / `INV-04`
- 来源：initial-spec

### Scenario SC_07: FileSession 对续推状态和 checkpoint 等价往返

- **GIVEN** 一个含 Unicode、opaque 字段和两个 tool calls 的 `ReasoningContinuationState`
- **WHEN** 通过 FileSession append 后读取 history、重新构造 FileSession 再读 history，并生成/提交 checkpoint 后读取 context_snapshot
- **THEN** 四条 FileSession 路径得到 format/model/payload_json 完全相等的 Message，JSONL message 与 checkpoint replacement 使用同一字段结构
- 测试层：unit
- 依据：`J2` / `J11` / `INV-05`
- 来源：initial-spec

### Scenario SC_08: 旧 session 缺少 reasoning_state 仍可读取

- **GIVEN** 一个历史 FileSession message payload 只有 role/content/tool_calls/tool_call_id/name/metadata
- **WHEN** FileSession 当前 serializer 读取并组装 history
- **THEN** Message.reasoning_state 为 `None`，原消息字段保持，普通对话继续运行
- 测试层：unit
- 依据：`J11` / `INV-05`
- 来源：initial-spec

### Scenario SC_09: 同模型新 run 保留历史 tool-loop state 的发送投影

- **GIVEN** session 已完成模型 A 的 run-1，其中历史 assistant tool-call Message 带 state；run-2 追加新的真实 user 输入并继续使用模型 A
- **WHEN** Runner 为 run-2 构造首次普通 LLM 请求
- **THEN** 文字、tool calls、tool results 与所有模型 A state 都保留在发送投影中，session 原记录保持完整
- 测试层：unit
- 依据：`J9` / `INV-06`
- 来源：initial-spec

### Scenario SC_10: 同 run steer 不切断 active tool-loop state

- **GIVEN** 当前 run 已收到 signed assistant tool call 并完成 tool result，下一 turn 前 steer buffer 注入一条 user 消息
- **WHEN** Runner drain steer 并构造下一次请求
- **THEN** steer 文本与当前 run 全部消息可见，signed assistant state 仍按原位置重放，provider 接受请求
- 测试层：smoke
- 依据：`J9` / `INV-06`
- 来源：initial-spec

### Scenario SC_11: TOOL_RESULT compaction 的 checkpoint replacement 删除 state

- **GIVEN** active context 含较长历史 prefix，以及 signed assistant tool call、完整 tool-result batch 和近期真实 user 消息
- **WHEN** TOOL_RESULT 触发 ContextCompactionManager 并成功 CAS 提交 checkpoint
- **THEN** checkpoint replacement 仅含近期真实 user 消息与 summary，逐 Message 的 `reasoning_state` 均为 `None`；下一普通请求不重放压缩前 state
- 测试层：smoke
- 依据：`J7` / `J14` / `INV-07`
- 来源：initial-spec

### Scenario SC_12: compaction summary request 使用 state-free 投影

- **GIVEN** active context 含 OpenAI 或 Anthropic 的 assistant `reasoning_state`、tool calls 与 tool results
- **WHEN** ContextCompactionManager 构造 summary LLM request
- **THEN** summary request 保留可读内容、tool calls 与 tool results 的既有压缩输入语义，全部 Message 的 `reasoning_state` 均为 `None`，原 Session 历史保持完整
- 测试层：unit
- 依据：`J7` / `J14` / `INV-07`
- 来源：initial-spec

### Scenario SC_13: token estimator 计入实际 replay envelope

- **GIVEN** 两个请求的 visible messages/tools 完全相同，A 无 state，B 仅新增足以跨过阈值的大 payload_json
- **WHEN** ContextTokenEstimator 估算并执行自动触发判断
- **THEN** A 保持阈值下，B 达到阈值并触发压缩，B 的估算覆盖 provider 实际发送的 state；成功 replacement 与其后的普通请求不带 replay envelope
- 测试层：unit
- 依据：`J12` / `INV-08`
- 来源：initial-spec

### Scenario SC_14: 观测与 Web 输出隔离 opaque state

- **GIVEN** payload_json 含唯一 sentinel signature 和隐藏 reasoning，且启用 trace 与 prompt-debug，随后读取 Web history
- **WHEN** 完成一次 tool-loop 请求并收集所有事件/文件/REST-WS DTO
- **THEN** 观测输出只含 format/model/byte_length/item_count/sha256，sentinel 只存在 session state 与 provider 请求 spy 中
- 测试层：smoke
- 依据：`J12` / `INV-11`
- 来源：initial-spec

### Scenario SC_15: reasoning disabled 普通 tool loop 保持原路径

- **GIVEN** Local Gemma 或 supports_disabled preset 以 reasoning disabled 产生 tool calls
- **WHEN** Runner 执行工具并构造下一请求
- **THEN** provider 由 normalized Message 重建 assistant tool calls，续推状态门禁不触发，既有工具结果配对保持
- 测试层：unit
- 依据：`J6` / `J10` / `INV-12`
- 来源：initial-spec

### Scenario SC_16: 多 tool-call 只重放一份状态且逐项配对

- **GIVEN** 一个 reasoning-enabled assistant envelope 含两个有序 tool calls，两个工具产生不同结果
- **WHEN** Runner 串行执行完整 batch 并发起下一次采样
- **THEN** assistant replay envelope 在 messages 中出现一次，两个 tool_result 按原 call id 各出现一次，执行对象与 envelope 投影完全一致
- 测试层：smoke
- 依据：`J10` / `INV-09`
- 来源：initial-spec

### Scenario SC_17: 两种真实 adapter 的 deterministic 端到端链路

- **GIVEN** 本地 fake transport 为 OpenAI 与 Anthropic endpoint 分别返回带 reasoning state 的 tool response，再返回终态 answer
- **WHEN** 通过真实 provider、Runner、FileSession、Tool 和 ContextCompactionManager 各执行一次完整 run
- **THEN** 两条链路都完成两次采样、一次工具执行和终态回复，第二次 HTTP payload 含精确 state，session/checkpoint 可重读
- 测试层：e2e
- 依据：`J15` / `INV-01..INV-13`
- 来源：initial-spec

### Scenario SC_18: GLM 真实 API 接受 reasoning_content 工具续写

- **GIVEN** 配置有效 `GLM_API_KEY` 与 `bigmodel-glm5-1m`，工具 prompt 确定触发一个无副作用 fixture Tool
- **WHEN** generic_chat 完成真实 tool call 与第二次模型采样
- **THEN** run 获得终态 answer，第二次请求无 reasoning 合同错误，工具执行一次且 session state 摘要可审计
- 测试层：e2e
- 依据：`J5` / `J6` / `J15`
- 来源：initial-spec

### Scenario SC_19: MiniMax 真实 API 接受 signed thinking blocks 工具续写

- **GIVEN** 配置有效 `MINIMAX_API_KEY` 与 `minimax-m3`，工具 prompt 确定触发一个无副作用 fixture Tool
- **WHEN** generic_chat 完成真实 thinking → tool_use → tool_result → thinking 链路
- **THEN** run 获得终态 answer，第二次请求无 signature/content-block 合同错误，session restart 后 history 可读
- 测试层：e2e
- 依据：`J5` / `J6` / `J15`
- 来源：initial-spec

### Scenario SC_20: 损坏或错配 state 拒绝发送与执行

- **GIVEN** session 中当前 run assistant state 分别为非法 JSON、错误 format、不同 model 或 envelope tool id 与 normalized Message 冲突
- **WHEN** Runner/provider 尝试构造下一请求或恢复 active context
- **THEN** 每个反例返回稳定 `reasoning_continuation_invalid` 及具体 violation kind，provider 请求、approval、tool execute 与新 checkpoint 均为 0
- 测试层：smoke
- 依据：`J8` / `J10` / `INV-04` / `INV-09` / `INV-10`
- 来源：initial-spec

### Scenario SC_21: 错用其他 wire format 时网络请求前失败

- **GIVEN** 两个冲突 fixture：OpenAI encoder 收到 `ANTHROPIC_CONTENT_BLOCKS` state，Anthropic encoder 收到 `OPENAI_CHAT_ASSISTANT` state
- **WHEN** provider encoder 校验 `ReasoningContinuationState.format`
- **THEN** 两条路径均返回 `reasoning_continuation_format_unsupported` 和 expected/actual format，HTTP transport、approval 与 tool execute 调用次数均为 0
- 测试层：smoke
- 依据：用户任务 / `J16` / `J17` / `J18` / `J21` / `INV-13`
- 来源：initial-spec

### Scenario SC_22: DeepSeek Anthropic 真实 API 接受 A→A 原样工具续写

- **GIVEN** 配置有效 `DEEPSEEK_API_KEY` 与 `deepseek-pro`，通过 `https://api.deepseek.com/anthropic` 调用一个无副作用 fixture Tool
- **WHEN** generic_chat 完成真实 thinking → tool_use → tool_result → answer 链路
- **THEN** run 获得终态 answer，第二次请求无 message-format/reasoning 合同错误，assistant envelope 与 DeepSeek 第一次响应逐项深度相等，工具执行一次
- 测试层：e2e
- 依据：`J6` / `J15` / `J18` / `INV-03` / `INV-13`
- 来源：initial-spec

### Scenario SC_23: 现存 500 字符截断行为被移除

- **GIVEN** 两个 fixture：OpenAI 非流式响应的 assistant message 含长度 > 500 的多行 `reasoning_content`（含 Unicode 字符与可识别首尾标记）；Anthropic 流式响应的 thinking block 拼接后总长度 > 500（signature 与 thinking 文本由多条 delta 分片送出）
- **WHEN** OpenAI 非流式 parser 与 Anthropic 流式 parser 分别消费上述 fixture
- **THEN** 两处 parser 产出的 reasoning 文本与 fixture 原文逐字符相等（尾部标记存在、`reasoning_content_length` 等于完整长度而非 500），provider_metadata 中不存在任何 `[:500]` 截断；该断言在删除 `openai_responses.py:482` 与 `anthropic_stream_parser.py:432` 的 `[:500]` 之前为 RED，删除后为 GREEN，并作为永久回归守卫防止截断被重新引入
- 测试层：unit
- 依据：`J3`（含「必须移除的现存截断代码」段）/ `J4` / `J8` / `INV-01`
- 来源：initial-spec

### Scenario SC_24: 流式中途断连不落盘 partial state

- **GIVEN** reasoning-enabled Anthropic-compatible 流式响应已发出 thinking text、部分 signature delta 和部分 tool input JSON delta，但在 message_delta/message_stop 之前连接中断（网络超时或 transport raise），signature 尚未聚合完整
- **WHEN** stream parser 处理到中断异常
- **THEN** 本次响应不生成 `ReasoningContinuationState`，不 append assistant，不触发审批与工具执行，不写 checkpoint；Session 不含任何带 partial signature 的 state 记录，下一次请求不会把残缺 signature 发给厂商
- 测试层：smoke
- 依据：`J4` / `J5` / `J10` / `INV-03` / `INV-04`
- 来源：adversarial-review (assumption:stream-partial-state-on-disconnect)

### Scenario SC_25: 切换模型时清除历史 reasoning state 的发送投影

- **GIVEN** FileSession 保存了模型 A 的 signed assistant tool-call state，用户随后选择模型 B 并开始新 run
- **WHEN** Runner 为模型 B 构造首次普通 LLM 请求
- **THEN** Session 原记录中的模型 A state 保持完整；发给模型 B 的历史文字、tool calls 与 tool results继续可见；所有历史 Message 的 `reasoning_state` 均为 `None`，模型 A 的 signature/reasoning payload 不进入模型 B 请求
- 测试层：unit
- 依据：用户任务 / `J23` / `INV-06` / `INV-10`
- 来源：initial-spec
