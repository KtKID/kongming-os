# 数据模型与状态

## 一眼速览

**核心数据结构 = `TokenUsage`**（discriminated union，**manager 内部私有**）。
其他 3 个公共 DTO 都是从 `TokenUsage` 派生出来给外部用的视图。

```
manager 内部（私有，外部禁止 import）          对外暴露（公共 DTO，可被外部消费）
──────────────────────────────────────         ─────────────────────────────────
                                                ┌─→ UsageTokenSnapshot  ── 一轮快照（实时）
   TokenUsage  ★核心★                          │
   ├─ _AnthropicTokenUsage   ─→ manager 派生 ──┼─→ ThreadUsageSummary   ── thread 累计 summary
   │   (4 字段：input / cache_read /            │
   │    cache_creation / output)                └─→ UsageFrame           ── WS S2C 帧
   │
   └─ _OpenAITokenUsage
       (4 字段：input / cached_input /
        output / reasoning_output)
```

### 命名表（一眼对应）

| 名字 | 公/私 | 角色 | 谁能用 |
|---|---|---|---|
| **`TokenUsage`** ★ | **私有** | **核心：一轮 token 用量的 discriminated union（Anthropic/OpenAI 二选一）** | 仅 `web.usage_token.manager` |
| `_AnthropicTokenUsage` | 私有 | TokenUsage 的 Anthropic variant（4 字段，不含 cache 子集） | 仅 manager 内部 |
| `_OpenAITokenUsage` | 私有 | TokenUsage 的 OpenAI variant（4 字段，input 含 cached 子集） | 仅 manager 内部 |
| `UsageTokenSnapshot` | 公共 | 一轮快照 DTO（manager 从 TokenUsage 派生 + context_usage） | 任何模块（store / WS / 测试） |
| `ThreadUsageSummary` | 公共 | thread 级累计 summary DTO（含 model_context_window / pct） | router / 前端 |
| `UsageFrame` | 公共 | WS S2C 帧（嵌套 UsageTokenSnapshot） | ws_event_sink / 前端 |

### 关键约束

1. **外部模块禁止 import `TokenUsage`**：`.importlinter` Contract 强制；要 token 数据从 `UsageTokenManager` 拿派生 DTO
2. **manager 私自维护**「TokenUsage → DTO 的派生逻辑」：派生公式（如 `context_usage`）在 `_channel_*.py` 里
3. **私有类下划线前缀**：`_AnthropicTokenUsage` / `_OpenAITokenUsage` / `TokenUsage`（私有 union 别名）—— 即便能 import，下划线开头表明不应该 import

> ⚠️ **命名一致性说明**：模块叫 `usage_token`（业务领域名）/ 管理者叫 `UsageTokenManager`（领域名 + Manager 后缀）/ 核心数据结构叫 `TokenUsage`（这是 OpenAI/Anthropic SDK 业界惯例，``response.usage`` 字段对应的类名）。三者命名**有意区分顺序**：业务领域 = "usage token"，数据结构 = "token usage"。

---

## 核心数据结构

### 私有：TokenUsage discriminated union

仅 `web.usage_token` 包内部使用；外部模块禁止 import。

```python
# src/web/usage_token/_models.py

from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field


class _AnthropicTokenUsage(BaseModel):
    """Anthropic 系（claude_code + generic_chat-anthropic）一轮 token 用量。

    SDK 原生字段，**不含 lossy 归一化**。

    ⚠️ Anthropic 语义关键差异：
    - input_tokens **不含** cache 部分（cache_read / cache_creation 独立计数）
    - context_usage 派生 = input + cache_read + cache_creation
    """
    model_config = ConfigDict(frozen=True, extra="forbid")

    channel: Literal["anthropic"] = "anthropic"
    input_tokens: int = Field(default=0, ge=0)
    cache_read_input_tokens: int = Field(default=0, ge=0)
    cache_creation_input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)


class _OpenAITokenUsage(BaseModel):
    """OpenAI 系（codex + generic_chat-openai）一轮 token 用量。

    SDK 原生字段。

    ⚠️ OpenAI 语义关键差异：
    - input_tokens **含** cached_input 子集
    - output_tokens **含** reasoning_output 子集
    - context_usage 派生 = input_tokens（已含 cache，不再加）
    """
    model_config = ConfigDict(frozen=True, extra="forbid")

    channel: Literal["openai"] = "openai"
    input_tokens: int = Field(default=0, ge=0)
    cached_input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    reasoning_output_tokens: int = Field(default=0, ge=0)


TokenUsage = Annotated[
    _AnthropicTokenUsage | _OpenAITokenUsage,
    Field(discriminator="channel"),
]
"""manager 私有类型；外部禁止 import。"""
```

### 公共：UsageTokenSnapshot（一轮快照）

外部可见（只读 DTO；不是 `TokenUsage` 本身）。

```python
# src/web/usage_token/_models.py（同文件，但导出位置不同）

class UsageTokenSnapshot(BaseModel):
    """一轮 token usage 快照。

    供 ws_event_sink emit / 前端实时显示。
    extras 字段装 channel-specific 字段（key 是 SDK 原生字段名），
    避免外部代码依赖 channel 分支。
    """
    model_config = ConfigDict(frozen=True, extra="forbid")

    channel: Literal["anthropic", "openai"]
    input_tokens: int = 0
    output_tokens: int = 0
    extras: dict[str, int] = Field(default_factory=dict)
    """
    Anthropic: {"cache_read_input_tokens": N, "cache_creation_input_tokens": M}
    OpenAI:    {"cached_input_tokens": N, "reasoning_output_tokens": M}
    """
    context_usage: int = 0
    """派生：当前 context 占用（公式由 channel 决定，已计算好）"""

    turn: int
    run_id: str
```

### 公共：ThreadUsageSummary（thread 级累计 summary）

```python
class ThreadUsageSummary(BaseModel):
    """thread 级累计 token usage summary。

    供 GET /api/threads 返回 / 前端 hydrateUsageFromThreads / StatusLine 渲染。
    """
    model_config = ConfigDict(frozen=True, extra="forbid")

    channel: Literal["anthropic", "openai"]
    cumulative_input_tokens: int = 0
    cumulative_output_tokens: int = 0
    extras: dict[str, int] = Field(default_factory=dict)
    """同 UsageTokenSnapshot.extras。"""

    last_run_context_usage: int = 0
    """最近一轮的 context_usage（取 last_run_snapshot 的派生值）。"""

    model_name: str = ""
    """thread 当前绑定的 model 名（用来查 context_window）。"""

    model_context_window: int | None = None
    """对应模型的 context window 上限；未命中 None。"""

    context_usage_pct: float | None = None
    """last_run_context_usage / model_context_window；未命中 None。"""
```

### 公共：UsageFrame（WS 帧）

替代现有 `web/protocol/ws_frames.py::UsageFrame`。

```python
# src/web/usage_token/_models.py（或 export 路径在 __init__.py）

class UsageFrame(_S2CFrameBase):
    """WS S2C 帧：一轮 token 用量推送。

    嵌套 UsageTokenSnapshot，避免直接平铺字段（不再 lossy）。
    """
    kind: Literal["usage"] = "usage"
    turn: int
    run_id: str = ""
    snapshot: UsageTokenSnapshot
```

## ThreadMetadata 落盘改造

### 当前（v7）

```python
cumulative_prompt_tokens: int = 0
cumulative_completion_tokens: int = 0
cumulative_total_tokens: int = 0          # 派生量
cumulative_cache_read_tokens: int = 0
cumulative_cache_creation_tokens: int = 0
schema_version: Literal[..., 7] = 7
```

问题：lossy 归一化 + 字段语义跨 channel 不可比 + Claude Code/Codex 通道这些字段永远 0。

### 改后（v8 完整字段定义）

每个字段必须带中文注释（实施时强制保持）。

```python
# src/web/thread_metadata.py

class ThreadMetadata(BaseModel):
    """单个 thread 的持久化元数据。

    落盘形态：``.kongming/web/threads/<thread_id>/metadata.json``。
    本类是后端本地状态；前端通过 router 暴露的 DTO 间接看到。
    """

    model_config = ConfigDict(frozen=True, extra="forbid")

    id: Annotated[str, Field(pattern=r"^thread-[a-f0-9]{12}$")]
    """thread 唯一标识。格式：``thread-<hex12>``；与 runner session_id 同值。"""

    name: Annotated[str, Field(min_length=1, max_length=200)]
    """thread 显示名（用户输入，最长 200 字符；UI 列表展示用）。"""

    preset_id: str = ""
    """创建时选的 LLM preset ID（来自 ``config_loader.models.LLMPresetConfig``）。
    ``backend_kind="claude_code"`` 时允许空字符串占位（claude_code 由 SDK 内部选 model）。"""

    backend_kind: Literal["generic_chat", "claude_code", "codex"] = "generic_chat"
    """后端通道类型（transport 路由维度）：
    - ``generic_chat``：走 InputAssembler + LLMProvider 的原生路径
    - ``claude_code``：走 Claude Agent SDK
    - ``codex``：走 Codex CLI
    ⚠️ 跟 token 语义维度的 ``channel`` 解耦；映射规则在 UsageTokenManager 内部。"""

    claude_thread_id: str = ""
    """Claude SDK 底层 session/thread id（仅 ``backend_kind="claude_code"`` 有效）。
    空字符串=未绑定（首次对话前 / 非 claude_code 通道）；
    一旦绑定即记录 Claude 侧分配的可恢复 id，用于 resume 历史。"""

    codex_thread_id: str = ""
    """Codex CLI 底层 session/thread id（仅 ``backend_kind="codex"`` 有效）。
    空字符串=未绑定 / 非 codex 通道。"""

    cwd: str = ""
    """claude_code 通道运行时的工作目录绝对路径。
    用于定位 ``~/.claude/projects/<encoded-cwd>/<claude_thread_id>.jsonl`` 历史文件。
    空字符串=不需要 / 未设置（generic_chat 通道不消费此字段）。"""

    created_at: float
    """thread 创建时间（Unix 时间戳，秒）。"""

    updated_at: float
    """最近活跃时间（Unix 时间戳，秒）。每轮对话结束 / rename / pin 切换时更新。"""

    message_count: Annotated[int, Field(ge=0)] = 0
    """历史消息总数（≥0）。UI 列表上「X 条消息」展示用。"""

    cumulative_usage: dict[str, Any] | None = None
    """token 用量累计（v8 新增，**透明 dict 落盘**）。

    ⚠️ **架构约束**：本字段是透明 dict，**仅 `UsageTokenManager` 能解释**。
    外部模块禁止直接读字段（用 ``manager.get_thread_summary(thread_id)`` 拿派生 summary）。

    落盘格式（Anthropic 系，``backend_kind=claude_code`` 或 generic_chat-anthropic）：
        {
          "channel": "anthropic",
          "input_tokens": N,                  # 不含 cache 的纯新输入累计
          "cache_read_input_tokens": N,       # 命中 cache 的输入累计（独立计数）
          "cache_creation_input_tokens": N,   # 写 cache 的输入累计（独立计数）
          "output_tokens": N                  # 输出累计
        }

    落盘格式（OpenAI 系，``backend_kind=codex`` 或 generic_chat-openai）：
        {
          "channel": "openai",
          "input_tokens": N,                  # 总输入（含 cached_input 子集）
          "cached_input_tokens": N,           # 命中 cache 的输入子集（是 input 的子集）
          "output_tokens": N,                 # 总输出（含 reasoning_output 子集）
          "reasoning_output_tokens": N        # 推理思考用量（是 output 的子集）
        }

    ``None`` 表示该 thread 还没跑过任何 turn。"""

    is_pinned: bool = False
    """是否置顶（v0.2.4 新增）。``True`` 时 UI 列表优先排列。"""

    schema_version: Literal[1, 2, 3, 4, 5, 6, 7, 8] = 8
    """schema 版本号。当前 ``8``（usage-token spec 引入）；``Literal[1..8]`` 接受老文件，
    写盘永远写 ``8``。每个 version 的升级规则见 ``read_thread_metadata`` docstring。"""
```

**字段分组**（按职责分类，方便阅读）：

| 分组 | 字段 | 用途 |
|---|---|---|
| 身份 | `id` / `name` / `preset_id` | 唯一标识 + 展示名 + 预设 |
| 通道路由 | `backend_kind` / `claude_thread_id` / `codex_thread_id` / `cwd` | transport 维度路由 |
| 时间 | `created_at` / `updated_at` | 创建 / 活跃时间戳 |
| 计数 | `message_count` | 历史消息数 |
| **Token 用量** | `cumulative_usage` | **透明 dict，仅 manager 能解释（架构边界关键）** |
| 偏好 | `is_pinned` | 置顶标记 |
| schema | `schema_version` | 升级链版本号 |

**注意**：ThreadMetadata 本身不导入 TokenUsage / UsageTokenManager。落盘是透明 dict，**仅 manager 能 import 并通过 `_persistence.from_persisted_dict` 解释**。这是架构边界的关键设计：

- `web.thread_metadata` 持有 dict 字段 → 不违反 import-linter
- 外部模块通过 `manager.get_thread_summary(thread_id)` 拿派生数据 → 不接触 cumulative_usage dict
- 只有 `manager.py` 调 `_persistence.from_persisted_dict(meta.cumulative_usage)` 解释 → 符合边界

## v7 → v8 lazy upgrade 映射规则

### 输入（v7）

```json
{
  "schema_version": 7,
  "backend_kind": "claude_code",
  "cumulative_prompt_tokens": 120000,
  "cumulative_completion_tokens": 3000,
  "cumulative_total_tokens": 123000,
  "cumulative_cache_read_tokens": 88000,
  "cumulative_cache_creation_tokens": 4000
  /* ... 其他 thread 字段 */
}
```

### 输出（v8）— claude_code thread

```jsonc
{
  "schema_version": 8,                       // schema 版本号（v8，本 spec 引入）
  "backend_kind": "claude_code",             // 后端通道：Claude Agent SDK
  "cumulative_usage": {                      // token 累计（透明 dict，仅 manager 能解释）
    "channel": "anthropic",                  // token 语义维度：Anthropic 系（与 backend_kind 解耦）
    "input_tokens": 120000,                  // 不含 cache 的纯新输入累计
    "cache_read_input_tokens": 88000,        // 命中 prompt cache 的输入累计（独立计数，不在 input 里）
    "cache_creation_input_tokens": 4000,     // 写 prompt cache 的输入累计（独立计数，不在 input 里）
    "output_tokens": 3000                    // 模型输出累计
  }
  /* 旧 5 字段（cumulative_prompt/completion/total/cache_read/cache_creation_tokens）彻底删除 */
}
```

### 输出（v8）— codex thread

```jsonc
{
  "schema_version": 8,                       // schema 版本号
  "backend_kind": "codex",                   // 后端通道：Codex CLI
  "cumulative_usage": {                      // token 累计
    "channel": "openai",                     // token 语义维度：OpenAI 系
    "input_tokens": 120000,                  // 总输入累计（含 cached_input 子集，OpenAI 语义）
    "cached_input_tokens": 88000,            // 命中 cache 的输入子集（⚠️ 是 input_tokens 的子集，不要相加）
    "output_tokens": 3000,                   // 总输出累计（含 reasoning_output 子集，OpenAI 语义）
    "reasoning_output_tokens": 0             // 推理思考用量（⚠️ 是 output_tokens 的子集；决策 4N：历史不补，新对话起算）
  }
}
```

注意：
- 旧 `cumulative_cache_creation_tokens` **丢弃**（OpenAI 系无此概念）
- 新 `cumulative_reasoning_output_tokens` 初始 0（**决策 4N**：历史不补）
- 旧 `cumulative_cache_read_tokens` → 新 `cached_input_tokens`（lossy 别名修正）

### 输出（v8）— generic_chat thread

启发式判断底层 provider：

```python
if old_cache_creation > 0:
    channel = "anthropic"  # cache_creation 是 Anthropic 独有
else:
    channel = "openai"     # 默认或没用过 cache
```

## 状态流转

### thread 维度的 `cumulative_usage` 字段

```
None (新 thread) ─ 第一轮 record_run_usage ─→ AnthropicTokenUsage / OpenAITokenUsage
                                                       │
                                                       ↓ 后续每轮累加
                                                AnthropicTokenUsage（累加 4 字段）
                                                       │
                                                       ↓ 落盘
                                              透明 dict 写入 metadata.json
                                                       │
                                                       ↓ 进程重启读盘
                                                  manager._persistence.from_persisted_dict 解释
```

**不变量**：
1. 同一个 thread 的 `cumulative_usage.channel` **永远固定**（不会切换 anthropic/openai；thread 绑定一个 channel）
2. `cumulative_usage` 一旦非 None，所有 channel-specific 字段都存在（非 None 时由 `_channel_xxx.parse_raw_to_usage` 兜底默认 0）
3. lazy upgrade 幂等：v8 dict 再过 upgrade 不变化

### manager 内部 last_run_snapshot 缓存

```
Snapshot {} ─ record_run_usage ─→ 更新最新 turn 的 Snapshot
              │                          │
              ↓                          ↓ get_last_run_snapshot 读
       追加到 cumulative_usage      返给 ws_event_sink / StatusLine
```

**缓存策略**：
- 内存里按 `thread_id → Snapshot` 缓存
- 进程重启失效（接受——StatusLine 刷新时通过 summary 拿）
- evict_cell 时清除该 thread 的缓存

## 公共 API 签名清单

manager 公共方法（详签名见 [02-module-breakdown.md](./02-module-breakdown.md#1-usagetokenmanager)）：

| 方法 | 输入 | 输出 |
|---|---|---|
| `record_run_usage` | thread_id + channel + raw_payload + turn + run_id | `UsageTokenSnapshot` |
| `get_thread_summary` | thread_id | `ThreadUsageSummary` |
| `get_last_run_snapshot` | thread_id | `UsageTokenSnapshot | None` |
| `to_ws_frame` | thread_id + turn + run_id | `UsageFrame` |
| `context_window` | model_name | `int | None` |
| `context_usage_pct` | thread_id | `float | None` |

## `.importlinter` Contract 完整配置

写入 `.importlinter` 文件末尾。

```toml
[importlinter:contract:usage-token-encapsulation]
name = "Only UsageTokenManager and public DTOs exposed; TokenUsage internal models are private"
type = forbidden
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
    web.thread_manager
    web.thread_metadata
    web.integrations.claude_code
    web.integrations.codex
    web.protocol
forbidden_modules =
    web.usage_token._models
    web.usage_token._channel_anthropic
    web.usage_token._channel_openai
    web.usage_token._persistence
    web.usage_token._migration
```

**Smoke test**（task#1 必带）：

```python
# tests/unit/web/usage_token/test_import_boundary.py
import pytest

def test_outside_modules_cannot_import_private_token_usage():
    """import-linter 之外加一道运行时 smoke test。"""
    # 尝试 import 内部模型，应该不抛（pyimport 本身可以）
    # 但 import-linter 在 CI 应该拒绝下面这种 import 从 web.thread_manager
    # 的存在。这里我们检查的是：__init__.py 不 re-export 内部。
    from web import usage_token
    assert not hasattr(usage_token, "_AnthropicTokenUsage")
    assert not hasattr(usage_token, "TokenUsage")
    assert hasattr(usage_token, "UsageTokenManager")
    assert hasattr(usage_token, "UsageTokenSnapshot")
    assert hasattr(usage_token, "ThreadUsageSummary")
    assert hasattr(usage_token, "UsageFrame")
```
