# generic-chat-session-analysis · 开发清单

> spec: docs/spec/sitian-generic-chat-analysis-v1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 收紧 source kind 为字符串枚举，加入 `generic_chat` 配置与示例/模块文档 | SC_11 | `J7`、`J9`、`J11`：YAML 字符串稳定，generic_channel 文件扫描语义稳定 | `src/sitian/config.py`、`config/sitian.local.yaml`、`docs/modules/司天/README.md`、配置/扫描测试 | None | [x] ✅ | None |
| T2 | 发现通用聊天 metadata/FileSession 对，并实现有界 Kongming JSONL 尾部读取 | SC_02, SC_03, SC_04, SC_05, SC_10 | `J4`、`J5`、`J10`、`J12`、`J13`：thread_id 关联、过滤、真源、局部损坏降级和资源上限 | `src/sitian/global_scanner.py`、`src/sitian/session_reader.py`、对应 unit tests | None | [x] ✅ | issue-1 fixed in Gate R1 |
| T3 | 分派 generic_chat 扫描并产出 Analyzer 合同 shape 的 project/thread observations | SC_01, SC_02, SC_03, SC_10 | `J4`、`J6`、`J7`：cwd/title/正文真源与 payload 合同 | `src/sitian/scanners.py`、`tests/unit/test_sitian_service.py`、`tests/unit/test_sitian_scanner_recent_sessions.py` | T1, T2 | [x] ✅ | None |
| T4 | 将 generic_chat 纳入逐 cwd work item 归并 | SC_06 | `J8`：同 source 的项目和 thread ids 保持隔离 | `src/sitian/suggestions.py`、对应 unit tests | T1 | [x] ✅ | None |
| T5 | 建立真实持久化生产者到 Analyzer、Store、报告 API 与前端 manager 的集成证据 | SC_07, SC_08, SC_09 | `J1`、`J2`、`J6`、`J14`：现有编排与报告入口保持唯一 | `tests/unit/test_sitian_analyzer.py`、`tests/unit/test_sitian_service.py`、`tests/unit/web/test_sitian_router.py`、`web/src/modules/sitian/__tests__/manager.test.ts`、新增 smoke/e2e tests | T3, T4 | [x] ✅ | None |
| T6 | 运行本任务 verify、静态检查和架构边界检查并记录可复跑证据 | SC_01, SC_02, SC_03, SC_04, SC_05, SC_06, SC_07, SC_08, SC_09, SC_10, SC_11 | Q3：持久化真源、公开 source 配置和用户可见报告链 | `docs/spec/sitian-generic-chat-analysis-v1/tasks/generic-chat-session-analysis/reports/`、任务涉及测试 | T5 | [x] ✅ | Gate R1 closure recorded |
