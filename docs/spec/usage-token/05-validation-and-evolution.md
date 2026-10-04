# 验证策略与演进

## 验证策略

### 1. 单元测试（pytest）

#### manager 公共 API（100% 覆盖）

```
tests/unit/web/usage_token/
├── test_manager_record_run_usage.py
│   ├── test_anthropic_channel_records_correctly
│   ├── test_openai_channel_records_correctly
│   ├── test_cumulative_accumulates_across_turns
│   ├── test_first_run_initializes_cumulative_usage
│   ├── test_unknown_channel_raises
│   └── test_corrupted_raw_payload_defaults_to_zero
├── test_manager_get_thread_summary.py
│   ├── test_empty_thread_returns_zero_summary
│   ├── test_anthropic_thread_returns_anthropic_extras
│   ├── test_openai_thread_returns_openai_extras
│   └── test_context_usage_pct_when_model_window_known
├── test_manager_to_ws_frame.py
│   ├── test_frame_uses_last_run_snapshot
│   └── test_frame_kind_is_usage
└── test_manager_context_window.py
    ├── test_exact_match
    ├── test_prefix_match
    └── test_unknown_model_returns_none
```

#### 内部子模块测试（按需）

```
tests/unit/web/usage_token/
├── test_channel_anthropic.py  ← parse / merge / context_usage 三函数
├── test_channel_openai.py     ← 同上
├── test_persistence.py        ← to_persisted_dict / from_persisted_dict 往返
└── test_migration_v7_to_v8.py
    ├── test_claude_code_thread_migration
    ├── test_codex_thread_migration
    ├── test_generic_chat_anthropic_heuristic（cache_creation>0）
    ├── test_generic_chat_openai_heuristic（cache_creation=0）
    ├── test_idempotent_v8_no_change
    └── test_legacy_total_tokens_discarded
```

#### 跨模块集成测试

```
tests/unit/test_web_thread_manager_with_usage_token.py  ← 完整一轮 record→read→ws
tests/unit/web/integrations/claude_code/test_record_run_usage_integration.py  ← claude_code 通道
tests/unit/web/integrations/codex/test_record_run_usage_integration.py        ← codex 通道
```

### 2. 前端单测（vitest）

```
web/src/stores/__tests__/
├── chat.usage.test.ts          ← appendUsage（UsageFrame）+ hydrateUsageFromThreads（summary）
└── status_line.test.tsx        ← StatusLine 分支渲染 + 百分比派生 + 中文 label
web/src/lib/__tests__/
└── model_context.test.ts       ← lookupContextWindow exact/prefix/未命中
```

### 3. Playwright e2e

```
web/tests/e2e/
└── usage_token_per_channel.spec.ts
    ├── test_claude_thread_shows_anthropic_fields
    ├── test_codex_thread_shows_openai_fields
    └── test_generic_chat_thread_shows_by_provider
```

mock LLM 返回固定 usage；断言底栏数字符合 SDK 原始字段（"输入 X / 缓存命中 X / ..."）。

### 4. 架构 lint（CI gate）

```bash
make lint  # 含 import-linter
```

- `usage-token-encapsulation` Contract 通过
- 故意违规的 PR（如 `from web.usage_token._models import TokenUsage` 在 `web.routers`）必须被拦截

CI 步骤：

```yaml
- name: import-linter
  run: |
    uv run lint-imports
    # 若 contract 失败，CI exit 1
```

### 5. codegen drift 检测（pre-commit hook）

```bash
make codegen   # 跑 datamodel-code-generator
git diff --exit-code web/src/protocol.ts || (echo "codegen drift" && exit 1)
```

或在 CI 跑一遍 codegen，diff 不为 0 直接拒绝 merge。

### 6. 端到端 smoke（task#5 必带）

跑 `make smoke` 后人工检查浏览器：
- 三种 thread 各打开一个真实对话 turn
- 底栏数字正确（不是 11.3M）
- 进度条按上下文百分比渲染
- 占位 model context 数值 footnote 提醒"占位未核实"

## 演进路径

### v0.1（本 spec 范围，5 个 task）

详见 [90-task-map.md](./90-task-map.md)。

- task#1：manager + 内部子模块 + import-linter Contract
- task#2：ThreadMetadata schema v8 + lazy upgrade
- task#3：跨模块 wiring（runner / LLMProvider / ws_event_sink / 三 channel WS handler / router）+ Anthropic lossy 修复
- task#4：前端 codegen + chat store + StatusLine + model-context + 删 tokenBudget
- task#5：测试 + Playwright e2e + 文档收尾

### v0.2（未来扩展，**不在本 spec 范围**）

| 方向 | 说明 |
|---|---|
| 多模型 thread token 拆分 | 一个 thread 切换 model 时分别累计 |
| Token 成本估算 | manager 增加 `estimate_cost(thread_id)` 接口；用 model_pricing.ts 内置表 |
| Token 速率（TPS） | 实时统计 input/output tokens-per-second；新增 UsageRate snapshot |
| 跨 thread 聚合 | manager 增加 `get_global_summary()` 接口；用于用户配额展示 |
| Gemini channel 接入 | 新增 `_channel_gemini.py`；只需扩 `TokenUsage` union + manager 内部分发 |

**架构稳定性保证**：未来扩展只动 `web.usage_token` 内部；外部模块（routers / store / StatusLine）通过现有 API 自动获得新数据。

## 风险与应对

| 风险 | 严重度 | 应对 |
|---|---|---|
| `_migration.upgrade_v7_to_v8` 误判 generic_chat 通道 channel | 中 | 启发式（cache_creation>0 → anthropic）有 fixture 单测覆盖；如果误判，用户最多看到 1-2 个字段语义错位，不影响功能 |
| ThreadMetadata.cumulative_usage 落盘 dict 损坏（非 manager 写入） | 低 | `_persistence.from_persisted_dict` 做 channel 字段校验 + 字段类型校验，损坏视为 None（不抛） |
| import-linter Contract 漏标某模块 | 中 | task#1 必带 smoke test：尝试在 web.thread_manager 等模块 import 内部模型，应该被 lint 拒绝 |
| manager 并发竞争（多 sink 同时 record） | 中 | per-thread `asyncio.Lock`；测试覆盖 |
| codegen 工具链脆弱（datamodel-code-generator 版本升级、Pydantic v2/v3 兼容） | 中 | 锁定版本到 pyproject.toml + CI drift 检测 |
| `tokenBudget` per-message 删除影响 ClaudeCodeView / CodexView 既有渲染 | 中 | task#4 改造时先 grep 全仓 `tokenBudget`；UI 改造后用截图回归测试 |
| 删除 ThreadMetadataDTO 影响 cron_ws / workspace 等其他 router | 中 | task#3 前 grep `ThreadMetadataDTO` 全仓引用；统一改 router 返回类型 |
| model-context 占位值跟实际不符 | 低 | DoD D11 显式提醒；前端命中"占位"时在 tooltip 标注 "估计值（待核实）" |
| 三通道 WS handler 接入点不一致（claude_code WS / codex WS / generic_chat） | 中 | task#3 设计公共 helper `web/usage_token/sinks.py` 提供 EventSink + WS handler 共用接入路径 |
| Playwright e2e 在 CI 缓慢且 flaky | 中 | 本地 mock LLM；CI 跑前 stub `KONGMING_MODEL_BASE_URL` 到本地 fake；timeout 短 |

## 模型 context window 内置表的核实清单（任务结束 follow-up）

| 模型 | 占位值 | 实际值（用户核实） | 来源 |
|---|---|---|---|
| gpt-4o | 128_000 | ? | OpenAI 官方文档 |
| gpt-4-turbo | 128_000 | ? | OpenAI 官方文档 |
| claude-sonnet-4 | 200_000 | ? | Anthropic 官方文档 |
| claude-opus-4 | **1_000_000** | ? | Anthropic 官方文档（已确认 1M）|
| claude-haiku-4 | 200_000 | ? | Anthropic 官方文档 |
| glm-5.1 | 128_000 | ? | 智谱官方文档 |
| MiniMax-M2.7 | 200_000 | ? | MiniMax 官方文档 |
| gemma-4-e4b-it | 8_192 | ? | Google Gemma 文档 / LM Studio model card |

**任务交付时强制提醒用户核实**（写入 task#4 / task#5 的 dev-report.md follow-up 段）。
