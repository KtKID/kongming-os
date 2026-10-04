## 直接回答：语法是 while，本质是"挂起点驱动的协程"

现在的 `Runner._drive_turns`（runner.py:622）确实是 `while True:`，但这个问题的答案不在循环关键字上，而在 **await 点**上。协程的 while 循环和线程的 while 循环是两种东西：它 90% 的时间挂起在 `await llm.complete()` / `await tool.execute()` 上，挂起即让出，asyncio 事件循环转去跑别的协程。所以"支持多会话并行"不需要任何新机制——**每个 await 点天然就是并行切换点、也是打断注入点**。1000 个 agent 并行 = 1000 个协程各自挂在自己的 await 上，单线程单事件循环就够（IO-bound 负载的本质决定的）。

## 第一性原理：整个系统只有三层循环，且只有一层是真循环

```
asyncio event loop        ← 唯一的真 while True（调度器，进程生命周期）
 └─ actor_loop × N        ← 消息泵：await mailbox.get() → 跑一个 run → 回去等
     └─ run loop          ← 不动点迭代：折叠 turn 直到终态（有界，agent 生命周期内反复发生）
         └─ turn          ← 原子步：一次 LLM 调用 + 其工具执行
```

三层的**终止语义**完全不同，这是命名应该揭示的本质：

- **turn（步）**：一个纯粹的状态转移函数。`step(history, spec) → assistant_msg + actions`。无循环。
- **run loop（折叠）**：`state' = step(state)`，迭代到不动点——LLM 不再产生 tool_calls（自然终态）或预算耗尽（强制终态）。数学上就是 `fold(step) until terminal`。它必须有界。
- **actor_loop（泵）**：`while alive: env = await get(); run(env)`。它必须无界（agent 活着就要收消息），idle 是挂起不是空转。

## 命名批判

你的直觉对。"Runner"没说明它 run 的是什么、到什么为止；"SessionEngine"的"Native"是相对什么而言的（历史上相对 SDK 通道），"Runtime"实际干的是装配。按本质重命名：

| 现名 | 本质 | 建议名 |
|---|---|---|
| `Runner._drive_turns` 里的隐式 turn | 原子状态转移 | 显式抽出 `TurnStep`（或 `step()` 函数） |
| `Runner` | 把 step 折叠到终态 | `RunLoop`（一次 run 的折叠器） |
| 新增 actor_loop | 消息泵，agent 的生命 | `AgentCell.serve()`（泵就叫泵） |
| `SessionEngine.build()` | composition root，spec → 装配好的 cell | `AgentFactory`（重构后 `run()` 消亡，被 mailbox 驱动取代，它只剩装配职责） |
| 树级容器 | cells + TaskRegistry + epoch | `ConversationTree`（已有此概念） |

## Loop 该怎么优化：把 1500 行的 Runner 拆成"一个纯步 + 三圈环"

现在 runner.py 的问题不是 while True，而是 turn 的核心逻辑（assemble → llm → tools）和横切关注点（emit 事件、lifecycle hooks、compaction、streaming、占位配对、异常收口）**全部内联在同一个类里**——1500 行、40+ 个 await self._xxx。第一性拆法：

```python
# 内核：一个纯步，无事件无hook无压缩，~100行
async def step(state: RunState, deps: StepDeps) -> StepOutcome:
    assembled = await deps.assembler.assemble(state.history)
    resp = await deps.llm.complete(to_request(assembled))
    if not resp.tool_calls:
        return StepOutcome(terminal=True, message=resp.message)
    results = await execute_calls(resp.tool_calls, deps)   # 含审批/占位
    return StepOutcome(terminal=False, appended=[resp.message, *results])

# 折叠器：唯一的 run loop，~30行
async def run_loop(seed, deps, budget) -> Result:
    state = seed
    while not state.terminal and budget.allow(state):
        state = apply(state, await deps.step(state, deps))
    return finalize(state)

# 横切关注点 = 环绕 step 的装饰层，各自独立成模块
deps.step = with_events(with_hooks(with_compaction(step)))
```

这样得到你要的四个属性：**简单**——内核 step 一屏读完，`while` 只剩一个且只有两个退出条件（终态/预算）；**可组合**——事件、hook、压缩、tracing 是洋葱层，加 UsageSink、审计层不动内核（和你 EventSink fan-out 的既有哲学同构）；**扩展性强**——子 agent 的 step 和主 agent 的 step 是同一个函数，差异全在 deps（spec/tools/session），零代码分支，这正是"代码不区分主子"的落点；**多会话并行**——`AgentFactory` 造 N 个 cell，每个 cell 一个 `serve()` 协程，并行是 asyncio 白送的，唯一要管的是 TaskRegistry 把每个协程登记在树上以便级联砍。

一个附带收益：step 纯化后，**journal/恢复变成序列化 RunState**（history 游标 + turn 数 + 预算余量），崩溃恢复从"重放事件流"降级为"从最近 state 快照继续 fold"——上一轮审查里 F6 的两阶段投递问题会好做很多。

保留意见一条：洋葱层不要过度——compaction 和 streaming 与 step 内部耦合较深（compact 改 history、stream 是 llm.complete 的另一形态），硬拆成装饰器可能比内联更绕。建议 streaming 收进 provider 层（`complete` 内部消费流，delta 走 EventSink 出去），compaction 收进 assembler（它本来就在 InputAssembler 边界上），这两个不做装饰层。