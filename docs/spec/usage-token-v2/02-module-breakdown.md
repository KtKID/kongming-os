# 模块拆分

## 模块总览

| 模块 | 职责 | 公/私 | 依赖 |
|---|---|---|---|
| `UsageTokenManager` (`manager.py`) | 唯一公共入口；按 backend_kind 派发派生器；返回 channel-specific DTO | 公共类 | 派生器 + DTO + 注入的 locator |
| `_models.py` | 公共 DTO 定义（4 个 channel-specific Pydantic 模型） | 私有模块 | 无（纯数据） |
| `_derive_claude.py` | 扫 Claude SDK jsonl → `ClaudeUsage` | 私有 | `_models` |
| `_derive_codex.py` | 扫 Codex rollout → `CodexUsage` | 私有 | `_models` |
| `_derive_generic.py` | 扫我们自家 session backend → `GenericChat*Usage` | 私有 | `_models` |
| `_locators.py` | thread_id → SDK 真源文件路径的解析器（注入到 manager） | 私有协议 | 无 |

## 1. UsageTokenManager (`manager.py`)

**职责**：唯一公共入口，无状态门面。

**包含范围**：
- 1 个公共方法 `get_thread_usage`
- 1 个 `__init__`，注入 3 个 locator（不持有任何数据）
- 内部分发函数 `_dispatch_to_derive(backend_kind, meta)`

**不包含**：
- 任何缓存（不维护 `_last_snapshot` / `_thread_models` 等）
- 任何写盘
- channel 字段映射细节（在 `_derive_*`）
- WS 帧的构造（下沉到 `web/protocol/ws_frames.py`）
- model_context_window 查表（**已被 DTO 自带字段消化**）

**接口**：

```python
from pathlib import Path
from typing import Protocol, runtime_checkable

from web.usage.usage_token_v2._models import (
    ClaudeUsage,
    CodexUsage,
    GenericChatAnthropicUsage,
    GenericChatOpenAIUsage,
)

ThreadUsage = ClaudeUsage | CodexUsage | GenericChatAnthropicUsage | GenericChatOpenAIUsage


@runtime_checkable
class ClaudeJsonlLocator(Protocol):
    """thread_id → Claude SDK jsonl 路径。"""
    async def locate(self, thread_id: str) -> Path | None: ...


@runtime_checkable
class CodexRolloutLocator(Protocol):
    """thread_id → Codex rollout 路径（需扫描 sessions/年/月/日）。"""
    async def locate(self, thread_id: str) -> Path | None: ...


@runtime_checkable
class GenericChatSessionLocator(Protocol):
    """thread_id → 我们自家 session backend 数据（dict 或 jsonl 路径）。"""
    async def locate(self, thread_id: str) -> Path | None: ...


@runtime_checkable
class ThreadMetadataReader(Protocol):
    """读 thread 的轻量元数据（不含 token 字段，schema v9 之后）。
    
    返回的 dict 至少包含：
      - backend_kind: "claude_code" | "codex" | "generic_chat"
      - cwd: str（claude_code 通道需要）
      - claude_thread_id: str（claude_code 通道需要）
      - codex_thread_id: str（codex 通道需要）
      - preset_id: str（generic_chat 通道判定底层 provider）
    """
    async def read(self, thread_id: str) -> dict | None: ...


class UsageTokenManager:
    """token 用量唯一公共查询入口。完全无状态。"""

    def __init__(
        self,
        *,
        meta_reader: ThreadMetadataReader,
        claude_locator: ClaudeJsonlLocator,
        codex_locator: CodexRolloutLocator,
        generic_locator: GenericChatSessionLocator,
    ) -> None:
        """注入 4 个查询者；manager 自己不持有任何数据。"""
        self._meta = meta_reader
        self._claude = claude_locator
        self._codex = codex_locator
        self._generic = generic_locator

    async def get_thread_usage(self, thread_id: str) -> ThreadUsage | None:
        """唯一公共方法。

        步骤：
        1. 读 thread metadata 拿 backend_kind（只读 IO）
        2. 按 backend_kind 派发：
           - claude_code → claude_locator + _derive_claude
           - codex → codex_locator + _derive_codex
           - generic_chat → generic_locator + _derive_generic（按底层 provider 再细分）
        3. 派生器返回 DTO 或 None（文件不存在 / 无 usage / 解析失败）

        Returns:
            channel-specific DTO，或 None（thread 未绑定 / 真源不存在 / 派生失败）
        """
        meta = await self._meta.read(thread_id)
        if meta is None:
            return None
        backend = meta.get("backend_kind")
        match backend:
            case "claude_code":
                path = await self._claude.locate(thread_id)
                if path is None:
                    return None
                return await asyncio.to_thread(_derive_claude.derive_from_jsonl, path)
            case "codex":
                path = await self._codex.locate(thread_id)
                if path is None:
                    return None
                return await asyncio.to_thread(_derive_codex.derive_from_rollout, path)
            case "generic_chat":
                path = await self._generic.locate(thread_id)
                if path is None:
                    return None
                preset_id = meta.get("preset_id", "")
                return await asyncio.to_thread(
                    _derive_generic.derive_from_session, path, preset_id
                )
            case _:
                return None
```

**复用/新建**：**全新**模块（`src/web/usage/usage_token_v2/manager.py`）

## 2. `_models.py`（通道 DTO 真源）

**职责**：4 个 channel-specific Pydantic DTO。每个 DTO 自带 `provider` 字段作 discriminator。

详见 [04-data-and-state.md](./04-data-and-state.md)。

**接口表面**：

```python
# 公共（外部允许 import）
class ClaudeUsage(BaseModel): ...
class CodexUsage(BaseModel): ...
class GenericChatAnthropicUsage(BaseModel): ...
class GenericChatOpenAIUsage(BaseModel): ...

# 嵌套子结构（公共）
class ClaudeCacheCreation(BaseModel): ...
class CodexTokenBreakdown(BaseModel): ...
class CodexRateLimits(BaseModel): ...
class CodexRateLimitWindow(BaseModel): ...
```

**架构约束**：所有 DTO 配 `frozen=True` + `extra="forbid"`。外部禁止构造 token 数据，**只能从 manager 接收**。

## 3. `_derive_claude.py`（私有派生器）

**职责**：扫 `~/.claude/projects/<encoded-cwd>/<claude_thread_id>.jsonl`，取最后一条 `type=assistant` 的 `message.usage` 映射为 `ClaudeUsage`。

**关键设计**：

- **取最后一条**，**不累加**（Anthropic 的 `input_tokens` 是"纯新增"语义，最后一条的 input + cache_read + cache_creation = 当前 context 占用）
- 流式按行读，避免大文件 OOM
- 单行 JSON 损坏 → warning 后 skip
- `type != "assistant"` 跳过
- `message.usage` 缺失或非 dict → skip 该行
- 文件不存在 / 不可读 → 返回 None
- 没有任何带 usage 的 assistant entry → 返回 None

**接口**：

```python
from pathlib import Path
from web.usage.usage_token_v2._models import ClaudeUsage

def derive_from_jsonl(jsonl_path: Path) -> ClaudeUsage | None:
    """扫 jsonl 取最后一条 assistant.message.usage 映射为 ClaudeUsage。"""
```

**实现要点**：

```python
def derive_from_jsonl(jsonl_path: Path) -> ClaudeUsage | None:
    if not jsonl_path.is_file():
        return None
    last_usage: dict | None = None
    last_model: str = ""
    try:
        with jsonl_path.open("r", encoding="utf-8") as fh:
            for raw_line in fh:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(entry, dict) or entry.get("type") != "assistant":
                    continue
                msg = entry.get("message")
                if not isinstance(msg, dict):
                    continue
                usage = msg.get("usage")
                if isinstance(usage, dict) and usage:
                    last_usage = usage  # 持续更新到最后一条
                    model = msg.get("model")
                    if isinstance(model, str) and model:
                        last_model = model
    except OSError:
        return None

    if last_usage is None:
        return None

    return _map_to_claude_usage(last_usage, last_model)


def _map_to_claude_usage(raw: dict, model: str) -> ClaudeUsage:
    """SDK 原生 usage dict → ClaudeUsage DTO，1:1 映射。"""
    cc = raw.get("cache_creation") or {}
    return ClaudeUsage(
        provider="claude",
        input_tokens=_safe_int(raw.get("input_tokens")),
        output_tokens=_safe_int(raw.get("output_tokens")),
        cache_read_input_tokens=_safe_int(raw.get("cache_read_input_tokens")),
        cache_creation_input_tokens=_safe_int(raw.get("cache_creation_input_tokens")),
        cache_creation=ClaudeCacheCreation(
            ephemeral_1h_input_tokens=_safe_int(cc.get("ephemeral_1h_input_tokens")),
            ephemeral_5m_input_tokens=_safe_int(cc.get("ephemeral_5m_input_tokens")),
        ),
        context_usage=(
            _safe_int(raw.get("input_tokens"))
            + _safe_int(raw.get("cache_read_input_tokens"))
            + _safe_int(raw.get("cache_creation_input_tokens"))
        ),
        model=model,
        context_window=_lookup_context_window(model),
    )
```

**`_lookup_context_window`**：内置 model_name → context_window 表（沿用 v1 `_model_context_table.py`，迁过来重命名）。

**复用/新建**：**新建**（从 v0.1 `src/web/usage_token/_derive_claude_code.py` 迁过来，去 cumulative 累加逻辑，加 cache_creation 细分 + model_context_window 派生）

## 4. `_derive_codex.py`（私有派生器）

**职责**：扫 Codex rollout 文件，取**最后一条** `event_msg` 中 `payload.type == "token_count"` 的事件（且 `info` 非 None）映射为 `CodexUsage`。

**关键设计**：

- 取最后一条**非空** `token_count` 事件（codex 一轮可能 emit 多条 token_count，但 info=None 是 placeholder）
- codex **已自带累加** —— `info.total_token_usage` 是 thread 级累计，**不再自己加**
- `info.last_token_usage` = 最近一次 API call
- `info.model_context_window` = 模型上限（直接使用，不用查表）
- `rate_limits` 透传（v2 后端只透传，前端 v3 渲染）

**接口**：

```python
from pathlib import Path
from web.usage.usage_token_v2._models import CodexUsage

def derive_from_rollout(rollout_path: Path) -> CodexUsage | None:
    """扫 rollout 取最后一条非空 token_count → CodexUsage。"""
```

**实现要点**：

```python
def derive_from_rollout(rollout_path: Path) -> CodexUsage | None:
    if not rollout_path.is_file():
        return None
    last_token_event: dict | None = None
    try:
        with rollout_path.open("r", encoding="utf-8") as fh:
            for raw_line in fh:
                try:
                    entry = json.loads(raw_line.strip())
                except json.JSONDecodeError:
                    continue
                if entry.get("type") != "event_msg":
                    continue
                payload = entry.get("payload") or {}
                if payload.get("type") != "token_count":
                    continue
                if payload.get("info") is None:
                    continue  # info=None 是 placeholder，跳过
                last_token_event = payload
    except OSError:
        return None

    if last_token_event is None:
        return None

    return _map_to_codex_usage(last_token_event)


def _map_to_codex_usage(payload: dict) -> CodexUsage:
    """codex token_count event → CodexUsage 1:1。"""
    info = payload["info"]
    return CodexUsage(
        provider="openai",
        total=_breakdown(info["total_token_usage"]),
        last=_breakdown(info["last_token_usage"]),
        model_context_window=int(info["model_context_window"]),
        rate_limits=_rate_limits(payload.get("rate_limits")),
    )
```

**复用/新建**：**新建**（参考 `web/codex/projects_scanner.py` 的 jsonl 解析风格）

## 5. `_derive_generic.py`（私有派生器）

**职责**：从我们自家 session backend 派生 token 数据。按底层 LLMProvider 类型分支（anthropic / openai），分别返回 `GenericChatAnthropicUsage` / `GenericChatOpenAIUsage`。

**关键设计**：

- generic_chat 通道走 `web.ws_event_sink` 推 LLMProvider stream parser 的 usage 到我们自家 session backend
- session backend 有 3 种后端（memory / sqlite / file），manager 通过 locator 拿到当前 thread 的 session 数据路径
- 派生器解析 session message 流，找最后一条 LLMResponse.usage
- 按 `preset_id` 确定 LLM 厂商（anthropic vs openai），映射到对应 DTO

**接口**：

```python
from pathlib import Path
from web.usage.usage_token_v2._models import GenericChatAnthropicUsage, GenericChatOpenAIUsage

def derive_from_session(
    session_path: Path,
    preset_id: str,
) -> GenericChatAnthropicUsage | GenericChatOpenAIUsage | None:
    """按 preset_id 决定底层 provider，扫 session 数据派生。"""
```

**复用/新建**：**新建**

**待 spec 细化**（task 实施前再定）：
- session backend 数据具体落盘格式（memory/sqlite/file 各不同）
- preset_id → provider 类型映射规则
- 是否做轻量缓存（generic_chat 一轮可能很多 message，每次扫太重？）

## 6. `_locators.py`（私有 Protocol + 工具）

**职责**：定义 manager 注入的 4 个查询者 Protocol（在 manager.py 顶部已展示）。装配层（`web/thread_manager.py`）实现具体 locator 注入到 manager。

具体实现：

| Protocol | 实现位置 | 解析逻辑 |
|---|---|---|
| `ThreadMetadataReader` | `web/thread_manager.py` 内部 helper | 包装 `read_thread_metadata`，只返回 manager 关心的字段 |
| `ClaudeJsonlLocator` | `web/thread_manager.py` 内部 helper | `cwd + claude_thread_id` → `jsonl_path_for` |
| `CodexRolloutLocator` | `web/thread_manager.py` 内部 helper | 复用 `web/codex/projects_scanner.py::find_rollout_by_uuid`（需要抽出来作纯函数） |
| `GenericChatSessionLocator` | `web/thread_manager.py` 内部 helper | 查 session backend 配置（memory/sqlite/file）→ 返回对应数据路径 |

**关键架构红线**：locator 实现可以 import `web.integrations.claude_code.jsonl_history` / `web.integrations.codex.projects_scanner` 等模块拿工具函数，**但** locator 本身放在 `web.thread_manager`（即装配层），不放在 `usage_token_v2/` 包内 —— 保持 manager 包对外部模块零耦合。

## 7. 跨模块改造点

以下文件需要随 v2 改造：

| 文件 | 改动 |
|---|---|
| `src/web/thread_manager.py` | 删 v1 `_ClaudeCodeJsonlPathProvider` + `UsageTokenManager` v1 注入；新增 v2 4 个 locator 实现 + 注入 v2 manager |
| `src/web/ws_event_sink.py` | 删 `UsagePersistSink`；`_build_frame(kind="usage")` 改调 v2 manager |
| `src/web/integrations/claude_code/service.py` | 已经在 v0.1 删了 `record_run_usage` 调用，v2 进一步删 `set_last_assistant_usage` 调用（manager 不再有这个方法） |
| `src/web/integrations/codex/service.py` | 删 `record_run_usage` 调用，只保留 emit 通知 |
| `src/web/routers/threads.py` | `_to_dto` 不再返回 `usage_summary`；前端单独请求 `/threads/<tid>/usage` 拿 |
| `src/web/routers/`（新文件 `usage.py`） | 新增 `GET /threads/<tid>/usage` 端点：调 `manager.get_thread_usage(tid)` 返回 DTO |
| `src/web/protocol/ws_frames.py` | 删 v1 `UsageFrame`；新增 v2 `UsageFrame`（嵌套 channel-specific DTO） |
| `src/web/thread_metadata.py` | schema v8 → v9：删 3 个 token 字段；加 lazy upgrade v8→v9 |
| `web/src/protocol.ts` | 新增 `ClaudeUsage` / `CodexUsage` / `GenericChatUsage` 接口；删 `ThreadUsageSummary` |
| `web/src/stores/chat.ts` | 删 `UsageView`；改用三个 channel-specific store shape |
| `web/src/components/StatusLine.tsx` | 拆为 `StatusLineClaude` / `StatusLineCodex` / `StatusLineGenericChat` |
| `web/src/components/ClaudeCodeView.tsx` | 删 `tokenBudget` per-message 渲染 |
| `web/src/lib/model-context.ts` | 保留（claude 通道 DTO 仍需要前端 fallback 查表，Codex 后端自带就不需要） |
| `.importlinter` | Contract 9 升级，加 v2 派生器进 forbidden_modules |

## 8. 包结构

```
src/web/usage/usage_token_v2/
├── __init__.py           # 只 export: UsageTokenManager + 4 个 DTO + 4 个 Protocol
├── manager.py            # 唯一公共类
├── _models.py            # 4 个 DTO + 嵌套子结构
├── _derive_claude.py     # 私有派生器
├── _derive_codex.py      # 私有派生器
├── _derive_generic.py    # 私有派生器
└── _model_context_table.py  # 内置 Claude 模型上限表（从 v1 迁来）
```

外部允许 import 的符号：

```python
# 5 个公共类
from web.usage.usage_token_v2 import (
    UsageTokenManager,
    ClaudeUsage,
    CodexUsage,
    GenericChatAnthropicUsage,
    GenericChatOpenAIUsage,
)
# 4 个 Protocol（装配层用）
from web.usage.usage_token_v2 import (
    ClaudeJsonlLocator,
    CodexRolloutLocator,
    GenericChatSessionLocator,
    ThreadMetadataReader,
)
```

外部**禁止**：

- 直接 import `_derive_claude` / `_derive_codex` / `_derive_generic` / `_models` / `_model_context_table`
- 在 `manager.py` 之外的任何文件**构造**任何 DTO 实例
- 调用任何派生器函数

## 公共 API 总结（仅 1 个方法 + 1 个 __init__）

```python
class UsageTokenManager:
    def __init__(
        self,
        *,
        meta_reader: ThreadMetadataReader,
        claude_locator: ClaudeJsonlLocator,
        codex_locator: CodexRolloutLocator,
        generic_locator: GenericChatSessionLocator,
    ) -> None: ...

    async def get_thread_usage(
        self, thread_id: str
    ) -> ClaudeUsage | CodexUsage | GenericChatAnthropicUsage | GenericChatOpenAIUsage | None: ...
```

就这两行。
