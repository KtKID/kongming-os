# usage-token-v2 — Manager 退位为无状态查询门面，token 真源回归 SDK

> 状态：spec 编写中
> 创建：2026-05-14
> 取代：[docs/usage-token/](../usage-token/README.md)（v1，部分决策已废止）

## v2 诞生的背景

v1 的设计哲学是 **manager-as-owner**：把 token 用量"收敛"到 `UsageTokenManager` 内部，由它维护一份 `metadata.json` 持久化拷贝（`cumulative_usage` / `last_run_snapshot` / `last_model_name`）。spec 第 5 条系统目标和 D5/D6 验收都明文要求 "每轮真实写盘 `cumulative_usage`"。

实施完后立刻踩进一连串坑：

1. **跟真源重复**：SDK 已经把每条 AssistantMessage 的 usage 写到自己的 jsonl 流水（Claude）/ rollout（Codex）。我们再存一份等于抄第二份账本。
2. **写盘竞争撞坏文件**：一轮里多次 fire-and-forget 写盘（`set_last_assistant_usage`）跟 `record_run_usage`（lock 内）抢同一个 `metadata.json` + 共享 `.tmp` 文件 → 文件出现"两次 JSON 拼一起"的尾巴垃圾 → `json.loads` 抛 Extra data → 前端 token 显示成 0。累计撞坏 9 个文件。
3. **字段永远滞后真源**：SDK 加新字段（`cache_creation.ephemeral_1h_input_tokens` / `server_tool_use` / `service_tier` 等），我们的 owner 拷贝缺一堆。
4. **强行统一字段是 lossy**：Anthropic 的 `input_tokens` 是"纯新增"（不含 cache），OpenAI 的 `input_tokens` 是"含 cache 子集的总输入"——语义完全不同，统一的 `ThreadUsageSummary.cumulative_input_tokens` 是错配。
5. **lost-update 撞 name 字段**：read-modify-write 整 metadata.json，并发写者用旧 metadata 把用户刚改的 name 又写回旧值（已观察到）。

v0.1 中间态修复（[`dev-pipeline/tasks/usage-token-derive-from-jsonl-v0.1`](../../dev-pipeline/tasks/usage-token-derive-from-jsonl-v0.1/)）已把 claude_code 通道改成 **从 SDK jsonl 派生**，service 层零写盘调用。但架构上**只动了一半**：codex / generic_chat 通道仍走 v1 owner 模式，`ThreadUsageSummary` 统一 DTO 还在，metadata.json 字段还在。

v2 把这剩下的一半改造完。

## v2 设计哲学（一图说清）

```
v1 owner 模式（已废止）：
  SDK 消息 → service.py → manager.record_run_usage → 写 metadata.json
                                                       ↓
                                              router 读 metadata.json
                                                       ↓
                                                  前端 StatusLine

v2 façade 模式：
  SDK 消息 → 不 push token 给 manager（SDK 自己写自己的 jsonl）
            │
            └─→ service.py 仅触发"通知前端刷新"事件
  
  前端 hydrate / 实时刷新：
  
  前端 → router → manager.get_thread_usage(tid)
                       ↓
                       ├─ 读 thread metadata 拿 backend_kind
                       ├─ 按 backend_kind 派发到对应派生器
                       └─ 派生器扫 SDK 真源 jsonl/rollout 算出 usage
                       ↓
                  ClaudeUsage / CodexUsage / GenericChatUsage
                  （channel-specific DTO，自带 provider discriminator）
                       ↓
                  前端按 provider 字段分支渲染
```

**核心承诺**：

- manager **完全无状态**（零内存缓存 / 零写盘 / 零长期数据）
- token 真源 **唯一**为 SDK 写的 jsonl/rollout
- metadata.json 里 **没有任何** token 字段
- 公共 API **只有 1 个**：`get_thread_usage(thread_id)`

## 5 大硬性约束（non-negotiable）

1. **manager 是 façade**：不持有状态、不写盘、不缓存。
2. **真源在 SDK**：所有 token 数据**唯一**来自 SDK 自己写的 jsonl/rollout，manager 只读、只派生。
3. **分通道不统一**：每个通道（claude / openai）有自己的 DTO，映射 SDK 原生字段 1:1，不再有统一 `ThreadUsageSummary`。
4. **manager 是唯一入口**：外部模块**只能**调 `manager.get_thread_usage()`；不允许直接 import 派生器 / 直接读 SDK 文件 / 在前端做累加。
5. **`.importlinter` Contract 强制**：派生器全部加入 forbidden_modules；CI gate 不通过禁止 merge。

## 外部 API 表面（仅 1 个公共方法）

```python
class UsageTokenManager:
    """完全无状态。"""

    def __init__(self, *, claude_locator, codex_locator, ...):
        """注入定位器（不持有任何长期数据）。"""

    async def get_thread_usage(
        self, thread_id: str
    ) -> ClaudeUsage | CodexUsage | GenericChatUsage | None:
        """唯一公共入口。

        内部：
        1. 读 thread metadata 拿 backend_kind（只读 IO，无状态）
        2. 按 backend_kind 派发对应派生器
        3. 派生器扫 SDK 真源（只读 IO）
        4. 返回 channel-specific DTO

        非已激活 thread / 真源不存在 → 返回 None。
        """
```

WS 帧的包装下沉到 web 协议层（不归 manager 管），由调用方拿 `get_thread_usage` 输出自己拼。

## 通道 DTO（分通道，不强行统一）

### ClaudeUsage（claude_code 通道 + generic_chat-anthropic）

```python
class ClaudeUsage(BaseModel):
    provider: Literal["claude"] = "claude"        # discriminator

    # 核心 4 字段（前端 StatusLine 渲染）
    input_tokens: int                              # 纯新增 input（不含 cache）
    output_tokens: int                             # 含 thinking 内部 reasoning
    cache_read_input_tokens: int                   # 命中 prompt cache
    cache_creation_input_tokens: int               # 新写入 cache

    # cache TTL 细分
    cache_creation: ClaudeCacheCreation

    # 派生
    context_usage: int                             # = input + cache_read + cache_creation

    # 模型 + 上限
    model: str                                     # "claude-opus-4-7"
    context_window: int                            # 1_000_000（前端 model-context.ts 查）

class ClaudeCacheCreation(BaseModel):
    ephemeral_1h_input_tokens: int = 0
    ephemeral_5m_input_tokens: int = 0
```

### CodexUsage（codex 通道 + generic_chat-openai）

```python
class CodexUsage(BaseModel):
    provider: Literal["openai"] = "openai"         # discriminator

    # codex 自带累加（thread 级累计，从最后一条 token_count 事件取）
    total: CodexTokenBreakdown
    # 最近一次 API call
    last: CodexTokenBreakdown

    # codex 自带 context window 上限（不用查表）
    model_context_window: int

    # codex 自带速率限制（Claude 没有）
    rate_limits: CodexRateLimits | None = None

class CodexTokenBreakdown(BaseModel):
    input_tokens: int                              # 含 cached_input 子集
    cached_input_tokens: int                       # 命中 cache 子集（input 子集）
    output_tokens: int                             # 含 reasoning 子集
    reasoning_output_tokens: int                   # o1/o3 推理（output 子集）
    total_tokens: int

class CodexRateLimits(BaseModel):
    primary: CodexRateLimitWindow                  # 5h 窗口
    secondary: CodexRateLimitWindow                # 7d 窗口
    plan_type: str                                 # "plus" / "team" / ...

class CodexRateLimitWindow(BaseModel):
    used_percent: float
    window_minutes: int
    resets_at: int
```

### GenericChatUsage（待定，[03-core-workflows.md](./03-core-workflows.md) 细化）

generic_chat 通道走我们自家的 LLMProvider，没有 SDK jsonl 真源，需要从我们自己的 session backend 派生。倾向"复用 SDK 通道字段"：

- 底层 provider 是 anthropic 系 → 复用 `ClaudeUsage`
- 底层 provider 是 openai 系 → 复用 `CodexUsage`

## 范围边界

**包含**：

- 新模块 `src/web/usage/usage_token_v2/`（与 v1 包并存一段时间，迁移完后删 v1）
- 三个派生器（`_derive_claude.py` / `_derive_codex.py` / `_derive_generic.py`），manager 包内私有
- 通道 DTO 三件套（ClaudeUsage / CodexUsage / GenericChatUsage）
- manager 单方法 `get_thread_usage`
- ThreadMetadata schema v8 → v9：**删** `cumulative_usage` / `last_run_snapshot` / `last_model_name` 三字段（不做数据迁移——真源在 SDK，旧数据冗余）
- 删 `record_run_usage` / `set_last_assistant_usage` / `to_ws_frame` 等 v1 公共方法
- 删 `UsagePersistSink`（ws_event_sink 不再 push token 给 manager）
- 前端 StatusLine 拆 `StatusLineClaude` / `StatusLineCodex` / `StatusLineGenericChat`
- importlinter Contract 9 升级：把 v2 派生器加入 forbidden_modules
- 三通道 e2e：每通道开一个 thread，验证字段从 SDK 真源 1:1 映射

**不包含**：

- token 计费金额估算（cost = tokens × pricing）—— 留 v3 扩展
- 跨 thread 聚合统计 —— 留 v3
- 服务端 server_tool_use 计费维度（Claude 的 web_search/web_fetch）—— 留 v3
- Codex `rate_limits` 在前端的展示（v2 后端透传，前端 v3 渲染）

## 模块导航

| 模块 | 状态 | 文档 |
|---|---|---|
| `UsageTokenManager` v2 (façade) | spec 编写中 | [02-module-breakdown.md](./02-module-breakdown.md) |
| `_derive_claude.py` | spec 编写中 | [02-module-breakdown.md#derive-claude](./02-module-breakdown.md#derive-claude) |
| `_derive_codex.py` | spec 编写中 | [02-module-breakdown.md#derive-codex](./02-module-breakdown.md#derive-codex) |
| `_derive_generic.py` | spec 编写中 | [02-module-breakdown.md#derive-generic](./02-module-breakdown.md#derive-generic) |
| 通道 DTO（ClaudeUsage / CodexUsage / GenericChatUsage） | spec 编写中 | [04-data-and-state.md](./04-data-and-state.md) |
| metadata.json schema v9（删 token 字段） | spec 编写中 | [04-data-and-state.md#schema-v9](./04-data-and-state.md#schema-v9) |
| 前端 StatusLine 拆分 | spec 编写中 | [03-core-workflows.md#frontend](./03-core-workflows.md#frontend) |

## 与 v1 的关系

| 维度 | v1 | v2 |
|---|---|---|
| manager 角色 | owner（写盘 + 读盘 + 累加） | façade（仅查询） |
| 公共方法数 | 6 个 | 1 个 |
| 真源 | metadata.json 里的 cumulative_usage | SDK jsonl/rollout |
| 通道 DTO | 统一 ThreadUsageSummary | 分通道 ClaudeUsage / CodexUsage / GenericChatUsage |
| metadata.json token 字段 | 必需（schema v8） | 全删（schema v9） |
| `record_run_usage` | 公共 API | **删除** |
| `set_last_assistant_usage` | 公共 API（v0.1 加） | **删除** |
| 累加策略 | 每轮 record + manager 内部累加 | 不累加（Claude 取最后一条；Codex 取 SDK 自带 total） |
| 写盘点 | 多个 | 0 |
| 并发竞争 | fire-and-forget + lock 内多源 | 零（无人写） |
| importlinter Contract 9 | 已有（禁外部 import 内部） | 升级（加 v2 派生器） |

**废止的 v1 决策**：

- v1 §系统目标 #5"修持久化空跑：每轮真实写盘 `cumulative_usage`" → **废止**，不写盘了
- v1 D5"schema v7→v8：嵌套 `cumulative_usage: dict` 落盘" → **v2 废止**（v9 删字段）
- v1 D6"三通道每轮调 `record_run_usage`" → **废止**，service 不再 push token
- v1 §6 API 6 个方法 → **简化到 1 个**

**保留的 v1 决策**：

- 强 import 边界（importlinter Contract 9）✓ 沿用并升级
- 分 channel 字段映射（Anthropic vs OpenAI 语义不同）✓ 强化（v2 完全不强求统一）
- v0.1 中间态的 claude_code 派生器实现 ✓ 直接迁过来重命名

## 文档导航

- [目标 + 完成标准 + 边界](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程（三通道派生 / WS emit / 前端消费 / schema 迁移）](./03-core-workflows.md)
- [数据模型与状态（DTO / metadata schema v9 / SDK 真源结构）](./04-data-and-state.md)
- [验证策略与演进（测试 / lint / e2e / 风险）](./05-validation-and-evolution.md)
- [Task 映射（实施拆分）](./90-task-map.md)
