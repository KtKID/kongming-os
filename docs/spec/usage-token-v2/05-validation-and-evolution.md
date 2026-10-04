# 验证策略与演进

## 测试金字塔

```
                    ┌──────────────────┐
                    │  Playwright e2e  │  ← 三通道开 thread 跑一轮，断言字段
                    └──────────────────┘     1:1 对齐 SDK 真源
                          ▲   3 用例
                    ┌─────┴─────────────────┐
                    │   集成测试 (pytest)    │  ← manager 真接 locator 真扫 fixture jsonl
                    └───────────────────────┘     ~10 用例
                          ▲
                ┌─────────┴────────────────────┐
                │     单元测试 (pytest)         │  ← 每个派生器 + DTO + locator + schema
                └──────────────────────────────┘     ~50 用例
                          ▲
        ┌─────────────────┴────────────────────────┐
        │   静态分析 (mypy / ruff / import-linter)  │
        └──────────────────────────────────────────┘
```

## 单元测试清单

### `_derive_claude.py`（8+ 用例）

| 用例 | 覆盖 |
|---|---|
| `test_returns_none_when_file_missing` | 不存在文件 → None |
| `test_returns_none_for_empty_file` | 空文件 → None |
| `test_returns_none_when_no_assistant_entry` | 只有 user/system entry → None |
| `test_single_assistant_maps_all_fields` | 单条全字段 1:1 映射 |
| `test_takes_last_assistant_when_multiple` | 多条取最后一条（不累加！） |
| `test_skips_malformed_line` | 单行损坏 skip，其他行正常 |
| `test_skips_assistant_without_usage` | 缺 usage 字段 skip |
| `test_cache_creation_ttl_breakdown` | `cache_creation.ephemeral_1h/5m` 嵌套正确 |
| `test_context_usage_derived` | `context_usage = input + cache_read + cache_creation` |
| `test_model_falls_back_to_earlier_when_final_missing` | 最后一条无 model 取倒数第二条 |
| `test_streaming_does_not_oom_on_large_file` | 10000 行不 OOM |
| `test_unreadable_file_returns_none` | 权限错误 → None |

### `_derive_codex.py`（8+ 用例）

| 用例 | 覆盖 |
|---|---|
| `test_returns_none_when_file_missing` | 不存在 → None |
| `test_returns_none_when_no_token_count_event` | 没 token_count 事件 → None |
| `test_skips_token_count_with_null_info` | `info=None` 跳过，取下一条 |
| `test_takes_last_non_null_info` | 多条非空 info 取最后一条 |
| `test_maps_total_and_last_breakdown` | total / last 5 字段 1:1 |
| `test_maps_model_context_window` | `info.model_context_window` 透传 |
| `test_maps_rate_limits_when_present` | rate_limits primary/secondary 透传 |
| `test_rate_limits_none_when_missing` | 没 rate_limits → DTO.rate_limits=None |
| `test_skips_non_token_count_events` | response_item / turn_context / 其他事件跳过 |
| `test_skips_malformed_line` | 损坏行 skip |

### `_derive_generic.py`（8+ 用例，task 实施前敲定细节）

| 用例 | 覆盖 |
|---|---|
| `test_anthropic_preset_returns_GenericChatAnthropicUsage` | preset 分支正确 |
| `test_openai_preset_returns_GenericChatOpenAIUsage` | 同上 |
| `test_takes_last_usage_for_anthropic` | Anthropic 系不累加 |
| `test_accumulates_for_openai` | OpenAI 系累加（待 task 实施前确认） |
| `test_unknown_preset_returns_none` | 未知 preset → None |
| `test_session_backend_memory/sqlite/file` | 3 个 backend 各覆盖 |
| `test_no_message_returns_none` | 空 session → None |

### `manager.py`（10+ 用例）

| 用例 | 覆盖 |
|---|---|
| `test_get_thread_usage_claude_code_dispatches_to_claude_deriver` | 通道分发 |
| `test_get_thread_usage_codex_dispatches_to_codex_deriver` | 同上 |
| `test_get_thread_usage_generic_chat_dispatches_to_generic_deriver` | 同上 |
| `test_returns_none_when_meta_reader_returns_none` | thread 不存在 → None |
| `test_returns_none_when_backend_kind_unknown` | 未知 backend → None |
| `test_returns_none_when_locator_returns_none` | locator 找不到真源 → None |
| `test_derive_failure_returns_none_silently` | 派生抛异常 → None（不冒泡） |
| `test_manager_has_no_state_fields` | grep `self._` 只有注入的 locator |
| `test_100_concurrent_queries_no_lock_no_race` | 100 路并发查不同 thread 正确返回 |
| `test_repeated_query_no_caching_each_re_reads` | 连续 2 次同 thread_id 调用，meta_reader 被调 2 次 |
| `test_init_does_no_io` | `__init__` 不读盘 / 不开文件 |

### DTO（10+ 用例）

| 用例 | 覆盖 |
|---|---|
| `test_claude_usage_frozen` | `frozen=True` 阻止 mutate |
| `test_codex_usage_extra_forbid` | 未知字段拒绝 |
| `test_provider_discriminator_literal` | provider 是 Literal 类型 |
| `test_cache_creation_default_zero` | 默认值 0 |
| `test_dto_model_dump_round_trip` | model_dump → model_validate roundtrip |
| `test_dto_does_not_leak_to_outside_module` | tests 之外 grep 无外部直接构造 |

### Locator + Protocol

| 用例 | 覆盖 |
|---|---|
| `test_claude_locator_jsonl_path_lookup` | cwd+claude_thread_id → 路径正确 |
| `test_codex_locator_scans_sessions_by_uuid` | 按 codex_thread_id 扫到 rollout |
| `test_locator_returns_none_for_missing_thread` | thread 不存在 → None |
| `test_locators_satisfy_runtime_checkable_protocol` | `isinstance` 通过 |

### Schema v9（5+ 用例）

| 用例 | 覆盖 |
|---|---|
| `test_v8_lazy_upgrade_drops_token_fields` | v8 文件含 3 字段读入 → v9 无字段 |
| `test_v9_idempotent` | v9 文件再过 upgrade 不变化 |
| `test_v7_via_v8_to_v9_chain` | 多层升级链穿透 |
| `test_v10_unknown_schema_returns_none` | 未来版本被拒绝 |
| `test_extra_forbid_rejects_unknown_field` | v9 仍 `extra="forbid"` |

## 集成测试（10+ 用例）

### `tests/integration/web/usage_token_v2/`

| 用例 | 覆盖 |
|---|---|
| `test_full_claude_query_with_real_jsonl_fixture` | manager + 真 Claude jsonl fixture |
| `test_full_codex_query_with_real_rollout_fixture` | manager + 真 Codex rollout fixture |
| `test_full_generic_chat_query` | manager + 我们 session backend fixture |
| `test_manager_v2_with_actual_thread_metadata_reader` | 真 ThreadMetadataIOAdapter |
| `test_ws_frame_built_with_v2_dto` | ws_event_sink emit 后帧含正确 DTO |
| `test_router_usage_endpoint_returns_v2_dto` | GET /threads/<tid>/usage |
| `test_v1_v2_coexistence_during_migration` | v1 manager + v2 manager 并存调用 |

## E2E 测试（3 用例 + n）

### `web/tests/e2e/usage-v2.spec.ts`

| 用例 | 覆盖 |
|---|---|
| `test_claude_thread_displays_full_field_set` | 开 claude_code thread，发问，StatusLine 显示 7 个字段（input/output/cache_read/cache_creation/1h/5m/context%） |
| `test_codex_thread_displays_codex_specific_fields` | 开 codex thread，StatusLine 显示 total/last 4 字段 + 模型上限来自后端而非前端表 |
| `test_generic_chat_thread_displays_backend_fields` | 开 generic_chat thread，按底层 provider 显示对应组件 |
| `test_tab_switch_does_not_break_state` | 在 3 个不同通道 thread 之间切换，每个 StatusLine 正确刷新 |
| `test_metadata_json_has_no_token_fields_after_run` | 跑完一轮，cat metadata.json，断言无 cumulative_usage 等 |

## 静态分析 / Lint

| 工具 | 检查内容 |
|---|---|
| **mypy** | `UsageTokenManager.get_thread_usage` 返回类型是 union；前端按 provider narrow 类型收窄正确 |
| **ruff** | `usage_token_v2/` 包内无未使用 import；DTO 字段顺序按规范 |
| **import-linter** | Contract 9 升级（见 [04-data-and-state.md](./04-data-and-state.md#importlinter-contract-9-升级)），CI gate 通过；故意写一行外部 import 派生器，CI 拒绝 |
| **架构合约 grep** | `grep -r "from web.usage.usage_token_v2._" src/ tests/ --exclude-dir=usage_token_v2` 应为 0 命中 |

## 验证脚本（落入 `dev-pipeline/tasks/<task>/dev-report.md`）

每个实施 task 的 dev-report 必带：

```
| 命令 | 预期 exit | 关键输出 |
|---|---|---|
| `uv run pytest tests/unit/web/usage/usage_token_v2/ -v` | 0 | `<N> passed` |
| `uv run pytest tests/integration/web/usage_token_v2/ -v` | 0 | `<M> passed` |
| `uv run mypy src/web/usage/usage_token_v2/` | 0 | `Success: no issues found in <K> source files` |
| `uv run ruff check src/web/usage/usage_token_v2/ tests/unit/web/usage/usage_token_v2/` | 0 | `All checks passed!` |
| `uv run lint-imports` | 0 | `Contracts: 8 kept, 0 broken.` |
| `cd web && npm run typecheck` | 0 | （静默通过） |
| `cd web && npm run build` | 0 | `built in ` |
| `npx playwright test web/tests/e2e/usage-v2.spec.ts` | 0 | `passed` |
| `find .kongming -name metadata.json -exec grep -l cumulative_usage {} \;` | 0 | 空（应该没有任何 metadata.json 含此字段） |
```

## 风险点

### R1：codex rollout 文件定位失败

**风险**：codex rollout 文件路径含日期戳（年/月/日），扫描可能慢或失败。

**缓解**：

- codex_locator 用 `web/codex/projects_scanner.py` 的现成 scanner（已有 sessions 按日期排序的逻辑）
- 缓存 path 解析结果到 thread metadata（codex_thread_id → rollout_path）一次性写入，后续直接拿 —— **但**：v2 原则是 metadata 无 token 字段，path 缓存可以加但要明确是"非 token 数据"
- 退路：找不到 rollout 时返回 None，前端显示"暂无 token 数据"

### R2：派生器扫文件性能

**风险**：1500 行 jsonl 每次查询都扫一遍，10 tab 同时打开 = 10 次扫描。

**缓解**：

- jsonl 流式读 1500 行实测 1-2ms，不是热点
- 同 thread_id 同次 hydrate **不重复调** manager —— 由前端缓存（避免一次打开页面调 100 次）
- 如果实测有性能问题，加 **mtime 缓存**：locator 返回 `(path, mtime)`，manager 检查 mtime 不变就用缓存（**但**这会引入 manager 状态，跟无状态原则冲突）—— v2 不做，留 v3

### R3：generic_chat 通道细节未定

**风险**：session backend 数据格式 / preset_id → provider 映射 / 是否累加 OpenAI 系，3 个决策点 spec 没敲定。

**缓解**：

- task 实施前补 spec（task-map 里独立列一个 spec-finalization task）
- 实施期间如果发现 generic_chat 复杂度过高，**可以延后**到 v2 完成 claude/codex 通道后单独 task

### R4：v1 v2 并存期的数据一致性

**风险**：迁移期间 v1 还在写 metadata.json 的 token 字段，v2 已经读 SDK 真源。两个数据源可能不一致（譬如服务端重启不久，jsonl 还没追加但 v1 已写 metadata）。

**缓解**：

- v1 公共方法保留写盘 —— 但 v1 `get_thread_summary` 在 v0.1 已经走派生（**已经一致**）
- task 6 删 v1 包前确保所有消费方都切到 v2
- 监控期：v1 v2 并存阶段，dev-pipeline 加一个验证 task 跑 24 小时不出现新损坏文件

### R5：schema v9 迁移破坏旧 thread

**风险**：lazy upgrade v8→v9 drop 3 字段，如果有人误读这些字段会失败。

**缓解**：

- grep 全仓 `cumulative_usage` / `last_run_snapshot` / `last_model_name`，确保只有 v1 包内使用（v1 包 task 6 一并删）
- DTO 验证：`extra="forbid"` 拦截写盘时残留旧字段

### R6：前端 codegen 协议漂移

**风险**：后端 Pydantic DTO 改了，前端 TS 接口没同步。

**缓解**：

- `protocol.ts` 改为 codegen 产物（v1 已有此机制，沿用）
- pre-commit hook 跑 codegen + diff 检查

## 演进路径

### v2 完成后（确定）

- metadata.json 完全无 token 字段
- 三通道走对称的"SDK 真源派生"
- manager 无状态门面

### v3 候选（未承诺）

| 候选 | 描述 |
|---|---|
| Token 计费金额 | 按 service_tier / cache TTL 不同价表算钱 |
| 跨 thread 聚合 | 用户总用量、月度账单 |
| Server tool 计费 | Claude 的 web_search_requests / web_fetch_requests 按次 |
| Codex rate_limits 前端 | 进度条 + 即将耗尽时警告 |
| 派生缓存 | manager 加 mtime 缓存（破例引入状态，需 spec 决议） |

### 不会做（spec 排除）

- 不引入"manager 自己存 token"（即使为了缓存）
- 不强行统一 ClaudeUsage / CodexUsage 字段（语义就是不同）
- 不让外部模块直接 import 派生器（Contract 9 永久禁止）
