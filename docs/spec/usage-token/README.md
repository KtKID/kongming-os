# usage-token — Token 用量唯一访问入口

> 状态：方案确认（可拆 task）
> 创建：2026-05-14
> 目标：用 `UsageTokenManager` 收敛 11 处散落的 token 字段定义点，建立单一访问入口 + import-linter 强制边界

## 系统目标

把当前散落在 11 处定义点、跨 6 条不同数据流的 token 用量逻辑，**用 `UsageTokenManager` 收敛为单一访问入口**：

- 外部模块**禁止**直接持有 `TokenUsage` 或其内部子类
- 外部模块**只能**通过 manager API 读写 token 数据
- channel（anthropic / openai）分发规则、字段映射、累加规则、派生公式（如 `context_usage`）**全部在 manager 内部**，外部不感知
- 通过 `.importlinter` Contract **机器强制**架构边界，未通过 lint 不能 merge

顺带解决前置 task 调研的 5 类问题：单位 bug、模型上下文上限缺失、Claude Code/Codex 持久化空跑、Anthropic prompt_tokens lossy、tokenBudget per-message 第二路径分裂。

## 背景

**前置调研材料**：[`dev-pipeline/tasks/web-usage-per-channel-v0.1/`](../../dev-pipeline/tasks/web-usage-per-channel-v0.1/)（已废弃但材料完整保留）

调研结论：
- token 字段散落在 **11 处定义点**，加一个字段同步 11 处
- 同一概念跨 **6 条不同数据流**：Native WS 实时 / Native 持久化 / Claude Code 累计（router 临时算）/ Claude Code per-message tokenBudget / Codex 累计（永远 0）/ Codex per-message tokenBudget
- ThreadMetadata 5 字段是 lossy 归一化（prompt/completion/total/cache_read/cache_creation），不能描述 Anthropic 跟 OpenAI 语义差异
- `anthropic_messages.py:412` 翻译有 bug：`prompt_tokens = input_tokens` 漏算 cache 两项
- 前端 StatusLine 显示 `cumulativeTotal` 累加，100 轮就涨到 11.3M，误导用户

## 最小可用路径（MVP）

```
LLM SDK raw usage (Anthropic / OpenAI)
  → UsageTokenManager.record_run_usage(thread_id, channel, raw_payload)
       ├─ 内部按 channel 字段映射到 TokenUsage（discriminated union）
       ├─ 累加到 ThreadMetadata.cumulative_usage（透明 dict 落盘）
       └─ 返回 UsageTokenSnapshot
  → ws_event_sink 调 manager.to_ws_frame() → UsageFrame 推前端
  → routers/threads.py 调 manager.get_thread_summary() → ThreadUsageSummary 返 REST
  → 前端 StatusLine 消费 summary（数字前缀中文 + 上下文百分比）
```

**唯一数据写入路径**：`record_run_usage`
**唯一数据读取路径**：`get_thread_summary` / `get_last_run_snapshot` / `to_ws_frame`

## 范围边界

**包含**：
- 新模块 `src/web/usage_token/` 完整实现（manager + 内部 _models / _channel_anthropic / _channel_openai / _persistence / _migration）
- `.importlinter` Contract 强制边界
- 11 处定义点收敛到 ~5 处真正必需 + manager 单一真源
- 前端 codegen（Python Pydantic → TS 类型自动生成；仅生成公共 DTO）
- ThreadMetadata schema v7→v8 lazy upgrade（旧 5 字段映射到 manager 内部嵌套结构）
- 前端 StatusLine 按 channel 分支显示 + 模型上下文上限百分比
- 三通道（claude_code / codex / generic_chat）持久化空跑修复
- Anthropic prompt_tokens lossy 修复

**不包含**：
- 多模型同 thread 的 token 用量拆分（一个 thread 当前只绑一个 model）
- Token 成本（费用）估算 — 未来扩展
- 实时 token 速率（tokens-per-second） — 未来扩展
- 跨 thread 聚合统计（全局总用量、用户总配额） — 未来扩展
- LLMResponse.usage 协议根本改造 — 本 spec 不动 `core/contracts.py`，让 LLMProvider 在 usage dict 里塞原生字段 + provider_kind 即可

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| `UsageTokenManager` (manager.py) | 方案确认 | [02-module-breakdown.md#manager](./02-module-breakdown.md#1-usagetokenmanager) | 是 | 单一入口，所有跨模块改造的中心 |
| `_models.py`（内部 TokenUsage union） | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | discriminated union 真源 |
| `_channel_anthropic.py` | 方案确认 | [02-module-breakdown.md#channel-anthropic](./02-module-breakdown.md#3-_channel_anthropicpy) | 是 | Anthropic 字段映射 + 累加 + 派生 |
| `_channel_openai.py` | 方案确认 | [02-module-breakdown.md#channel-openai](./02-module-breakdown.md#4-_channel_openaipy) | 是 | OpenAI 同上 |
| `_persistence.py` | 方案确认 | [02-module-breakdown.md#persistence](./02-module-breakdown.md#5-_persistencepy) | 是 | 嵌入 ThreadMetadata 的落盘形态 |
| `_migration.py` | 方案确认 | [02-module-breakdown.md#migration](./02-module-breakdown.md#6-_migrationpy) | 是 | v7→v8 lazy upgrade |
| 跨模块改造（runner / ws_event_sink / routers / 三 normalizer / 前端 StatusLine / codegen） | 方案确认 | [02-module-breakdown.md#external](./02-module-breakdown.md#7-跨模块改造点)、[03-core-workflows.md](./03-core-workflows.md) | 是 | 由 task-map 拆分 |

## 5 大硬性约束（non-negotiable）

1. **唯一入口**：`UsageTokenManager` 是 token 用量的唯一对外接口
2. **数据结构封装**：`TokenUsage` 及其子类是 manager 私有；外部模块不允许 import / 实例化 / 持有
3. **manager 持有所有读写**：任何模块读 token 必须调 manager 的查询 API；写 token 必须调 `record_run_usage`
4. **channel 分发内部化**：anthropic / openai 的字段映射、累加规则、派生公式都在 manager 内部
5. **`.importlinter` Contract 强制**：未通过 lint 不能 merge（CI gate）

## 外部 API 表面（仅 6 个公共方法）

```python
class UsageTokenManager:
    async def record_run_usage(self, thread_id, *, channel, raw_payload, turn, run_id) -> UsageTokenSnapshot
    async def get_thread_summary(self, thread_id) -> ThreadUsageSummary
    async def get_last_run_snapshot(self, thread_id) -> UsageTokenSnapshot | None
    async def to_ws_frame(self, thread_id, *, turn, run_id) -> UsageFrame
    def context_window(self, model_name) -> int | None
    def context_usage_pct(self, thread_id) -> float | None
```

详见 [02-module-breakdown.md](./02-module-breakdown.md)。

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [目标 + 完成标准 + 边界](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程（写盘 / 读取 / 迁移 / WS emit / 前端消费）](./03-core-workflows.md)
- [数据模型与状态（TokenUsage / Snapshot / Summary / 落盘格式）](./04-data-and-state.md)
- [验证策略与演进（测试 / lint / codegen / 风险）](./05-validation-and-evolution.md)
- [Task 映射（3-5 个 task 拆分）](./90-task-map.md)

## 当前建议

1. **整个 spec 可直接拆 task 进入 x-req**——所有模块和决策已确认
2. **task 拆分顺序见 [90-task-map.md](./90-task-map.md)**：建议串行（schema → manager 实现 → 跨模块 wiring → codegen + 前端 → 测试 + e2e）
3. **决策已锁定**（无需用户再拍）：
   - 1A discriminated union（嵌套在 manager 内部）
   - 2B lazy upgrade v7→v8（在 `_migration.py` 实现）
   - 3A 内置 ts 表 + codegen 化（公共 DTO 自动生成；TokenUsage 内部模型**不**生成）
   - 4N Codex 历史不补 reasoning_output_tokens
4. **新决策点**（dev 阶段定）：
   - codegen 工具选型（datamodel-code-generator / pydantic-to-typescript / 手写）
   - tokenBudget per-message 删除 vs 保留薄壳兼容
   - manager 是单例还是按 home/thread 实例化
