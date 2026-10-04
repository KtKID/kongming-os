# Dev Report — context-compaction-implementation — 20260804

## 开发结果

- 完整删除旧 FIFO compactor 实现、合同、配置、装配和两份旧测试；活动源码与测试中的旧符号零命中。
- `ContextCompactionManager` 统一承接 `MANUAL`、`RUN_START`、`TOOL_RESULT`，摘要请求使用当前模型、完整 active context、固定压缩 prompt 和空 tools。
- FileSession 保存 raw transcript 与 checkpoint active projection，JSONL 支持 fsync、restart、损坏记录跳过与跨实例 CAS；通用 Session、InMemory 与 SQLite 源码保持原合同。
- `/compact` 使用宿主无关 action executor；CLI 与 Web 共用 runtime Protocol，Web 模块边界保持 core-free。
- 生产 catalog 六个 preset 均声明正整数 context window；测试用临时小窗口覆盖 90% 阈值和当前 preset 冲突哨兵。
- 真实 MiniMax-M3 完成主动 checkpoint、FileSession 重启、三项事实召回和后续续写；T10 进一步直接验证 checkpoint summary 使用用户日常语言并保留三项新事实。

## 红灯证据

新增 checkpoint backend、Manager 与触发 E2E 在生产实现前因缺少 checkpoint contract、`ContextCompactionManager` 和 Session active-context 方法失败；旧实现删除后 retirement sentinel 继续约束旧文件、合同与配置键。模块收口阶段 `uv run lint-imports` 曾以 `hosts.web.websocket.routes -> commands.service -> core.contracts` 报错，拆分 `context_compaction_action.py` 后同一门禁恢复为 20 个合同全绿。

## Scenario 验证证据

```verify
id: SC01-manual-command-checkpoint
scenario: SC_01
cmd: uv run pytest -p no:cacheprovider -q tests/e2e/test_context_compaction_triggers.py::test_manual_command_persists_checkpoint_and_restart_consumes_it tests/unit/test_web_ws_command_dispatch.py::test_ws_compact_command_uses_runtime_portal_and_sends_notice tests/unit/test_web_ws_command_dispatch.py::test_ws_compact_command_rejects_arguments_without_runtime_call tests/unit/test_web_ws_command_dispatch.py::test_ws_compact_command_rejects_attachment_without_runtime_call
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

```verify
id: SC02-run-start-boundary
scenario: SC_02
cmd: uv run pytest -p no:cacheprovider -q tests/e2e/test_context_compaction_triggers.py::test_run_start_compacts_after_new_user_before_normal_sampling
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC03-tool-result-batch
scenario: SC_03
cmd: uv run pytest -p no:cacheprovider -q tests/e2e/test_context_compaction_triggers.py::test_tool_result_compacts_only_after_complete_batch
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC04-below-threshold
scenario: SC_04
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_context_compaction_manager.py::test_auto_compact_skips_below_ninety_percent
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC05-current-preset-window
scenario: SC_05
cmd: uv run pytest -p no:cacheprovider -q tests/e2e/test_context_compaction_triggers.py::test_current_run_window_wins_over_runtime_and_prior_checkpoint
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC06-summary-request-shape
scenario: SC_06
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_context_compaction_manager.py::test_manual_compact_forces_summary_below_threshold tests/e2e/test_context_compaction_triggers.py::test_run_start_compacts_after_new_user_before_normal_sampling tests/e2e/test_context_compaction_triggers.py::test_tool_result_compacts_only_after_complete_batch
cwd: .
expect_exit: 0
expect_contains: 3 passed
mode: auto
```

```verify
id: SC07-file-projection-restart
scenario: SC_07
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_context_checkpoint_sessions.py::test_file_context_checkpoint_projection_and_restart
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC08-stale-cas
scenario: SC_08
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_context_compaction_manager.py::test_stale_summary_does_not_cover_concurrent_user tests/unit/test_context_checkpoint_sessions.py::test_file_checkpoint_commit_rejects_stale_revision
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC09-failure-recovery
scenario: SC_09
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_context_compaction_manager.py::test_invalid_summary_does_not_commit tests/unit/test_context_compaction_manager.py::test_provider_failure_keeps_active_context_unchanged tests/unit/test_context_compaction_manager.py::test_insufficient_reduction_does_not_commit_checkpoint
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

```verify
id: SC10-cancel-tool-batch
scenario: SC_10
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_runner_interrupt.py::test_interrupt_pending_tool_uses_also_get_placeholder
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC11-concurrent-idempotency
scenario: SC_11
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_context_compaction_manager.py::test_concurrent_same_revision_emits_one_completed_event tests/unit/test_context_checkpoint_sessions.py::test_file_checkpoint_commit_is_idempotent_per_source_revision
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC12-corrupt-checkpoint-recovery
scenario: SC_12
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_context_checkpoint_sessions.py::test_file_session_skips_corrupt_checkpoint_record_on_restart
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC13-fork-raw-prefix
scenario: SC_13
cmd: uv run pytest -p no:cacheprovider -q tests/unit/web/test_thread_fork.py::test_historical_fork_uses_raw_prefix_without_future_checkpoint_summary
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC14-minimax-live-restart
scenario: SC_14
mode: manual
steps: 加载 .env 并清除代理变量，设置 KONGMING_RUN_LIVE_CONTEXT_COMPACTION=1 后运行 tests/e2e/test_context_compaction_minimax_live.py；确认最终版本 1 passed in 14.48s，JSONL 含 8 条 message 与 1 条 manual checkpoint，直接读取 summary 可见中文主体与 ALPHA/BETA/GAMMA 精确值、prompt_version=context-checkpoint-v2，重启后准确召回三个值并继续对话。
```

```verify
id: SC15-window-config-boundaries
scenario: SC_15
cmd: uv run pytest -p no:cacheprovider -q tests/unit/config/test_model_catalog_runtime_v2.py::test_catalog_rejects_missing_or_non_positive_context_window tests/unit/config/test_model_catalog_runtime_v2.py::test_builtin_catalog_declares_verified_context_windows tests/e2e/test_context_compaction_triggers.py::test_current_run_window_wins_over_runtime_and_prior_checkpoint
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

```verify
id: SC16-old-module-retired
scenario: SC_16
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_context_compaction_retirement.py tests/unit/runtime_assembly/test_session_engine_history_portal.py::test_in_memory_continue_path_remains_available tests/unit/runtime_assembly/test_session_engine_history_portal.py::test_manual_compact_requires_file_session
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

```verify
id: SC17-physical-overflow
scenario: SC_17
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_context_compaction_manager.py::test_auto_compact_rejects_context_already_over_physical_window
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC18-durable-ack-retry
scenario: SC_18
cmd: uv run pytest -p no:cacheprovider -q tests/unit/test_context_compaction_manager.py::test_durable_restart_retry_reuses_checkpoint_without_second_llm_call
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

## 补充质量证据

- 本次改动涉及的 Python 回归：`304 passed in 101.86s`。
- 三种 trigger E2E：`4 passed`。
- MiniMax-M3 live：`1 passed in 23.52s`；JSONL 含 8 条 raw message 与 1 条 checkpoint，窗口 1,000,000，阈值 900,000，usage 完整。
- `bash scripts/lint.sh`：Ruff 通过，import-linter 20 个合同通过。
- `bash scripts/typecheck.sh`：427 个源文件通过。
- `uv run ruff format --check src evals/src tests`：975 个文件通过。
- Web `pnpm typecheck`、RuntimeSection 3 项、system notice 5 项通过；全量 Vitest 探测另有 19 个既有失败，集中在项目树 fixture 与重复 terminal 测试。
- `git diff --check`：通过。

## T10 · 用户日常语言与新增事实

- RED：新增 prompt 合同后，旧 `context-checkpoint-v1` 缺少 `the language the user normally uses`，聚焦测试按预期失败。
- 实现：prompt 升级为 `context-checkpoint-v2`，明确要求沿用用户日常语言并保留新增事实；live 用户语料使用“这个返回值是新的事实，压缩摘要必须保留它”，没有“请记住”。
- 直接证据：checkpoint `replacement_history[-1]` 必须以中文为主体，并包含真实模型生成的 ALPHA/BETA/GAMMA 三个精确值；事实解析同时接受 `KEY=value` 与 Markdown 表格。
- MiniMax live 首次执行产出中文表格并保留全部事实，旧格式 oracle 按预期暴露；修正测试解析、中文主体检查和 prompt version 持久化断言后，最终真实链路 `1 passed in 14.48s`。
- 聚焦回归：`18 passed, 1 skipped`；Ruff check/format、目标 mypy、`git diff --check` 通过。Q3 tri-lens 的 P1 真实门禁缺口已由本次 live 通过关闭，两项 P2 测试强度问题已同步收紧。

本报告初版由 x-dev 于 2026-08-04 生成，T10 于 2026-08-05 补充。
