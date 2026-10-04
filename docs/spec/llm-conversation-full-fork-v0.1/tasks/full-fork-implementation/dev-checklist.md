# full-fork-implementation · 开发清单

> spec: docs/spec/llm-conversation-full-fork-v0.1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 固化 `Message` 深拷贝、Session 独立性、血缘元数据与稳定顺序语义 | SC_01, SC_08, SC_09, SC_12 | 会话合同与血缘单一真源 | `src/core/message.py`; `src/hosts/web/threads/{manager,metadata,types}.py` | None | [x] ✅ | None |
| T2 | 在同一源线程快照门禁中覆盖运行、审批、排队输入和 send-now claim，并统一 REST 冲突语义 | SC_03, SC_04, SC_05, SC_06 | 跨层状态一致性；错误映射 | `src/hosts/web/threads/manager.py`; `src/hosts/web/routers/threads.py`; `src/hosts/web/protocol/rest_models.py` | T1 | [x] ✅ | issue-6 P2 registered |
| T3 | 实现目标线程私有构建、元数据最后发布、异常与取消完成后清理 | SC_07, SC_13 | J01 多阶段提交；J02 取消安全 | `src/hosts/web/threads/{manager,metadata}.py`; `src/sessions/` | T1, T2 | [x] ✅ | issue-3 closed |
| T4 | 按历史中的 ready 附件引用闭包复制资产，校验缺失元数据或载荷并回滚 | SC_02, SC_14 | J03 资产闭包；路径隔离 | `src/hosts/web/uploads/storage.py`; `src/hosts/web/threads/manager.py` | T3 | [x] ✅ | issue-5 closed |
| T5 | 对齐 Python/TS REST 合同、前端 fork 操作、加载态、错误态与来源标识 | SC_05, SC_06, SC_09, SC_10, SC_12 | Web wire 双侧真源 | `src/hosts/web/protocol/rest_models.py`; `web/src/protocol.ts`; `web/src/stores/threads.ts`; `web/src/components/ThreadList.tsx` | T2, T3 | [x] ✅ | issue-4 closed |
| T6 | 补齐 Manager、路由、协议漂移、前端交互及真实 UI→API→持久化重放 smoke/e2e | SC_02, SC_10, SC_11, SC_13 | 必需测试层；红灯先行 | `tests/`; `web/src/**/*.test.tsx`; `web/e2e/` | T2, T3, T4, T5 | [x] ✅ | issue-1, issue-8 closed; issue-2 withdrawn after SQLite scope correction; issue-7 P2 registered |
| T7 | 更新模块文档并完成 pytest、ruff、mypy、import-linter、前端类型与 xdev 验证 | None | 架构边界与可复验交付 | `docs/modules/Web前端/README.md`; task 验收产物 | T6 | [x] ✅ | QA Gate round 1 passed |
