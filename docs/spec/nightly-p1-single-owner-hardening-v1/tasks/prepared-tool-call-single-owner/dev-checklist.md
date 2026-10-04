# prepared-tool-call-single-owner · 开发清单

> spec: docs/spec/nightly-p1-single-owner-hardening-v1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 收紧 Tool.execute 为 PreparedToolCall，并把 BaseBuiltinTool 默认校验/填充迁入唯一 prepare | SC_20, SC_22, SC_28 | J19、J22；审批后零语义改写 | src/core/contracts/tool_runtime.py, src/tools/runtime/base.py | None | [x] ✅ | 1 |
| T2 | Runner 为普通 Tool 构造默认 prepared call、为 preparer 调用一次，并隔离 approval/execute 深拷贝 | SC_20, SC_21, SC_28 | J18、J22；审批事实等于执行事实 | src/core/runner.py, src/core/contracts/approval.py | T1 | [x] ✅ | None |
| T3 | 迁移全部 Tool 实现、MCP adapter、workflow/evolution/scheduler 调用方和测试到新签名 | SC_22 | J20；公开 Tool 协议零旧调用 | src/tools/, src/evolution/, src/application/, tests/ | T1 | [x] ✅ | 1 |
| T4 | 用 A/B/C 对抗 spy 覆盖单次 prepare、审批副本 mutation、execute 零 normalization，并运行类型/架构门禁与文档同步 | SC_20, SC_21, SC_22, SC_28 | J18—J22；核心安全执行链 | tests/unit/core/, tests/unit/tools/, tests/e2e/, docs/modules/核心/README.md, docs/modules/工具/README.md | T2, T3 | [x] ✅ | 1 |
