# 03-provider-encoder · 开发清单

> spec: docs/spec/reasoning-continuation-v0.1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 明确 encoder 边界：`ReasoningStateFormat` 选择 OpenAI/Anthropic wire；同模型发送投影与 model/tool-call 门禁由 task-05 负责 | None | INV-10；INV-13；J6；J21；J23 | src/core/contracts/message.py、src/core/runner.py | None | [x] 🟢 | encoder 已有 format 合同；来源门禁归 task-05 T1/T2/T8 |
| T2 | OpenAI-compatible 请求 encoder 精确重放当前 run state 的完整 replay envelope；tool result 编码为 `role=tool/tool_call_id` | None | INV-02；INV-13；J3；J16；encoder 不筛选或合成 opaque 字段 | src/infrastructure/llm_providers/base.py、src/infrastructure/llm_providers/openai_responses.py | T1 | [x] 🟢 | None |
| T3 | Anthropic-compatible 请求 encoder 原样重放完整、有序 content blocks；tool result 编码为 `tool_result/tool_use_id` | None | INV-03；INV-13；J4；J17；J18；J19；字段级过滤会破坏 A→A opaque envelope | src/infrastructure/llm_providers/anthropic_messages.py | T1 | [x] 🟢 | None |
| T4 | 冲突哨兵测试：显示 `reasoning_content=A` 与 semantic state `B` 同时存在，实际 provider payload 读取 `B` 且不含 `A` | SC_05 | INV-01；INV-11；J1；J8；语义真源唯一性 | tests/unit/test_openai_reasoning_encoder.py、tests/unit/test_anthropic_reasoning_encoder.py | T2, T3 | [x] 🟢 | None |
| T5 | 跨 wire-format 测试：OpenAI encoder 拒绝 Anthropic state，Anthropic encoder 拒绝 OpenAI state；HTTP 请求前返回 `reasoning_continuation_format_unsupported` | SC_21 | INV-13；J16；J17；J21；HTTP transport 调用次数为 0 | tests/unit/test_reasoning_encoder.py | T2, T3 | [x] 🟢 | None |
| T6 | 同一普通 tool result 经 OpenAI 与 Anthropic encoder 后分别形成官方 `role=tool/tool_call_id` 与 `tool_result/tool_use_id`，wire 不存在猜测的 reasoning/signature 字段 | None | INV-09；J22；两类 wire 差异收敛在 encoder | tests/unit/test_tool_result_wire_encoding.py | T2, T3 | [x] 🟢 | None |
