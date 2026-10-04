# 07-observation-projection · 开发清单

> spec: docs/spec/reasoning-continuation-v0.1
> risk: Q2

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 为 `reasoning_state` 定义显式安全投影：trace/prompt-debug/Web REST+WS payload 只输出 format/model/byte_length/item_count/sha256，不含 payload_json 及可逆内容 | None | INV-11；J12；dataclass asdict 自动展开 opaque state 的泄漏风险 | src/core/contracts/llm_provider.py、src/infrastructure/tracing/prompt_debug_dump.py、src/hosts/web/app_support/generic_history.py | None | [ ] ⏳ | None |
| T2 | 观测隔离 smoke 测试：payload_json 含唯一 sentinel signature + 隐藏 reasoning，收集所有事件/文件/REST-WS DTO，sentinel 只存在 session state 与 provider 请求 spy 中 | SC_14 | INV-11；J12 | tests/unit/test_reasoning_observation_isolation.py | T1 | [ ] ⏳ | None |
