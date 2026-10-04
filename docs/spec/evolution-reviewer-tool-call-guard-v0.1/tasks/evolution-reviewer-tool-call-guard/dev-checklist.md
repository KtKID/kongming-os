# evolution-reviewer-tool-call-guard · 开发清单

> spec: docs/spec/evolution-reviewer-tool-call-guard-v0.1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 定义 run 级 LLM 工具调用合同、封闭模式、违规种类、独立错误和内部事件，并从 `core.contracts` 统一导出 | SC_01, SC_03, SC_06, SC_07, SC_09 | `J7`、`J8`：公开合同与取消语义隔离 | `src/core/contracts/llm_provider.py`, `src/core/contracts/event_sink.py`, `src/core/contracts/__init__.py`, `src/core/errors.py` | None | [x] ✅ | None |
| T2 | 先补 Runner 流式/非流式合同红灯测试，记录当前未知工具被 append/执行、重试缺失和资源未提前关闭的失败证据 | SC_01, SC_02, SC_03, SC_04, SC_06, SC_07, SC_09, SC_10, SC_11 | `SC_11` 响应原子性、`SC_09` 资源生命周期 | `tests/unit/test_runner_tool_call_contract.py`, `tests/unit/test_core_runner_basic.py` | T1 | [x] ✅ | issue-2, issue-3, issue-4 closed |
| T3 | 在唯一 Runner 内实现显式合同校验、流式早停、非流式预校验、一次瞬态纠错和原子副作用门禁，并由 SessionEngine 只做 run 级透传 | SC_01, SC_02, SC_03, SC_04, SC_06, SC_07, SC_09, SC_10, SC_11 | `J3`、`J4`、`J8`、`J11`：校验先于 append/execute，默认 run 行为保持 | `src/core/runner.py`, `src/runtime_assembly/session_engine.py`, `tests/unit/test_runner_tool_call_contract.py`, `tests/unit/test_core_runner_basic.py` | T1, T2 | [x] ✅ | issue-2, issue-3 closed |
| T4 | 先补 evo reviewer 的日志、单 accepted turn、事件工具名过滤和最终单通知红灯测试 | SC_01, SC_03, SC_05, SC_08, SC_11 | `J5`、`J6`：非法工具不得进入回放，首个违规必须留 ERROR 日志 | `tests/unit/test_evolution_reviewer_runtime.py`, `tests/unit/test_native_runtime_evolution.py` | T1 | [x] ✅ | issue-4 closed |
| T5 | reviewer 显式启用严格合同和一次纠错预算，记录首个违规，过滤非 `evolution_write` 工具事件，并在一次合法写入后结束 child run | SC_01, SC_03, SC_05, SC_08, SC_11 | reviewer 单工具不变量、`J2`、`J5`、`J6`、`J10` | `src/evolution/reviewer_runtime.py`, `src/evolution/trigger_diagnostics.py`, `src/evolution/evolution_manager.py`, `tests/unit/test_evolution_reviewer_runtime.py`, `tests/unit/test_native_runtime_evolution.py` | T3, T4 | [x] ✅ | None |
| T6 | 增加真实 EvolutionManager/event bus/Web sink 薄 E2E，覆盖大量 `documents`、纠错成功与二次违规失败，证明零非法工具帧和单终态通知 | SC_03, SC_05, SC_08, SC_11 | `J1`、`J5`：用户可见失败气泡链路 | `tests/e2e/test_evolution_tool_call_guard_web.py`, `tests/e2e/test_self_evolution_e2e.py` | T5 | [x] ✅ | None |
| T7 | 更新核心与进化模块边界文档，复跑全部 Scenario 对应测试、mypy、ruff、import-linter 和 diff 检查并产出 dev-report verify 块 | SC_01, SC_02, SC_03, SC_04, SC_05, SC_06, SC_07, SC_08, SC_09, SC_10, SC_11 | Q3 公开合同、Runner 原子性和完整 Scenario 证据 | `docs/modules/核心/README.md`, `docs/modules/进化/README.md`, `dev-report.md` | T6 | [x] ✅ | issue-4 closed; issue-1 P2 registered |
