第一性原理：整个 Harness 只有一种东西——Actor + Mailbox
你要的"代码不区分主/子 agent、禁止 subagent 和 workflow 两套调用方式"，本质就是 actor 模型。全框架只需三个原语：
原语 1：Agent = actor 实例。AgentNode(agent_id, parent_id, conversation_id, spec)，spec 含自己的 system prompt、toolset、skills、session。主 agent 唯一的特殊之处是 parent_id=None 且 mailbox 接用户输入——纯数据差异，零代码分支。
原语 2：一切驱动都是 Mailbox 消息。agent 没有"被调用"的概念，只有"收到消息后跑一个 run，跑完回到 idle"。消息类型收敛为：UserMessage、ChildResult(child_agent_id, result)、SystemNotice。你说的场景就自然成立了：
用户 → A.mailbox: "让b读文档"
A run: 调 spawn 工具 → tool_result 立即返回 {child_id: b, status: dispatched}
       → A 输出"已派出b，等待回复" → run 结束，A idle
       （B 在后台自己跑自己的 loop）
用户 → A.mailbox: 继续聊天 → A 又跑一个 run（B 不受影响）
B 完成 → harness 投递 ChildResult 到 A.mailbox → 触发 A 新 run → A 汇总汇报
关键约束：每个 agent 同一时刻只跑一个 run（mailbox 串行消费）。这一条规则同时解决了"B 结果和用户消息同时到达"的竞态、A 运行中不能被外部改 history 的一致性问题——不需要任何锁。
原语 3：spawn 是唯一派生方式。阻塞式 subagent 不是第二套机制，而是 spawn(..., wait=True) ——即"派出后 mailbox 里没别的事就等 ChildResult"，是策略参数不是代码路径。workflow 也只是"一个 agent 按剧本连续 spawn"，同一原语的组合。
注意 tool_use/tool_result 配对问题（Anthropic 协议硬约束）：spawn 的 tool_result 必须立即返回派出确认，子 agent 的最终结果走 ChildResult 消息在下一个 run 注入，绝不能悬空等待——这正好和你现有 interrupt-run-v0.1 的占位配对逻辑同构。
统一任务管理：TaskRegistry 是唯一的资源账本
每个会话树一个 TaskRegistry，登记一切有生命周期的东西：
TaskRecord(task_id, agent_id, parent_task_id, kind, status, handle, resources)
  kind ∈ {agent_run, llm_call, tool_call, bash_process, spawn}
  handle = asyncio.Task；resources = [PID, ...]
这些记录天然构成一棵树：A.run → tool_call(spawn) → B.run → tool_call(bash) → PID 1234。你要的第 2、3 条需求都是这棵树上的操作：

统一管理 = 所有行为（含 B 的工具调用）都经同一个 registry 登记，Event 扩展为携带 agent_id + task_id + conversation_id（现有 Event 只有 run_id，这是要补的字段）
打断链 = registry.cancel_subtree(task_id)：后序遍历，先 kill 叶子（bash 进程 kill()+wait() 兜底，你已有此约束）、再 cancel 子 agent 的 run、再 cancel 父 run。asyncio 的结构化取消（cancel 沿 await 链传播 + runner 顶层收口成 Result(cancelled)）和这个模型完全对齐——这是选 asyncio 的最强理由。

需要预留一个策略位：父被打断时子默认级联杀，但 detach=True 的后台任务（如 cron 派生）可以豁免。
会话隔离：ConversationTree 就是 registry 的作用域
一个聊天会话 = 一棵树 = (root AgentNode, TaskRegistry, EventSink fan-out)。树与树之间零共享可变状态（provider 连接池可共享，那是无状态资源）。你现有的 ThreadCell 已经是这个东西的雏形——它今天装配"一个 runtime"，改成装配"一棵树的根 + registry"即可。子 agent 有独立 session_id、独立 prompt/tools/skills，现有 SubAgentManager 已验证了隔离可行，但它要被收编：从"自己管生命周期的旁路"降级为 spawn 原语的实现细节，SubAgentLifecycleRegistry 合并进 TaskRegistry，消除双账本。
技术选型
内核：Python + asyncio，不换。 理由：① 负载是纯 IO-bound（LLM 调用、子进程、文件），asyncio 单事件循环足够，"多线程"是伪需求——真并发点只有 CPU 密集工具，丢 ProcessPoolExecutor/子进程即可；② asyncio 的 cancellation 传播语义与打断链一比一映射，Rust（tokio）也能做但 CancellationToken 要手动织入每层，Python 的 Task.cancel() 沿 await 链自动传播更贴合；③ 你的 Runner/Session/EventSink/Safety 全套已在 Python，重写零收益；④ LLM/MCP 生态最全。Rust 的强项（内存安全、真并行、单二进制）在这个负载画像下换不回重写成本；TS 的 actor 生态和子进程控制都弱于 Python，仅剩"前后端同语言"一个优点。
跨平台：内核做成 headless 服务，三个宿主都是薄壳。 CLI 直接进程内挂 adapter；Web 走你现有 FastAPI+WS；Tauri 用 sidecar 模式带打包的 Python 内核（你 packaging/ 的 x-space sidecar + ready JSON 契约就是为此准备的）。三端共享同一套 wire 协议（约束 17 的双侧真源），协议要新增的帧就是：agent 树快照、agent.spawned/completed、按 task_id 的 interrupt 帧、以及agent 主动推送（B 完成后 A 无用户提问也要出消息——CLI 要能异步打印，Web 要能渲染非用户触发的消息，这是三端 UI 都要吃的新语义）。
必须提前想清楚的盲区
按启发式义务列出：① 崩溃恢复——TaskRegistry 在内存，进程挂了树就没了；至少要 journal agent 树结构，重启时把 in-flight 标记为 orphaned，否则 Web 端会出现幽灵"运行中"状态。② 预算控制——spawn 递归深度、扇出数、子树 token 总额必须有硬上限，否则 A 派 B 派 C 会失控。③ ChildResult 注入的角色语义——注入成 user role 还是合成 tool_result，影响模型行为，建议做成显式的 harness 消息格式并在 system prompt 里声明协议。④ run_id 语义膨胀——现在 run-{session_id}-{index} 单调递增假设单一驱动源，mailbox 多源触发后仍成立（串行消费保证），但 Event 必须补 agent_id/task_id 才能让前端画树。

如果方向认可，落地顺序我建议：Event 加标识字段 → TaskRegistry + cancel_subtree → mailbox 化 Runner 驱动 → spawn 工具收编 SubAgentManager → wire 协议加树帧。要不要我先把这套写成 docs/spec/ 下的正式设计文档？

## 本质

Mailbox 本质是一个**串行化点**：把外部世界的并发（用户随时说话、子 agent 随时完成、cron 随时触发）压成该 agent 的严格串行输入流。它是"谁在什么时候产生事件"和"agent 什么时候处理事件"之间的解耦边界。有了它，"agent 同一时刻只跑一个 run"不再是需要锁保证的约束，而是结构上的必然——因为 run 只能从队头取一条消息开始。

它和 Session 的分工：mailbox 是**待处理输入**（瞬态，处理后消失），Session 是**已发生历史**（持久，只增）。消息被 run 消费的那一刻，从 mailbox 转录进 session。

## 数据结构

每个 AgentNode 挂一个队列 + 一个常驻消费者协程，就这两样：

```python
@dataclass(frozen=True)
class Envelope:
    message_id: str
    kind: Literal["user_message", "child_result", "system_notice"]
    sender: str                    # "user" | child_agent_id | "scheduler"
    payload: dict                  # 文本/附件/子agent的Result摘要
    enqueued_at_ms: int

class AgentCell:                   # 每个 agent 一份
    node: AgentNode                # agent_id / parent_id / spec
    mailbox: asyncio.Queue[Envelope]
    actor_task: asyncio.Task      # 常驻消费循环，登记进 TaskRegistry
    state: Literal["idle", "running", "cancelled", "closed"]
```

注意**打断不是 Envelope**。cancel 是控制面信号，走 `TaskRegistry.cancel_subtree()` 直接砍 asyncio.Task；如果把打断放进 mailbox，它会排在队尾等前面的消息处理完——语义就错了。mailbox 只装数据面的"待办输入"。

## 执行流程

```
生产者（三种，互不知晓）:
  WS handler 收到用户消息      → mailbox.put(user_message)
  B 的 run 结束，harness 回调  → A.mailbox.put(child_result)
  cron 触发                    → mailbox.put(system_notice)

消费者（每 agent 一个常驻协程）:
  async def actor_loop(cell):
      while True:
          env = await cell.mailbox.get()      # idle 态：挂在这里，零开销
          batch = drain_nowait(cell.mailbox)  # 可选：把积压消息并入同一个 run
          cell.state = "running"
          result = await runner.run(seed_from(env, batch), session=cell.session)
          if result.status == "completed" and cell.node.parent_id:
              parent.mailbox.put(child_result(result))   # 结果向上投递
          emit_to_ui(result)                  # 主 agent 则推给用户（含无人提问的主动汇报）
          cell.state = "idle"
```

几个关键点：

**idle 就是 `await queue.get()`**。不是轮询、没有后台开销，A "派出 b 后 loop 走完"在实现上就是 actor_loop 回到了 get() 这一行。

**drain 批处理是个策略位**。用户在 A running 期间连发两条，A 空闲后可以合成一个 run 处理（省 LLM 调用、上下文更连贯），也可以逐条跑。child_result 和 user_message 混排时建议合并注入同一个 run——"用户刚说的话 + b 刚回来的结果"一起给模型看，比拆两个 run 语义更好。

**向上投递是 spawn 的收尾对称面**：spawn 时父的 tool_result 立即返回 dispatched，子完成时经父的 mailbox 补上真正的结果。一条消息通路闭合了整个父子协作，没有回调地狱、没有第二套机制。

**崩溃语义要明确**：mailbox 是内存队列，进程挂了未消费的消息就丢。用户消息可接受（WS 断连用户能感知重发），child_result 不可接受——所以子 agent 的 Result 应先落 session/journal 再投递，重启时可从"子已完成但父未消费"状态重放。这是上一轮说的 journal 需求的具体化。

## 对抗性审查结论 + 需求澄清后的最终收敛

对方案做了两路子 agent 审查（纯对抗审查 + 对照代码库核查），结合需求方澄清，方案收敛如下。核心原则升级为一句话：**数据面走 mailbox（串行），控制面绕 mailbox（打断、审批），账本面全经 registry（登记先于暴露）**。原方案把三者混在 mailbox 一条通道里，是全部致命洞的根源。

### 澄清 1：打断语义 = 会话回 idle + 子 agent 全销毁 + 执行中任务全取消

这是设计目标本身，无分歧。epoch 机制不是新语义，而是实现层的保险栓：cancel 不是瞬时的，打断进行中某个子的 runner 可能恰好跑完、其收尾代码正把结果投进父 mailbox，父回 idle 后看到消息又跑起来——用户视角"打断后 agent 自己复活说话"。对策：

- 打断瞬间树的 interrupt epoch +1；Envelope 携带产生时的 epoch，actor_loop 丢弃旧世代投递（只记账不触发 run）
- 打断同时清空 mailbox 中已排队的非用户消息
- cancel 只砍 runner task，actor_loop 永不被 cancel（只随树销毁）；否则 agent 永久失聪、mailbox 静默堆积
- spawn 必须**先原子登记 TaskRecord(pending) 再返回 tool_result**；cancel_subtree 时 registry 置关门标志拒绝新登记，防止 dispatched 与登记之间的打断漏杀孤儿子

### 澄清 2：砍掉 wait=True，全框架只有异步一种派出方式

审查发现 wait=True 死锁：子结果唯一通路是父 mailbox，但父 runner 正 await 子、父 actor_loop 阻塞在 runner.run() 里不会 get()，child_result 永不被消费。需求方确认没有同步等待场景：纯 mailbox 模式下 A 永不阻塞（派出 B → run 结束 → idle；A 在自己 run 里读文件是正常工具循环）。结论：**删除 wait=True**，"等 B 回来再干下一步"是 agent 的行为（收到 child_result 前不推进，LLM 自己表达），不是机制。这更彻底地满足"禁止两套调用方法"，死锁问题整体消失。

### 澄清 3：审批按会话路由，不区分 agent，子规则 = 父规则

现有 per-thread approval inbox 结构直接沿用（会话 = thread = 树），改动收敛为：

- 子 agent 的 runner 装配时**共享树的同一个 ApprovalManager / bridge**（不再像现 SubAgentManager 自己装一套）
- 审批请求携带 agent_id 仅作展示归属；`ApprovalManager._pending` 是 dict，天然支持父子同时挂多个 pending
- 审批是控制面，绕过 mailbox 直达会话级 inbox，与 run 串行性解耦（否则父在跑 run 时子的审批请求排队挂死，父子同时等审批则互等活锁）
- cancel_subtree 时一并取消子树的 pending approval future，否则 inbox 留幽灵审批项

### 澄清 4：子 agent 一次性（single_shot），上下文不带到下一个任务

生命周期问题（僵尸 actor 积累）随之消失：lifecycle 是 AgentCell 的数据字段而非代码分支——`single_shot`（结果投递后即 GC，session 归档不复用）vs `persistent`（主 agent）。子 agent 的 mailbox 一生只收一条任务消息，结构仍与主 agent 完全同构，符合"代码零区分"。

用量要求：**与主 agent 区分、又能汇总审计**。Event 补 agent_id 后，usage 按 agent_id 分桶存储，会话维度上卷汇总——既能单看某个子 agent 花了多少，也能审计整棵树总账。需给现有 `UsageTokenManager`（当前按 thread 单维度）加聚合维度。

### 澄清 5：子 agent 流式输出带 agent_id，暂不消费

Web 渲染时子输出收缩显示、当前可不消费，但 **wire 协议第一天就在流式帧上带 agent_id**（成本≈0）；否则以后做"展开看子 agent 实时干活"要动协议真源两侧（约束 17），迁移成本远高于现在留好字段。

### 审查遗留的重要修正（不依赖澄清，落地必做）

- **journal 两阶段**：只记树结构不够。"child_result 落盘 → 父消费 → 写 consumed 标记"，按 task_id 幂等去重，防重放时父重复注入同一结果；恢复时扫描 history 补未配对 tool_use 的占位 tool_result，否则重启后首次 LLM 调用被 400 拒
- **drain 合并标注**：合并进同一 run 的消息必须带 origin/agent_id 标注并按 epoch 过滤，否则 LLM 把子结果误读为用户发言、打断前残留消息混入打断后首个 run
- **child_result 投递前经 registry 校验目标存活**，避免向已销毁 mailbox 投递时静默丢失
- **detach 任务的归宿**：树销毁时 detach 任务及其 bash PID 必须有 owner（转移 orphan registry 或强杀），不定义则进程泄漏

### 代码库冲突清单（落地要动的点）

| 现状 | 冲突 | 改动方向 |
|---|---|---|
| `Runner._seed_messages` 只吃单条 user_input | 无法合并注入 user_message + child_result | seed 改为接受消息数组 |
| `ThreadCellStatus` 只有 IDLE/RUNNING/AWAITING_APPROVAL/EVICTING | 表达不了"主 idle 但子树 running" | 状态机加树维度；InterruptFrame 从 cancel current_run_task 改为 cancel_subtree |
| `ApprovalInboxBroadcaster._bridge_registry` thread→bridge 一对一 | 子 agent 审批无通道 | 子 runner 共享树的 bridge，请求带 agent_id |
| `Event` 只有 run_id | 前端画不了树、用量分不了桶 | 补 agent_id / task_id / conversation_id |
| `UsageTokenManager` 按 thread 单维度 | 子用量无法区分与上卷 | 按 agent_id 分桶 + 会话上卷聚合入口 |
| `SubAgentManager` 与 `AgentWorkflowStrategyManager` 两套独立入口 | 正是要消灭的双机制 | 统一收编进 spawn 原语 + mailbox 驱动 |
| compactor `_filter_middle` 保留 user role 消息 | child_result 注入 user role 可行，但 provider 层 role 交替约束需补偿 | InputAssembler 前做 role 序列补偿 |
| Session file/sqlite 后端单写者假设 | 父子各写各的 session 无冲突 | 确认不共享连接池即可 |

### 最终形态

**单一 spawn 原语（仅异步）· single_shot 子 agent · 按会话的审批 · epoch 门卫打断 · per-agent 用量分桶 + 会话上卷 · 流式帧带 agent_id**。落地顺序：Event 加标识字段 → TaskRegistry + cancel_subtree（含 epoch + 关门标志）→ mailbox 化 Runner 驱动 → spawn 工具收编 SubAgentManager / workflow → 审批 bridge 共享 → wire 协议加树帧与 agent_id。

## 打断问题的完整推导：约束 16、Outcome 分类器与三段时间线

### 认定：约束 16 在 runner 边界终止了 cancel 的异常传播

约束 16（runner 顶层吞 CancelledError、收口成 `Result(status="cancelled")`、不外抛）是刻意设计：换来 runner 收口前完成 tool_use/tool_result 占位配对 + 单一出口。但代价必须写明：**CancelledError 的自动传播链在 runner 处终止，"取消"从异常控制流转换成了数据值**。此后传播必须在 runner 之上以数据形式手工重建——谁 await 了 runner.run()，谁就有义务检查 status 并采取行动。

由此发现本文档前面 actor_loop sketch（`result = await runner.run(...)` 直接内联）的两个结构缺陷：

1. runner 内联在 actor_task 里，"cancel 只砍 runner task"无靶可砍——cancel actor_task 会被约束 16 吞掉，actor 照常回 idle
2. 缺 single_shot 退出条件（sketch 写于澄清 4 之前），子 agent 跑完 cancelled 的 run 后不会销毁

### 第一性拆分：cancel 停止工作，lifecycle 决定存亡，二者正交

"打断后 actor 存活回 idle"对主 agent 恰恰是**正确语义**（打断 ≠ 销毁主 agent）。错误在于把"销毁子 agent"寄托在 cancel 传播上：

- **cancel 的职责**：停止正在进行的工作（砍 run_task、杀 PID）。到此为止。
- **lifecycle 的职责**：决定 actor 本体存亡。`persistent`（主 agent）→ 任何 run 终态后回 idle；`single_shot`（子 agent）→ 任何终态（含 cancelled）后退出 loop、注销 cell。

"子 agent 全销毁"靠 single_shot 的退出条件实现，不靠 cancel 链。

### Outcome 分类器：以数据形式重建被切断的传播链

终态是封闭枚举，每个终态必须带 reason，actor_loop 对它全覆盖 dispatch（无 default 落空分支）：

```
Outcome
├─ completed                                    → 向上投递 child_result / 推 UI
├─ cancelled(reason)                            ← 控制面，不是错误，绝不重试
│    reason ∈ {user_interrupt, parent_cascade, watchdog_timeout}
│    → 不投递、不推增量；single_shot 则退出
├─ failed(error_class)                          ← 错误面，按 class 决定可否重试
│    class ∈ {llm.auth, llm.rate_limit, llm.protocol_400, tool.execution, internal.bug}
│    → 必须向上投递失败（父有权知道子挂了）
└─ budget_exhausted(max_turns | token_limit)    → 向上投递部分结果 + 耗尽标记
```

关键立场：**cancelled 不属于 error**——控制面与错误面并列于同一分类器，处理策略族完全不同。约束 16 的 metadata（cancelled_at_turn / cancel_reason）已是雏形，缺的是消费者。

修正版 actor_loop（同时修两个缺陷）：

```python
async def actor_loop(cell):
    while True:
        env = await cell.mailbox.get()
        if env.epoch < cell.tree.epoch:          # 时间面门卫
            continue
        run_task = asyncio.create_task(runner.run(...))
        registry.register(run_task, cell)        # ← cancel_subtree 的靶子，不是 actor_task
        result = await run_task                  # 约束16保证永不 raise
        match classify(result):                  # 语义面：全覆盖 dispatch
            case Completed():   deliver_up(result)
            case Cancelled(r):  emit_only(r)     # 不投递
            case Failed(e):     deliver_failure_up(e)
            case Exhausted(b):  deliver_partial_up(b)
        if cell.lifecycle == "single_shot":      # 存亡由 lifecycle 决定
            break
        cell.state = "idle"
    registry.close_cell(cell)                    # 注销 + mailbox 关闭
```

分类器解决不了的两个面：**时间面**——run 在 cancel 到达前完成、结果已进 mailbox，分类器看到货真价实的 completed，无法知道它"相对打断已过时"（过时性是消息与打断的相对时序属性，不在 Result 里）→ epoch 门卫；**资源面**——bash 进程、httpx 流不随 Python 值分类而回收 → registry kill+wait 兜底。

三个正交机制各管一面：**分类器 = 语义面**（发生了什么、上层怎么响应），**epoch = 时间面**（这个结果还作数吗），**registry = 资源面**（还有什么占着没还）。

### 三段时间线：打断落点决定处理方式

以"子结果触发父 run，父 run 调 LLM"为例，cancel 可能落在三段：

| 段 | 状态 | 正确处理 |
|---|---|---|
| 1. child_result 已进父 mailbox，父 run 未启动 | 消息在队列里 | **消费侧抛弃**：打断时 purge 队列 + epoch 门卫兜底（防 purge 后才投进来的旧世代消息） |
| 2. 父 run 已启动，LLM 服务器推理中，本地在 await | 回复在途 | **不需要抛弃逻辑**：cancel run_task → CancelledError 在 await 挂起点炸开 → httpx 连接随协程取消关闭，回复在本地永不成为消息。约束 16 收口 + 占位配对。损失仅服务器侧已推理算力（远端计费止损取决于 provider 断流行为，未验证） |
| 3. 父 run 已跑完，回复已 append 进 session、已推 UI | 既成事实 | **必须不抛弃**：session 已提交的 assistant 消息和 tool_use/tool_result 配对不可回滚，否则 LLM 上下文与用户所见分裂 + 配对链撕开（400 风险）。语义 = "打断来晚了"，用户在打断前一瞬看到回复是可接受 UX。该抛弃的只有此 run 完成后**向上投递的 envelope**——绕回段 1 被 epoch 拦截 |

细节两条：asyncio 无"帧"，cancel 生效点是下一个 await 挂起点，runner 卡在纯同步代码时 cancel 要等让出才落地；段 2 流式场景下 UI 可能已收到半截 delta，前端须标记为 interrupted 而非静默截断（interrupt-run-v0.1 已覆盖，重构时保住）。

### 打断不变量（一句话）

> **打断只阻止未来，不回滚过去。抛弃动作全系统只存在一个位置——mailbox 消费侧的 epoch 门卫；进行中的靠 cancel 使其"永不到达"；已提交的一律保留。**

抛弃点若错放到网络接收层或 UI 层，会出现 session 有回复但用户没看到（或反之）的状态分裂——此竞态最隐蔽的坑。