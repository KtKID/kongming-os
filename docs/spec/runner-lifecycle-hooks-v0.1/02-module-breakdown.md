# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| Lifecycle Hook 定义 | 定义 `LifecycleHook` 方法、命名触发点和触发时机说明 | `repo:src/core/lifecycle.py` | 方案确认 | P0，core 入口 |
| Runner Hook 调度 | 在 turn/tool/run 关键点调用统一 lifecycle hook | `repo:src/core/runner.py`、`RunState`、`Session`、`Result` | 方案确认 | P0，替换旧 after-run 机制 |
| SessionEngine 注册表 | 管理装配期 hook 注册、移除和 run 入口快照 | `repo:src/runtime_assembly/session_engine.py`、Runner | 方案确认 | P0，build 后注册能力 |
| Evolution Hook 消费者 | 用 `LifecycleHook.after_run` 承接自我进化业务 | `repo:src/evolution/evolution_manager.py`、SessionEngine | 方案确认 | P1，普通消费者 |
| Host 装配迁移 | CLI/Web build 完 runtime 后注册 lifecycle hook | `repo:src/hosts/cli/main.py`、`repo:src/hosts/web/run.py` | 方案确认 | P1，入口迁移 |
| 验证与文档对齐 | 覆盖时机、旧 API 删除、per-run 临时 hook、模块文档 | `repo:tests/`、`repo:docs/modules/` | 方案确认 | P1，回归网 |

图集总览见 `./diagrams.md#总览`。

## 触发点定义

| 触发点名 | Protocol 方法 | 触发时机 | 主要入参 |
|---------|---------------|----------|----------|
| `before_turn` | `before_turn` | `turn.start` 事件发出后，本 turn 读取 history 与组装 LLMRequest 前 | `RunState` |
| `after_turn` | `after_turn` | assistant message 写入 session 且 usage 事件发出后，进入 tool 调用判定前 | `RunState`、assistant `Message` |
| `before_tool` | `before_tool` | `tool.call.start` 发出后，approval 判定与 tool execute 前 | `RunState`、`ToolCall` |
| `after_tool` | `after_tool` | tool_result 写入 session 且 `tool.call.end` 发出后 | `RunState`、`ToolCall`、tool result `Message` |
| `after_run` | `after_run` | Result 已构造，`run.end` 发出前 | `RunState`、`Session`、`Result` |

新增触发点时，先在 `repo:src/core/lifecycle.py` 的触发点定义表补一行，再给 `LifecycleHook` 增加同名 async 方法，最后在 Runner 增加对应 `_run_lifecycle_<point>` 调度函数和测试。注册表里已有的 hook 对象通过“实现对应方法”参与该触发点。

## 模块 1：Lifecycle Hook 定义

**边界类/入口**：`LifecycleHook`

**代码落点**：
- `repo:src/core/lifecycle.py`
- `repo:src/core/__init__.py`

**职责**：定义 Runner lifecycle hook 的唯一 Protocol、命名触发点和触发时机说明。`after_run` 与 turn/tool hook 使用同一协议面。

**包含范围**：
- 移除 `AfterRunHook` callable 类型。
- `LifecycleHook.after_run(state, session, result)` 加入 Protocol。
- 定义 `LifecycleHookPointSpec` 或等价只读结构，集中列出触发点名、方法名、触发时机和入参摘要。
- `__all__` 只导出生命周期统一入口与触发点定义。

**范围外**：
- 跨模块共享合同。
- evolution 业务逻辑。
- 事件持久化。

**依赖**：
- `repo:src/core/run_state.py`
- `repo:src/core/contracts.py`
- `repo:src/core/message.py`
- `repo:src/core/result.py`

**接口草案**：

```python
@dataclass(frozen=True)
class LifecycleHookPointSpec:
    name: str  # 触发点唯一名，如 after_run
    method_name: str  # LifecycleHook 上对应的 async 方法名
    timing: str  # 触发时机说明，写明前后事件边界
    payload: tuple[str, ...]  # 传给 hook 的核心对象名称


class LifecycleHook(Protocol):
    async def before_turn(self, state: RunState) -> None: ...
    async def after_turn(self, state: RunState, assistant_message: Message) -> None: ...
    async def before_tool(self, state: RunState, call: ToolCall) -> None: ...
    async def after_tool(self, state: RunState, call: ToolCall, result_message: Message) -> None: ...
    async def after_run(self, state: RunState, session: Session, result: Result) -> None: ...
```

**核心不变量**：
- 触发点名与 Protocol 方法名一一对应。
- 定义处能读到触发时机说明。
- `LifecycleHook` 保持 core 内部扩展点定位。

**复用/新建**：复用现有 `LifecycleHook`，新增触发点说明结构。

**风险等级**：中

**task 建议**：
- 建议 task 名：`runner-lifecycle-hook-points-v0.1`
- 对应 DoD：DoD#1、DoD#2
- 是否进入 x-req：是
- 原因：core 触发点定义是后续模块前置条件。

## 模块 2：Runner Hook 调度

**边界类/入口**：`Runner`

**代码落点**：
- `repo:src/core/runner.py`

**职责**：Runner 统一生成 effective lifecycle hook 列表，并在所有命名触发点调用对应方法。`after_run` 替换当前独立 `_run_after_run_hooks` 机制。

**包含范围**：
- `Runner.__init__` 保留 constructor-level `lifecycle_hooks`。
- `Runner.run(...)` 与 `Runner.continue_from_last_user_message(...)` 保留 per-run `lifecycle_hooks` 参数。
- 删除 `after_run_hooks` 参数、字段和 helper。
- 新增 `_run_lifecycle_after_run(state, session, result, lifecycle_hooks)`。
- Result 构造完成后调用 `_run_lifecycle_after_run`，随后发出 `run.end`。
- hook 异常通过 `_emit_hook_error("after_run", ...)` 落入 `error` 事件，Result 保持原状态。

**范围外**：
- 修改 turn loop 停止条件。
- 修改 tool approval 或 tool_result 配对。
- 修改 LLMRequest 组装。

**依赖**：
- `LifecycleHook`
- `RunState`
- `Session`
- `Result`
- `EventSink`

**接口草案**：

```python
async def run(
    self,
    user_input: str,
    *,
    session: Session,
    agent_spec: AgentSpec,
    llm: LLMProvider,
    tools: ToolLookup,
    approval: ApprovalProvider,
    lifecycle_hooks: Sequence[LifecycleHook] | None = None,  # 本次 run 临时 hook
    event_sinks: Sequence[EventSink] | None = None,  # 本次 run 临时事件落地
) -> Result:
    ...


async def _run_lifecycle_after_run(
    self,
    state: RunState,  # 本次 run 的状态快照
    session: Session,  # 本次 run 所属 session
    result: Result,  # 已构造完成的最终结果
    lifecycle_hooks: Sequence[LifecycleHook],  # constructor + runtime + per-run 合并列表
) -> None:
    ...
```

**核心不变量**：
- `after_run` 在所有 Result 分支后执行，覆盖 completed、failed、cancelled。
- `run.end` 是主链路最后的 run terminal 事件。
- Constructor hooks 与 per-run hooks 顺序稳定：constructor hooks 先执行，调用方传入的临时 hooks 后执行。

**复用/新建**：复用现有 `_run_lifecycle_before_turn`、`_run_lifecycle_after_turn`、`_run_lifecycle_before_tool`、`_run_lifecycle_after_tool` 模式。

**风险等级**：高

**风险说明**：after-run 时机靠事件顺序体现，容易在错误分支或 cancel 分支遗漏。建议先用 fake session、fake sink 和 fake hook 做顺序测试。

**task 建议**：
- 建议 task 名：`runner-lifecycle-hook-points-v0.1`
- 对应 DoD：DoD#1、DoD#2、DoD#3
- 是否进入 x-req：是
- 原因：旧机制删除与新机制调用必须同批完成。

## 模块 3：SessionEngine 注册表

**边界类/入口**：`SessionEngine`

**代码落点**：
- `repo:src/runtime_assembly/session_engine.py`

**职责**：在 runtime 装配完成后管理 lifecycle hook 注册表。主程序可以在首次 run 前把 runtime 上下文注入 hook 对象并注册。

**包含范围**：
- `SessionEngine.__init__` 保存 `list[LifecycleHook]`。
- `SessionEngine.add_lifecycle_hook(hook)` 追加装配期 hook。
- `SessionEngine.remove_lifecycle_hook(hook)` 按对象身份移除并返回是否移除成功。
- `run()` 与 `continue_from_last_user_message()` 入口处快照 `tuple(self._lifecycle_hooks)`，传给 Runner 的 per-run `lifecycle_hooks` 参数。
- 删除 `after_run_hooks` build 参数、字段、绑定 helper 和 Runner 调用参数。

**范围外**：
- Host 专属注册策略。
- EvolutionManager 业务分支。
- Runner 内部调度细节。

**依赖**：
- `LifecycleHook`
- `Runner`
- `Session`
- `AgentSpec`

**接口草案**：

```python
class SessionEngine:
    def add_lifecycle_hook(self, hook: LifecycleHook) -> None:
        """注册装配期 lifecycle hook，后续 run 入口会快照该列表。"""

    def remove_lifecycle_hook(self, hook: LifecycleHook) -> bool:
        """按对象身份移除装配期 lifecycle hook，返回本次是否移除。"""

    def _lifecycle_hooks_snapshot(self) -> tuple[LifecycleHook, ...]:
        """返回当前注册表快照，用于单次 run 的稳定输入。"""
```

**核心不变量**：
- Build 后注册有效的条件是首次 `run()` / `continue_from_last_user_message()` 前完成注册。
- 单次 run 看到的是入口时刻快照，运行中 add/remove 影响后续 run。
- SessionEngine 只管理 hook 列表，Runner 仍然定义和执行 hook 点。

**复用/新建**：复用 `SessionEngine.run()` 与 `continue_from_last_user_message()` 委托 Runner 的现有入口。

**风险等级**：中

**task 建议**：
- 建议 task 名：`runtime-lifecycle-registry-v0.1`
- 对应 DoD：DoD#3、DoD#4、DoD#5
- 是否进入 x-req：是
- 原因：这是 build 后注册语义的核心落点。

## 模块 4：Evolution Hook 消费者

**边界类/入口**：`EvolutionLifecycleHook`

**代码落点**：
- `repo:src/evolution/evolution_manager.py`
- 可选新文件：`repo:src/evolution/lifecycle.py`

**职责**：把自我进化接入 `LifecycleHook.after_run`，让 EvolutionManager 保持业务逻辑 owner。hook 对象持有 runtime 上下文，并在 after-run 时调用 manager。

**包含范围**：
- 新增 `EvolutionLifecycleHook(runtime, evolution_manager)`。
- `after_run(state, session, result)` 调用 `evolution_manager.notify_runtime_run(runtime, session, result)` 或语义等价的业务入口。
- 保留 completed、reviewer role、reviewer tool 等业务判断在 EvolutionManager 内。
- hook 异常由 Runner lifecycle dispatcher 统一隔离。

**范围外**：
- 更改自我进化 cadence。
- 更改 reviewer runtime 构造。
- 更改 evolution 事件路由。

**依赖**：
- `LifecycleHook`
- `SessionEngine`
- `EvolutionManager`

**接口草案**：

```python
class EvolutionLifecycleHook:
    def __init__(self, runtime: SessionEngine, evolution_manager: EvolutionManager) -> None:
        self._runtime = runtime  # 父 runtime 上下文，供 evolution 判断 agent_spec/tools
        self._manager = evolution_manager  # 自我进化业务入口

    async def after_run(self, state: RunState, session: Session, result: Result) -> None:
        await self._manager.notify_runtime_run(self._runtime, session, result)
```

**核心不变量**：
- 自我进化是 lifecycle hook 消费者之一。
- runtime 上下文通过 hook 对象构造注入。
- EvolutionManager 只处理业务条件与后台 reviewer 调度。

**复用/新建**：复用现有 `EvolutionManager.notify_runtime_run` 业务入口。

**风险等级**：中

**task 建议**：
- 建议 task 名：`evolution-lifecycle-consumer-v0.1`
- 对应 DoD：DoD#5、DoD#6
- 是否进入 x-req：是
- 原因：这是旧 `after_run_hooks=[manager.notify_runtime_run]` 的目标替换路径。

## 模块 5：Host 装配迁移

**边界类/入口**：`RuntimeLifecycleRegistrar`

**代码落点**：
- `repo:src/hosts/cli/main.py`
- `repo:src/hosts/web/run.py`

**职责**：把 CLI/Web 中 `SessionEngine.build(..., after_run_hooks=[...])` 改为 build 后注册 lifecycle hook，确保注册发生在 CLI run loop 与 Web 首次请求前。

**包含范围**：
- CLI：build runtime 后立即创建并注册 `EvolutionLifecycleHook(runtime, evolution_manager)`，再创建 `SubAgentManager(runtime)` 和进入 run loop。
- Web：每个 thread/runtime build 完后，如果 app 级 evolution manager 启用，立即注册 hook，再绑定 workflow manager。
- 注册点保留在 host 装配阶段，贴近 runtime 创建位置。

**范围外**：
- Web thread 创建策略。
- CLI approval、scheduler ticker、workflow manager 逻辑。
- EvolutionManager 初始化方式。

**依赖**：
- `SessionEngine.add_lifecycle_hook`
- `EvolutionLifecycleHook`
- Host 当前 evolution manager 创建路径。

**接口草案**：

```python
runtime = SessionEngine.build(...)
runtime.add_lifecycle_hook(EvolutionLifecycleHook(runtime, evolution_manager))
```

**核心不变量**：
- 注册发生在第一次 `runtime.run()` 或 `continue_from_last_user_message()` 前。
- Host 只做装配，不承担 after-run 业务判断。
- CLI/Web 共享同一种注册语义。

**复用/新建**：复用现有 CLI/Web runtime build 位置。

**风险等级**：低

**task 建议**：
- 建议 task 名：`host-lifecycle-registration-v0.1`
- 对应 DoD：DoD#5、DoD#6
- 是否进入 x-req：是
- 原因：入口迁移简单，但需要覆盖 CLI 与 Web 两条装配路径。

## 模块 6：验证与文档对齐

**边界类/入口**：`RunnerLifecycleHookTestSuite`

**代码落点**：
- `repo:tests/unit/test_runner_lifecycle_hooks.py`
- `repo:tests/unit/test_native_runtime.py`
- `repo:tests/unit/test_native_runtime_evolution.py`
- `repo:tests/unit/web/`
- `repo:docs/modules/核心/README.md`
- `repo:docs/modules/执行器/README.md`
- `repo:docs/modules/进化/README.md`

**职责**：用测试和模块文档锁定统一 lifecycle 机制，清理旧 after-run 术语。

**包含范围**：
- Runner after-run 顺序测试：Result 构造 → `after_run` hook → `run.end`。
- Completed/failed/cancelled 三类 Result 分支覆盖。
- SessionEngine build 后注册、remove、run 入口快照、continue 入口快照。
- Per-run temporary hook 仍然生效。
- Evolution hook 接入测试。
- 搜索断言旧 `AfterRunHook` / `after_run_hooks` 生产代码引用清零。
- 模块 README 更新 core/runtime/evolution 边界。

**范围外**：
- 外部 LLM 调用。
- 浏览器 UI e2e。
- 非 lifecycle 相关模块文档重写。

**依赖**：
- pytest fake LLM / fake session / fake event sink。
- 现有 native runtime 单元测试基线。

**接口草案**：

```python
class RunnerLifecycleHookTestSuite:
    def assert_after_run_before_run_end(self) -> None:
        """断言 after_run 触发早于 run.end 事件。"""

    def assert_runtime_add_remove_snapshot(self) -> None:
        """断言 runtime 注册表在 run 入口快照，remove 影响后续 run。"""
```

**核心不变量**：
- 测试覆盖 run 与 continue 两个入口。
- 文档术语统一为 lifecycle hook。
- EventSink 与 LifecycleHook 职责说明保持分离。

**复用/新建**：复用现有 `repo:tests/unit/test_runner_after_run_hooks.py` 断言意图，迁移到 lifecycle hook 命名。

**风险等级**：中

**task 建议**：
- 建议 task 名：`lifecycle-validation-docs-v0.1`
- 对应 DoD：DoD#2、DoD#4、DoD#7
- 是否进入 x-req：是
- 原因：统一机制的主要风险来自时机漂移和旧 API 残留。

## 模块一致性要求

- Lifecycle Hook 定义是唯一 hook 点说明来源。
- Runner Hook 调度只消费 `LifecycleHook`。
- SessionEngine 注册表只管理装配期 hook 对象和快照。
- Evolution Hook 消费者只桥接 runtime 上下文与 EvolutionManager 业务入口。
- Host 装配迁移只负责注册时机。
- 验证与文档对齐覆盖所有入口和旧术语清理。
