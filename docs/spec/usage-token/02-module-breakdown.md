# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| `manager.py` | 单一入口；编排 channel 分发 / 持久化 / 派生 / WS 帧 | `_models` + `_channel_*` + `_persistence` + `_migration` | 方案确认 | 公共 API ≤ 7 个 |
| `_models.py` | TokenUsage discriminated union（私有）+ Snapshot / Summary 公共 DTO | 无 | 方案确认 | 仅 manager 能 import 内部 union |
| `_channel_anthropic.py` | Anthropic 字段映射 + 累加 + 派生（context_usage） | `_models` | 方案确认 | 处理 input / cache_read_input / cache_creation_input / output |
| `_channel_openai.py` | OpenAI 字段映射 + 累加 + 派生 | `_models` | 方案确认 | 处理 input（含 cached） / cached_input / output（含 reasoning） / reasoning_output |
| `_persistence.py` | TokenUsage ↔ ThreadMetadata.cumulative_usage（dict）互转 | `_models` + `web.thread_metadata` | 方案确认 | 落盘用透明 dict，类型守在 manager 内 |
| `_migration.py` | v7→v8 lazy upgrade（旧 5 字段 → 嵌套 cumulative_usage） | `_persistence` | 方案确认 | 沿用 `thread_metadata.read_thread_metadata` 现存懒升级风格 |
| **跨模块改造** | 7 处接入 manager；删 3 处冗余 | 上述全部 | 方案确认 | 详见 §7 |

## 模块详情

### 1. UsageTokenManager（`manager.py`）

**职责**：所有 token usage 读写的唯一对外入口。编排 channel 分发、持久化、派生公式、WS 帧构造、模型上限映射。

**包含范围**：
- 6 个公共方法（详见 API 表）
- backend_kind → channel 映射（claude_code→anthropic / codex→openai / generic_chat→看底层 LLMProvider）
- 模型上下文窗口表（占位，决策 3A）
- thread-level usage 缓存（避免每次都读盘；用 `threading.Lock` 或 `asyncio.Lock` 保护并发）

**不包含**：
- channel 字段映射细节（在 `_channel_*`）
- 落盘格式细节（在 `_persistence`）
- v7→v8 迁移逻辑细节（在 `_migration`）

**依赖**：内部 `_models / _channel_anthropic / _channel_openai / _persistence / _migration`；外部 `web.thread_metadata`（读写盘）+ `web.protocol` 的公共 DTO

**复用/新建**：**全新**模块

**数据结构 / 公共 API**：

```python
from pathlib import Path
from typing import Literal, Mapping, Any

class UsageTokenManager:
    """所有 token usage 访问的唯一入口。

    外部模块**不允许**直接持有 TokenUsage 实例或其子类。所有读写必须经过本 manager。
    架构约束由 .importlinter `usage-token-encapsulation` Contract 强制。
    """

    def __init__(
        self,
        home: Path,
        *,
        thread_metadata_io: "ThreadMetadataIO",
        model_context_windows: Mapping[str, int] | None = None,
    ) -> None: ...

    # === 写入路径 ===
    async def record_run_usage(
        self,
        thread_id: str,
        *,
        channel: Literal["anthropic", "openai"],
        raw_payload: Mapping[str, Any],
        turn: int,
        run_id: str,
    ) -> "UsageTokenSnapshot":
        """每轮结束调一次。

        内部：
          1. 按 channel 把 raw_payload 解析为 TokenUsage（_channel_xxx.parse）
          2. 累加到 ThreadMetadata.cumulative_usage（_persistence.merge）
          3. 落盘 ThreadMetadata
          4. 缓存最近一轮 Snapshot
          5. 返回 Snapshot 给调用方（ws_event_sink 用）
        """

    # === 查询路径（不返回 TokenUsage 实例）===
    async def get_thread_summary(self, thread_id: str) -> "ThreadUsageSummary":
        """thread 级累计 summary。供 routers/threads.py 用。"""

    async def get_last_run_snapshot(self, thread_id: str) -> "UsageTokenSnapshot | None":
        """最近一轮 Snapshot；供 StatusLine 实时显示。"""

    # === 序列化路径 ===
    async def to_ws_frame(
        self,
        thread_id: str,
        *,
        turn: int,
        run_id: str,
    ) -> "UsageFrame":
        """构造 WS UsageFrame。供 ws_event_sink emit 用。"""

    # === 模型上下文窗口 ===
    def context_window(self, model_name: str) -> int | None:
        """exact 优先，prefix 次之；未命中返回 None。"""

    def context_usage_pct(self, thread_id: str) -> float | None:
        """summary.context_usage_current / context_window。未命中返回 None。"""
```

**风险等级**：**高**（系统级架构变更，11 处定义点收敛）

**风险说明**：
- manager 单元测试覆盖必须达 100%（公共 API），漏一条等于线上 token 显示错误
- 并发：多个 EventSink 可能同时写同一 thread → 用 per-thread Lock 保护
- 缓存失效：进程重启后 last_run_snapshot 丢失（接受——StatusLine 刷新时从 summary 拿）

**task 建议**：
- task 名：`usage-token-manager-core-v0.1`
- 对应 DoD：D1, D2, D3, D4（部分）, D5（部分）
- 是否进入 x-req：**是**
- 原因：架构基础，所有其他 task 依赖

---

### 2. `_models.py`（私有数据结构）

**职责**：TokenUsage discriminated union（manager 私有）+ Snapshot / Summary 公共 DTO（manager 之外可见但只读）

**数据结构**：见 [04-data-and-state.md](./04-data-and-state.md)。简要：

```python
# 私有
class _AnthropicTokenUsage(BaseModel): channel="anthropic"; input / cache_read_input / cache_creation_input / output
class _OpenAITokenUsage(BaseModel):    channel="openai";    input / cached_input / output / reasoning_output

# discriminated union（仅 manager 内部用）
TokenUsage = Annotated[_AnthropicTokenUsage | _OpenAITokenUsage, Field(discriminator="channel")]

# 公共（manager 之外可见）
class UsageTokenSnapshot(BaseModel): ...   # 一轮快照
class ThreadUsageSummary(BaseModel): ...   # thread 级累计 summary
class UsageFrame(BaseModel): ...           # WS 帧（替代现有 ws_frames.py 里的 UsageFrame）
```

**风险等级**：低
**task**：随 task#1 一起做

---

### 3. `_channel_anthropic.py`

**职责**：Anthropic 系（claude_code 通道 + generic_chat-anthropic 通道）的字段映射、累加规则、派生公式

**核心函数**：

```python
def parse_raw_to_usage(raw: Mapping[str, Any]) -> _AnthropicTokenUsage:
    """从 Anthropic SDK 原生 usage dict 构造。

    输入字段：input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens
    缺字段时默认 0；不抛。
    """

def merge_cumulative(
    prev: _AnthropicTokenUsage,
    delta: _AnthropicTokenUsage,
) -> _AnthropicTokenUsage:
    """累加一轮到累计；4 个字段独立相加。"""

def context_usage(usage: _AnthropicTokenUsage) -> int:
    """派生：当前 context 占用 = input + cache_read + cache_creation。"""
```

**风险等级**：低
**task**：随 task#1 一起做

---

### 4. `_channel_openai.py`

**职责**：OpenAI 系（codex 通道 + generic_chat-openai 通道）字段映射、累加、派生

**核心函数**：

```python
def parse_raw_to_usage(raw: Mapping[str, Any]) -> _OpenAITokenUsage:
    """字段：input_tokens / cached_input_tokens / output_tokens / reasoning_output_tokens。

    Codex CLI jsonl 直接给这 4 个；OpenAI Responses API 需要从 prompt_tokens_details /
    completion_tokens_details 拿（手工补救——但 OpenAI 协议改造不在本 spec 范围）。
    """

def merge_cumulative(prev, delta) -> _OpenAITokenUsage:
    """累加；注意 input_tokens 含 cached_input 子集，所以独立累加 input 也独立累加 cached。"""

def context_usage(usage: _OpenAITokenUsage) -> int:
    """派生：context 占用 = input_tokens（已含 cache）。"""
```

**风险等级**：低
**task**：随 task#1 一起做

---

### 5. `_persistence.py`

**职责**：TokenUsage ↔ ThreadMetadata.cumulative_usage（透明 dict）互转

**核心函数**：

```python
def to_persisted_dict(usage: TokenUsage) -> dict[str, Any]:
    """TokenUsage → 落盘 dict。

    格式（Claude thread）：
      {"channel": "anthropic", "input_tokens": ..., "cache_read_input_tokens": ..., ...}
    格式（Codex thread）：
      {"channel": "openai", "input_tokens": ..., "cached_input_tokens": ..., ...}
    """

def from_persisted_dict(raw: Mapping[str, Any]) -> TokenUsage:
    """落盘 dict → TokenUsage。验证 channel 字段；缺字段拒绝。"""
```

**ThreadMetadata 模型改造**（不在本模块，但本模块对接）：

```python
# 改前 (v7)
cumulative_prompt_tokens: int = 0
cumulative_completion_tokens: int = 0
cumulative_total_tokens: int = 0
cumulative_cache_read_tokens: int = 0
cumulative_cache_creation_tokens: int = 0

# 改后 (v8)
cumulative_usage: dict[str, Any] | None = None
# ↑ 透明 dict 持久化；ThreadMetadata 不再直接持 TokenUsage 类型
# manager 通过 from_persisted_dict 解释这个 dict
# None 表示该 thread 还没跑过任何 turn
```

**风险等级**：中
**风险说明**：dict 落盘失去 schema 校验；防御措施——manager 在 from_persisted_dict 时做 channel 字段校验 + 字段类型校验，损坏视为 None（不抛）

**task**：随 task#1 一起做

---

### 6. `_migration.py`

**职责**：v7→v8 lazy upgrade。沿用 `thread_metadata.read_thread_metadata` 现存懒升级风格

**核心函数**：

```python
def upgrade_v7_to_v8(data: dict[str, Any]) -> dict[str, Any]:
    """v7 → v8 字段重组。

    输入：v7 形态 dict（含 cumulative_prompt_tokens 等 5 字段 + backend_kind）
    输出：v8 形态 dict（含 cumulative_usage 嵌套 dict，旧字段彻底删除）

    映射规则（按 backend_kind）：
      claude_code → channel="anthropic"，
        cumulative_prompt_tokens          → input_tokens
        cumulative_cache_read_tokens      → cache_read_input_tokens
        cumulative_cache_creation_tokens  → cache_creation_input_tokens
        cumulative_completion_tokens      → output_tokens
        cumulative_total_tokens           → 丢弃（派生量）

      codex → channel="openai"，
        cumulative_prompt_tokens          → input_tokens
        cumulative_cache_read_tokens      → cached_input_tokens（lossy 别名修正）
        cumulative_cache_creation_tokens  → 丢弃（codex 无此概念）
        cumulative_completion_tokens      → output_tokens
        cumulative_reasoning_output_tokens → 0（决策 4N，历史不补）

      generic_chat → 启发式判断：
        cache_creation > 0 → anthropic（独有概念）
        否则 → openai
    """
```

**集成点**：在 `web/thread_metadata.py::read_thread_metadata` 现存懒升级链末尾追加 `if data.get("schema_version") == 7: data = upgrade_v7_to_v8(data); data["schema_version"] = 8`

**风险等级**：中
**风险说明**：启发式映射 generic_chat 通道时可能误判；防御措施——单测覆盖 3 channel 各类型 fixture；幂等保证（v8 不再升级）

**task**：task#2 单独做（含 3 channel fixture 单测 + ThreadMetadata schema v8 改造）

---

### 7. 跨模块改造点（接入 manager）

7 处接入 manager + 3 处删除冗余 + 2 处自动生成 + 1 处工厂化。详见 [03-core-workflows.md](./03-core-workflows.md)。

| 改造点 | 当前状态 | 改后 | task |
|---|---|---|---|
| `runner.py:443` emit usage Event payload | dict 含 prompt/completion/total | dict 含原生字段 + `channel` 标识；由 UsagePersistSink 转给 manager | task#3 |
| `anthropic_messages.py:412` `prompt_tokens=input_tokens` | lossy（漏算 cache） | LLMResponse.usage 直接放 SDK 原生字段 + `provider_kind="anthropic"` | task#3 |
| `openai_responses.py` 同样改 | provider_metadata 里塞 cached_tokens/reasoning_tokens | usage 里直接放原生字段 + `provider_kind="openai_compatible"` | task#3 |
| `ws_event_sink._build_frame(kind="usage")` | 直接 new UsageFrame | 调 `manager.to_ws_frame(...)` | task#3 |
| `UsagePersistSink.emit` | 调 `add_thread_usage(prompt, completion, ...)` | 调 `manager.record_run_usage(channel, raw_payload, ...)` | task#3 |
| `routers/threads.py::_to_dto` | 读 ThreadMetadata 5 字段；claude_code 走 parse_transcript_usage 临时算 | 调 `manager.get_thread_summary(thread_id)` 拿 summary；删 parse_transcript_usage 临时算逻辑 | task#3 |
| `claude_code` WS handler | 不写 ThreadMetadata.cumulative | 每轮结束调 `manager.record_run_usage(channel="anthropic", ...)` | task#3 |
| `codex` WS handler | 不写 ThreadMetadata.cumulative | 每轮结束调 `manager.record_run_usage(channel="openai", ...)` | task#3 |
| `ThreadMetadataDTO`（rest_models.py） | 跟 ThreadMetadata 一一映射 | **删除**；router 返回 `ThreadMetadata.model_dump() | manager.get_thread_summary(thread_id)` | task#3 |
| 前端 `protocol.ts` 手工镜像 | 11 处定义点之 #6 #7 | codegen 自动生成（datamodel-code-generator） | task#4 |
| 前端 `UsageSnapshot` store shape | 独立 TS interface | 删除；store 直接持 ThreadUsageSummary / UsageFrame | task#4 |
| 前端 `StatusLine.tsx` | 显示 cumulative 累加 | 按 summary.channel 分支显示 + 进度条 + 中文 label | task#4 |
| 前端 `model-context.ts` | 不存在 | 新增（占位 8 模型） | task#4 |
| 前端 `tokenBudget` per-message 路径 | ClaudeCodeView / CodexView `Object.entries` 渲染 | **删除**；改消费 UsageFrame（决策 B1） | task#4 |
| 测试 fixture 硬编码字段名 | 5 pytest + 3 vitest | factory 函数构造，不硬编码 | task#5 |

## 架构边界（import-linter Contract）

新增到 `.importlinter`（具体配置见 [04-data-and-state.md](./04-data-and-state.md) 末尾）：

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

效果：除 `web.usage_token.manager` 本身外，其他任何模块 import 内部子模块都报错。

**注意**：`web.usage_token.__init__` 只 export `UsageTokenManager` + 公共 DTO（`UsageTokenSnapshot` / `ThreadUsageSummary` / `UsageFrame`），不 re-export 内部子模块。
