# 05-runner-validation-gate · 开发清单

> spec: docs/spec/reasoning-continuation-v0.1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | Runner 构造同模型发送投影：文字、tool calls 与 tool results 历史保持，`state.model == request.model` 的 reasoning_state 原样重放；模型变化时清除 state 发送投影 | None | INV-06；INV-10；J2；J9；J23；旧模型 state 进入新模型请求的风险 | src/core/runner.py | None | [x] ✅ | None |
| T2 | provider 响应校验前置门禁：reasoning 已启用且响应含 tool calls 时，校验 state 存在、格式合法、model 相同、normalized tool calls 与 replay envelope 一致；失败返回 `reasoning_continuation_invalid` | SC_06 | INV-04；J5；J10；校验先于 assistant append、approval 与 tool execute，失败时副作用计数为 0 | src/core/runner.py、src/infrastructure/llm_providers/*.py | None | [x] ✅ | None |
| T3 | 同模型新 run 保留历史 state 发送投影测试：run-2 首次请求保留 run-1 的 state，session 原记录保持完整 | SC_09 | INV-06；J9；J13 | tests/unit/test_runner_reasoning_projection.py | T1 | [x] ✅ | None |
| T4 | 同 run steer 不切断 active tool-loop state 测试：drain steer 后 signed assistant state 仍按原位置重放 | SC_10 | INV-06；J9 | tests/unit/test_runner_reasoning_projection.py | T1 | [x] ✅ | None |
| T5 | reasoning disabled / 无 capability 普通 tool loop 保持 normalized Message 重建路径，续推门禁不触发 | SC_15 | INV-12；J6；J10；新门禁不扩大到普通模型 | tests/unit/test_runner_reasoning_projection.py | T2 | [x] ✅ | None |
| T6 | 多 tool-call 只重放一份 state 且逐项配对：assistant envelope 出现一次，两个 tool_result 按原 call id 各出现一次，执行对象与 envelope 投影一致 | SC_16 | INV-09；J10；J22 | tests/unit/test_runner_reasoning_projection.py | T1, T2 | [x] ✅ | None |
| T7 | 模型切换清除发送投影中的全部历史 state：Session 原记录保持，模型 A signature/reasoning payload 不进入模型 B 请求 | SC_25 | INV-06；INV-10；J23；跨模型 opaque signature 无法复用 | tests/unit/test_runner_reasoning_projection.py | T1, T2 | [x] ✅ | None |
