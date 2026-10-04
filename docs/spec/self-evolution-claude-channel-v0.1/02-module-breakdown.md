# 组件设计 + 接口 + 模块边界

## 模块拓扑

```
src/evolution/                    ← 独立子系统，频道无关
├── evolution_manager.py            🆕 §①  # EvolutionManager 类（核心门面）
├── transcript_provider.py 🆕 §② # TranscriptProvider Protocol
├── claude_transcript_provider.py 🆕 §③  # claude 频道 provider 实现
├── event_bus.py          🆕 §④  # EvolutionEventBus（按 thread_id 路由）
├── claude_evidence_selector.py  # task-1 产出（被 §③ 内部用）
├── evidence_selector.py         # 既有（generic_chat 用）
├── state_store.py / store.py    # 既有，manager 内部用
├── reviewer_runtime.py / models.py  # 既有，manager 内部 spawn
└── memory_materializer.py / skill_materializer.py / apply_executor.py  # 既有

src/web/app.py                   # §⑤ lifespan 启动时装配 manager 单例
src/web/integrations/claude_code/route.py     # §⑥ ws 入口三处钩子
```

## 模块边界（核心架构原则）

| 层 | 谁能 import 谁 | 反方向禁止 |
|---|---|---|
| **evolution 子系统**（`src/evolution/`）| 不 import 任何 web/* 或 channel-specific 代码 | ✅ |
| **频道层**（`web/claude_code/`、`web/codex/`、`web/ws.py`）| 通过 `evolution.evolution_manager.EvolutionManager` 公开 API 接入 | ✅ |
| **app 装配层**（`src/web/app.py`）| import `EvolutionManager` 装配单例到 `app.state.evolution_manager` | ✅ |

**禁忌**：

- ❌ `evolution/*` 不能 import `web.integrations.claude_code.*`（包括 jsonl_history）—— 由 `ClaudeTranscriptProvider` 桥接
- ❌ `web/claude_code/route.py` 不能 import `evolution.state_store` / `evolution.reviewer_runtime`（manager 内部细节）
- ✅ `web/claude_code/route.py` 只能 import `evolution.evolution_manager` + `evolution.claude_transcript_provider`

**这一条 import-linter 边界是本 spec 的硬约束。dev 阶段必须配置 .importlinter Contract 强制检查。**

---

## §① `src/evolution/evolution_manager.py` — EvolutionManager 核心门面

### 职责

整个 evolution 子系统对外的唯一入口。装配所有内部依赖（mini ToolRegistry / state_store 单例 / event bus / cadence 配置），对各频道暴露最小 API。频道方零感知内部细节。

### 公开接口

```python
class EvolutionManager:
    """Evolution 子系统门面。频道方只通过本类的公开 API 接入。"""

    def __init__(
        self,
        *,
        config: KongmingConfig,
        kongming_home: Path,
    ) -> None:
        """装配 mini ToolRegistry / state_store / event_bus / etc."""

    @property
    def enabled(self) -> bool:
        """总开关——绑定 config.evolution.learning.enabled。
        disabled 时所有公开 API 都是 no-op，频道方无需做开关判断。
        """

    async def notify_user_message(
        self,
        *,
        thread_id: str,
        provider: TranscriptProvider,
        cwd: str,
    ) -> None:
        """频道方在用户消息入口调用——fire-and-forget。
        内部：cadence 判断 → provider.build_window → spawn reviewer → 落盘 + 发事件。
        异常吞 + log warning，绝不冒泡。
        """

    def register_event_route(
        self,
        thread_id: str,
        sink: EventSink,
    ) -> None:
        """频道方在 ws 连接建立时调用，登记 thread_id → sink 路由。"""

    def unregister_event_route(self, thread_id: str) -> None:
        """频道方在 ws 断开时调用。幂等。"""

    async def aclose(self) -> None:
        """释放资源（mini runtime 池 / state_store 缓冲）。app shutdown 时调。"""
```

### 内部结构

```
EvolutionManager
├── _config: KongmingConfig                        # 读 evolution.learning 子树
├── _learning: EvolutionLearningConfig             # 缓存的 learning 配置
├── _state_store: EvolutionStateStore              # 单例，整 app 共享
├── _evolution_store: EvolutionStore               # 单例，复用既有 write_review
├── _mini_registry: ToolRegistry                   # 内部装配，只含 evolution_write
├── _event_bus: EvolutionEventBus                  # 按 thread_id 路由
├── _kongming_home: Path
└── _bg_tasks: set[asyncio.Task]                   # 持后台 reviewer task 引用避免 GC
```

### `notify_user_message` 内部流程

```
1. if not self.enabled: return
2. current = await _state_store.record_parent_run(session_id=thread_id, user_turn_count=N+1)
3. if current.run_count < min_user_turns or % every_n_runs != 0: return
4. run_id = f"run-claude-{thread_id}-{current.run_count}"
   # 注：v0.1 写死 "claude" 前缀；M1.5 codex 接入时改成按 provider.channel_id 拼
5. window = await provider.build_window(run_id, max_messages)
6. if not window.messages: mark_review_result(status="skipped_empty_window") + return
7. stub_runtime = _build_stub_parent_runtime()  # 用 self._mini_registry + self._event_bus
8. try:
     outcome = await run_child_review(parent_runtime=stub_runtime, window=window, ...)
   finally:
     await stub_runtime.aclose()
9. (reviewer 已通过 evolution_write 落盘 + 事件已通过 event_bus 路由)
```

整个流程外层包 `try / except Exception` 吞所有异常 + log warning。

### `_build_stub_parent_runtime`（manager 内部 helper）

manager 内部 helper，跟之前 trigger 单文件方案的核心思路一致（SessionEngine 当 reviewer parent 容器，跑完即 aclose），区别是：

- **tools**：用 `self._mini_registry`（已装好的 evolution_write registry），不外部传入
- **event_sinks**：用 `[self._event_bus]`（event_bus 实现了 EventSink Protocol，转发到注册的频道 sink），不外部传入
- 3 级 model fallback：`learning.model_name` → `config.llm.default_model_name` → raise ValueError（被顶层 except 吞）

### 风险点

1. `_build_stub_parent_runtime` 的 SessionEngine.build 装配链路（中等风险，PoC 优先）
2. `_event_bus` 的 sink 注册/注销并发安全（用 asyncio.Lock）
3. `_state_store` 单例并发写（store 自带 asyncio.Lock，OK）

---

## §② `src/evolution/transcript_provider.py` — TranscriptProvider Protocol

### 职责

抽象"怎么读对话历史"，让 EvolutionManager 跟具体频道解耦。每个频道实现自己的 provider。

### 接口

```python
from typing import Protocol
from evolution.models import TranscriptWindow

class TranscriptProvider(Protocol):
    """读对话历史的抽象。每个频道实现一份。"""

    @property
    def channel_id(self) -> str:
        """频道标识，如 "claude" / "codex" / "native"。
        用于：run_id 拼接、日志、事件 metadata。
        """

    async def build_window(
        self,
        *,
        run_id: str,
        max_messages: int,
    ) -> TranscriptWindow:
        """读对话历史并拍平。失败返回空 messages 的 window，不抛。"""
```

### 实现约束

- 纯函数风格（无副作用）
- 异常吞，返回空 window 而非抛
- `TranscriptWindow.session_id` 由 provider 决定（claude 用 thread_id，codex 用 thread_id，native 也用 session_id）

---

## §③ `src/evolution/claude_transcript_provider.py` — claude 频道实现

### 职责

实现 TranscriptProvider Protocol，内部调 `claude_evidence_selector`（task-1 产出）。**是 evolution 模块向 web/claude_code/jsonl_history 借数据的唯一桥**。

### 实现

```python
@dataclass(frozen=True)
class ClaudeTranscriptProvider(TranscriptProvider):
    thread_id: str
    claude_thread_id: str
    cwd: str
    claude_home: Path | None = None  # 测试注入用

    @property
    def channel_id(self) -> str:
        return "claude"

    async def build_window(self, *, run_id: str, max_messages: int) -> TranscriptWindow:
        return claude_evidence_selector.build_claude_transcript_window(
            thread_id=self.thread_id,
            claude_thread_id=self.claude_thread_id,
            cwd=self.cwd,
            run_id=run_id,
            max_messages=max_messages,
            claude_home=self.claude_home,
        )
```

### Import 边界

`evolution.claude_transcript_provider` → `evolution.claude_evidence_selector` → `web.integrations.claude_code.jsonl_history`

这条链是 evolution → web.integrations.claude_code 的**唯一允许跨包路径**。在 `.importlinter` 加例外注释说明。

---

## §④ `src/evolution/event_bus.py` — EvolutionEventBus

### 职责

按 `thread_id` 路由 evolution 事件到对应频道的 ws sink。实现 EventSink Protocol，可以直接传给 SessionEngine/reviewer_runtime 作为 event_sinks。

### 接口

```python
class EvolutionEventBus(EventSink):
    """按 thread_id 路由事件的 EventSink 实现。"""

    def __init__(self) -> None:
        self._routes: dict[str, EventSink] = {}
        self._lock = asyncio.Lock()

    async def emit(self, event: Event) -> None:
        """收到 reviewer/tool 事件 → 按 event.session_id 或 event.run_id 解析出
        thread_id → 路由到对应 sink。

        - 路由不存在 → 丢弃（log debug，不报错）
        - 路由 sink 抛异常 → 吞 + log warning（不影响其它事件）
        """

    async def register(self, thread_id: str, sink: EventSink) -> None:
        """登记路由。重复登记覆盖旧的（log info）。"""

    async def unregister(self, thread_id: str) -> None:
        """撤销路由。幂等。"""
```

### thread_id 解析逻辑

evolution 事件如何反查 thread_id？

- `evolution.review.*` 事件的 `event.session_id` 直接等于 thread_id（reviewer 跑在 review_session，session_id 是 review-{thread_id}-{run_id}）
- `tool.call.start/end` 事件可能来自 stub_runtime / reviewer_runtime——需要在 reviewer 装配时把 thread_id 写到 metadata，或者用 run_id 前缀 `run-claude-{thread_id}-N` 反查

**v0.1 简化策略**：所有路由路径基于 `run_id` 解析（`run-claude-{thread_id}-N` 正则提取）。reviewer 内部所有事件都带 run_id。

---

## §⑤ `src/web/app.py` 装配改动

### 改动点

在 lifespan startup 阶段（已有 evolution.apply_executor.recover_pending_apply_jobs 调用附近）加：

```python
from evolution.evolution_manager import EvolutionManager

# 在 app.state 注入段（行 391 附近）
evolution_manager = EvolutionManager(
    config=cfg,
    kongming_home=home,
)
app.state.evolution_manager = evolution_manager

# 在 lifespan shutdown 阶段
await evolution_manager.aclose()
```

### Import 边界

`web.app` → `evolution.evolution_manager`：app.py 是装配层，唯一负责实例化 manager 的地方。其他 web 代码只读 `app.state.evolution_manager`。

---

## §⑥ `src/web/integrations/claude_code/route.py` 三处钩子

### 改动 1：ws 连接建立时（行 155 `await websocket.accept()` 之后）

```python
manager = websocket.app.state.evolution_manager
if manager.enabled and bound_thread_id:
    # 构造一个 WsEventSink 绑到当前 ws connection
    sink = WsEventSink(websocket=websocket, thread_id=bound_thread_id)
    await manager.register_event_route(bound_thread_id, sink)
```

### 改动 2：claude-command 处理处（行 210 `asyncio.create_task` 之后）

```python
# 用户消息进来 → fire-and-forget 触发 evolution
if manager.enabled and bound_thread_id:
    cwd = ...  # 从 thread metadata 拿
    claude_thread_id = ...  # 从 thread metadata 拿
    evo_task = asyncio.create_task(
        manager.notify_user_message(
            thread_id=bound_thread_id,
            provider=ClaudeTranscriptProvider(
                thread_id=bound_thread_id,
                claude_thread_id=claude_thread_id,
                cwd=cwd,
            ),
            cwd=cwd,
        )
    )
    bg_tasks.add(evo_task)
    evo_task.add_done_callback(bg_tasks.discard)
```

### 改动 3：ws 断开时（finally 块）

```python
finally:
    if manager.enabled and bound_thread_id:
        await manager.unregister_event_route(bound_thread_id)
```

### 关键性质

- route.py **从不 import** `evolution.state_store / reviewer_runtime / store / models / event_bus / ...`
- 只 import `evolution.evolution_manager.EvolutionManager`（类型注解可选）+ `evolution.claude_transcript_provider.ClaudeTranscriptProvider`
- 通过 manager 三个 API（register/notify/unregister）+ `enabled` 属性接入

### WsEventSink

这是个已有概念（generic_chat 路径 ws.py 用过），claude_code 复用同一个类。如果 `WsEventSink` 当前耦合了 generic_chat 上下文，需要在 task-3 阶段抽出一个 channel-agnostic 版本（或确认它已经 channel-agnostic）。

---

## DoD ↔ 模块追溯矩阵

| DoD | 需要的组件 | 需要的 task |
|-----|----------|------------|
| D1 cadence 触发 | manager.notify_user_message + state_store | task-2 |
| D2 transcript 装配 | ClaudeTranscriptProvider + claude_evidence_selector | task-1 + task-3 |
| D3 工具白名单 | manager._mini_registry（内部装配只含 evolution_write）| task-2 |
| D4 run_id 命名 | manager.notify_user_message 内部拼接 `run-claude-{thread_id}-{count}` | task-2 |
| D5 web UI 显示 | EvolutionEventBus 路由 + WsEventSink + route.py register_event_route | task-2 + task-3 |
| D6 频道隔离 | state_store 共用 sessions 表，thread_id 命名空间天然隔离 | task-2 |
| D7 fire-and-forget | manager.notify_user_message 异常吞 | task-2 |
| **D8 import 边界** | `.importlinter` 加 Contract：evolution 不依赖 web.integrations.claude_code 除 ClaudeTranscriptProvider→jsonl_history 外的任何东西 | task-2 |
| **D9 频道无关性** | 验证：codex 接入时只需新建 CodexTranscriptProvider + codex route.py 三行钩子 | task-3（用 mock provider 验证）|

## 风险等级

| 组件 | 等级 | 主要风险 | 缓解 |
|------|------|---------|------|
| EvolutionManager | **中** | `_build_stub_parent_runtime` 装配 + event_bus 路由实现 | task-2 第一步 PoC stub |
| TranscriptProvider Protocol | 低 | 接口设计稳定性 | 跟 claude provider 一起设计避免误抽象 |
| ClaudeTranscriptProvider | 低 | 复用 task-1 已 req 的纯函数 | — |
| EvolutionEventBus | **中** | thread_id 解析逻辑 / 并发 register/emit | task-2 单测覆盖并发场景 |
| app.py 装配 | 低 | 跟现有 lifespan 顺序匹配 | task-3 时按 evolution.apply_executor 旁边的位置插入 |
| route.py 钩子 | 低 | 注入路径已确认（app.state.evolution_manager）| task-3 |
