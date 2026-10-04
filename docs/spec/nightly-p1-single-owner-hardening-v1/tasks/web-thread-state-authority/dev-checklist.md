# web-thread-state-authority · 开发清单

> spec: docs/spec/nightly-p1-single-owner-hardening-v1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 新建 ThreadStatusManager，收口 active map、sequence、run lease、单连接 writer 与 bounded queue | SC_06, SC_07, SC_09, SC_27 | J3、J4、J21；并发与资源不变量 | src/hosts/web/websocket/thread_status_manager.py, src/hosts/web/websocket/thread_status.py | None | [x] ✅ | fix-report-20260729-r3 issue-4；issue-5 记为 P2 |
| T2 | 扩展 thread-status snapshot/run identity 双侧协议并迁移 generic、Claude、Codex publisher | SC_06, SC_07, SC_23, SC_27 | J5、J21；Web wire 双侧真源 | src/hosts/web/protocol/, web/src/protocol.ts, web/src/protocol/, scripts/export_thread_status_frame_schema.py, src/hosts/web/integrations/ | T1 | [x] ✅ | fix-report-20260729-r3 issue-3、issue-6 |
| T3 | 将前端 canonical status 改为 snapshot replace/current generation 投影，并把发送态拆入独立 dispatch store | SC_01, SC_02, SC_08 | J1、J6；Stop 只读服务端业务态 | web/src/chat/, web/src/pages/Chat.tsx, web/src/stores/, web/src/hooks/useThreadStatusWS.ts, web/src/hooks/useThreadRunning.ts | T2 | [x] ✅ | fix-report-20260729-r3 issue-1 |
| T4 | 将 approval inbox 卡片改为 pending/submitting/error，删除只消费 authoritative remove 并覆盖乱序与双 tab | SC_03, SC_04, SC_05 | J7；remove/snapshot omission 为终态 | web/src/features/approval-inbox/, src/hosts/web/approvals/global_inbox/, src/hosts/web/websocket/thread_status.py | T2 | [x] ✅ | fix-report-20260729-r3 issue-2、issue-7 |
| T5 | 补齐真实 WS、frontend reducer、协议漂移和双浏览器 E2E 证据并同步模块文档 | SC_01, SC_02, SC_03, SC_04, SC_05, SC_06, SC_07, SC_08, SC_09, SC_23, SC_24, SC_25, SC_27 | J20；高损失并发与用户可见链路 | tests/, web/src/**/__tests__/, web/tests/e2e/, docs/modules/Web前端/README.md | T3, T4 | [x] ✅ | qa-gate-r1-20260729；issue-8 记为 P2 |
