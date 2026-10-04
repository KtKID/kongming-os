# Dev Report — session-engine-history-portal — 20260729

## 根因与修复

Web 的首条消息、WS history frame 与 thread fork 直接取得
`SessionEngine._session_factory`、`_sessions` 或 raw Session。宿主由此掌握了
Session 缓存、创建和写入语义；读取回退还会在运行时内部不可用时静默改走另一条
路径。fork 的逐条播种与失败清理同样依赖宿主编排 raw Session。

修复由 `SessionEngine` 统一公开读取历史、追加单条消息、向空会话播种历史和补偿
清空四个异步任务级门户。播种先验证目标为空，任何中途失败都会清空已写入前缀并
重新抛出原始异常。Web 首条消息、history frame 和 fork 全部迁移到公共门户，
ThreadManager 的 raw Session helper 已删除。

## 红灯证据

生产修改前运行公共门户测试，结果为 `3 failed`，三个失败均为
`AttributeError`，证明 `SessionEngine` 缺少 read、append、seed 任务级入口。

随后运行冲突哨兵
`test_history_frame_uses_public_runtime_portal_only`，公共入口返回历史 B，
`_session_factory` 与 `_sessions` 访问直接抛错；旧实现命中私有
`_session_factory` 并失败。迁移后同一测试转绿。

## 改动文件

- `src/runtime_assembly/session_engine.py`
- `src/hosts/web/threads/manager.py`
- `src/hosts/web/threads/cell.py`
- `src/hosts/web/websocket/routes.py`
- `tests/unit/runtime_assembly/test_session_engine_history_portal.py`
- `tests/unit/test_web_ws_history_frame.py`
- `tests/unit/web/test_generic_first_message_thread.py`
- `tests/unit/web/test_thread_fork.py`
- `tests/unit/test_web_ws_endpoint.py`
- `tests/e2e/test_web_thread_fork_smoke.py`
- `tests/support/web_thread_fork_e2e_server.py`
- `docs/modules/执行器/README.md`
- `docs/modules/Web前端/README.md`
- `docs/spec/nightly-p1-single-owner-hardening-v1/tasks/session-engine-history-portal/dev-checklist.md`
- `docs/spec/nightly-p1-single-owner-hardening-v1/tasks/session-engine-history-portal/dev-report.md`

## 验证证据

```verify
id: SC10-web-history-public-portal
scenario: SC_10
cmd: uv run pytest -q tests/unit/test_web_ws_history_frame.py::test_history_frame_uses_public_runtime_portal_only tests/unit/web/test_generic_first_message_thread.py::test_create_generic_thread_from_first_message_persists_metadata_and_user_message tests/e2e/test_web_thread_fork_smoke.py::test_rest_fork_persists_full_history_and_independent_asset
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC11-seed-and-fork-rollback
scenario: SC_11
cmd: uv run pytest -q tests/unit/runtime_assembly/test_session_engine_history_portal.py::test_seed_partial_failure_clears_target_and_reraises_original tests/unit/runtime_assembly/test_session_engine_history_portal.py::test_file_session_seed_failure_removes_persisted_prefix tests/unit/web/test_thread_fork.py::test_fork_metadata_commit_failure_rolls_back_private_target tests/e2e/test_web_thread_fork_smoke.py::test_rest_fork_file_seed_failure_rolls_back_every_target_resource
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

## 补充质量证据

- 公共门户、WS history、首条消息、fork 全边界及真实 FileSession REST E2E：
  `50 passed`。
- `test_web_ws_endpoint.py`：`21 passed`，真实 WS endpoint 契约保持通过。
- `uv run ruff check`：目标源码与测试通过。
- `uv run mypy`：四个生产文件通过。
- `uv run lint-imports`：架构合同通过。
- `git diff --check`：通过。
- 私有入口扫描：`src/hosts/web/` 未引用
  `_session_factory`、`_get_or_create_session` 或 `get_or_create_session(...)`。

## Gate② 修复回归

- issue-1：真实 TestClient 从 `/api/threads/generic/first-message` 创建并等待
  assistant 终态，经 `/ws/threads/{id}` 读取结构化 history，再经 REST fork；
  public-only wrapper 记录 append/read/seed 调用，并让五个 raw Session 名称访问
  立即抛错。
- issue-2：真实 TestClient REST fork 使用第二次 append 抛错的 FileSession；
  原始 `OSError` 保持可诊断，目标 metadata、session 目录与附件全部清除，源历史
  原样保留。
- issue-3、issue-4：按 x-fix 的 P2 规则保留在 issue ledger。

本报告由 x-dev 于 2026-07-29 生成。
