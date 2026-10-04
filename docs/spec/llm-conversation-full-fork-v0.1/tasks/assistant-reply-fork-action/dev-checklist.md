# assistant-reply-fork-action · 开发清单

> spec: docs/spec/llm-conversation-full-fork-v0.1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 固化 Session 原始 `history_index` 合同：Runner 在 assistant append 后把索引写入 terminal `turn.end`，历史投影与 Python/TS wire 使用同一可选字段 | SC_16, SC_17 | J15/J17；Web wire 双侧真源 | `src/core/runner.py`; `src/hosts/web/app_support/generic_history.py`; `src/hosts/web/websocket/event_sink.py`; `src/hosts/web/protocol/ws_frames.py`; `web/src/protocol.ts` | None | [x] ✅ | None |
| T2 | 扩展 fork REST DTO 与 `ThreadManager` 门户：可选索引生成闭区间前缀，校验 terminal assistant，按前缀计算附件闭包，保留无 body 全量语义与既有回滚门禁 | SC_15, SC_16 | J4/J16；持久化前缀与资产闭包 | `src/hosts/web/protocol/rest_models.py`; `src/hosts/web/routers/threads.py`; `src/hosts/web/threads/{manager,types}.py`; `src/hosts/web/uploads/storage.py` | T1 | [x] ✅ | None |
| T3 | 在通用时间线逐层保留 fork 索引，并给 assistant 最终回复页脚增加复制按钮右侧的分叉图标、单请求 loading/error 与成功导航；移除侧栏入口，user 与 tool 卡片保持无入口 | SC_17 | J9/J15/J17；实时/回放状态一致性 | `web/src/chat/{types,ChatTimelineStore,ChatRenderAdapter}.ts`; `web/src/stores/{chat,threads}.ts`; `web/src/components/{MessageList,ThreadList}.tsx`; `web/src/pages/Chat.tsx` | T1, T2 | [x] ✅ | None |
| T4 | 以红灯测试覆盖服务端精确前缀、工具配对、越界/非 terminal 边界、前缀资产闭包、无 body 全量兼容和 REST 错误映射 | SC_15, SC_16 | SC_15/SC_16；错误真源与回滚 | `tests/unit/web/test_thread_fork.py`; `tests/e2e/test_web_thread_fork_smoke.py`; `tests/unit/test_web_protocol_round_trip.py` | T1, T2 | [x] ✅ | None |
| T5 | 以红灯测试覆盖 Python/TS 协议漂移、实时/回放索引透传、按钮位置/可访问名/禁用恢复，并跑 fake 与真实 LLM 的 UI→REST→FileSession 端到端链路 | SC_15, SC_17 | 必需测试层；实时完成竞态 | `web/src/chat/__tests__/`; `web/src/components/__tests__/MessageList.test.tsx`; `web/src/pages/__tests__/Chat.test.tsx`; `web/tests/e2e/`; `tests/support/` | T3, T4 | [ ] 🟡 | 真实 MiniMax 执行需要外部数据发送授权；fake LLM 的真实 Web 内部链路已通过 |
| T6 | 更新 Web 模块文档与开发报告，完成目标 pytest、前端测试、TypeScript、ruff、mypy、import-linter、协议合同和 xdev 验证 | None | 架构边界与可复验证据 | `docs/modules/Web前端/README.md`; `docs/spec/llm-conversation-full-fork-v0.1/tasks/assistant-reply-fork-action/` | T5 | [x] ✅ | xdev 四组 verify 与 spec validate 通过 |
