# web-browser-directory-picker-v0.1-full · 开发清单

> spec: docs/spec/web-browser-directory-picker-v0.1
> risk: Q3

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[ ] 🟡` 待测试 / `[x] 🟢` 测试通过 / `[x] ✅` 已完成 / `[!] 🔴` 测试失败

| # | 任务说明 | Scenario IDs | 风险 | 涉及文件 | 依赖 | 状态 | fix |
|---|---|---|---|---|---|---|---|
| T1 | 先写目录选择协议、环境分流、路由、并发、取消回收和三个调用方的 RED 测试并保存失败证据 | SC_01, SC_02, SC_03, SC_04, SC_05, SC_06, SC_07, SC_08, SC_09, SC_10 | J1-J8；红灯必须击穿浏览器当前 `null` 路径、错误 transport 与资源泄漏 | `tests/unit/web/test_directory_picker.py`, `tests/unit/web/test_directory_picker_route.py`, `tests/unit/test_web_protocol_round_trip.py`, `tests/unit/test_web_protocol_rejection.py`, `web/src/lib/__tests__/dirPicker.test.ts`, `web/src/components/__tests__/ThreadProjectSelector.test.tsx`, `web/src/components/__tests__/NewThreadDialog.test.tsx`, `web/src/components/__tests__/AddProjectDialog.test.tsx` | None | [x] ✅ | Gate R2 issue-1 |
| T2 | 实现 Python REST DTO、loopback/单实例 DirectoryPickerManager、macOS osascript adapter、route 与 app/client-config 装配 | SC_02, SC_05, SC_06, SC_07, SC_09, SC_10 | J2、J4-J7；公开 wire、远程 GUI guard、锁与子进程生命周期 | `src/hosts/web/protocol/rest_models.py`, `src/hosts/web/protocol/__init__.py`, `src/hosts/web/directory_picker/`, `src/hosts/web/routers/directory_picker.py`, `src/hosts/web/routers/config.py`, `src/hosts/web/app.py`, `tests/unit/web/` | T1 | [x] ✅ | Gate R1 issue-1；Gate R2 issue-1 |
| T3 | 将前端目录选择 helper 收口为可判定 Tauri/server 双 transport，并更新三个调用方的 selected/cancelled/unavailable/busy/loading 行为 | SC_01, SC_03, SC_04, SC_08 | J1-J3、J8；Tauri 冲突哨兵唯一真源与 cwd 业务语义保持 | `web/src/lib/dirPicker.ts`, `web/src/protocol.ts`, `web/src/hooks/useClientConfig.ts`, `web/src/components/ThreadProjectSelector.tsx`, `web/src/components/NewThreadDialog.tsx`, `web/src/components/AddProjectDialog.tsx`, 对应测试 | T1 | [x] ✅ | Gate R1 issue-1；Gate R2 issue-1 |
| T4 | 建立真实 UI→API→DirectoryPickerManager→fake OS adapter 薄链路，更新 Web 模块文档并完成 pytest、前端测试、类型、ruff、mypy、import-linter、协议与 xdev 验证 | SC_01, SC_02, SC_03, SC_04, SC_05, SC_06, SC_07, SC_08, SC_09, SC_10 | Q3；用户可见链路、公开协议、并发与资源证据闭环 | `tests/e2e/`, `web/tests/e2e/`, `docs/modules/Web前端/README.md`, `docs/spec/web-browser-directory-picker-v0.1/tasks/web-browser-directory-picker-v0.1-full/` | T2, T3 | [x] ✅ | Gate R1/R2 闭环 |
