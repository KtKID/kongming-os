# workflow-agent-lifecycle-unify · 开发清单

> spec: docs/spec/nightly-p1-single-owner-hardening-v1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 扩展 TaskRecord 冻结 identity、terminal 查询和 live-safe 200 条 retention，并由 AgentManager 暴露不可变投影 | SC_12, SC_13 | J10；登记先于暴露、live 不裁剪 | src/application/agents/registry.py, src/application/agents/manager.py, src/hosts/shared/host_dispatcher.py | None | [x] ✅ | R1：Result 终态映射补强 |
| T2 | workflow 强制走父 AgentManager spawn，缺少父身份时早失败，并删除旧 SubAgentManager/lifecycle 路径和装配胶水 | SC_12, SC_14 | J11；生命周期单一真源 | src/application/agent_workflows/, src/application/subagents/, src/tools/agent_workflow_tool.py, src/hosts/web/run.py | T1 | [x] ✅ | R1：child usage/cancel 传播补强 |
| T3 | ThreadManager 与 subagents route 通过 HostDispatcher/AgentManager 返回同一 TaskRecord 投影 | SC_12 | J12；Web 路由穿过真实 owner | src/hosts/web/threads/manager.py, src/hosts/web/routers/thread_subagents.py, src/hosts/web/protocol/ | T2 | [x] ✅ | R1：Python/TS DTO 单一真源 |
| T4 | 覆盖真实 spawn→TaskRegistry→REST、terminal 幂等、retention 和早失败红灯，并同步 Agent/Web 模块文档 | SC_12, SC_13, SC_14 | J20；状态机与证据链 | tests/unit/application/, tests/unit/web/, tests/e2e/, docs/modules/应用/README.md, docs/modules/Web前端/README.md, docs/modules/执行器/README.md | T3 | [x] ✅ | R1：旧 workflow 测试全量迁移 |
