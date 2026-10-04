# permissions-explicit-cleanup · 开发清单

> spec: docs/spec/nightly-p1-single-owner-hardening-v1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 删除 PermissionsManager 全局 orphan cleanup 公共方法和 Web startup 局部 universe 扫描 | SC_18 | J17；顶层 thread_id 跨宿主隔离 | src/safety/approval/permissions_manager.py, src/hosts/web/threads/manager.py | None | [x] ✅ | None |
| T2 | 保持显式 Web thread 删除的 permissions 清理与可观测重试，固定目标 thread 单点副作用 | SC_19 | J17；metadata 先提交、清理可重试 | src/hosts/web/threads/manager.py, src/safety/approval/permissions_manager.py | T1 | [x] ✅ | issue-2 |
| T3 | 以 Web/CLI/cron 相反 ID 走真实 lifespan/delete 测试并同步 Safety/Web 文档 | SC_18, SC_19 | J20；安全边界冲突哨兵 | tests/unit/safety/, tests/unit/web/, tests/e2e/, docs/modules/安全/README.md, docs/modules/Web前端/README.md | T2 | [x] ✅ | issue-4 |
