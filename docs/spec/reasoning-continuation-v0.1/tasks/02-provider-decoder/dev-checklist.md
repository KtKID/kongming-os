# 02-provider-decoder · 开发清单

> spec: docs/spec/reasoning-continuation-v0.1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 删除 OpenAI 非流式 parser 的 `reasoning_raw[:500]` 截断（`openai_responses.py:482`），保留完整原文 | SC_23 | INV-01；J3「必须移除的现存截断代码」；禁止任何形态字符截断 | src/infrastructure/llm_providers/openai_responses.py | None | [x] 🟢 | None |
| T2 | 删除 Anthropic 流式 parser 的 `full[:500]` 截断（`anthropic_stream_parser.py:432`），保留完整 thinking 原文 | SC_23 | INV-01；J3「必须移除的现存截断代码」 | src/infrastructure/llm_providers/anthropic_stream_parser.py | None | [x] 🟢 | None |
| T3 | OpenAI 非流式 parser 从响应构造 `OPENAI_CHAT_ASSISTANT` 格式 canonical replay envelope（role/content/reasoning_content/tool_calls 有序），写入 `Message.reasoning_state` | SC_01 | INV-01；INV-02；J3；J16；GLM envelope 只含官方示例字段，禁止加 thinking/signature | src/infrastructure/llm_providers/openai_responses.py | None | [x] 🟢 | None |
| T4 | OpenAI 流式 parser 分片重组为完整 replay envelope；分片边界落在 Unicode 字符与 JSON token 间时正确拼接 | SC_02 | INV-02；J3；流式只允许 delta 聚合 | src/infrastructure/llm_providers/openai_compat_stream_parser.py | None | [x] 🟢 | None |
| T5 | Anthropic 非流式 parser 保留完整有序 content blocks（thinking/text/tool_use/redacted_thinking），含 opaque signature/data；MiniMax 完整回放 response.content | SC_03 | INV-03；J4；J17；adapter 不跨协议合成字段 | src/infrastructure/llm_providers/anthropic_messages.py | None | [x] 🟢 | None |
| T6 | Anthropic 流式 parser 聚合 thinking_delta + signature_delta，并原样保留 `redacted_thinking.data`；缺失字段保持缺失；MiniMax/DeepSeek 只处理各自 endpoint 实际返回的 delta | SC_04 | INV-03；J4；J17；J18；opaque 字段逐值保留 | src/infrastructure/llm_providers/anthropic_stream_parser.py | None | [x] 🟢 | `_AnthropicBlock.redacted_data` 保存 start block 原值；缺失值保持 `None`，不合成空串 |
| T7 | 流式响应在 message_stop 前中断（signature 未聚合完整）时不生成 state、不返回可重放 envelope | SC_24 | INV-03；INV-04；J4；J10；禁止把 partial signature 落盘 | src/infrastructure/llm_providers/anthropic_stream_parser.py、src/infrastructure/llm_providers/openai_compat_stream_parser.py | T4, T6 | [x] 🟢 | None |
| T8 | 单元测试：SC_01-04、SC_23、SC_24 的 RED→GREEN，含长度>500 的 Unicode fixture、流式分片边界、`redacted_thinking.data` A→A 深度相等、中途断连 fixture | SC_01, SC_02, SC_03, SC_04, SC_23, SC_24 | INV-01..INV-04 | tests/unit/test_openai_reasoning_decoder.py、tests/unit/test_anthropic_reasoning_decoder.py | T3, T4, T5, T6, T7 | [x] 🟢 | Task 2 全组 16 passed；相关 Anthropic/encoder 回归 59 passed |
