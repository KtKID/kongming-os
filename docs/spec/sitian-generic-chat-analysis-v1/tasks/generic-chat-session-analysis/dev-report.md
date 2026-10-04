# Dev Report — generic-chat-session-analysis — 20260802

## 改动

- `SiTianSourceKind` 收敛五种 source kind，新增 `generic_chat`；配置示例明确其 `path` 是 Kongming home，`generic_channel` 保持工作区文件扫描。
- `global_scanner.py` 用纯 stdlib 读取 metadata、FileSession manifest 与 JSONL，通过 `thread_id` 关联；metadata 提供标题/通道/业务类型，manifest 提供 cwd，JSONL 提供正文和最近活动时间。
- `session_reader.py` 在已有逆序分块读取器上新增 `read_kongming_session_tail()`；只保留有界的 user/assistant 文本，排除 system、tool、空正文、附件 metadata 和 tool calls。
- `SiTianScanSource` 分派 `generic_chat`，输出既有 Analyzer 所需的 project/thread observations；`generic_chat` 按 cwd 逐项目物化 work item。
- 保持现有 `SiTianRunOnce`、Analyzer、RecordsStore、报告 API 和前端 `SitianManager` 入口。新增真实 `write_thread_metadata()`、`FileSession.append()` 到 FastAPI 报告端点的闭环测试。
- 修复已有报告路由测试夹具的模型配置漂移：当前 `Config` 使用 `model.preset_id`。

## 红灯证据

- 初始测试收集失败：`read_kongming_session_tail` 与 `SiTianSourceKind` 尚未存在。
- 首轮通用频道回归发现 `generic_channel` 的 return 被错误放入 generic_chat 分支，`SiTianRunOnce` 收到 `NoneType`；已回归到原文件扫描分支。
- 真实闭环测试首轮因过期的 `model.name/base_url/api_key` 配置字段失败；已改为当前 `model.preset_id` 合同。报告路由既有 6 条测试也通过该修复恢复运行。
- mypy 首轮指出 metadata JSON 的 `id/format` 可能为 `None`；`global_scanner` 已用 `TypeGuard[str]` 在路径拼接前收窄。
- Gate R1 的未知 JSONL 反例首次失败：缺失 `record_type` 的 user-shaped 行进入了 tail 与 Analyzer prompt；reader 已收紧为显式 `record_type="message"`。

## 验证证据

```verify
id: SC01-source-kind-and-generic-channel
scenario: SC_01
cmd: .venv/bin/pytest -q tests/unit/test_sitian_generic_chat.py::test_source_kind_serializes_generic_chat_and_rejects_unknown tests/unit/test_sitian_service.py::test_sitian_run_once_materializes_workspace_state
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC02-contract-truth-sources
scenario: SC_02
cmd: .venv/bin/pytest -q tests/unit/test_sitian_generic_chat.py::test_generic_chat_scanner_uses_contract_truth_sources
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC03-channel-kind-window-filter
scenario: SC_03
cmd: .venv/bin/pytest -q tests/unit/test_sitian_generic_chat.py::test_generic_chat_scanner_filters_backend_kind_thread_kind_and_window
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC04-bounded-kongming-tail
scenario: SC_04
cmd: .venv/bin/pytest -q tests/unit/test_sitian_session_reader.py::test_reads_kongming_tail_with_role_filter_and_bounds tests/unit/test_sitian_session_reader.py::test_kongming_tail_requires_explicit_message_record_type
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC05-corruption-and-root-error
scenario: SC_05
cmd: .venv/bin/pytest -q tests/unit/test_sitian_generic_chat.py::test_generic_chat_skips_corrupted_threads_and_records_missing_root_failure
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC06-per-cwd-work-item
scenario: SC_06
cmd: .venv/bin/pytest -q tests/unit/test_sitian_generic_chat.py::test_generic_chat_materializes_one_work_item_per_cwd
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC07-analyzer-consumes-generic-observations
scenario: SC_07
cmd: .venv/bin/pytest -q tests/e2e/test_sitian_generic_chat_report_e2e.py
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC08-real-producer-runonce-store-report
scenario: SC_08
cmd: .venv/bin/pytest -q tests/e2e/test_sitian_generic_chat_report_e2e.py
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC09-report-api-e2e
scenario: SC_09
cmd: .venv/bin/pytest -q tests/e2e/test_sitian_generic_chat_report_e2e.py
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC09-sitian-manager-visible-state
scenario: SC_09
cmd: pnpm exec vitest run src/modules/sitian/__tests__/manager.test.ts
cwd: web
expect_exit: 0
expect_contains: 10 passed
mode: auto
```

```verify
id: SC10-non-chat-content-excluded
scenario: SC_10
cmd: .venv/bin/pytest -q tests/e2e/test_sitian_generic_chat_report_e2e.py tests/unit/test_sitian_session_reader.py::test_kongming_tail_skips_corrupted_and_non_message_records
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC11-existing-scanner-regression
scenario: SC_11
cmd: .venv/bin/pytest -q tests/unit/test_sitian_service.py::test_sitian_scan_claude_project_reads_matching_sessions tests/unit/test_sitian_service.py::test_sitian_scan_codex_project_reads_matching_sessions tests/unit/test_sitian_service.py::test_sitian_scan_claude_workspace_lists_top_projects_by_mtime tests/unit/test_sitian_scanner_recent_sessions.py
cwd: .
expect_exit: 0
expect_contains: 17 passed
mode: auto
```

## 静态与架构检查

- `uv run mypy src/sitian/config.py src/sitian/global_scanner.py src/sitian/session_reader.py src/sitian/scanners.py src/sitian/suggestions.py`：5 个文件无问题。
- `uv run ruff check`（本任务的司天生产/测试文件）与 `git diff --check`：通过。
- `uv run lint-imports`：20 条架构合同保持通过；其中包含 `sitian must not depend on host runtime or application workflow`。

## Gate ② 结论

- Q3 tri-lens R1 发现并登记 issue-1：缺失 `record_type` 的 JSONL 行会被误采集。修复与 reader/E2E 红绿证据记录在 `reports/fix/fix-gate-r1-20260802-120100.md`。
- 增量复核复跑全部 12 个 auto verify 块，结果为 fail=0、uncovered=0；P0=0、P1=0。
- issue-2 至 issue-4 为已登记的 P2 证据与状态改进项，不阻断本次 Gate；其上下文保留在 `reports/qa-gate/qa-gate-report-20260802-115931.md`。
- Gate ②：PASS。

## 自检结论

本人（x-dev）已在本机运行全部 auto verify 命令，并确认结果与本报告一致。
本报告由 x-dev 于 2026-08-02 生成。
