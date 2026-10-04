# 目标与完成标准

## 系统目标（替换 v1）

1. **架构纠偏**：把 `UsageTokenManager` 从 owner 模式（持有 token 数据 + 写盘 + 累加）转为 **无状态门面（façade）**——只查询、只派生、不缓存、不写盘。
2. **真源对齐**：承认 token 真源唯一在 SDK 写的 jsonl/rollout，metadata.json **不再**存任何 token 字段。
3. **分通道字段忠实映射**：Anthropic / OpenAI 字段语义不同（`input_tokens` 含义、cache 概念、reasoning 拆分），v2 **不再强行统一 DTO**——分通道映射 SDK 原生字段 1:1。
4. **删除写盘竞争源**：v1 的 `record_run_usage` / `set_last_assistant_usage` / `set_thread_model` 公共 API 全部删除；ws_event_sink 的 `UsagePersistSink` 删除。metadata.json 的 token 字段（schema v8 引入的 3 个）随 schema v9 一并删除。
5. **公共 API 收敛到 1 个方法**：`manager.get_thread_usage(thread_id)`。外部模块**不**感知通道分发、**不**接触派生器、**不**碰 SDK 真源文件路径。

## DoD（验收清单）

每条都可独立验证。

### D1. manager 无状态

- [ ] `UsageTokenManager` 类**无任何状态字段**：grep `self\._` 在 manager.py 里只出现注入的 locator 引用（不出现 `_last_snapshot` / `_thread_models` / `_locks` / `_bg_tasks` 等）
- [ ] 100 路并发 `get_thread_usage` 调用：返回结果一致，无锁竞争（断言测试覆盖）
- [ ] `__init__` 不读任何文件、不创建任何 task
- [ ] 公共方法数 ≤ 1（只有 `get_thread_usage`；可有 1 个无 IO 的 `__init__`）

### D2. 真源对齐 + 零写盘

- [ ] `UsageTokenManager` 包内**无任何**写文件调用：grep `write_text` / `os.replace` / `_io.write_*` 在 `src/web/usage/usage_token_v2/` 下 0 命中
- [ ] `web/ws_event_sink.py` 删除 `UsagePersistSink` 类
- [ ] `web/claude_code/service.py` / `web/codex/service.py` 不调任何 v2 写盘相关方法（grep 0 命中）
- [ ] **三通道 e2e**：跑完一轮对话，`.kongming/web/threads/<tid>/metadata.json` 里**不含**任何 token 字段（schema v9 验证）

### D3. metadata schema v9 + 字段删除

- [ ] `ThreadMetadata` schema v8 → v9：删 3 字段 `cumulative_usage` / `last_run_snapshot` / `last_model_name`
- [ ] lazy upgrade v8 → v9：直接 drop 这 3 个字段（不迁移数据；真源在 SDK，旧数据冗余）
- [ ] `extra="forbid"` 在 v9 下生效——旧 v8 文件里这 3 个字段被 drop 后不会触发 forbid
- [ ] `schema_version` Literal 扩展到 9，**写盘永远写 9**
- [ ] 5 个 fixture 单测覆盖（v7→v9 / v8→v9 / v9 直接读 / 损坏拒绝 / extra forbid 拒绝未知字段）

### D4. 分通道 DTO

- [ ] 删除 v1 的 `ThreadUsageSummary` 统一 DTO
- [ ] 新增 `ClaudeUsage` / `CodexUsage` / `GenericChatAnthropicUsage` / `GenericChatOpenAIUsage` 四个独立 DTO
- [ ] 每个 DTO 自带 `provider: Literal[...]` 作 discriminator
- [ ] 每个 DTO 字段**1:1 映射** SDK 真源原生字段（含 cache TTL 细分、rate_limits 等），不做 lossy 归一化
- [ ] 公共 API 返回类型：`ClaudeUsage | CodexUsage | GenericChatAnthropicUsage | GenericChatOpenAIUsage | None`

### D5. 派生器（manager 包内私有）

- [ ] `_derive_claude.py`：扫 Claude SDK jsonl，取**最后一条** `type=assistant` 的 `message.usage` 映射为 `ClaudeUsage`（**不累加**）
- [ ] `_derive_codex.py`：扫 Codex rollout，取**最后一条** `event_msg.token_count` 映射为 `CodexUsage`（codex 已自带累加，直接用）
- [ ] `_derive_generic.py`：从我们自己的 session backend 派生 `GenericChatAnthropicUsage` 或 `GenericChatOpenAIUsage`（按底层 provider 分支）
- [ ] 三派生器纯函数：输入 = 文件路径，输出 = DTO 或 None
- [ ] 文件不存在 / 无 usage entry / 解析失败 → 返回 None，**不抛**
- [ ] 流式按行读，避免大文件 OOM
- [ ] 单测：每个派生器至少 8 个用例（空文件 / 单条 / 多条取最后 / 损坏行 skip / 无 usage / 文件不存在 / 权限错误 / mock SDK 字段全集）

### D6. 公共 API 单入口

- [ ] `UsageTokenManager.get_thread_usage(thread_id)` 是**唯一**公共方法
- [ ] 内部步骤：① `read_thread_metadata` 拿 `backend_kind` → ② 按 `backend_kind` 派发到对应派生器 → ③ 派生器返回 DTO 或 None
- [ ] 非已绑定 SDK 真源的 thread（缺 `claude_thread_id` / `codex_thread_id` / `cwd`） → 返回 None
- [ ] 派生器抛任何异常 → manager 静默捕获返回 None（不影响主对话流）
- [ ] **多 tab 并发**：100 路 `get_thread_usage` 并发调用各自不同 thread_id，结果正确，无锁、无 race
- [ ] grep 验证：manager.py 中 channel / backend_kind 判断分支**只在 1 处**（派发函数内）

### D7. WS / REST 帧改造

- [ ] `web/protocol/ws_frames.py` 删 v1 `UsageFrame`（嵌套 `snapshot: dict`）
- [ ] 新增 `UsageFrame v2`：`{ kind:"usage", turn, run_id, usage: ClaudeUsage | CodexUsage | ... }`
- [ ] `ws_event_sink._build_frame(kind="usage")` 改为：调 `manager.get_thread_usage()` 拿 DTO → 自己包成 `UsageFrame` send
- [ ] `routers/threads.py` 拿 thread DTO 时调 `manager.get_thread_usage()`，**不**走 `_to_dto` 里的 token 字段
- [ ] `ThreadMetadataDTO` 删除 `usage_summary` 字段（前端单独 fetch `/threads/<tid>/usage` 拿）

### D8. 前端改造

- [ ] 删除 `web/src/stores/chat.ts` 里的 v1 `UsageView` shape
- [ ] 新增 `web/src/protocol.ts` 的 `ClaudeUsage` / `CodexUsage` / `GenericChatUsage` 接口
- [ ] `StatusLine.tsx` 拆为：`StatusLineClaude` / `StatusLineCodex` / `StatusLineGenericChat`
- [ ] discriminator 字段：前端按 `usage.provider` switch 分支
- [ ] Claude StatusLine 展示：input / output / cache_read / cache_creation / cache_creation.ephemeral_1h / cache_creation.ephemeral_5m / 上下文进度条（model + context_window）
- [ ] Codex StatusLine 展示：total 4 字段 + last 4 字段 + 进度条（model_context_window）+（可选 rate_limits 进度条）
- [ ] 删除 `tokenBudget` per-message normalizer / `ClaudeCodeView.tsx` 里对 `tokenBudget` 的 `Object.entries` 渲染

### D9. importlinter Contract 9 升级

- [ ] Contract 9 `forbidden_modules` 加入：
  ```
  web.usage.usage_token_v2._derive_claude
  web.usage.usage_token_v2._derive_codex
  web.usage.usage_token_v2._derive_generic
  web.usage.usage_token_v2._models
  ```
- [ ] `source_modules` 加入 `web.usage.usage_token_v2`（防止旧 v1 误 import 新 v2 内部）
- [ ] grep 验证：除了 manager.py 自己，**没有任何**外部代码 import 派生器或私有 DTO
- [ ] CI gate：故意写一行 `from web.usage.usage_token_v2._derive_claude import derive_from_jsonl` 在外部模块时 lint 报错

### D10. v1 包并存策略 + 最终清理

- [ ] v2 实施期间，`src/web/usage_token/`（v1）与 `src/web/usage/usage_token_v2/`（v2）**并存**
- [ ] v1 公共方法 `record_run_usage` / `set_last_assistant_usage` 加 `DeprecationWarning`
- [ ] 三通道 service / ws_event_sink / router 逐步迁到 v2 API
- [ ] **task 6 最后一步**：v1 全部消费者迁完后，删除 `src/web/usage_token/` 整个目录、删除 ThreadMetadataIOAdapter、删除 metadata 里 3 个 token 字段（schema v9）

### D11. 验证

- [ ] **pytest**：派生器 24 用例（每个 8）+ manager 100 路并发用例 + DTO frozen + provider discriminator 类型收窄测试 + schema v9 lazy upgrade
- [ ] **vitest**：三个 StatusLine 组件分别快照测试 + provider 字段分支测试
- [ ] **Playwright e2e**：开三个 thread（claude_code / codex / generic_chat-anthropic / generic_chat-openai）各跑一轮对话，断言 StatusLine 渲染字段跟 SDK 真源 1:1 对齐
- [ ] **import-linter**：CI gate 通过
- [ ] **e2e 删字段验证**：跑完一轮对话后 `cat .kongming/web/threads/<tid>/metadata.json`，断言无 `cumulative_usage` / `last_run_snapshot` / `last_model_name` 字段
- [ ] **手测**：旧 server（v1）残留写坏文件 + 新 server（v2）启动 → 24h 跑下来无新损坏（v2 没有写者）

## 范围边界

### 包含

- 见 [README.md "范围边界" 段](./README.md#范围边界) 的"包含"列表
- v1 包的渐进式废弃 + 最终删除
- metadata.json schema v9 字段删除 + lazy upgrade

### 不包含

- token 计费金额估算（cost = tokens × pricing）—— 留 v3 扩展
- 跨 thread 聚合统计（用户总配额 / 全局 token 池） —— 留 v3
- 服务端 server_tool_use 细化计费（Claude 的 web_search/web_fetch）—— 留 v3
- Codex `rate_limits` 在前端渲染细节（v2 后端透传字段，前端 v3 决定怎么渲染）
- 已损坏的 metadata.json 修复（v0.1 已有 `scripts/repair_metadata_json.py` 做完）—— 不再做
- `core/contracts.py` LLMResponse.usage 协议改造 —— 不动；让 LLMProvider 在 usage dict 里塞原生字段
