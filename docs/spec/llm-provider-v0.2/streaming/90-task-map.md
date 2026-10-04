# LLM Streaming V1 Task Map

> 本表同级文档：[README](./README.md) · [模块拆分](./02-module-breakdown.md) · [数据与状态](./04-data-and-state.md) · [验证与演进](./05-validation-and-evolution.md) · [测试用例详细设计](./06-test-cases-detailed.md)

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 | 建议流程 |
|---|---|---|---|---|---|
| A. 流式契约与 parser 底座 | `llm-streaming-v1-foundation` | 是 | llm-provider-v0.2 模块 D（httpx 连接复用，强烈建议） | 方案确认 | `x-req` → `x-plan` → `x-dev` |
| B. OpenAI-compatible provider 流式接入 | `llm-streaming-v1-openai-provider` | 是 | A | 方案确认 | `x-req` → `x-plan` → `x-dev` |
| C. Anthropic Messages provider 流式接入 | `llm-streaming-v1-anthropic-provider` | 是 | A | 方案确认 | `x-req` → `x-plan` → `x-dev` |
| D. Runner / Host / CLI 流式集成 | `llm-streaming-v1-runtime-integration` | 是 | A + B | 方案确认 | `x-req` → `x-plan` → `x-dev` |
| E. 契约测试与回归 | `llm-streaming-v1-contract-tests` | 是 | A + B + C + D | 方案确认 | `x-req` → `x-plan` → `x-dev` |

**测试用例完整清单**：见 [05-validation-and-evolution.md](./05-validation-and-evolution.md)（含 54 个 unit / e2e 用例分布、本地手工验证清单、性能基线）。
**测试用例详细设计**：见 [06-test-cases-detailed.md](./06-test-cases-detailed.md)（关键用例的完整输入/输出数据、断言骨架、`make_openai_chunk` / `make_anthropic_event` / `StubLLMStreamProvider` 等辅助工厂）。
**数据结构权威定义**：见 [04-data-and-state.md](./04-data-and-state.md)（含 `LLMStreamChunk` 字段必填矩阵、Event payload schema、Anthropic SSE 映射表）。

## 推荐推进顺序

**强烈建议前置**：先完成 llm-provider-v0.2 的模块 D（`httpx-client-reuse`），否则流式 TTFT 会被 TLS 握手污染，无法正确验证流式实现本身的收益。llm-provider-v0.2 README 第 104 行已标注此建议。

**V1 主推进顺序**：

1. `llm-streaming-v1-foundation`（契约 + parser 底座，不动任何 provider / runner）
2. `llm-streaming-v1-openai-provider`（GLM-5 / Gemma / Kimi / DeepSeek 全都能用上）
3. `llm-streaming-v1-runtime-integration`（runner + CLI 流式链路打通，可以体感打字机）
4. `llm-streaming-v1-anthropic-provider`（Anthropic / MiniMax 通过 Anthropic 路径扩展）
5. `llm-streaming-v1-contract-tests`（最终质量门）

**可选并行**：

- 2 和 4 解耦，若有两人开发可并行；单人开发按上述顺序即可
- 5 的 Ollama index 复用单测可以在 2 完成后先行落地（不依赖 4）

## 第一版范围控制

V1 只允许以下场景进入 task：

- **Provider**：OpenAI-compatible 端点（Z.AI / LM Studio / Ollama / OpenAI 官方 / DeepSeek / Kimi / Qwen）+ Anthropic 官方 Messages API
- **模型族**：`gemma-4-e4b-it` / `glm*` / `claude-*` / `MiniMax-M2.7*`（继承 reasoning-adapter-v1 的支持矩阵）
- **parser 策略**：完全对齐 Hermes（`run_agent.py:4744-4852`）的 OpenAI-compatible chunk 归一化逻辑
- **防御代码必抄**：Hermes `_last_id_at_idx` + `_active_slot_by_idx` 的 Ollama 并行 tool_call 分 slot 逻辑

以下内容继续留在方案层，不进入本轮 task：

- MiniMax 在 Anthropic 路径下的流式验证（V1 保守，留给 V2）
- 流式中 Ctrl-C 优雅中断的语义设计（V1 沿用现有异常中断）
- tool_call streaming 的细粒度 UI（流中展示 "准备调用 X 工具，参数拼装中..."）
- HTTP/2 支持（h2 依赖 + `http2=True`，ROI 低）
- `content.delta` 的 "已打字撤回"（用于 tool_calls 压制时回退已展示的 chatty 引导）
- 多 provider 流式路由 / fallback 链（流式中途断开 → 切 non-stream 续写）

## 进入 x-req 前的准入条件

每个 task 进入 x-req 前，应先锁定：

1. **契约形状冻结**：`LLMStreamChunk` 的字段与 kind 枚举在模块 A 就要定好，后续模块 B/C/D/E 都依赖这个契约；任何形状变更需要回头改 A
2. **Hermes 对标行号**：parser 实现必须在 PR description 里标注对应 Hermes `run_agent.py` 的具体行号区间，方便未来 review 对比
3. **SSE reader 的纯度**：`sse_reader.py` 只处理行缓冲与 `data:` 前缀解析，不解任何业务字段；保证两个 provider 能共用
4. **trace sink 降采样**：模块 D 必须带 `delta_sampling` 开关的单测，默认 `none` 不落盘（否则 trace.jsonl 会在真实使用下膨胀几十倍）
5. **回退路径覆盖**：模块 D 的 runner 必须有"`stream_enabled=True` 但 `isinstance(llm, SupportsLLMStream) is False`"的回退单测，保证能力缺失时自动走 `complete()` 非流式路径；不依赖 `NotImplementedError` 异常做控制流

## 与 llm-provider-v0.2 其他模块的关系

- **强前置**：模块 D `httpx-client-reuse`（否则 TTFT 指标被 TLS 握手污染，无法正确度量流式收益）
- **已满足**：模块 A `provider_metadata` 已落地 → 流式的 `LLMStreamChunk.provider_metadata` 直接复用该格式
- **独立**：模块 B `reasoning-effort-control` / C `tools-schema-compaction` / E `tools-dynamic-selection` 均不影响本方案
- **交互点**：B（reasoning）在流式下会触发 `reasoning.delta` 事件；两者结合后 CLI 可以实时渲染思考链；这是 B + 本方案共同的增益点，不是新依赖

## 与当前 CR 的关系

V1 完成后，必须同时交付以下三条质量保证：

1. **流式 ↔ 非流式等价性契约测试**（模块 E）
2. **Ollama index 复用场景覆盖**（模块 E，防御代码是 Hermes 的关键借鉴）
3. **非流式路径 reasoning 多字段兼容**（模块 B 顺带修复既有 `_parse_response` 只读 `reasoning_content` 单字段的潜在遗漏）

第 3 条是本方案对既有代码的"搭便车修复"——发现于调研 Hermes `_extract_reasoning` 多字段兼容（`run_agent.py:1824-1864`）时，kongming 现有 `OpenAIResponsesProvider._parse_response` 只读 `reasoning_content` 一个字段，遇到 DeepSeek / Qwen 风格的 `reasoning` 顶层字段会丢思考链。这个修复强行绑在模块 B 里一并 ship。
