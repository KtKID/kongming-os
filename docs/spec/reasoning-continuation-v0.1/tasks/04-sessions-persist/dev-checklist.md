# 04-sessions-persist · 开发清单

> spec: docs/spec/reasoning-continuation-v0.1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | FileSession 使用的 serializer `_message_to_dict/_message_from_dict` 往返 `reasoning_state`：payload JSON 序列化，反序列化时 format/model/payload_json 完全相等 | None | INV-05；J2；J11；v0.1 只验收 FileSession | src/sessions/session_store.py | None | [x] 🟢 | None |
| T2 | FileSession JSONL 逐消息记录持久化 `reasoning_state`；checkpoint 生成与恢复时 state 完整往返 | None | INV-05；INV-07；J11 | src/sessions/file_session.py | T1 | [x] 🟢 | None |
| T3 | FileSession 真实往返测试：append → history、重新构造 → history、checkpoint commit → context_snapshot 四条路径的 format/model/payload_json 完全相等 | SC_07 | INV-05；J11 | tests/unit/test_file_session_reasoning_state.py | T1, T2 | [ ] ⏳ | None |
| T4 | 旧 FileSession payload 兼容测试：message 缺 reasoning_state 字段时读取为 None，原字段保持，普通对话继续 | SC_08 | INV-05；J11；缺字段旧记录稳定读取为 None | tests/unit/test_file_session_reasoning_state.py | T1, T2 | [ ] ⏳ | None |
| T5 | FileSession 损坏 state 行按既有损坏记录策略处理；model/tool-call 语义错配统一交 task-05 前置门禁 | SC_20 | INV-04；INV-05；INV-09；J8；J10 | tests/unit/test_file_session_reasoning_state.py | T1, T2 | [ ] ⏳ | None |
