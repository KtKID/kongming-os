# Dev Report — permissions-explicit-cleanup — 20260729

## 根因与修复

`ThreadManager.start()` 把 Web metadata 列表当作全局 thread universe，并调用
`PermissionsManager.cleanup_orphans()` 枚举共享目录中的全部权限本。CLI 与 cron
拥有独立 thread 生命周期，因此它们的有效本子会被 Web 启动扫描判成 orphan。

修复删除全局枚举删除入口及 Web startup 扫描。权限本清理固定由显式
`delete_thread(thread_id)` 触发；per-thread metadata mutation lock 串行化创建、
更新和删除，只有现存 Web metadata 完成 `exists → absent` 提交并复查文件消失后
才进入权限清理。metadata 缺失或提交失败时保留权限本，清理失败进入可观测重试
队列。跨宿主全局垃圾回收保留为需要完整 universe 的独立维护能力。

## 红灯证据

生产修改前运行：

`uv run pytest -q tests/unit/web/test_thread_permissions_lifecycle.py::test_start_preserves_permission_books_from_every_host`

结果为 `1 failed`。Web metadata 只含 `thread-cccccccccccc`，启动后
`thread-dddddddddddd` 的真实权限文件消失，失败断言精确命中跨宿主误删。

## 改动文件

- `src/safety/approval/permissions_manager.py`
- `src/hosts/web/threads/manager.py`
- `tests/unit/web/test_thread_permissions_lifecycle.py`
- `tests/e2e/test_thread_permissions_lifecycle_e2e.py`
- `docs/modules/安全/README.md`
- `docs/modules/Web前端/README.md`
- `docs/spec/nightly-p1-single-owner-hardening-v1/tasks/permissions-explicit-cleanup/dev-checklist.md`
- `docs/spec/nightly-p1-single-owner-hardening-v1/tasks/permissions-explicit-cleanup/dev-report.md`

## 验证证据

```verify
id: SC18-cross-host-books-preserved
scenario: SC_18
cmd: uv run pytest -q tests/unit/web/test_thread_permissions_lifecycle.py::test_start_preserves_permission_books_from_every_host tests/unit/web/test_thread_permissions_lifecycle.py::test_delete_thread_removes_permissions_book tests/e2e/test_thread_permissions_lifecycle_e2e.py::test_lifespan_preserves_all_hosts_and_rest_delete_targets_web_only
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC19-explicit-delete-retry
scenario: SC_19
cmd: uv run pytest -q tests/unit/web/test_thread_permissions_lifecycle.py::test_cleanup_failure_keeps_delete_committed_and_retry_succeeds tests/unit/web/test_thread_permissions_lifecycle.py::test_delete_missing_web_metadata_preserves_other_host_book tests/unit/web/test_thread_permissions_lifecycle.py::test_metadata_delete_failure_preserves_permissions_book tests/unit/web/test_thread_permissions_lifecycle.py::test_stale_metadata_update_cannot_resurrect_deleted_thread tests/e2e/test_thread_permissions_lifecycle_e2e.py::test_delete_cleanup_failure_keeps_thread_deleted_and_retry_recovers
cwd: .
expect_exit: 0
expect_contains: 5 passed
mode: auto
```

## 补充质量证据

- 相关 unit、safety、E2E 集：`18 passed`。
- `uv run ruff check`：目标源码与测试通过。
- `uv run mypy`：两个生产文件通过。
- `uv run lint-imports`：20 个架构合同通过。
- `git diff --check`：目标文件通过。
- 残留扫描：目标生产代码、目标测试与本次更新的两个 README 中无
  `cleanup_orphans`、`_cleanup_orphan_permissions` 和 orphan audit 事件。

## Gate② 修复回归

- issue-2：新增 metadata `exists → absent` 提交闸门、per-thread mutation lock
  和删除后陈旧写入拒绝；缺 metadata、删除未提交与并发旧快照均有普通测试反例。
- issue-4：新增同一真实 `TestClient` lifespan 的三宿主冲突哨兵，启动后比较三本
  原始 JSON（含 revision），再通过 REST 删除 Web 目标并验证 CLI/cron 原文不变。
- issue-1、issue-3：按 x-fix 的 P2 规则保留在 issue ledger，未进入本轮代码修复。

本报告由 x-dev 于 2026-07-29 生成。
