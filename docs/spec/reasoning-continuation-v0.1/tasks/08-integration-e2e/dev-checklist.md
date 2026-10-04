# 08-integration-e2e · 开发清单

> spec: docs/spec/reasoning-continuation-v0.1
> risk: Q2

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 本地 deterministic smoke：OpenAI 与 Anthropic fake transport 经真实 provider/Runner/FileSession/Tool/CompactionManager 完成完整 run，第二次 HTTP payload 含精确 state，工具只执行一次 | SC_17 | INV-01..INV-13；J15；薄 integration 穿过真实内部决策层 | tests/e2e/test_reasoning_continuation_smoke.py | None | [ ] ⏳ | None |
| T2 | credential-gated GLM 真实 E2E：`bigmodel-glm5-1m` 真实工具调用进入第二次采样，第二次请求获成功响应，session 含 OpenAI Chat state 摘要，工具执行一次 | SC_18 | J5；J6；J15；J16；厂商严格校验 reasoning 字段 | tests/e2e/test_glm_reasoning_e2e.py | T1 | [ ] ⏳ | None |
| T3 | credential-gated MiniMax 真实 E2E：`minimax-m3` 真实 thinking → tool_use → tool_result → thinking 链路，第二次采样无 signature 合同错误，session restart 后 history 可读 | SC_19 | J5；J6；J15；J17 | tests/e2e/test_minimax_reasoning_e2e.py | T1 | [ ] ⏳ | None |
| T4 | credential-gated DeepSeek 真实 E2E：`deepseek-pro` 经 Anthropic endpoint 完成 thinking → tool_use → tool_result → answer，第二次采样成功，出站 payload 不含 redacted_thinking | SC_22 | J6；J15；J18；INV-03；INV-13 | tests/e2e/test_deepseek_reasoning_e2e.py | T1 | [ ] ⏳ | None |
