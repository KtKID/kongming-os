# 目标与完成标准

## 系统目标

1. **架构收敛**：把当前散落在 11 处定义点、跨 6 条数据流的 token 用量逻辑收敛到 `UsageTokenManager` 单一入口
2. **强边界**：通过 `.importlinter` Contract 机器强制——外部模块禁止直接持有 `TokenUsage` 内部数据结构
3. **零 lossy 归一化**：anthropic / openai 各自保留 SDK 原生字段语义，不再强行映射到统一 5 字段
4. **修显示 bug**：StatusLine 不再显示 cumulative 累加误导，改显示「当前 context 占用 / 模型上限 (%)」
5. **修持久化空跑**：Claude Code / Codex 通道每轮真实写盘 cumulative_usage，删 router 临时算
6. **修 Anthropic lossy 翻译**：`anthropic_messages.py` 不再把 `prompt_tokens = input_tokens`（漏算 cache）

## DoD（验收清单）

每条都可独立验证。

### D1. 架构边界

- [ ] `src/web/usage_token/` package 创建，内部子模块 `_models.py / _channel_anthropic.py / _channel_openai.py / _persistence.py / _migration.py` 全部下划线前缀
- [ ] `.importlinter` 新增 `usage-token-encapsulation` contract，未通过 lint 不能 merge
- [ ] `make lint` 跑 import-linter 通过；故意写一行 `from web.usage_token._models import TokenUsage` 在外部模块时 lint 报错
- [ ] `web.usage_token.__init__` 只 export `UsageTokenManager` + 公共 DTO（`UsageTokenSnapshot` / `ThreadUsageSummary` / `UsageFrame`）

### D2. 外部 API

- [ ] 公共方法 ≤ 7 个：`record_run_usage` / `get_thread_summary` / `get_last_run_snapshot` / `to_ws_frame` / `context_window` / `context_usage_pct` / `reset_thread`（如果有）
- [ ] 所有方法签名带类型注解；不返回 `TokenUsage` 实例
- [ ] manager 公共 API 100% 单测覆盖

### D3. channel 分发内部化

- [ ] 外部模块没有任何代码出现 `channel == "anthropic"` / `channel == "openai"` 的分支（grep 全仓验证）
- [ ] anthropic / openai 的字段映射、累加规则、派生公式都在 `_channel_anthropic.py` / `_channel_openai.py` 实现
- [ ] backend_kind → channel 的映射规则在 manager 内部（`claude_code→anthropic` / `codex→openai` / `generic_chat→按底层 provider`）

### D4. 11 处定义点收敛

- [ ] grep 验证：手工定义 token 字段的位置 ≤ 5 处（manager 内部 1 处 + 必需公共 5 处：LLMResponse.usage / Event payload / UsageFrame / ThreadMetadata 残壳 / StatusLine）
- [ ] 删除：`ThreadMetadataDTO`、前端 `UsageSnapshot` store shape、`tokenBudget` per-message normalizer
- [ ] 改为自动生成：前端 `protocol.ts` 的 `UsageFrame` / `ThreadUsageSummary` / `UsageTokenSnapshot` 由 codegen 产出
- [ ] 测试 fixture 工厂化：用 `make_usage_*()` 函数构造，不硬编码字段名

### D5. ThreadMetadata 改造

- [ ] schema v7→v8：删 5 个旧 `cumulative_*_tokens` 字段；改为 `cumulative_usage: dict[str, Any]`（透明 dict 落盘，仅 manager 能解释）
- [ ] lazy upgrade v7→v8 在 `_migration.py` 实现：按 `backend_kind` 把旧字段映射到嵌套 TokenUsage 结构
- [ ] 3 个 channel 各有 fixture 单测，跑迁移后旧字段彻底删除、新结构正确
- [ ] `extra="forbid"` 仍然生效，旧字段残留会拒绝

### D6. 三通道持久化空跑修复

- [ ] `claude_code` WS handler 每轮结束调 `manager.record_run_usage(channel="anthropic", raw_payload=...)`
- [ ] `codex` WS handler 每轮结束调 `manager.record_run_usage(channel="openai", raw_payload=...)`
- [ ] `generic_chat` 通道（已有的 UsagePersistSink）改走 manager
- [ ] 删 `routers/threads.py::_to_dto` 里对 `parse_transcript_usage` 的临时计算（claude_code 路径）
- [ ] 三通道跑完一轮后，`ThreadMetadata.cumulative_usage` 都有真实值（断言测试覆盖）

### D7. WS / REST 帧改造

- [ ] `UsageFrame` 改为嵌套 `usage: TokenUsage`（or `UsageTokenSnapshot`，由 spec 04 数据段决定）
- [ ] `ws_event_sink._build_frame(kind="usage")` 通过 `manager.to_ws_frame()` 构造，不再直接 new `UsageFrame`
- [ ] `routers/threads.py::_to_dto` 通过 `manager.get_thread_summary()` 拿 token 数据
- [ ] `ThreadMetadataDTO` 删除（决策 C1）；router 返回 `ThreadMetadata.model_dump()` + manager 补充 summary 字段

### D8. 前端改造

- [ ] `protocol.ts` 的 `UsageFrame` / `ThreadUsageSummary` / `UsageTokenSnapshot` 改为 codegen 产物（datamodel-code-generator）
- [ ] 删除 `web/src/stores/chat.ts::UsageSnapshot` 独立 shape；store 直接持 `UsageFrame` / `ThreadUsageSummary`
- [ ] `StatusLine.tsx` 按 `summary.channel` 分支显示，所有数字前缀中文（输入 / 缓存命中 / 缓存写入 / 输出 / 推理）
- [ ] 新增「当前上下文占用 / 模型上限 (百分比) ▓▓▓▓░░」展示
- [ ] 新增 `web/src/lib/model-context.ts` 上限映射表（**占位**，结束时提醒用户核实）
- [ ] 删除 `ClaudeCodeView.tsx` / `CodexView.tsx` 里对 `tokenBudget` 的 `Object.entries` 渲染；改消费 UsageFrame

### D9. Anthropic lossy 修复

- [ ] `src/executors/llm/anthropic_messages.py:412` 修正：让 LLMResponse.usage 直接携带 SDK 原生字段（input_tokens / cache_read_input_tokens / cache_creation_input_tokens / output_tokens）+ provider_kind 标识
- [ ] runner emit `Event(kind="usage")` payload 携带这些原生字段 + channel 标识
- [ ] OpenAI provider 同步：emit 原生 input_tokens / cached_input_tokens / output_tokens / reasoning_output_tokens + channel 标识

### D10. 验证

- [ ] **pytest**：manager 公共 API 100% 覆盖 + `_channel_*` / `_persistence` / `_migration` 单元测试 + 三通道集成测试
- [ ] **vitest**：StatusLine 渲染 + 派生公式（context_usage / 百分比） + codegen 输出类型对齐
- [ ] **Playwright e2e**：Claude Code / Codex / generic_chat 三种 thread 各开一个，底栏数字符合 SDK 原始 usage
- [ ] **import-linter**：CI gate 通过；故意违规的 PR 被 lint 拦截
- [ ] **make codegen**（或 pre-commit hook）跑出的 TS 跟 Python 一致；CI 跑 codegen + diff 检查没漂移

### D11. 提醒（任务结束 follow-up）

- [ ] `web/src/lib/model-context.ts` 占位 8 模型上下文窗口；提交合并前必须核实改成真实值（查 OpenAI / Anthropic / MiniMax / GLM 官方文档或 `GET /v1/models/{id}` 端点）

## 范围边界

### 包含

参见 [README.md "范围边界" 段](./README.md#范围边界) 的"包含"列表。

### 不包含

参见 [README.md "范围边界" 段](./README.md#范围边界) 的"不包含"列表。

## 关键约束

| 约束 | 来源 | 应对 |
|---|---|---|
| Python ↔ TS 协议必须同步 | MEMORY: feedback_protocol_py_ts_sync.md | 通过 codegen 解决（D8） |
| 不允许 `python -c` 一次性验证 | MEMORY: feedback_verification_must_be_test_file.md | 所有验证沉淀为 pytest / vitest 文件 |
| 破坏性 API 改动必须 grep 全仓所有调用方 | MEMORY: feedback_breaking_api_grep_callers.md | task #2 改 schema 前要 grep；前置调研已完成（v0.1 task 包） |
| Web 改完必须 build + 重启 + Playwright 验证 | MEMORY: feedback_web_build_restart.md + feedback_playwright_verify_after_done.md | task #5 含 e2e 步骤 |
| 自己的测试必须单独验证通过 | MEMORY: feedback_own_tests_must_pass.md | DoD D10 显式列 |
| 拒绝过度兼容 | CLAUDE.md + 用户偏好 | 删 ThreadMetadataDTO / UsageSnapshot / tokenBudget 不留 alias |
| 测试隔离 | MEMORY: feedback_test_isolation.md | manager 单测用临时 home 目录，不共享 |

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 涉及模块 | 涉及 task（[90-task-map.md](./90-task-map.md)） |
|---|---|---|
| D1 架构边界 | manager + `.importlinter` | task#1 |
| D2 外部 API | manager.py | task#1 |
| D3 channel 分发内部化 | `_channel_anthropic.py` + `_channel_openai.py` | task#1 |
| D4 定义点收敛 | manager + 跨模块 wiring | task#1 + task#3 |
| D5 ThreadMetadata 改造 | `_persistence.py` + `_migration.py` + `thread_metadata.py` | task#1 + task#2 |
| D6 三通道空跑修复 | claude_code WS handler + codex WS handler + UsagePersistSink | task#3 |
| D7 WS / REST 帧改造 | `ws_event_sink.py` + `routers/threads.py` + `UsageFrame` Pydantic | task#3 |
| D8 前端改造 + codegen | `protocol.ts`（生成）+ `chat.ts` + `StatusLine.tsx` + `model-context.ts` + `ClaudeCodeView.tsx` / `CodexView.tsx` | task#4 |
| D9 Anthropic lossy 修复 | `anthropic_messages.py` + `openai_responses.py` + `runner.py` emit | task#3 |
| D10 验证 | pytest / vitest / Playwright / import-linter | task#5 |
| D11 model-context 占位提醒 | model-context.ts | task#4（结束提醒） |

**反向追溯**（每个 task 都有 DoD 支撑）：
- task#1 → D1, D2, D3, D4, D5（部分）
- task#2 → D5（迁移 + 测试）
- task#3 → D4（wiring 部分）, D6, D7, D9
- task#4 → D8, D11
- task#5 → D10

无遗漏 / 无 scope creep。
