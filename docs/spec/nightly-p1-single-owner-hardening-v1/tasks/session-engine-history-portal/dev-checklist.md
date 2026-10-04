# session-engine-history-portal · 开发清单

> spec: docs/spec/nightly-p1-single-owner-hardening-v1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 为 SessionEngine 增加历史读取、单消息追加、空会话播种公共异步方法及失败清空语义 | SC_10, SC_11 | J8；seed 失败原子清空 | src/runtime_assembly/session_engine.py, tests/unit/test_session_engine.py, tests/unit/runtime_assembly/ | None | [x] ✅ | None |
| T2 | 迁移 Web 首条消息、history frame、thread fork 到公开 SessionEngine 门户并删除 raw Session helper | SC_10, SC_11 | J9；Web 私有字段零访问 | src/hosts/web/threads/manager.py, src/hosts/web/websocket/routes.py, src/hosts/web/threads/cell.py | T1 | [x] ✅ | None |
| T3 | 用 FileSession、冲突哨兵和 fork 部分失败覆盖真实入口并同步模块文档 | SC_10, SC_11 | J20；跨层真实消费者与 rollback | tests/unit/web/, tests/e2e/, docs/modules/Web前端/README.md, docs/modules/执行器/README.md | T2 | [x] ✅ | issue-1, issue-2 |
