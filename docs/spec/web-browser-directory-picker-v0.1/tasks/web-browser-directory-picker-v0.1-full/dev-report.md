# web-browser-directory-picker-v0.1-full · 开发报告

## RED 证据

| 场景 | 命令 | 预期失败 | 实际失败 | 状态 |
|---|---|---|---|---|
| SC_01, SC_02 | `cd web && pnpm exec vitest run src/lib/__tests__/dirPicker.test.ts --reporter=verbose` | 浏览器应返回 server selected；Tauri 应返回带来源的 selected | 浏览器收到 `null`；Tauri 收到裸字符串 `/tauri/project` | RED |
| SC_05-SC_07, SC_09, SC_10 | `uv run pytest -q tests/unit/web/test_directory_picker.py tests/unit/web/test_directory_picker_route.py tests/unit/test_web_protocol_round_trip.py::test_directory_picker_rest_dto_round_trip tests/unit/test_web_protocol_rejection.py::test_directory_picker_protocol_rejects_relative_paths_and_inconsistent_outcome` | 新 Manager、route 和严格 DTO 可被测试驱动 | `DirectoryPickerOutcome` 与 `hosts.web.directory_picker` 尚未实现，pytest collection 失败 | RED |

## 实现与验证

### 实现结果

- 前端 `pickDirectory()` 以 `window.__TAURI_INTERNALS__` 分流：Tauri 保持 `@tauri-apps/plugin-dialog`；普通浏览器调用 `POST /api/server/directory-picker`。
- Python `DirectoryPickerManager` 统一执行 loopback 来源守卫、进程内 single-flight、默认目录规范化和最终目录校验。
- macOS adapter 通过 `asyncio.create_subprocess_exec` 调 `/usr/bin/osascript`；标题和默认目录只作为 argv 传入；任务取消执行 `kill()` + `wait()`。
- REST 合同提供 selected/cancelled 正常响应，并将 remote、busy、unavailable、adapter/process failure 映射为 403/409/501/502；全局 Auth/CSRF middleware 继续保护 POST。
- `ThreadProjectSelector`、`NewThreadDialog`、`AddProjectDialog` 消费统一结果，覆盖 selected、cancelled、unavailable、busy 和 loading；最终业务入口继续只接收原有绝对 `cwd`。
- Playwright 薄 E2E 穿过 React、Vite proxy、真实 FastAPI route、真实 Manager 和 fake OS adapter；真实 macOS 面板保留为人工 HIL。

### 改动文件

- `src/hosts/web/directory_picker/`
- `src/hosts/web/routers/directory_picker.py`
- `src/hosts/web/routers/config.py`
- `src/hosts/web/app.py`
- `src/hosts/web/protocol/rest_models.py`
- `src/hosts/web/protocol/__init__.py`
- `web/src/lib/dirPicker.ts`
- `web/src/protocol.ts`
- `web/src/hooks/useClientConfig.ts`
- `web/src/components/ThreadProjectSelector.tsx`
- `web/src/components/NewThreadDialog.tsx`
- `web/src/components/AddProjectDialog.tsx`
- `web/src/components/Layout.tsx`
- `web/vite.config.ts`
- 对应 Python、Vitest、Playwright 测试与 Web 模块文档

### Scenario 验证证据

```verify
id: SC01-tauri-priority
scenario: SC_01
cmd: pnpm exec vitest run src/lib/__tests__/dirPicker.test.ts -t "Tauri 与 server 同时可用时只调用 Tauri transport"
cwd: web
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC02-browser-e2e
scenario: SC_02
cmd: pnpm exec playwright test --config playwright.directory-picker.config.ts
cwd: web
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC02-macos-finder-hil
scenario: SC_02
mode: manual
steps: 在 macOS 启动 Kongming Web，使用同机普通浏览器登录，点击新会话的“选择新项目”，确认系统文件夹面板出现；选择目录后确认项目按钮显示所选目录名，取消后确认当前选择保持。
```

```verify
id: SC03-cancel-preserves-cwd
scenario: SC_03
cmd: pnpm exec vitest run src/components/__tests__/NewThreadDialog.test.tsx -t "取消目录面板时保留已输入 cwd"
cwd: web
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC04-unavailable-fallback
scenario: SC_04
cmd: pnpm exec vitest run src/components/__tests__/ThreadProjectSelector.test.tsx -t "服务端 picker 不可用时展示手动绝对路径 fallback"
cwd: web
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC05-single-flight-http
scenario: SC_05
cmd: uv run pytest -q tests/unit/web/test_directory_picker.py::test_manager_single_flight_and_cancel_releases_next_request tests/unit/web/test_directory_picker_route.py::test_browser_directory_picker_maps_domain_errors_to_http_status
cwd: .
expect_exit: 0
expect_contains: 5 passed
mode: auto
```

```verify
id: SC06-process-cancel-cleanup
scenario: SC_06
cmd: uv run pytest -q tests/unit/web/test_directory_picker.py::test_macos_adapter_cancel_kills_and_waits_for_process
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC06-http-lifecycle-cancel
scenario: SC_06
cmd: uv run pytest -q tests/unit/web/test_directory_picker.py::test_manager_aclose_cancels_active_adapter_and_rejects_new_pick tests/unit/web/test_directory_picker_route.py::test_browser_directory_picker_disconnect_cancels_active_manager_pick
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC06-frontend-abort-consumers
scenario: SC_06
cmd: pnpm exec vitest run src/lib/__tests__/api.test.ts src/components/__tests__/NewThreadDialog.test.tsx src/components/__tests__/AddProjectDialog.test.tsx -t "apiPost 把 AbortSignal|关闭 dialog 时 abort|组件 cleanup 时 abort"
cwd: web
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC06-app-lifespan-close
scenario: SC_06
cmd: uv run pytest -q tests/unit/test_web_app_lifespan.py::test_lifespan_shutdown_closes_directory_picker_manager
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC07-boundary-rejection
scenario: SC_07
cmd: uv run pytest -q tests/unit/web/test_directory_picker_route.py::test_browser_directory_picker_rejects_remote_gui_request tests/unit/web/test_directory_picker_route.py::test_browser_directory_picker_rejects_invalid_wire_before_adapter
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC08-existing-consumers
scenario: SC_08
cmd: pnpm exec vitest run src/components/__tests__/ThreadProjectSelector.test.tsx src/components/__tests__/NewThreadDialog.test.tsx src/components/__tests__/AddProjectDialog.test.tsx
cwd: web
expect_exit: 0
expect_contains: 34 passed
mode: auto
```

```verify
id: SC09-lock-release
scenario: SC_09
cmd: uv run pytest -q tests/unit/web/test_directory_picker.py::test_manager_single_flight_and_cancel_releases_next_request
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC10-invalid-adapter-output
scenario: SC_10
cmd: uv run pytest -q tests/unit/web/test_directory_picker.py::test_manager_rejects_non_directory_adapter_output
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

### 补充质量证据

| 验证 | 结果 |
|---|---|
| 前端聚焦 Vitest | 6 files，52 passed |
| 后端 Manager + route + protocol/config/lifespan | 28 passed，1 个独立 legacy config 用例 deselected |
| REST protocol round-trip/rejection | 2 passed |
| Playwright 薄 E2E | 1 passed |
| `pnpm typecheck` | 通过 |
| `pnpm lint` | 0 errors；22 个仓库既有 warnings |
| `pnpm build` | 通过 |
| 聚焦 `mypy` | 8 source files 通过 |
| 聚焦 `ruff check` | 通过 |
| `uv run lint-imports` | 20 kept，0 broken |
| `git diff --check` | 通过 |
| `bash scripts/web-ctl.sh restart --rebuild` + status + `/api/health` | PID 94842 运行于 60000；health `{"status":"ok"}` |

现有 `tests/unit/web/routers/test_client_config.py::test_client_config_smoke_migrates_legacy_config_path` 因仓库当前 legacy model config 的 `context_window_tokens=None` 独立失败；本任务聚焦回归使用 `-k 'not smoke_migrates_legacy_config_path'`，其余 28 项通过。

### Q3 Gate 结论

- R1 tri-lens：P0 ×0、P1 ×1、P2 ×4。P1 生命周期缺口经 Gate R1 修复；4 个 P2 已登记在 `reports/qa-gate/qa-gate-report-20260815-132554.md`，保持非阻塞。
- R2 裁剪复审：实现正确性通过，新增 P1 证据缺口 ×1；经 Gate R2 补齐真实 fetch、组件 cleanup 和 app lifespan 跨层断言。
- 最终回流：13 个 auto verify block 全过，fail ×0、uncovered ×0；fix counter 已重置为 0。

## 自检结论

自动验证已覆盖所有 Scenario；真实 Finder 交互列为人工 HIL。实现保持 Tauri transport 优先、业务 cwd DTO 稳定、loopback GUI 边界和子进程回收不变量。
