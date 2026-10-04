# 用户原始需求
我现在重构方案，这个文档是讨论方案过程，包括下面澄清，不全是在说现有架构，你要认识到这一点，你要判断方案是否往更简单的架构设计和组合进行优化，老架构不合适就淘汰而不是缝补。我要的情况需要支持，和agentA下任务，agentA派出子agentB去做，A能和我继续聊天，B在做完任务后就报告A，然后A再报告给我。打断A的时候，附属B和任务都要打断。并且我看到claude实现有一个错误分类器，本质是什么东西，我是否也需要，如果用try catch内部可能有很多case处理，错误分类器能不能解耦很多分支？

确定：1.重构v1版本配置里只能填1层。包括扩展性。2.同意run时捕获。3.不过滤。4.连带打断。确定要做分类器。现在loop重构、多agent重构、新增分类器是我们确定下来要做的对吧，那么你觉得顺序应该是什么？如果先做多agent重构，将来loop重构会不会又要把多agent重写？

# loop / 多 agent 重构方案 v2（收敛版）

> 定位：本文是 `loop-多agent重构-fable5.md` 讨论稿的收敛版。讨论稿是多轮对抗审查的过程记录，
> 各轮之间存在互相矛盾的表述；本版只保留验证过的正确方向，纳入全部已拍板决策，
> 已否决方向集中列在文末附录（防止回潮），正文不再出现。
> 拍板时间：2026-07-02。

## 一、第一性原理：整个 Harness 只有一种东西——Actor + Mailbox

目标"代码不区分主/子 agent、禁止 subagent 和 workflow 两套调用方式"，本质就是 actor 模型。
全框架只需三个原语：

**原语 1：Agent = actor 实例。** `AgentNode(agent_id, parent_id, conversation_id, spec)`，
spec 含自己的 system prompt、toolset、skills、session。主 agent 唯一的特殊之处是
`parent_id=None` 且 mailbox 接用户输入——纯数据差异，零代码分支。

**原语 2：一切驱动都是 Mailbox 消息。** agent 没有"被调用"的概念，只有"收到消息后跑一个
run，跑完回到 idle"。消息类型收敛为 `user_message` / `child_result` / `system_notice`。
目标场景自然成立：

```
用户 → A.mailbox: "让 B 读文档"
A run: 调 spawn 工具 → tool_result 立即返回 {child_id: b, status: dispatched}
       → A 输出"已派出 B，等待回复" → run 结束，A idle
       （B 在后台自己跑自己的 loop）
用户 → A.mailbox: 继续聊天 → A 又跑一个 run（B 不受影响）
B 完成 → harness 投递 child_result 到 A.mailbox → 触发 A 新 run → A 汇总汇报
```

关键约束：**每个 agent 同一时刻只跑一个 run（mailbox 串行消费）**。这一条同时解决
"B 结果和用户消息同时到达"的竞态、以及 A 运行中不能被外部改 history 的一致性问题——不需要锁。

**原语 3：spawn 是唯一派生方式，且只有异步一种。** 全框架没有同步等待派出。
"等 B 回来再干下一步"是 agent 的**行为**（收到 child_result 前不推进，LLM 自己表达），
不是机制。workflow 同样收编进 spawn 原语（见第八节）。

tool_use/tool_result 配对（Anthropic 协议硬约束）：spawn 的 tool_result 必须立即返回
派出确认，子 agent 的最终结果走 child_result 在下一个 run 注入，绝不悬空等待——
与现有 interrupt-run-v0.1 的占位配对逻辑同构。

### Mailbox 的本质

Mailbox 是一个**串行化点**：把外部世界的并发（用户随时说话、子 agent 随时完成、cron 随时
触发）压成该 agent 的严格串行输入流。有了它，"agent 同一时刻只跑一个 run"不再是需要锁
保证的约束，而是结构上的必然——run 只能从队头取一条消息开始。

它和 Session 的分工：mailbox 是**待处理输入**（瞬态，消费后消失），Session 是**已发生历史**
（持久，只增）。消息被 run 消费的那一刻，从 mailbox 转录进 session。

## 二、核心原则（一句话版）

> **数据面走 mailbox（串行），控制面绕 mailbox（打断、审批），账本面全经 registry（登记先于暴露）。**

三者混在一条通道里是讨论稿早期版本全部致命洞的根源，收敛后严格三分。

## 三、已拍板决策清单

| # | 决策点 | 结论 |
|---|---|---|
| 1 | spawn 递归深度 | **v1 配置固定 1 层**（子 agent 不能再 spawn）；设计保留扩展性——深度是配置项 + 退出条件写通用式，将来放开只改配置 |
| 2 | epoch 盖章时机 | **run 启动时捕获**，该 run 的所有产物（含向上投递的 envelope）继承 run 起始 epoch；禁止在投递入队时盖章 |
| 3 | 用户消息与 epoch | **用户消息不过 epoch 门卫**，永远作数；门卫只过滤内部投递（child_result / system_notice） |
| 4 | 打断粒度 | **只有树级一种**：打断 = 整会话回 idle + 子 agent 全销毁 + 执行中任务全取消；wire 协议不设按 task_id 的子树打断帧 |
| 5 | Outcome 分类器 | **确定要做**，形态见第五节；`cancelled` 必须携带 `tree_wide` 标记，局部取消必须向上投递 |
| 6 | 落地顺序 | Event 补字段 → 分类器 → TaskRegistry → mailbox 化（单 agent）→ spawn（多 agent），见第十一节 |

## 四、数据结构

每个 AgentNode 挂一个队列 + 一个常驻消费者协程，就这两样：

```python
@dataclass(frozen=True)
class Envelope:
    message_id: str
    kind: Literal["user_message", "child_result", "system_notice"]
    sender: str          # "user" | child_agent_id | "scheduler"
    payload: dict        # 文本/附件/子 agent 的 Outcome 摘要
    epoch: int           # 产生该消息的 run 的起始 epoch（决策 2）；user_message 可不携带
    enqueued_at_ms: int

class AgentCell:         # 每个 agent 一份
    node: AgentNode      # agent_id / parent_id / spec
    lifecycle: Literal["persistent", "single_shot"]   # 主 agent / 子 agent，数据字段非代码分支
    mailbox: asyncio.Queue[Envelope]
    actor_task: asyncio.Task   # 常驻消费循环，随树销毁
    state: Literal["idle", "running", "closed"]
```

**打断不是 Envelope**。cancel 是控制面信号，走 `TaskRegistry.cancel_subtree()` 直接砍
asyncio.Task；放进 mailbox 会排在队尾等前面消息处理完，语义就错了。mailbox 只装数据面的
"待办输入"。

## 五、Outcome 分类器

### 本质

把"错误怎么处置"从异常控制流（try/catch）里剥出来，变成一份数据（封闭枚举），
让处置决策集中在唯一一个消费点（actor_loop 的 match）。

- 边界**以内**（provider / tool / runner）照样用 try/catch，但职责降级为两件事：
  清理资源（finally 关连接、杀进程）+ **翻译**（把异常翻成分类），不做"接下来怎么办"的决策
- 边界**以外**只有一个消费者，拿着分类做全部处置决策：投不投给父、重不重试、销不销毁

解耦账：N 种错误来源 × M 种处置动作，try/catch 是 N×M 散落各层；分类器是 N→K 翻译
（K = 分类数，4 类）+ K 个处置分支集中一处。新增错误来源只改翻译层，新增处置策略只改
消费层——两个方向都回到"改一个能力只动一处"。

**分类law**：分类必须按"处置方式的差异"划分，不按"错误从哪来"划分。凡是两种错误处置
完全相同，就合并成一类——这条规则保证枚举封闭且小。

分类器不取代 try/catch，二者是两层：try/finally 留在机制层管资源清理（只能靠控制流，
如 cancel 时杀 PID）；分类器在策略层管"发生了什么、上层怎么响应"。

### 形态

```
Outcome
├─ completed                                  → 向上投递 child_result / 推 UI
├─ cancelled(reason, tree_wide)               ← 控制面，不是错误，绝不重试
│    reason ∈ {user_interrupt, parent_cascade, watchdog_timeout}
│    tree_wide=True （user_interrupt / parent_cascade）→ 不投递（父自己也被砍）
│    tree_wide=False（如 watchdog 杀单个子）→ 必须上投带 cancelled 标记，
│                                              否则父在 idle 里永久悬等
├─ failed(error_class)                        ← 错误面，按 class 决定可否重试
│    class ∈ {llm.auth, llm.rate_limit, llm.protocol_400, tool.execution, internal.bug}
│    → 必须向上投递失败（父有权知道子挂了）
└─ budget_exhausted(max_turns | token_limit)  → 向上投递部分结果 + 耗尽标记
```

关键立场：**cancelled 不属于 error**——控制面与错误面并列于同一分类器，处理策略族完全
不同。约束 16 的 metadata（cancelled_at_turn / cancel_reason）已是翻译层雏形，本重构补上
消费者。投递与否取决于两个维度的组合：控制面/错误面 × **取消源是否树级**，不能只看前者。

## 六、actor_loop（最终版）

```python
async def actor_loop(cell: AgentCell) -> None:
    try:
        while True:
            env = await cell.mailbox.get()        # idle 态挂在这里，零开销
            # epoch 门卫：只过滤内部投递；用户消息永远作数（决策 3）
            if env.kind != "user_message" and env.epoch < cell.tree.epoch:
                continue                          # 只记账（emit 丢弃事件），不触发 run
            batch = drain_same_epoch(cell.mailbox)  # 同世代积压消息合并注入同一个 run
            run_epoch = cell.tree.epoch           # ← run 启动时盖章（决策 2）
            cell.state = "running"
            run_task = asyncio.create_task(cell.run_fn(seed_from(env, batch)))
            registry.register_run(run_task, cell)   # cancel_subtree 的靶子是 run_task，不是 actor_task
            try:
                result = await run_task           # 约束 16：cancel 收口成 Result，不 raise
            except Exception as exc:              # runner 内部 bug 兜底，防 actor 永久失聪
                result = internal_failure_result(exc)
            match classify(result):
                case Completed():                     deliver_up_or_ui(cell, result, epoch=run_epoch)
                case Cancelled(_, tree_wide=True):    emit_only(result)      # 不投递
                case Cancelled(r, tree_wide=False):   deliver_up_or_ui(cell, cancelled_notice(r), epoch=run_epoch)
                case Failed(err):                     deliver_failure_up(cell, err, epoch=run_epoch)
                case Exhausted(budget):               deliver_partial_up(cell, result, budget, epoch=run_epoch)
            if cell.lifecycle == "single_shot" and registry.no_live_descendants(cell):
                break                             # 存亡由 lifecycle 决定，不靠 cancel 链
            cell.state = "idle"
    finally:
        registry.close_cell(cell)                 # 树销毁 cancel actor_task 时同样保证注销
```

要点：

- **idle 就是 `await queue.get()`**，不轮询、无后台开销。
- **cell.run_fn 是 run 的实现，不承诺是 LLM**。主/子 agent 的 run_fn = `runner.run`；
  policy actor（见第八节）的 run_fn = 确定性策略函数。actor 抽象的最小承诺只有三条：
  mailbox 串行消费、spawn 派生、Outcome 上投。
- **cancel 与 lifecycle 正交**：cancel 的职责是停止正在进行的工作（砍 run_task、杀 PID），
  到此为止；actor 本体存亡由 lifecycle 决定——`persistent`（主 agent）任何终态后回 idle，
  `single_shot`（子 agent）终态且无存活子孙后退出并注销。"打断后主 agent 存活回 idle"
  是正确语义（打断 ≠ 销毁主 agent）；"子 agent 全销毁"靠 single_shot 退出条件实现。
- **退出条件写通用式** `run 终态 ∧ 无存活子孙`：v1 深度=1 时"无存活子孙"恒真、零成本，
  将来放开递归深度不改这行代码（决策 1 的扩展性落点）。同理 `deliver_up` 只在满足同一
  条件时才把结果当"最终结果"投父，防止"派出孙 agent 的中间 run"被误投为完成。
- **actor_loop 永不被单独 cancel**（只随树销毁），否则 agent 永久失聪、mailbox 静默堆积。
- **drain 合并是策略位**：用户在 A running 期间连发两条，A 空闲后合成一个 run（省 LLM
  调用、上下文更连贯）；child_result 和 user_message 混排时合并注入同一个 run——
  "用户刚说的话 + B 刚回来的结果"一起给模型看，比拆两个 run 语义好。合并的消息必须带
  origin/agent_id 标注，防 LLM 把子结果误读为用户发言。

## 七、打断链完整设计

打断语义（决策 4）：**会话回 idle + 子 agent 全销毁 + 执行中任务全取消**，只有树级一种粒度。

### epoch：时间面的门卫

cancel 不是瞬时的：打断进行中，某个子的 runner 可能恰好跑完、其收尾代码正把结果投进父
mailbox，父回 idle 后看到消息又跑起来——用户视角"打断后 agent 自己复活说话"。对策：

- 打断瞬间树的 interrupt epoch +1
- **epoch 在 run 启动时捕获**（决策 2），run 的一切产物继承起始 epoch。这样"run 在打断前
  完成、投递发生在打断后"的缝隙 envelope 带的仍是旧 epoch，被门卫拦下——盖章时机若改成
  投递入队时刻，这条缝隙就是漏洞
- 门卫只拦内部投递，**用户消息不参与世代**（决策 3）：打断清场的是"打断前的世界产生的
  内部消息"，用户的话永远作数
- 打断同时清空 mailbox 中已排队的内部消息（child_result / system_notice），epoch 门卫
  兜底"清场后才投进来的旧世代消息"
- spawn 必须**先原子登记 TaskRecord(pending) 再返回 tool_result**；cancel_subtree 时
  registry 置关门标志拒绝新登记，防 dispatched 与登记之间的打断漏杀孤儿子

### 三段时间线：打断落点决定处理方式

以"子结果触发父 run，父 run 调 LLM"为例，cancel 可能落在三段：

| 段 | 状态 | 正确处理 |
|---|---|---|
| 1. child_result 已进父 mailbox，父 run 未启动 | 消息在队列 | **消费侧抛弃**：purge 队列 + epoch 门卫兜底 |
| 2. 父 run 已启动，LLM 推理中，本地在 await | 回复在途 | **不需要抛弃逻辑**：cancel run_task → CancelledError 在 await 挂起点炸开 → httpx 连接随协程取消关闭，回复永不成为消息。约束 16 收口 + 占位配对。损失仅服务器侧已推理算力 |
| 3. 父 run 已跑完，回复已 append 进 session、已推 UI | 既成事实 | **必须不抛弃**：session 已提交的 assistant 消息和 tool_use/tool_result 配对不可回滚，否则 LLM 上下文与用户所见分裂 + 配对链撕开（400 风险）。该抛弃的只有此 run 完成后**向上投递的 envelope**——带旧 epoch 绕回段 1 被拦截 |

细节两条：asyncio 无"帧"，cancel 生效点是下一个 await 挂起点，纯同步代码段要等让出才落地；
段 2 流式场景 UI 可能已收到半截 delta，前端须标记 interrupted 而非静默截断
（interrupt-run-v0.1 已覆盖，重构时保住）。

### 三个正交机制各管一面

- **分类器 = 语义面**：发生了什么、上层怎么响应
- **epoch = 时间面**：这个结果还作数吗（过时性是消息与打断的相对时序属性，不在 Result 里）
- **registry = 资源面**：还有什么占着没还（bash 进程、httpx 流不随 Python 值分类而回收）

### 打断不变量（一句话）

> **打断只阻止未来，不回滚过去。抛弃动作全系统只存在一个位置——mailbox 消费侧的 epoch
> 门卫；进行中的靠 cancel 使其"永不到达"；已提交的一律保留。**

抛弃点若错放到网络接收层或 UI 层，会出现 session 有回复但用户没看到（或反之）的状态分裂。

## 八、TaskRegistry：唯一的资源账本

每棵会话树一个 TaskRegistry。**记账范围取最小集**——只登记两类东西：

1. **run 级 asyncio.Task**：cancel_subtree 的靶子
2. **穿越 asyncio 取消传播边界的外部资源**：bash PID（kill()+wait() 兜底）、detach 任务

```python
TaskRecord(task_id, agent_id, parent_task_id, kind, status, handle, resources)
  kind ∈ {agent_run, external_process, detach}
```

llm_call / tool_call **不登记**：run_task 被砍时它们沿 await 链自动死（这正是选 asyncio 的
最强理由），登记成靶子是冗余；审计与前端画树消费 Event 流（补 agent_id 后信息完备），
registry 不做第二套 trace。

`cancel_subtree(root_task_id)`：置关门标志 → 后序遍历，先杀叶子外部资源、再 cancel 子的
run_task、再 cancel 父 run_task → 树 epoch +1 → purge 各 mailbox 内部消息 → 取消子树
pending approval future。

策略位：树销毁时 `detach=True` 的后台任务（如 cron 派生）豁免级联杀，但必须有归宿
（转移 orphan registry 或强杀），不定义则进程泄漏。

## 九、spawn 原语与 workflow 收编

### spawn（v1）

- 深度配置固定 1 层（决策 1）：子 agent 的 toolset 不含 spawn，或 spawn 执行时查 registry
  深度直接返回错误 tool_result
- 子 agent = `single_shot` AgentCell：独立 session_id、独立 prompt/tools/skills，
  结果投递后即注销（session 归档不复用）；结构与主 agent 完全同构，零代码区分
- 现有 SubAgentManager 从"自己管生命周期的旁路"收编为 spawn 原语的实现细节，
  SubAgentLifecycleRegistry 合并进 TaskRegistry，消除双账本

### workflow = policy actor（run ≠ 必然是 LLM）

现有 workflow（map_reduce 等）是**确定性代码编排**：并发 fan-out、超时预算、shard 校验、
失败聚合全是代码逻辑，编排环节零 LLM 参与。收编方式**不是**"变成一个 LLM agent 按剧本
行事"（那会让每步转移多一次 LLM 调用且丢确定性，是功能回退），而是：

> workflow 编排器 = 一个 `run_fn` 为确定性策略函数的 actor。它同样收 mailbox 消息、
> 同样用 spawn 派生 mapper、同样经 registry 记账、同样按 Outcome 上投——共享打断链、
> 账本、用量上卷的全部机制，只是 run 内部不调 LLM。

这不破坏"代码零区分"：actor 抽象承诺的是 mailbox 串行消费 + spawn 派生 + Outcome 上投，
从不承诺 run 内部是什么。`runner.run` 只是 run_fn 的一种实现。

深度交互：workflow 编排器 spawn mapper 已占 1 层，若编排器本身又是主 agent spawn 出来的
则需要深度 2——因此 **workflow 收编排在 v1 之后**，等深度配置放开或编排器以树根身份运行
时落地。v1 只完成 SubAgentManager 收编 + 保持 workflow 现状运行。

## 十、审批 / 用量 / 流式 / journal

### 审批按会话路由，不区分 agent，子规则 = 父规则

现有 per-thread approval inbox 结构直接沿用（会话 = thread = 树），改动收敛为：

- 子 agent 的 runner 装配时**共享树的同一个 ApprovalManager / bridge**（不再自装一套）
- 审批请求携带 agent_id 仅作展示归属；`ApprovalManager._pending` 是 dict，天然支持
  父子同时挂多个 pending
- 审批是控制面，绕过 mailbox 直达会话级 inbox，与 run 串行性解耦（否则父在跑 run 时子的
  审批请求排队挂死，父子同时等审批则互等活锁）
- cancel_subtree 时一并取消子树 pending approval future，否则 inbox 留幽灵审批项；
  `WebHostAdapter.prompt_approval` 的 CancelledError 必须 raise（约束 16 既有规则）

### 用量：per-agent 分桶 + 会话上卷

Event 补 agent_id 后，usage 按 agent_id 分桶存储，会话维度上卷汇总——既能单看某个子
agent 花了多少，也能审计整棵树总账。`UsageTokenManager`（当前按 thread 单维度）加聚合维度。

### 流式帧第一天带 agent_id

Web 渲染子输出当前收缩显示、可不消费，但 wire 协议第一天就在流式帧上带 agent_id
（成本≈0）；否则以后做"展开看子 agent 实时干活"要动协议真源两侧（约束 17），迁移成本
远高于现在留字段。

### 崩溃恢复：journal 两阶段

mailbox 是内存队列，进程挂了未消费消息就丢。用户消息可接受（WS 断连用户能感知重发），
child_result 不可接受：

- 子 agent 的结果**先落盘 journal 再投递**；"child_result 落盘 → 父消费 → 写 consumed
  标记"，按 task_id 幂等去重，防重放时父重复注入同一结果
- 树结构入 journal，重启时把 in-flight 标记 orphaned（否则 Web 端出现幽灵"运行中"）
- 恢复时扫描 history 补未配对 tool_use 的占位 tool_result，否则重启后首次 LLM 调用被 400 拒

### 预算控制

spawn 扇出数、子树 token 总额必须有硬上限（深度 v1 已固定 1）。child_result 触发父 run
意味着派 N 个子至少产生 N 次父 LLM 调用，drain 合并是主要止血阀。

## 十一、落地顺序（5 步，每步独立可测、可单独提交）

顺序的铁律：**mailbox 是地基，spawn 是住户，住户不能先于地基进场**——B 向 A 报告的唯一
通路是 A 的 mailbox，先做多 agent 就得发明临时回调通道，loop 重构落地时整体推翻重写。

1. **Event 补 agent_id / task_id / conversation_id**。纯加法零行为变更（单 agent 时
   agent_id 为固定值），下游（registry 记账、用量分桶、前端画树）全部消费这几个字段。
2. **分类器（Outcome + classify）**。叶子依赖：只吃现有 `Result`（约束 16 的 cancelled
   收口已是翻译层雏形），不依赖 mailbox 也不依赖 registry。先让现有消费点（ThreadCell
   run 收尾回调、SessionBridge）改吃 Outcome 分发——它是 actor_loop 的输入类型，
   接口先于实现。
3. **TaskRegistry + cancel_subtree**。先在"树上只有根节点"的退化形态下工作：登记 run 级
   task + 外部资源，Web InterruptFrame 从 cancel current_run_task 改为 cancel_subtree。
   单 agent 时行为等价、风险极低，但账本、kill+wait 兜底、关门标志提前吃真实流量。
4. **loop 重构（mailbox 化，仍单 agent）**。ThreadCell 演化为 AgentCell：挂 mailbox +
   常驻消费协程，用户消息走 mailbox 入队。专门验证串行消费、epoch 门卫、drain 策略、
   Outcome 分发闭环——所有难竞态在没有多 agent 干扰的最简环境先跑通。
5. **多 agent（spawn 原语）**。纯组合工作：spawn = 建 AgentCell（步骤 4 产物）+ 登记
   registry（步骤 3 产物）+ Outcome 上投（步骤 2 产物）。收尾清单：SubAgentManager 收编、
   审批 bridge 共享、用量分桶、wire 协议加树帧与流式 agent_id。

## 十二、技术选型

**内核：Python + asyncio，不换。** ① 负载纯 IO-bound（LLM 调用、子进程、文件），单事件
循环足够，"多线程"是伪需求——真并发点只有 CPU 密集工具，丢 ProcessPoolExecutor/子进程；
② asyncio cancellation 沿 await 链自动传播，与打断链一比一映射（tokio 要手动织
CancellationToken）；③ Runner/Session/EventSink/Safety 全套已在 Python，重写零收益；
④ LLM/MCP 生态最全。

**跨平台：内核 headless 服务，三宿主薄壳。** CLI 进程内挂 adapter；Web 走现有
FastAPI+WS；Tauri 用 sidecar 带打包 Python 内核（packaging/ x-space sidecar + ready JSON
契约即为此准备）。三端共享 wire 协议（约束 17 双侧真源），需新增：agent 树快照、
agent.spawned/completed、树级 interrupt 帧、agent 主动推送（B 完成后 A 无人提问也要出
消息——CLI 异步打印、Web 渲染非用户触发消息，三端 UI 共同的新语义）。

## 十三、代码库冲突清单（落地要动的点）

| 现状 | 冲突 | 改动方向 |
|---|---|---|
| `Runner._seed_messages` 只吃单条 user_input | 无法合并注入 user_message + child_result | seed 改为接受消息数组 |
| `ThreadCellStatus` 四态，RUNNING/IDLE 从 `current_run_task` 现算 | 表达不了"主 idle 但子树 running" | 加树维度状态，**保持派生**（从 registry 现算，不落字段——沿用 cell.py"避免多点手工同步漂移"原则）；InterruptFrame 改 cancel_subtree |
| `ApprovalInboxBroadcaster._bridge_registry` thread→bridge 一对一 | 子 agent 审批无通道 | 子 runner 共享树 bridge，请求带 agent_id |
| `Event` 只有 run_id | 前端画不了树、用量分不了桶 | 补 agent_id / task_id / conversation_id |
| `UsageTokenManager` 按 thread 单维度 | 子用量无法区分与上卷 | 按 agent_id 分桶 + 会话上卷聚合入口 |
| `SubAgentManager` 与 `AgentWorkflowStrategyManager` 两套独立入口 | 正是要消灭的双机制 | v1 收编 SubAgentManager 进 spawn；workflow 收编为 policy actor 排 v1 之后 |
| compactor `_filter_middle` 保留 user role 消息 | child_result 注入 user role 可行，但 provider 层 role 交替约束需补偿 | InputAssembler 前做 role 序列补偿；child_result 做成显式 harness 消息格式并在 system prompt 声明协议 |
| Session file/sqlite 后端单写者假设 | 父子各写各的 session 无冲突 | 确认不共享连接池即可 |

## 附录：已否决方向（防回潮清单）

| 否决项 | 一句话理由 |
|---|---|
| `spawn(wait=True)` 同步派出 | 死锁（子结果唯一通路是父 mailbox，父阻塞在 run 里不会 get）+ 违反"只有一套调用方式" |
| 按 task_id 的子树打断帧 | 与树级 epoch 不兼容（误杀无关子树在途投递）；v1 无子树级打断需求，一个粒度配一个树级计数器最简 |
| epoch 门卫无差别过滤所有旧世代消息 | 会静默吞掉打断前一瞬的用户消息；用户的话永远作数 |
| envelope 在投递入队时盖 epoch 章 | "run 在打断前完成、投递在打断后"的缝隙 envelope 会带新 epoch 穿过门卫——必须 run 启动时盖章 |
| cancelled 一律不向上投递 | watchdog 等局部取消掐断唯一通路，父永久悬等；投递与否取决于取消源是否树级 |
| single_shot "任何终态即退出" | 与递归 spawn 冲突（B 派 C 后中间 run 结束即销毁，C 成果丢失）；退出条件 = 终态 ∧ 无存活子孙 |
| registry 登记 llm_call / tool_call | 与 asyncio 取消传播重复（自动死）、与 Event 流重复记账；账本按"cancel 需要 + 资源回收需要"取最小集 |
| workflow = LLM agent 按剧本连续 spawn | 每步转移多一次 LLM 调用 + 丢确定性，是功能回退；正解 = policy actor（run_fn 为策略函数） |
| 打断信号走 mailbox | 排队尾等前面消息处理完，语义错误；cancel 是控制面，绕 mailbox 直砍 task |
| cancel actor_loop 本体 | agent 永久失聪、mailbox 静默堆积；cancel 只砍 run_task，actor 存亡由 lifecycle 决定 |
