# 数据模型与状态

## 核心实体

```python
@dataclass(frozen=True)
class LifecycleHookPointSpec:
    name: str  # 触发点唯一名，例如 after_run
    method_name: str  # LifecycleHook 上对应的 async 方法名
    timing: str  # 触发时机说明，包含前后事件边界
    payload: tuple[str, ...]  # 传入 hook 的核心对象名称


class LifecycleHook(Protocol):
    async def before_turn(self, state: RunState) -> None: ...
    async def after_turn(self, state: RunState, assistant_message: Message) -> None: ...
    async def before_tool(self, state: RunState, call: ToolCall) -> None: ...
    async def after_tool(self, state: RunState, call: ToolCall, result_message: Message) -> None: ...
    async def after_run(self, state: RunState, session: Session, result: Result) -> None: ...


@dataclass
class NativeRuntimeLifecycleRegistry:
    hooks: list[LifecycleHook]  # 装配期注册的 hook 对象，按注册顺序执行


@dataclass(frozen=True)
class LifecycleHookSnapshot:
    hooks: tuple[LifecycleHook, ...]  # 单次 run 入口快照，运行中保持稳定


@dataclass
class EvolutionLifecycleHook:
    runtime: SessionEngine  # 父 runtime 上下文，供 evolution 读取 agent_spec/tools
    evolution_manager: EvolutionManager  # 自我进化业务入口
```

## 实体关系

实体关系图见 `./diagrams.md#生命周期数据关系`。

## 状态流转

### Runtime Hook 注册状态

`built → hook_registered → first_run_snapshot → run_invoked → hook_removed → next_run_snapshot`

- `built`：`SessionEngine.build(...)` 返回 runtime。
- `hook_registered`：host 调用 `runtime.add_lifecycle_hook(...)`。
- `first_run_snapshot`：首次 `run()` 或 `continue_from_last_user_message()` 入口快照注册表。
- `run_invoked`：Runner 使用 snapshot 与 per-run hooks 组装 effective hooks。
- `hook_removed`：host 或测试调用 `runtime.remove_lifecycle_hook(...)`。
- `next_run_snapshot`：后续 run 使用新的注册表快照。

状态图见 `./diagrams.md#SessionEngine-注册状态`。

### Run Hook 触发顺序

`run.start → turn.start → before_turn → after_turn → before_tool → after_tool → Result constructed → after_run → run.end`

这个顺序表达最大路径。无 tool 的 run 会跳过 tool 触发点；failed/cancelled 分支仍然构造 Result 后触发 `after_run`，随后发出 `run.end`。

时序图见 `./diagrams.md#runner-hook-时序`。

## 持久化方案

| 数据 | 存储方式 | 位置 | 备注 |
|------|---------|------|------|
| Hook 注册表 | 内存 | `SessionEngine` 实例 | 装配期能力，进程生命周期内有效 |
| Hook snapshot | 内存 | 单次 `run()` / `continue_from_last_user_message()` 调用栈 | 保证单次 run 内列表稳定 |
| Hook 触发事实 | EventSink 持久化 | 现有 trace / audit sink | 只落 error、run/turn/tool 等事实事件 |
| Evolution 业务产物 | 现有 evolution 存储 | `<kongming_home>/evolution/` | 仍由 EvolutionManager 维护 |

## 共享数据结构

```python
LifecycleHookPointName = Literal[
    "before_turn",  # turn.start 后、history 读取前
    "after_turn",  # assistant message 写入后、tool 判定前
    "before_tool",  # tool.call.start 后、approval 前
    "after_tool",  # tool_result 写入且 tool.call.end 后
    "after_run",  # Result 已构造、run.end 前
]


@dataclass(frozen=True)
class LifecycleHookCallContext:
    point: LifecycleHookPointName  # 当前触发点名称
    run_id: str  # 本次 run id
    session_id: str  # 本次 session id
    turn: int  # 当前 turn 序号，after_run 为终态 turn
```

`LifecycleHookCallContext` 是可选演进结构。本轮实现可以直接传 `RunState`、`Session`、`Result`，后续触发点增多时再评估是否抽出统一上下文对象。

## 状态一致性要求

- `SessionEngine` 注册表顺序等于 hook 执行顺序。
- Runner constructor hooks、runtime snapshot hooks、per-run hooks 合并顺序固定。
- `after_run` hook 读取的是已构造 Result，写入业务产物通过自己的 manager 完成。
- EventSink 持久化的是事实事件，生命周期 hook 只通过 Runner 调度进入业务扩展。
