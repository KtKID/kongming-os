# Task Map

5 个 task，串行实施（每个有明确前置依赖）。每个 task 单独走 x-req → x-dev → x-verify → x-qa-gate 流程，独立 commit。

## Task 总览

| # | task 名 | 前置依赖 | 对应 DoD | 工时估计 | 风险 | 状态 |
|---|---|---|---|---|---|---|
| 1 | `usage-token-manager-core-v0.1` | 无 | D1, D2, D3, D4（部分）, D5（部分） | ~3h | 中 | 可进入 x-req |
| 2 | `usage-token-thread-meta-v8-v0.1` | task#1 | D5 (完整) | ~1.5h | 中 | 待 #1 完成 |
| 3 | `usage-token-cross-module-wiring-v0.1` | task#1 + #2 | D4 (剩余), D6, D7, D9 | ~3h | 高 | 待 #2 完成 |
| 4 | `usage-token-frontend-codegen-v0.1` | task#3 | D8, D11 | ~2h | 中 | 待 #3 完成 |
| 5 | `usage-token-validation-e2e-v0.1` | task#4 | D10 | ~2h | 低 | 待 #4 完成 |

**总工时**：~11.5h，但分 5 个独立 commit，每个 task 完成后 commit 一次。

---

## Task 详情

### task#1：`usage-token-manager-core-v0.1`

**前置**：无（架构基础）

**范围**：
- 新建 `src/web/usage_token/` package
- 6 个文件：`__init__.py` + `manager.py` + `_models.py` + `_channel_anthropic.py` + `_channel_openai.py` + `_persistence.py` + `_migration.py`
- manager 公共 API 全部实现（不含 v8 ThreadMetadata 改造，先用 dummy `thread_metadata_io`）
- `.importlinter` 添加 `usage-token-encapsulation` Contract
- 单测：`tests/unit/web/usage_token/test_manager_*.py` + `test_channel_*.py` + `test_persistence.py` + `test_migration_v7_to_v8.py` + `test_import_boundary.py`

**对应 DoD**：D1（架构边界）+ D2（外部 API）+ D3（channel 分发内部化）+ D4 部分（manager 内部 1 处真源 + 已收敛）+ D5 部分（`_persistence.py` 已写好，但 ThreadMetadata 改造在 #2）

**关键约束**：
- `__init__.py` 仅 export `UsageTokenManager` + 公共 DTO；不 re-export 内部模型
- import-linter Contract 跑通；故意违规的 import 在测试里抛错
- manager 公共 API 100% 单测覆盖

**风险**：中——架构边界设计必须一次到位，否则后续 task 全部踩坑

**备注**：可与 #2 略并行（manager 不直接依赖 ThreadMetadata 内部字段；只依赖 `cumulative_usage` 这个 dict 字段是否存在），但建议串行更安全。

---

### task#2：`usage-token-thread-meta-v8-v0.1`

**前置**：task#1（`_migration.py` 已实现）

**范围**：
- 改 `src/web/thread_metadata.py`：
  - `THREAD_METADATA_SCHEMA_VERSION = 8`
  - `ThreadMetadata` 删 5 个旧 `cumulative_*_tokens` 字段
  - 加 `cumulative_usage: dict[str, Any] | None = None`
  - `Literal[1, 2, 3, 4, 5, 6, 7, 8]`
  - 集成 `_migration.upgrade_v7_to_v8` 到 `read_thread_metadata` 现存懒升级链末尾
- 改 `src/web/thread_manager.py`：
  - 删 `add_thread_usage`（被 manager.record_run_usage 取代）
  - 构造 ThreadMetadata 时把 `cumulative_usage=None`
- 改测试 fixture：5 个 pytest 文件（`test_thread_metadata_v2.py` / `codex/test_thread_metadata_v5.py` / `test_web_thread_manager_lifecycle.py` / `test_web_thread_metadata.py` / `test_web_protocol_round_trip.py`）

**对应 DoD**：D5 完整

**关键约束**：
- 3 channel fixture 单测全部通过
- 现存懒升级链 v1→v8 完整工作（手工测一个 v1 文件能升到 v8）
- `extra="forbid"` 仍然生效，旧字段残留拒绝

**风险**：中——5 个测试文件改字段名容易遗漏

---

### task#3：`usage-token-cross-module-wiring-v0.1`

**前置**：task#1 + task#2

**范围**：7 处接入 manager + Anthropic lossy 修复 + 删 ThreadMetadataDTO + parse_transcript_usage 临时算逻辑删除

**改造点**：
- `src/executors/llm/anthropic_messages.py`：LLMResponse.usage 直接放原生字段（input_tokens / cache_read_input_tokens / cache_creation_input_tokens / output_tokens）+ `provider_metadata["provider_kind"] = "anthropic"`
- `src/executors/llm/openai_responses.py`：同上 openai（input_tokens / cached_input_tokens / output_tokens / reasoning_output_tokens）+ provider_kind="openai_compatible"
- `src/executors/llm/openai_compat_stream_parser.py` + `anthropic_stream_parser.py`：stream 路径同步
- `src/core/runner.py:443`：emit usage event payload 含 channel 标识 + 原生字段
- `src/web/ws_event_sink.py`：
  - `UsagePersistSink.emit` 改调 `manager.record_run_usage(channel, raw_payload, ...)`（不再透传单字段 kwargs）
  - `WSEventSink._build_frame(kind="usage")` 改调 `manager.to_ws_frame(thread_id, turn, run_id)`
  - 不再 import `UsageFrame` 旧定义
- `src/web/protocol/ws_frames.py`：旧 `UsageFrame` 删除（由 `web.usage_token.UsageFrame` 取代）；WSFrameS2C union 引用新 UsageFrame
- `src/web/protocol/rest_models.py`：**`ThreadMetadataDTO` 删除**
- `src/web/routers/threads.py`：
  - `_to_dto` 删除；改为直接 `meta.model_dump()` + 调 `manager.get_thread_summary` 补充 `usage_summary` 字段
  - 删除 `parse_transcript_usage` 临时算逻辑
- `src/web/integrations/claude_code/`：在 WS handler 每轮结束调 `manager.record_run_usage(channel="anthropic", raw_payload=msg.usage, ...)`
- `src/web/integrations/codex/`：在 WS handler / jsonl_history 处理每轮结束时调 `manager.record_run_usage(channel="openai", raw_payload=..., ...)`
- ThreadManager 改造：注入 `UsageTokenManager` 实例（构造参数）

**对应 DoD**：D4 剩余 + D6（三通道空跑修复）+ D7（WS/REST 帧改造）+ D9（Anthropic lossy 修复）

**关键约束**：
- 改 LLMProvider.usage 前必须 grep 全仓 `response.usage` 调用方（MEMORY: feedback_breaking_api_grep_callers.md）
- 改 ThreadMetadataDTO 前必须 grep 全仓 `ThreadMetadataDTO` 引用
- 三通道 WS handler 接入点不一致时设计公共 helper

**风险**：**高**——本 task 涉及 13+ 个文件改造，最易踩坑；建议拆 2-3 个子 commit

**备注**：本 task 完成后 `make smoke` 必须能跑（后端可用），即使前端还没改造（前端继续用旧 UsageFrame interface 字段不存在，但不影响后端）。

---

### task#4：`usage-token-frontend-codegen-v0.1`

**前置**：task#3

**范围**：
- 选 codegen 工具（dev 决策：datamodel-code-generator / pydantic-to-typescript / 手写）
- 生成脚本接入项目命令；`pre-commit` hook 跑 drift 检测
- `web/src/protocol.ts`：`UsageFrame` / `UsageTokenSnapshot` / `ThreadUsageSummary` 改为 codegen 产物
- `web/src/stores/chat.ts`：删 `UsageSnapshot` 独立 shape；改持 codegen 产出的类型；删 `cumulativePrompt / Total` 等累加逻辑
- `web/src/components/StatusLine.tsx`：按 `summary.channel` 分支 + 中文 label + 进度条 + 百分比
- `web/src/lib/model-context.ts`：新建（占位 8 模型）
- `web/src/components/ClaudeCodeView.tsx` + `CodexView.tsx`：删 `tokenBudget` Object.entries 渲染；改消费 UsageFrame
- 删 `web/src/stores/chat.ts` 等处的 `cumulativeXxx` 字段；前端测试 fixture 同步改

**对应 DoD**：D8（前端改造）+ D11（占位提醒）

**关键约束**：
- Web 改完必须 `web build` + 重启后端（MEMORY: feedback_web_build_restart.md）
- 完成后主动问用户是否 Playwright MCP 跑（MEMORY: feedback_playwright_verify_after_done.md）
- 任务结束时强制提醒用户核实 model-context.ts 占位值（DoD D11）

**风险**：中——前端改造面广（4-5 文件），但每个改造点都是独立的

**备注**：dev 阶段决定 codegen 工具时优先 `datamodel-code-generator`（discriminated union 支持成熟）。

---

### task#5：`usage-token-validation-e2e-v0.1`

**前置**：task#4

**范围**：
- 补全所有单元测试覆盖（如果前面 task 漏写）
- Playwright e2e：`web/tests/e2e/usage_token_per_channel.spec.ts`（3 channel 各跑一遍）
- CI 配置：import-linter + codegen drift 检测
- `make smoke` 全链路冒烟

**对应 DoD**：D10（验证）

**风险**：低（前面 task 的测试基础够，本 task 是补漏 + e2e 集成）

**备注**：本 task 完成后整个 spec ✅ 完成，可写 spec 收尾报告。

---

## 并行 / 串行决策

**建议严格串行**：

```
task#1 ──→ task#2 ──→ task#3 ──→ task#4 ──→ task#5
```

**理由**：
- task#1 是基础（manager 没建好后面没法接）
- task#2 依赖 task#1（migration 模块）
- task#3 依赖 task#1 + task#2（既要 manager 又要 v8 schema）
- task#4 依赖 task#3（前端要等后端协议稳定）
- task#5 是验证收尾

**例外**：task#1 内部的子模块（manager / `_channel_*` / `_persistence` / `_migration`）可并行子 agent 实施；但 task 间不并行。

## 任务结束 follow-up

每个 task 完成后必须：

1. `pre-commit` 通过（含 import-linter + codegen drift）
2. 自己写的测试单独跑通（MEMORY: feedback_own_tests_must_pass.md）
3. dev-report.md 含验证命令清单
4. 触发 x-verify → x-qa-gate

**整个 spec 完成后**（task#5 ✅ 之后）必须：

1. 在用户面前明确提醒：**`web/src/lib/model-context.ts` 占位 8 模型上下文窗口值需核实**（D11）
2. 把 `dev-pipeline/tasks/web-usage-per-channel-v0.1/` 重命名为 `archive-web-usage-per-channel-v0.1/`（标注已被本 spec 替代）
3. 更新 `docs/usage-token/README.md` 状态：方案确认 → 开发中 → 已完成
