# 01-core-contract · 开发清单

> spec: docs/spec/reasoning-continuation-v0.1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 新增 `ReasoningStateFormat(StrEnum)`，取值 `OPENAI_CHAT_ASSISTANT` / `ANTHROPIC_CONTENT_BLOCKS` | None | INV-01；J8；新增公开枚举（AGENTS 约束：有限取值用 StrEnum） | src/core/message.py | None | [x] ✅ | None |
| T2 | 新增 frozen `ReasoningContinuationState(format, model, payload_json)`；`payload_json: str` 保证 frozen 深层不可变，禁止用 `dict[str, Any]` | None | INV-01；J1；J8；payload_json 是 canonical replay envelope 唯一语义真源，禁止解析/猜测/合成 | src/core/message.py | T1 | [x] ✅ | None |
| T3 | `Message` 新增 `reasoning_state` 可选字段（`ReasoningContinuationState` 或 `None`，默认 `None`）；`Message.assistant()` 工厂支持传入；保持现有字段与顺序 | None | INV-01；J1；metadata 已声明不参与语义，reasoning_state 必须是独立强类型字段而非塞入 metadata | src/core/message.py | T2 | [x] ✅ | None |
| T4 | 单元测试：构造含 `reasoning_state` 的 assistant Message，断言 frozen 不可变、payload_json 原文往返、缺失字段读取为 None | None | INV-01；J8 | tests/unit/test_message.py | T3 | [x] ✅ | issue-1 已修复：收敛 test_old_record docstring 边界声明，session 反序列化往返留 task-04 |
