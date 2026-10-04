# 数据模型与状态

## 一眼速览

```
SDK 真源（外部，唯一可信）             manager 包内 DTO（公共，外部可见，frozen）
──────────────────────────             ─────────────────────────────────────────

Claude jsonl                           ┌─→ ClaudeUsage                  ── claude_code +
~/.claude/projects/.../<tid>.jsonl     │   ClaudeCacheCreation             generic_chat-anthropic
  message.usage:                       │
  - input_tokens                       │
  - output_tokens                      │
  - cache_read_input_tokens            │
  - cache_creation_input_tokens        │
  - cache_creation.ephemeral_1h        │
  - cache_creation.ephemeral_5m        │
                                       │
Codex rollout                          ┌─→ CodexUsage                   ── codex +
~/.codex/sessions/.../rollout-...jsonl │   CodexTokenBreakdown            generic_chat-openai
  event_msg.payload (token_count):     │   CodexRateLimits
  - info.total_token_usage             │   CodexRateLimitWindow
  - info.last_token_usage              │
  - info.model_context_window          │
  - rate_limits                        │
                                       │
Our session backend                    └─→ GenericChatAnthropicUsage    ── generic_chat 通道
（memory / sqlite / file）                  GenericChatOpenAIUsage          按底层 provider 分
```

**核心约束**：

1. DTO 全部 `frozen=True` + `extra="forbid"`
2. **外部禁止构造** DTO 实例 —— 只能从 `manager.get_thread_usage()` 接收
3. 每个 DTO 自带 `provider: Literal[...]` 字段作 **discriminator**，前端用它分支
4. 字段 1:1 映射 SDK 原生字段 —— SDK 加新字段时**只动 DTO**，不改外部代码

## Claude 系 DTO

### `ClaudeUsage`

```python
# src/web/usage/usage_token_v2/_models.py

from typing import Literal
from pydantic import BaseModel, ConfigDict, Field


class ClaudeCacheCreation(BaseModel):
    """Anthropic prompt cache TTL 细分（cache_creation 子结构）。"""
    model_config = ConfigDict(frozen=True, extra="forbid")

    ephemeral_1h_input_tokens: int = Field(default=0, ge=0)
    """写入 1 小时 TTL cache 的 input tokens。
    1h cache 单价比 5m cache 贵，保留更久。"""

    ephemeral_5m_input_tokens: int = Field(default=0, ge=0)
    """写入 5 分钟 TTL cache 的 input tokens（默认档）。"""


class ClaudeUsage(BaseModel):
    """Claude 系（claude_code 或 generic_chat-anthropic）token 用量。

    映射 SDK `message.usage` 1:1。**取最后一条** assistant message 的 usage，
    不做累加（Anthropic 的 input_tokens 字段是"纯新增"语义，最后一条 input +
    cache_read + cache_creation = 当前 context 占用）。
    """
    model_config = ConfigDict(frozen=True, extra="forbid")

    # ─────────────────────────────────────────────────────
    # discriminator
    # ─────────────────────────────────────────────────────
    provider: Literal["claude"] = "claude"
    """前端用此字段做 narrowing。"""

    # ─────────────────────────────────────────────────────
    # 核心 4 字段（SDK 原生）
    # ─────────────────────────────────────────────────────
    input_tokens: int = Field(default=0, ge=0)
    """**纯新增** input tokens（不含 cache 部分）。
    
    Anthropic 语义：这次 API call 新发的 input（用户最后一句话 + 系统 prompt 增量）。
    历史对话的大部分已经命中 cache，所以这个数字通常很小（个位数）。"""

    output_tokens: int = Field(default=0, ge=0)
    """这次 API call 的 output（含 thinking 内部 reasoning）。"""

    cache_read_input_tokens: int = Field(default=0, ge=0)
    """命中 prompt cache 的 input tokens（标准 input 价的 10%）。"""

    cache_creation_input_tokens: int = Field(default=0, ge=0)
    """新写入 cache 的 input tokens（标准 input 价的 125%）。"""

    # ─────────────────────────────────────────────────────
    # cache TTL 细分（SDK 原生嵌套字段）
    # ─────────────────────────────────────────────────────
    cache_creation: ClaudeCacheCreation = Field(default_factory=ClaudeCacheCreation)
    """cache_creation_input_tokens 按 TTL 细分（1h vs 5m，价格不同）。"""

    # ─────────────────────────────────────────────────────
    # 派生量（manager 派生器算好）
    # ─────────────────────────────────────────────────────
    context_usage: int = Field(default=0, ge=0)
    """当前 context 占用 = input + cache_read + cache_creation。
    
    这是发给模型的完整 prompt 大小，跟 context_window 比较得百分比。"""

    # ─────────────────────────────────────────────────────
    # 模型元数据
    # ─────────────────────────────────────────────────────
    model: str = ""
    """模型名（最后一条 assistant message 的 message.model）。"""

    context_window: int = 0
    """模型 context 上限（由派生器查 `_model_context_table.py` 填）。0=未知。"""
```

### Claude 真源原始字段（SDK jsonl 实际产出）

完整字段集（v2 派生器**消费**的源数据；前端只看 DTO，不看这个）：

```jsonc
{
  "input_tokens": 6,
  "output_tokens": 881,
  "cache_read_input_tokens": 341086,
  "cache_creation_input_tokens": 431,
  "cache_creation": {
    "ephemeral_1h_input_tokens": 431,
    "ephemeral_5m_input_tokens": 0
  },
  "server_tool_use": { "web_search_requests": 0, "web_fetch_requests": 0 },  // v3 扩展
  "service_tier": "standard",                                                  // v3 扩展
  "speed": "standard",                                                         // v3 扩展
  "inference_geo": "",                                                         // v3 扩展
  "iterations": [...]                                                          // 调试用，跳过
}
```

**v2 取**：前 5 项（加 cache_creation 嵌套）。
**v3 留**：`server_tool_use` / `service_tier` 等计费维度。

## Codex / OpenAI 系 DTO

### `CodexUsage`

```python
class CodexTokenBreakdown(BaseModel):
    """Codex token 用量 5 字段（OpenAI 语义）。"""
    model_config = ConfigDict(frozen=True, extra="forbid")

    input_tokens: int = Field(default=0, ge=0)
    """**总** input tokens（**含** cached_input 子集，OpenAI 语义）。"""

    cached_input_tokens: int = Field(default=0, ge=0)
    """命中 cache 的 input tokens（**是 input_tokens 的子集，不要相加**）。"""

    output_tokens: int = Field(default=0, ge=0)
    """**总** output（**含** reasoning_output 子集，OpenAI 语义）。"""

    reasoning_output_tokens: int = Field(default=0, ge=0)
    """o1/o3 内部推理 tokens（**是 output_tokens 的子集**）。"""

    total_tokens: int = Field(default=0, ge=0)
    """codex 自带的总和（≈ input + output）。"""


class CodexRateLimitWindow(BaseModel):
    """Codex 速率限制单窗口（5h 或 7d）。"""
    model_config = ConfigDict(frozen=True, extra="forbid")

    used_percent: float = 0.0
    """该窗口已用百分比（0-100）。"""

    window_minutes: int = 0
    """窗口长度（分钟）。"""

    resets_at: int = 0
    """重置时间戳（Unix epoch 秒）。"""


class CodexRateLimits(BaseModel):
    """Codex 速率限制（两个窗口 + 计划等级）。"""
    model_config = ConfigDict(frozen=True, extra="forbid")

    primary: CodexRateLimitWindow
    """主要窗口（一般是 5h / 300min）。"""

    secondary: CodexRateLimitWindow
    """次要窗口（一般是 7d / 10080min）。"""

    plan_type: str = ""
    """计划类型 `plus` / `team` / `pro` / `enterprise` 等。"""


class CodexUsage(BaseModel):
    """Codex（OpenAI 系）token 用量。

    映射 codex rollout `event_msg.payload(token_count).info` 1:1。
    codex **已自带累加**——`total_token_usage` 是 thread 级累计，`last_token_usage`
    是最后一次 API call，直接用，**不再自己加**。
    """
    model_config = ConfigDict(frozen=True, extra="forbid")

    # ─────────────────────────────────────────────────────
    # discriminator
    # ─────────────────────────────────────────────────────
    provider: Literal["openai"] = "openai"

    # ─────────────────────────────────────────────────────
    # codex 自带累加 + 最后一次（直接 1:1 映射）
    # ─────────────────────────────────────────────────────
    total: CodexTokenBreakdown
    """thread 级累计（codex 自己算好的）。"""

    last: CodexTokenBreakdown
    """最近一次 API call 的用量。"""

    # ─────────────────────────────────────────────────────
    # codex 自带 context window 上限（不用查表）
    # ─────────────────────────────────────────────────────
    model_context_window: int = Field(default=0, ge=0)
    """codex 报的模型 context 上限。"""

    # ─────────────────────────────────────────────────────
    # 速率限制（v2 透传，前端 v3 渲染）
    # ─────────────────────────────────────────────────────
    rate_limits: CodexRateLimits | None = None
    """codex 速率限制状态（5h 窗口 + 7d 窗口）。
    None = codex 没报（如本地模型）。"""
```

### Codex 真源原始字段（rollout token_count 事件）

```jsonc
// event_msg.payload (type=="token_count")
{
  "type": "token_count",
  "info": {
    "total_token_usage": {
      "input_tokens": 4038540,
      "cached_input_tokens": 3731712,
      "output_tokens": 13158,
      "reasoning_output_tokens": 3064,
      "total_tokens": 4051698
    },
    "last_token_usage": {
      "input_tokens": 151026,
      "cached_input_tokens": 148352,
      "output_tokens": 366,
      "reasoning_output_tokens": 0,
      "total_tokens": 151392
    },
    "model_context_window": 258400
  },
  "rate_limits": {
    "primary":   { "used_percent": 27.0, "window_minutes": 300,   "resets_at": 1777965554 },
    "secondary": { "used_percent": 20.0, "window_minutes": 10080, "resets_at": 1777962127 },
    "limit_id": "codex",         // v2 跳过
    "limit_name": null,           // v2 跳过
    "credits": null,              // v2 跳过
    "rate_limit_reached_type": null,  // v2 跳过
    "plan_type": "plus"
  }
}
```

**v2 取**：`info.total` / `info.last` / `info.model_context_window` / `rate_limits.primary` / `rate_limits.secondary` / `rate_limits.plan_type`。
**v2 跳过**：`limit_id` / `limit_name` / `credits` / `rate_limit_reached_type`。
**注意**：一轮可能 emit 多次 `token_count`，但前几次 `info` 是 `null`（占位），派生器**取最后一条 `info` 非空的**。

## Generic Chat 系 DTO

### `GenericChatAnthropicUsage`

```python
class GenericChatAnthropicUsage(BaseModel):
    """generic_chat 通道（底层是 Anthropic 系 LLMProvider）的 token 用量。
    
    字段跟 ClaudeUsage 平行（不复用是为了 discriminator 字段不同）。
    """
    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: Literal["claude"] = "claude"  # 跟 ClaudeUsage 同——前端复用渲染组件

    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    cache_read_input_tokens: int = Field(default=0, ge=0)
    cache_creation_input_tokens: int = Field(default=0, ge=0)
    cache_creation: ClaudeCacheCreation = Field(default_factory=ClaudeCacheCreation)

    context_usage: int = Field(default=0, ge=0)
    model: str = ""
    context_window: int = 0
```

**为什么不直接复用 `ClaudeUsage`**：

- 数据**来源**不同（一个来自 SDK jsonl，一个来自我们自己的 session backend）
- 派生路径不同（前者 SDK 写盘格式；后者我们自定义 Event 流）
- 字段**形态**相同 + `provider` discriminator 也相同 → **前端可复用同一个 React 组件渲染**

设计 trade-off：保留 backend 派生路径独立，前端零成本复用。如果 v3 加 `server_tool_use` 等 Claude-specific 字段，generic_chat 通道可能没法填（我们自己 LLMProvider 不一定报这字段），那时候 DTO 形态会自然分叉。

### `GenericChatOpenAIUsage`

```python
class GenericChatOpenAIUsage(BaseModel):
    """generic_chat 通道（底层是 OpenAI 系 LLMProvider）的 token 用量。
    
    形态比 CodexUsage 简化：没有 codex 自带的累加 + rate_limits，需要自己派生。
    """
    model_config = ConfigDict(frozen=True, extra="forbid")

    provider: Literal["openai"] = "openai"

    # 直接用 CodexTokenBreakdown（字段一样）
    total: CodexTokenBreakdown   # 我们自己累加
    last: CodexTokenBreakdown    # 最后一条

    model: str = ""
    context_window: int = 0
    # rate_limits 没有（我们不是 codex）
```

**实施决策**（2026-05-15 spike 敲死）：

- **Backend 支持范围**：**只支持 FileSession**（`messages.jsonl` 每行含 `usage` 字段）。`InMemorySession` 不持久化 usage，`SQLiteSession` 项目内已不维护——这两种 backend 下 generic_chat 通道**前端 StatusLine 留空**
- **真源格式**（FileSession `messages.jsonl`）：每行 JSON 含可选 `usage` 字段，跟 SDK 原生 usage dict 同形
- **累加策略**：**不累加，取最后一条带 usage 的 message**（跟 Claude 通道对称）
- **provider 映射**：用 `LLMPresetConfig.provider: Literal["openai_compatible","anthropic"] | None`；`None` 时按 `base_url` 退化判定（复用 `executors.llm.provider_factory` 现有逻辑）

## metadata.json schema v9

### 当前（v8）

```python
class ThreadMetadata:
    id: str
    name: str
    preset_id: str
    backend_kind: Literal["generic_chat", "claude_code", "codex"]
    claude_thread_id: str
    codex_thread_id: str
    cwd: str
    created_at: float
    updated_at: float
    message_count: int

    # ▼ v8 引入的 token 字段（v9 要删）
    cumulative_usage: dict | None = None
    last_run_snapshot: dict | None = None
    last_model_name: str = ""

    is_pinned: bool
    schema_version: Literal[1, ..., 8]
```

### 改后（v9）

```python
class ThreadMetadata:
    """thread 元数据 schema v9：纯配置态，不含任何 token 字段。
    
    token 数据真源在 SDK jsonl/rollout，由 UsageTokenManager v2 现场派生。
    """
    id: str
    name: str
    preset_id: str
    backend_kind: Literal["generic_chat", "claude_code", "codex"]
    claude_thread_id: str
    codex_thread_id: str
    cwd: str
    created_at: float
    updated_at: float
    message_count: int

    # ▲ v8 的 token 字段全部删除

    is_pinned: bool
    schema_version: Literal[1, ..., 9] = 9
```

**字段表**：

| 分组 | 字段 |
|---|---|
| 身份 | `id` / `name` / `preset_id` |
| 通道路由 | `backend_kind` / `claude_thread_id` / `codex_thread_id` / `cwd` |
| 时间 | `created_at` / `updated_at` |
| 计数 | `message_count` |
| 偏好 | `is_pinned` |
| schema | `schema_version` |

**token 相关字段全部不在**——manager v2 不读不写。

## v8 → v9 lazy upgrade

**规则**：

```python
# web/thread_metadata.py 现有 lazy upgrade 链最后加一段
if data.get("schema_version") == 8:
    # v9 删除 3 个 token 字段；存在就 drop 掉
    data.pop("cumulative_usage", None)
    data.pop("last_run_snapshot", None)
    data.pop("last_model_name", None)
    data["schema_version"] = 9
```

**不迁移数据原因**：

- 真源在 SDK jsonl/rollout，旧 metadata 里的 token 字段本来就是冗余拷贝
- 旧字段的精度还比真源**低**（lossy 4 字段，缺 cache_creation 细分）
- v2 重启后第一次查询直接派生真源，前端立刻看到完整数据

**幂等性**：v9 dict 再过 upgrade 不变化。

**写盘**：永远写 `schema_version=9`，不留旧字段。

## 状态流转

### thread token 数据生命周期

```
thread 创建（metadata.json v9，无 token 字段）
       ↓
SDK 跟 thread 对话，SDK 自己写 jsonl/rollout（manager 不参与）
       ↓
前端打开 thread / WS 帧需要刷新
       ↓
manager.get_thread_usage(tid)
       ├─ read metadata 拿 backend_kind
       ├─ locator 找 SDK 文件路径
       └─ 派生器扫文件，返回 channel-specific DTO
       ↓
前端按 provider 字段渲染
```

**不变量**：

1. `metadata.json` 写盘只在 thread CRUD（create/rename/pin/bind_claude_thread_id 等）触发，**永远不**因 token 触发
2. manager 不在任何条件下写盘
3. manager 不持有跨调用的状态——两次 `get_thread_usage(tid)` 调用完全独立，每次都重新读 metadata + 重新扫 SDK 文件

## 公共 API 表面（vs v1）

| v1 公共方法 | v2 是否保留 |
|---|---|
| `record_run_usage` | ❌ 删除 |
| `get_thread_summary` | ❌ 改名 `get_thread_usage` + 改返回类型 |
| `get_last_run_snapshot` | ❌ 删除（取最后一条 = 派生本身的语义） |
| `to_ws_frame` | ❌ 删除（WS 帧包装下沉到 web 协议层） |
| `context_window` | ❌ 删除（context_window 已经在 DTO 字段里） |
| `context_usage_pct` | ❌ 删除（前端用 `usage.context_usage / usage.context_window`） |
| `set_last_assistant_usage` (v0.1) | ❌ 删除 |
| `set_thread_model` (v0.1) | ❌ 删除 |
| **`get_thread_usage`** | ✅ **v2 唯一公共方法** |

## `.importlinter` Contract 9 升级

```toml
[importlinter:contract:usage-token-encapsulation]
name = Only UsageTokenManager v2 and public DTOs exposed; derivers/locators are private
type = forbidden
allow_indirect_imports = True
source_modules =
    core
    cli
    host
    safety
    observability
    config_loader
    executors
    web.app
    web.routers
    web.app_support.cron_delivery
    web.cron_ws
    web.ws
    web.ws_event_sink
    web.thread_manager      # 装配层例外见 ignore_imports
    web.thread_metadata
    web.integrations.claude_code
    web.integrations.codex
    web.protocol
    web.usage_token         # v1 包（迁移期）
forbidden_modules =
    web.usage.usage_token_v2._derive_claude
    web.usage.usage_token_v2._derive_codex
    web.usage.usage_token_v2._derive_generic
    web.usage.usage_token_v2._models
    web.usage.usage_token_v2._model_context_table
ignore_imports =
# 装配层 thread_manager 允许构造 v2 manager + 注入 locator，
# 但仍禁止直接 import 派生器
    web.thread_manager -> web.usage.usage_token_v2
```

## 设计要点回顾

1. **承认 SDK 是真源**：所有 DTO 字段直接映射 SDK 原生字段，加新字段时只动 DTO
2. **承认通道差异**：不强行统一，每通道 DTO 独立但共享 discriminator 模式
3. **manager 无状态**：构造时只接 locator，运行时不存任何东西
4. **前端按 provider narrowing**：discriminator 模式让 TS 自动收窄类型
5. **schema 升级简单粗暴**：v9 直接 drop 3 字段（不迁移），承认旧数据是冗余
