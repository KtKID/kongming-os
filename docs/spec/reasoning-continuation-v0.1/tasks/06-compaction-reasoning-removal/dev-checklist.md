# 06-compaction-reasoning-removal · 开发清单

> spec: docs/spec/reasoning-continuation-v0.1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | ContextCompactionManager 为 summary LLM request 构造 state-free 投影：保留既有可读消息、tool calls 与 tool results，逐 Message 清除 `reasoning_state`，Session 原记录保持完整 | SC_12 | INV-07；J7；J14 | src/prompting/compaction/context_compaction_manager.py | None | [ ] ⏳ | None |
| T2 | TOOL_RESULT compaction 成功 checkpoint replacement 仅含近期真实 user 消息与 summary，逐 Message `reasoning_state=None`，下一普通请求不重放压缩前的 state | SC_11 | INV-07；J7；J14 | src/prompting/compaction/context_compaction_manager.py | T1 | [ ] ⏳ | None |
| T3 | token estimator 估算仍包含普通请求实际发送的 replay envelope：对抗值 state=空 vs state=大 payload，后者单独跨过阈值并触发压缩；成功 replacement 的后续请求无 replay envelope | SC_13 | INV-08；J12；估算覆盖 provider 实际发送的 state | src/prompting/compaction/context_compaction_manager.py | T1, T2 | [ ] ⏳ | None |
| T4 | compaction smoke 测试：极小 context window + 真实 ContextCompactionManager 写 checkpoint；重启 FileSession 后 checkpoint replacement 与下一普通请求均不含 `reasoning_state` | SC_11 | INV-07；J14 | tests/unit/test_compaction_reasoning_removal.py | T1, T2, T3 | [ ] ⏳ | None |
