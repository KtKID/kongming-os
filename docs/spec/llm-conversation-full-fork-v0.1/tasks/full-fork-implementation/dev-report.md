# Dev Report — full-fork-implementation — 20260727-181458

## 改动文件

- `src/hosts/web/threads/{manager,metadata,types,errors}.py`
- `src/hosts/web/uploads/storage.py`
- `src/hosts/web/routers/threads.py`
- `src/hosts/web/protocol/rest_models.py`
- `web/src/protocol.ts`
- `web/src/stores/threads.ts`
- `web/src/components/{ThreadList,SidebarSessionRow}.tsx`
- `web/src/chat/{ChatTimelineStore,runtimeWiring}.ts`
- `tests/unit/web/test_thread_fork.py`
- `tests/unit/web/test_thread_fork_protocol.py`
- `tests/e2e/test_web_thread_fork_smoke.py`
- `tests/support/web_thread_fork_e2e_server.py`
- `web/tests/e2e/thread-fork.spec.ts`
- `web/playwright.thread-fork.config.ts`
- 相关 metadata、路由、store、组件与时间线回归测试
- `docs/modules/Web前端/README.md`
- `docs/spec/llm-conversation-full-fork-v0.1/`

## 红灯证据与修复

| 层 | 红灯事实 | 修复 |
|---|---|---|
| unit | 首轮 Manager 对抗测试出现 7 个失败：pending approval/send-now claim 未阻断、metadata 提前可见、取消窗口残留、资产全目录复制、缺失 payload/metadata 未形成整体失败 | 快照门禁覆盖四类未闭合状态；目标 metadata 最后提交；在途 IO 使用 shield 收口；按历史 ready 引用闭包复制并执行一致性校验 |
| unit | 历史附件测试只得到 text part，`metadata.attachments` 未进入可见时间线 | `ChatTimelineStore` 从 `NormalizedMessage.metadata.attachments` 恢复附件 part，并校验 wire 必填字段 |
| e2e | fork 后直接刷新目标页面时历史 marker 消失；trace 显示 history 已到达新 store，视图仍订阅 StrictMode 清理阶段销毁的旧 store | 时间线引用归零后延迟至微任务边界释放，并用 store identity 防止迟到清理删除新实例 |
| regression | 21 个 metadata/lifecycle 回归用例在装配阶段使用退役模型配置，无法执行 schema v12 断言 | 测试夹具升级到 `model.preset_id + model-providers.yaml` 当前真源，并同步 `ThreadCell.host_dispatcher` 字段 |
| QA Gate P1 | fork 的 metadata 已写入且请求取消时，并发 `boot_or_attach` 可读取旧 metadata 并复活已清理目标 | fork 在目标 boot lock 内完成取消清理；`boot_or_attach` 获锁后重读 metadata；同一竞争测试由红转绿 |
| QA Gate P1 | 旧 localStorage DTO 缺少 provider thread ID 时侧栏读取 `undefined.length` 崩溃 | 缓存入口补齐 provider/source/lineage 默认值，组件访问使用空串兜底；store 与组件原始旧缓存样本转绿 |
| QA Gate P1 | usage 隔离、附件部分复制回滚缺少可执行证据；issue-2 基于越界的 SQLite 规格承诺 | FileSession 写入 source 非零 usage并断言 target 为零；新增附件 A 已复制、附件 B 失败的目录清理断言；撤回 SQLite 验收并增加 FileSession-only Manager 门卫 |
| QA Gate P1 | 扩展 ThreadManager 回归有 36 项仍使用退役模型配置，测试在 Manager 逻辑前失败 | boot/evict 夹具迁移到 `preset_id + model-providers.yaml`，保留 p1/p2/preset-1 输入；原命令从 36 failed/128 passed 转为 164 passed |

上述红灯均由原测试转绿，未使用 skip、xfail 或宽松断言。

## Scenario 证据映射

| Scenario | 层 | 真实边界 |
|---|---|---|
| SC_01 | unit | `ThreadManager → Session`，逐字段深拷贝 tool/reasoning/metadata |
| SC_02 | smoke | `FastAPI TestClient → ThreadManager → FileSession → AssetStorage`，删除源后读取目标附件 |
| SC_03–SC_07 | unit | Manager 快照门禁、REST 错误映射、多阶段失败回滚 |
| SC_08–SC_09 | unit + smoke | source 非零 usage 与 target 零值、run/permissions 独立、直接父 lineage、metadata v1-v12 与 Python/TS 合同 |
| SC_10 | e2e | 隔离浏览器点击 → Zustand → REST → 目标 route；opt-in 真实 Web/真实 MiniMax-M3 同时完成 source 首发、UI fork 与目标续聊 |
| SC_11 | smoke + e2e | 新 FileSession 恢复目标历史且目标 run count 为零；真实目标 WebSocket 续聊的 LLM request 携带 system/user/assistant/user 四条上下文 |
| SC_12 | unit | 顺序重复 fork 与 200 字符标题边界 |
| SC_13 | smoke | 真实 Manager/AssetStorage 与阻塞 IO 窗口注入取消，并发 boot 验证锁内重读与清理 |
| SC_14 | unit | ready 引用闭包、无关资产排除、附件 A 已复制后 B 缺件的完整回滚与多段扩展名 |

## 自动验证

```verify
id: SC01-full-history
scenario: SC_01
cmd: uv run pytest -q tests/unit/web/test_thread_fork.py::test_fork_copies_full_llm_history_lineage_and_assets
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC02-independent-assets
scenario: SC_02
cmd: uv run pytest -q tests/e2e/test_web_thread_fork_smoke.py::test_rest_fork_persists_full_history_and_independent_asset
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 120
mode: auto
```

```verify
id: SC03-active-approval-gate
scenario: SC_03
cmd: uv run pytest -q tests/unit/web/test_thread_fork.py -k 'fork_rejects_active_source or fork_rejects_pending_approval'
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC04-pending-gate
scenario: SC_04
cmd: uv run pytest -q tests/unit/web/test_thread_fork.py -k 'fork_rejects_pending_queue or fork_rejects_send_now_claim'
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC05-owned-scope
scenario: SC_05
cmd: uv run pytest -q tests/unit/web/test_thread_fork.py -k 'provider_owned or scheduled_task or non_file_backend'
cwd: .
expect_exit: 0
expect_contains: 5 passed
mode: auto
```

```verify
id: SC06-http-errors
scenario: SC_06
cmd: uv run pytest -q tests/unit/test_web_routers_threads.py -k 'fork_thread_missing_source or fork_thread_invalid_source'
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC07-transaction-rollback
scenario: SC_07
cmd: uv run pytest -q tests/unit/web/test_thread_fork.py -k 'fork_append_failure or fork_metadata_commit_failure'
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC08-independent-state
scenario: SC_08
cmd: uv run pytest -q tests/unit/web/test_thread_fork.py::test_repeated_and_nested_forks_use_new_ids_direct_lineage_and_fresh_state tests/e2e/test_web_thread_fork_smoke.py::test_rest_fork_persists_full_history_and_independent_asset
cwd: .
expect_exit: 0
expect_contains: 2 passed
mode: auto
```

```verify
id: SC09-schema-contract
scenario: SC_09
cmd: uv run pytest -q tests/unit/web/test_thread_fork_protocol.py tests/unit/web/test_thread_metadata_v2.py::test_read_v1_file_auto_upgrades_to_v12 tests/unit/web/test_thread_metadata_v10.py::test_v9_file_upgraded_to_v12_default_not_archived tests/unit/test_web_thread_metadata.py::test_v13_unknown_schema_returns_none
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

```verify
id: SC10-browser-flow
scenario: SC_10
cmd: pnpm test:e2e:thread-fork
cwd: web
expect_exit: 0
expect_contains: 1 passed
timeout: 120
mode: auto
```

```verify
id: SC11-persistent-recovery
scenario: SC_11
cmd: uv run pytest -q tests/e2e/test_web_thread_fork_smoke.py
cwd: .
expect_exit: 0
expect_contains: 1 passed
timeout: 120
mode: auto
```

```verify
id: SC12-repeat-title
scenario: SC_12
cmd: uv run pytest -q tests/unit/web/test_thread_fork.py::test_repeated_and_nested_forks_use_new_ids_direct_lineage_and_fresh_state
cwd: .
expect_exit: 0
expect_contains: 1 passed
mode: auto
```

```verify
id: SC13-cancellation-windows
scenario: SC_13
cmd: uv run pytest -q tests/unit/web/test_thread_fork.py -k 'fork_cancellation'
cwd: .
expect_exit: 0
expect_contains: 3 passed
timeout: 120
mode: auto
```

```verify
id: SC14-asset-closure
scenario: SC_14
cmd: uv run pytest -q tests/unit/web/test_thread_fork.py -k 'copies_only_ready or missing_referenced or preserves_multi_suffix'
cwd: .
expect_exit: 0
expect_contains: 4 passed
mode: auto
```

## 质量检查

- 相关前端扩展回归：73 passed。
- ThreadManager metadata/lifecycle/route/fork 扩展回归：164 passed。
- metadata/lifecycle 现代化夹具回归：21 passed。
- Playwright 隔离 E2E：1 passed，覆盖一次 POST、目标导航、tool/附件回放、刷新恢复与源历史可打开。
- Playwright 真实 LLM E2E：1 passed（21.6s）；source `thread-04a902cd8551` 使用 `minimax-m3` 首发成功，fork `thread-300aa8f539c1` 返回 201，目标续聊回复确认 source marker；持久证据见 `reports/verify/real-llm-thread-fork-e2e-20260728-105431.md`。
- `pnpm typecheck`、目标文件 ESLint、目标 Python Ruff/mypy、20 条 import-linter 合同均通过。
- RAG：`skipped:no-corpus`，遵循用户指令。
- QA Gate P1 聚焦复跑：取消竞态与部分附件 2 passed；旧缓存 store/component 21 passed；FileSession 持久化 smoke 1 passed。
- Q3 原始 tri-lens 登记 6 个 P1/P2，x-fix 追加 1 个扩展回归 P1；5 个 P1 已关闭，SQLite 范围 issue-2 已撤回，2 个 P2 保持非阻塞登记。
- 修复扩展后的裁剪 tri-lens：P0 ×0、P1 ×0、P2 ×0；最终 xdev verify 再次 14/14 通过。

本报告由 x-dev 于 2026-07-27T18:14:58Z 生成。
