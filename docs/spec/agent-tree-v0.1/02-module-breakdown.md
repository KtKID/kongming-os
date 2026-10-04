# 模块拆分

## 模块总览

| 模块 | 职责 | 为什么需要 | 判断依据 | 依赖 | 缺失后果 | 状态 | 备注 |
|------|------|------------|---------|------|----------|------|------|
| A · AgentManager | 主+子 agent 生命周期门户；spawn 原语；cancel_subtree | 统一 agent 抽象的对外入口，收编双账本 | 需求要点 1 | B/C + Runner | spawn 无门户、概念分裂 | 可进入 x-req | 高风险 |
| B · TaskRegistry | 资源账本（agent_run + external_process）；cancel_subtree 后序砍靶；关门标志 | 账本面三分的载体；登记先于暴露 | 不变量登记先于暴露 | 无 | 漏杀孤儿子、kill 无账本 | 可进入 x-req | 中风险 |
| C · Mailbox + agent_loop | 串行驱动内核；Mail 入出队；epoch 门卫；Disposition 按 action 二选一分发 | 数据面三分的载体；最难竞态集中 | 约束 16 + 唯一 run loop | D + Runner | 主 agent 阻塞、复活说话 | 可进入 x-req | 高风险，先 PoC |
| D · run 终态分类器 | Result → Disposition（action+reason）；处置集中到 agent_loop action 二选一 | cancelled 从异常剥成数据 | 约束 16 | Result | cancelled 失语、action 无依据 | 可进入 x-req | 低风险 |
| F · 审批 agent_id 维度 | _PendingApproval 加 agent_id；子 runner 共享 bridge；取消子树 pending future | 审批是控制面绕 mailbox | 需求要点 9 | ApprovalManager | 子审批挂死、归属丢失 | 可进入 x-req | 低风险 |
| G · Event/wire 协议扩展 | Event 补坐标字段；流式帧带 agent_id | 双侧真源同步、流式首日带 agent_id | 约束 17 + 需求要点 14 | wire 协议模型 | 运行时漂移崩溃 | 可进入 x-req | 中风险 |
| H · 统一时间工具 | 收编散落 epoch-ms helper，提供 tz-aware `now_epoch_ms()` / `now_iso()` | 消除 naive `int(time.time()*1000)` 散落，时间戳来源单一 | 现状 ~8 处散落 helper + ~20 处 inline 无时区 | 无 | 时间戳口径不一致、调试困难 | 可进入 x-req | 低风险 |

> 注：原模块 E「ConversationTree」已删除——用户决策「ThreadCell 就是 tree，不需要新增」。epoch/registry/event_sinks 的 owner 职责并入 ThreadCell（见 `./04-data-and-state.md` ThreadCell 演进段落）。模块数 8→7。

## 模块边界原则

- 每个模块对外暴露一个边界类作为唯一入口：资源/生命周期域用 `<模块>Manager`（AgentManager / TaskRegistry）、外部系统/协议用 `Event`/wire 协议模型、纯函数模块（run 终态分类器）无独立 Manager；树态 owner 职责并入 host 装配层 ThreadCell（不单列模块，非 Manager）。
- 模块内功能由边界类收口调用；跨模块通过边界类调用。
- 模块外代码只 import 边界类；内部实现放在私有文件或未导出模块。
- mailbox/agent_loop 无独立 Manager（属 AgentCell 内部 + AgentManager 编排），对外暴露 AgentCell。
- 数据面（mailbox）/控制面（审批/打断）/账本面（registry）严格三分，三者不得共通道。

## 模块详情

### 模块 A：AgentManager

**职责**：管理主+子所有 agent 的创建、销毁、查询；spawn 原语实现；cancel_subtree 树级打断。

**为什么需要**：统一 agent 抽象需要一个生命周期门户收口创建/销毁/查询；spawn 是异步派生的唯一入口；cancel_subtree 是树级打断的唯一编排点。没有它，spawn 无门户、主/子概念分裂。

**判断依据**：需求要点 1（SubAgentManager 改名 AgentManager）；不变量「登记先于暴露」（spawn 先登记再返回）；asyncio cancellation 沿 await 链自动传播是树级打断的天然机制。

**缺失后果**：spawn 散落多处实现、主/子双套机制、cancel 漏杀孤儿子、回归测试盲区。

**边界类**：`AgentManager`（资源/生命周期域命名规范）

**包含范围**：
- `spawn(parent_id, spec, skill_names, seed_message)` — 异步派生：建 AgentCell + 登记 TaskRecord(pending) + 启动 agent_loop + 立即返回 `{child_id, status:dispatched}`。agent_id 由 AgentManager 生成（`uuid4().hex[:8]`），register 时做树内唯一性校验
- `cancel_subtree(agent_id)` — 树级打断：调 TaskRegistry.cancel_subtree（后序砍靶）+ bump epoch + mailbox purge
- `get_agent(agent_id)` / `list_agents()` / `list_children(agent_id)`
- `register_cell(cell)` / `unregister_cell(agent_id)` — AgentCell 注册表（在 ThreadCell.registry 之上的语义层）
- `close_cell(agent_id)` — single_shot 终态且无存活子孙时注销 + 关 mailbox

**cwd / role_id 解析**：spawn 时由 AgentManager 从 SubAgentTask（迁移期）或新 spawn 参数解析并填入 AgentCell.cwd / AgentCell.role_id。主 agent 的 cwd=进程 cwd、role_id=None；子 agent 的 cwd 不是父 cwd，是 workflow 层按 task 新建的 `agents/<task_run_id>/work/`，role_id=AgentRolePreset 查询键。现状 cwd 散落在 `SubAgentTask.metadata["working_dir"]/["task_run_dir"]` + `SubAgentGrant.working_dir`（`repo:src/application/subagents/permissions.py:39`）；role 散落在 `SubAgentTask.agent_role_id` + `ResolvedSubAgentRuntime.role_id/role_nickname/role_description`（`repo:src/application/subagents/runtime_resolver.py:31-33`），提为一等字段后由 AgentCell 统一持有。

**不包含范围**：
- run loop 内部（调 `repo:src/core/runner.py::Runner.run`，不改 turn loop）
- 审批决策（归 F，SafetyGatedApproval 不变）
- 用量计算（随 task 自动死，分桶归 task-5）

**依赖**：TaskRegistry（B，账本登记）、ThreadCell（树态 owner，agent_loop 通过启动参数接收 current_tree_epoch，不直接持有 ThreadCell 引用）、Runner（run_fn）、run 终态分类器（D，分发消费）、Mailbox/agent_loop（C，cell 内部）

**复用/新建**：收编 `repo:src/application/subagents/manager.py::SubAgentManager`（淘汰阻塞语义 `run_task` 同步 `await runner.run(...)`）+ `repo:src/application/subagents/lifecycle.py::SubAgentLifecycleRegistry`（合并进 TaskRegistry）。审计字段（status/started_at/finished_at/error_message）迁移到 TaskRecord。**新建** AgentManager + AgentCell。

**数据结构/接口**：

```python
# 对外暴露：AgentManager（边界类）
class AgentManager:
    def spawn(self, parent_id: str | None, spec: AgentSpec,
              skill_names: tuple[str, ...], seed_message: Message) -> SpawnResult: ...
    async def cancel_subtree(self, agent_id: str) -> None: ...
    def get_agent(self, agent_id: str) -> AgentCell | None: ...
    def list_agents(self) -> list[AgentCell]: ...
    def list_children(self, agent_id: str) -> list[AgentCell]: ...

# SpawnResult — spawn 同步返回值（不阻塞）
@dataclass(frozen=True)
class SpawnResult:
    child_id: str            # 新建子 agent_id
    status: Literal["dispatched"]  # 固定 dispatched，子结果走 child_result
```

**风险等级**：高

**风险类型**：可行性（cancel 时序竞态）

**风险说明**：cancel_subtree 与 spawn 登记存在竞态——若 cancel 在 spawn「返回 tool_result」与「登记 TaskRecord」之间发生，会漏杀孤儿子；cancel 与父 run 跑完同时发生（段 3）需 epoch 门卫兜底。

**风险判断依据**：不变量「登记先于暴露」；第一性原理推导的打断链三段时间线。

**风险缺失后果**：孤儿子泄漏、复活说话、session 分裂。

**PoC 建议**：单 agent 退化形态（task-3）先跑通 cancel_subtree 后序 + 关门标志 + kill+wait 兜底，再在 task-5 组合多 agent。

**task 建议**：
- 建议 task 名：`agent-tree-spawn`（task-5）
- 对应 DoD：DoD-1, DoD-2, DoD-3, DoD-8
- 是否进入 x-req：是（依赖 task-1~4 产物）
- 原因：高风险主链路，需组合前置产物；单 agent 形态（task-3/4）先行降险

---

### 模块 B：TaskRegistry

**职责**：资源账本，登记 agent_run task + external_process（bash PID）；cancel_subtree 后序遍历砍靶子；关门标志拒绝新登记。

**为什么需要**：账本面三分的载体。spawn 必须「登记先于暴露」防止漏杀；cancel 必须有账本才能后序遍历砍靶 + kill+wait 兜底。没有它，cancel 无靶子可砍、孤儿子泄漏。

**判断依据**：不变量「登记先于暴露」+「cancel 与 lifecycle 正交」（cancel 砍 run_task/杀 PID，TaskRegistry 只管这两类 kind）；需求要点 12（只 2 种 kind，无 detach）。

**缺失后果**：cancel 无账本可遍历、kill 漏掉 PID、关门失效导致孤儿子。

**边界类**：`TaskRegistry`（资源/生命周期域命名规范）

**包含范围**：
- `register_run(task: asyncio.Task, agent_id, parent_task_id)` → TaskRecord
- `register_external(pid: int, agent_id, parent_task_id)` → TaskRecord
- `async cancel_subtree(agent_id)` — 后序遍历：先砍子孙 run_task（asyncio cancellation 沿 await 链），再 kill+wait external PID 兜底
- `close_registry()` — 置关门标志，拒绝新登记（防 dispatched 与登记间的打断漏杀）
- `no_live_descendants(agent_id)` — single_shot 退出条件判定

**不包含范围**：
- llm_call / tool_call 登记（随 task 自动死，不单独登记）
- 审计事件流（Event 已覆盖，需求要点 11）
- agent 本体存亡决策（归 lifecycle，cancel 只砍 task/PID）

**依赖**：无（被 AgentManager 调用；纯账本）

**复用/新建**：**新建**；审计字段（status/started_at/finished_at/error_message）迁移自 `repo:src/application/subagents/lifecycle.py::SubAgentLifecycleRecord`。

**数据结构/接口**：

```python
class TaskRegistry:
    def register_run(self, task: asyncio.Task, agent_id: str,
                     parent_task_id: str | None) -> TaskRecord: ...
    def register_external(self, pid: int, agent_id: str,
                          parent_task_id: str | None) -> TaskRecord: ...
    async def cancel_subtree(self, agent_id: str) -> None: ...
    def close_registry(self) -> None: ...          # 关门标志
    def no_live_descendants(self, agent_id: str) -> bool: ...

# PidHandle — external_process 的 kill 靶
@dataclass
class PidHandle:
    pid: int                 # 进程 PID
    kind: Literal["bash", "other"]
```

**风险等级**：中

**风险类型**：可行性（kill+wait 兜底正确性）

**风险说明**：external_process 的 kill+wait 顺序错误会导致僵尸进程或竞态；关门标志需在 cancel_subtree 入口置位，登记侧需 double-check。

**风险判断依据**：Python asyncio + subprocess kill 语义；不变量登记先于暴露。

**风险缺失后果**：僵尸进程堆积、孤儿子漏杀。

**PoC 建议**：单 agent 退化形态（task-3）先跑通 register/cancel_subtree/close_registry/no_live_descendants，kill+wait 用真实 subprocess 验证。

**task 建议**：
- 建议 task 名：`agent-tree-task-registry`（task-3）
- 对应 DoD：DoD-3
- 是否进入 x-req：是
- 原因：账本是地基，被 A 依赖，单 agent 退化可独立测

---

### 模块 C：Mailbox + agent_loop

**职责**：Mail 入队/出队；agent_loop 常驻消费协程；epoch 门卫过滤旧世代内部投递；Disposition 按 action 二选一（上投/不上投）。

**为什么需要**：数据面三分的载体。mailbox 把外部世界并发（用户随时说话、子 agent 随时完成、cron 随时触发）压成该 agent 的严格串行输入流；「agent 同一时刻只跑一个 run」是结构必然（run 只能从队头取一条消息开始）。没有它，主 agent 阻塞、复活说话、epoch 门卫无处安放。

**判断依据**：约束 16（cancelled 收口成 Result，agent_loop await run_task 不 raise）+ 唯一 run loop（Runner 继续作 run_fn）+ 不变量「打断只阻止未来」→ epoch 门卫只在 mailbox 消费侧抛弃。

**缺失后果**：主 agent 阻塞（无 mailbox 无法并发）、复活说话（无 epoch 门卫旧投递被消费）、agent_loop 失聪（被单独 cancel）。

**边界类**：无独立 Manager（属于 AgentCell 内部 + AgentManager 编排）；对外暴露 `AgentCell`。

**包含范围**：
- **双 queue**：`user_inbox: asyncio.Queue[Mail]`（用户消息专用 lane）+ `agent_inbox: asyncio.Queue[Mail]`（child_result / system_notice lane）。Mail 按 `kind` 路由：`user_message` → user_inbox；其余 → agent_inbox。一个单 FIFO queue 把"到达顺序"和"紧迫性"耦合了，物理上做不到优先级；双 queue 是结构必然解。
- `async agent_loop(cell, *, current_epoch_getter)` 常驻协程：**先 drain user_inbox 全部** → `wait_either(user_inbox, agent_inbox)` 合并等两个 queue → 取到 mail → epoch 门卫 → run_task → classify_result → deliver → idle/退出
- epoch 过滤逻辑：`mail.kind != "user_message" and mail.epoch < current_epoch_getter()` → 丢弃。**epoch 用 getter 实时读**，不用启动时的 int 快照——cancel_subtree 的 `bump_epoch()` 后 int 快照不变会导致门卫失效；getter 才能立刻看到新值（详见下方"epoch 传参方式"决策）。
- classify_result → Disposition → 按 action 二选一（emit_only=不上投 / deliver_up=上投）
- run_epoch 在 run 启动时捕获（= mail.epoch，对内部投递；user_message 不过门卫取 0），该 run 的 Event/Disposition/上投 Mail 全继承

**不包含范围**：
- run loop 内部（调 `repo:src/core/runner.py::Runner.run`，不改 turn loop）
- 审批路由（审批绕 mailbox，归 F）
- Disposition 类型定义（归 D，C 只消费）
- 立即发送（post-v1，需求要点 17：复用 cancel 机制，不写新机制）

**依赖**：run 终态分类器（D）、Runner（run_fn）；epoch 经 Mail.epoch 携带 + current_epoch_getter 注入参数（不直接依赖 ThreadCell，避免循环依赖）

**复用/新建**：**新建**（mailbox + agent_loop）；AgentCell 新建。

**数据结构/接口**：

```python
# Mail — mailbox 传输信封（新建）
@dataclass(frozen=True)
class Mail:
    kind: Literal["user_message", "child_result", "system_notice"]
    sender: str              # 发送者：B 完成时=B 的 agent_id；用户输入="user"；cron="scheduler"
    recipient_agent_id: str  # 接收者：投进谁 mailbox 就是谁；支持第三方投递（sender≠recipient，如 cron 投给 A）
    task_id: str             # 关联 spawn 的 TaskRecord.task_id；user_message="";child_result 时父消费可回溯哪个 spawn 调用
    epoch: int               # 产生该 mail 的 run 起始 epoch；user_message 不过门卫
    payload: Message         # 复用 Message（无 author 字段，provenance 走 metadata['source_agent_id'] 软键）
    enqueued_at_ms: int = field(default_factory=now_epoch_ms)   # 用统一时间工具（tz-aware）

# agent_loop 伪代码见 ./diagrams.md#模块-c-mailbox--agent_loop（流程图）
```

**字段语义**：`sender` 是消息的产生者（B 完成→B 的 agent_id；用户输入→"user"；cron→"scheduler"）；`recipient_agent_id` 是目标 agent（投进谁 mailbox 就是谁）——A 的 mailbox 里大部分 mail recipient=A，但第三方投递（cron 投给 A、跨树投递）会出现 sender≠recipient，故每条 mail 都明确带 recipient，物理落点和字段一致。`task_id` 关联 spawn 的 TaskRecord，让父消费 child_result 时能回溯是哪个 spawn 调用。

**风险等级**：高

**风险类型**：可行性（最难竞态集中地：epoch 盖章时机、三段时间线）

**风险说明**：epoch 盖章必须在 run 启动瞬间捕获（run_epoch = mail.epoch，对内部投递），若盖章晚于 cancel bump 则旧 run 的上投 mail 无法被拦截；三段时间线（段1 队列/段2 run 在途/段3 session 已提交）任一处理错都会复活说话或 session 分裂。

**风险判断依据**：第一性原理推导的打断链三段时间线；约束 16 收口后 cancelled 在 runner 之上必须手工重建传播。

**风险缺失后果**：复活说话（B 恰在 cancel 瞬间完成，旧 epoch 结果被 A 消费）、agent_loop 失聪、session 与用户所见分裂。

#### 双 queue 优先级（需求要点 16）

**为什么必须双 queue 而不是单 FIFO**：用户消息必须优先级最高——它来的时候，即使 agent_inbox 里已经攒着 child_result / system_notice，也要先处理用户消息。单 FIFO queue 把"到达顺序"和"紧迫性"耦合了：child_result 先到，用户消息后到，FIFO 永远先消费 child_result，结构上做不到优先级。要拆耦合，物理上就得两条 lane。

**取法**（伪代码见 `./04-data-and-state.md` agent_loop 主循环）：

```
while True:
    while not user_inbox.empty():      # 第一优先：drain user lane 全部
        mail = user_inbox.get_nowait()
        await _run_one_mail(mail)
    mail = await wait_either(user_inbox, agent_inbox)  # 都空时合并等
    await _run_one_mail(mail)            # 跑完回顶部，user 有新消息又会插队
```

`wait_either` 用 `asyncio.wait([task_a, task_b], return_when=FIRST_COMPLETED)` 同时等两个 queue 的 `get()` 协程，谁先来取谁。asyncio 单线程协作式调度，无需锁/channel。取到一个 user mail 跑完后回顶部，此时 user_inbox 若又有了新消息会先 drain，等于"用户消息天然插队到 child_result 前面"。

**为什么不进一步拆第三个 queue**：child_result 和 system_notice 都是 agent 内部协作信号，语义紧迫性同级（晚 100ms 处理不影响正确性），FIFO 在 agent lane 内足够。拆第三个是过度设计。

#### 用户消息默认不打断当前 run（不引入 should_yield）

**显式 vs 自动**：用户要干预只有两种**显式动作**——① 打断（现有 cancel 语义：砍 run + bump epoch 丢 mailbox + 收口成 `Result(cancelled)`）；② 立即发送（post-v1：cancel 当前 run 但保留已落 session 的 turn 历史，收尾后用新消息起 run）。两者都是用户点按钮触发。**agent_loop / runner 都不做"自动让行"检查——不引入 `should_yield: Callable[[], bool]` 之类的每 turn 早退信号**。run 是不可分割的处理单元，用户消息进 user_inbox 排队，等当前 run 跑到自然终态后回顶部 drain 才被处理。

**为什么不做自动让行**：should_yield 要求 Runner 的 turn 循环感知 mailbox（每 turn 顶部检查 user_inbox.empty()），这把"调度"职责泄漏进 turn loop，破坏 runner 的纯净性（runner 只管 turn 推进，不该知道 mailbox 存在）。且产品语义上"什么时候让位"应由用户决定（显式打断/立即发送），不该由 agent 自己猜。立即发送复用 cancel 机制即可，不需要新机制。

**子 agent 不受影响**：主 agent 的 `wait_either` 只读主 agent 的两个 inbox；子 agent 是独立 cell / 独立 agent_loop / 独立 run_task，用户消息进主 agent 的 user_inbox，碰不到子 agent 的 run。子 agent 跑自己的 turn 循环到自然终态。

#### epoch 传参方式修正：getter 取代启动参数 int

**原伪代码缺陷**：早期版本写 `agent_loop(cell, *, current_tree_epoch: int)`——启动时的 int 快照。但 cancel_subtree 调 `ThreadCell.bump_epoch()` +1 后，这个 int 不会变，门卫永远用旧值比较 → **门卫失效**。早期注释"cancel_subtree bump 后下次 run 取新值"自相矛盾（int 快照取不到新值）。

**修正**：改用 `current_epoch_getter: Callable[[], int]`，实时读 ThreadCell.epoch。cancel_subtree bump 后，agent_loop 下次调 getter 立刻拿到新值，门卫生效。`./04-data-and-state.md` agent_loop 伪代码与本节同步修正。

**为什么不用 asyncio.Event 通知**：epoch 门卫是"消费 mail 时做一次性比较"，不是"等 epoch 变化"。getter 同步读 + 比较，比 Event 信号量模型简单一个数量级，且不引入额外协调原语。

#### Codex `submission_loop` 同构对照（设计印证）

工业级多 agent 实现 Codex（`codex-rs/core/src/session/handlers.rs:74`）的 `submission_loop` 与本项目 `agent_loop` **架构同构**，印证分层正确：

| 维度 | Codex `submission_loop` | 项目 `agent_loop` |
|---|---|---|
| 职责 | per-agent inbox dispatcher，从 `rx_sub: Receiver<Submission>` 取 op → match 分发 → idle | per-agent inbox dispatcher，从 user_inbox/agent_inbox 取 Mail → epoch 门卫 → run → classify_result → deliver → idle |
| 碰不碰模型 | **不碰**，模型 stream 在 `run_turn` task 内 | **不碰**，turn loop 在 `Runner._drive_turns` |
| 主子分支 | loop 函数体相同，差异由 session 数据决定（SessionSource/parent_thread_id/depth） | 主子零代码分支，差异仅在 AgentCell 字段（parent_id/lifecycle/depth） |
| 子→父通信 | `Op::InterAgentCommunication` 投目标 thread mailbox + `trigger_turn` | `child_result` Mail 投父 agent_inbox |
| 取消模型 | `Op::Shutdown` 投目标 thread，loop 自然退出（**无 epoch 门卫**） | `cancel_subtree` 砍 run_task + bump_epoch + purge mailbox（**epoch 门卫必留**，因约束 16 收口 cancelled 成数据后需在消费侧按世代丢弃旧投递） |

**项目相对 Codex 的改进**：Codex 用单 channel + match 分发（所有 op 进同一 channel，FIFO），未解决优先级问题，靠"单 agent 通常 idle 等用户"掩盖。项目拆双 queue + 优先 drain user lane，**显式表达"用户消息永远最高优先级"**。两者都是"inbox dispatcher，不碰模型"，架构同构未破。

**可借鉴的演进方向（不在 v1 范围）**：Codex 的 `Op` 是带多态的 union（UserInput / InterAgentCommunication / Compact / ThreadRollback / Shutdown / 审批响应 / MCP 响应），证明"一个 inbox 吃下所有 op 类型"可行且干净。项目 `Mail.kind` 当前只 3 种（user_message / child_result / system_notice），将来支持压缩/回滚/关停/审批注入时，**正确路径是扩 `Mail.kind`，不是加新通道**——避免给 compact/rollback 各开一条独立 queue 的发散。`Mail.kind: str` 已是开放字符串，扩起来零成本。

**PoC 建议**：**强烈建议先 PoC**。目标：单 agent 退化形态跑通双 queue 取法 → epoch 门卫 → run_task → classify_result → deliver 闭环。最小验证：① 手工注入旧 epoch mail 断言被丢弃、user_message 永不过期；② user_inbox 和 agent_inbox 同时非空时，先消费 user_inbox 全部。通过标准：对抗性检验（B 恰在 cancel 瞬间完成）结果带旧 epoch 被拦截；优先级测试（用户消息晚于 child_result 到达但先被处理）。失败备选：改用 run_epoch 在 Runner 入参显式传入（而非 agent_loop 捕获 mail.epoch）。

**task 建议**：
- 建议 task 名：`agent-tree-loop-mailbox`（task-4）
- 对应 DoD：DoD-2, DoD-4, DoD-5
- 是否进入 x-req：是（建议先 PoC epoch 门卫）
- 原因：最难竞态集中地，单 agent 形态先验证 epoch 门卫再铺开

---

### 模块 D：run 终态分类器

**职责**：把 Result 翻译成 Disposition（带 action + reason + tree_wide）；处置决策集中到 agent_loop 唯一 action 二选一点。

**为什么需要**：约束 16 让 cancelled 在 runner 边界终止（变成 Result 数据值），此后必须在 runner 之上以数据形式手工重建传播。run 终态分类器就是这个重建层——把「run 终态怎么处置」从 try/catch 异常控制流剥成 Disposition 数据（classify_result 产数据不产控制流，对齐 Claude Code classify 家族范式）。没有它，cancelled 在 runner 之上失语、agent_loop 无 action 依据。

**判断依据**：约束 16（cancelled 收口成 Result(status="cancelled")，cancelled_at_turn/cancel_reason 在 metadata dict）+ 需求要点 6（处置集中到 agent_loop 唯一 action 二选一点，边界内 provider/tool/runner 各自翻译成分类）。

**缺失后果**：cancelled 失语、agent_loop 散布 try/except、错误处置不可测。

**边界类**：无（纯函数模块，函数 `classify_result(result) -> Disposition`）。

**包含范围**：
- Disposition 类型定义（单 dataclass：action + reason + tree_wide）
- `classify_result(result: Result, current_epoch) -> Disposition` 纯函数（tree_wide 由 cancel_subtree 编排时带入，classify_result 只吃 Result + Result.metadata）
- `build_mail(disposition, ...) -> Mail`（构造上投 Mail 的单一助手，按 reason 决定 payload）

**不包含范围**：
- 异常翻译（边界内 provider/tool 各自 try/finally 清理 + 翻译成 Result）
- 分发执行（归 C agent_loop，D 只产出 Disposition）

**依赖**：Result（`repo:src/core/result.py`）；不依赖树态（epoch 经 Mail 携带，tree_wide 由调用方带入）

**复用/新建**：**新建**；对齐 claude query.ts reason 表，但按「处置方式差异」合并（不是 1:1 映射）。

**数据结构/接口**：

```python
# Disposition — run 终态分类结果（单 dataclass + action 字段）
@dataclass(frozen=True)
class Disposition:
    action: Literal["deliver_up", "emit_only"]   # 消费侧唯一分支依据
    reason: Reason   # 封闭枚举标签
    tree_wide: bool = False   # 仅 cancel 类 reason 有意义

# reason 封闭枚举（替代原 Outcome 4 子类的异构字段，统一成单一 tag 维度）
Reason = Literal[
    "completed", "max_turns", "token_limit", "cost_limit",
    "user_interrupt", "parent_cascade", "hook_blocked", "watchdog",
    "llm.capability", "llm.protocol_400", "llm.auth", "llm.rate_limit",
    "tool.execution", "internal.bug",
]

def classify_result(result: Result, current_epoch: int) -> Disposition: ...
```

reason 映射表（claude query.ts reason → Disposition.reason）：

| claude reason | Disposition.reason | 说明 |
|---|---|---|
| completed | completed | 正常完成 |
| max_turns | max_turns | 预算耗尽 |
| aborted_streaming / aborted_tools | user_interrupt, tree_wide=True | 用户打断，树级 |
| model_error / blocking_limit | llm.capability | LLM 能力/限制 |
| prompt_too_long | llm.protocol_400 | 协议 400 |
| image_error | tool.execution | 工具执行 |
| stop_hook_prevented / hook_stopped | hook_blocked, tree_wide=按树级 | hook 拦截 |

**风险等级**：低

**风险类型**：可行性（纯函数，吃现有 Result）

**风险说明**：Result.status + metadata 组合需完整覆盖；边界内 provider/tool 翻译成 Result 的责任需明确（约束 16 已为 cancelled 铺好）。

**风险判断依据**：`repo:src/core/result.py::Result`（status=completed/failed/cancelled；cancelled_at_turn/cancel_reason 在 metadata）。

**风险缺失后果**：分类遗漏导致 agent_loop action 落空兜底 internal_failure。

**PoC 建议**：无需 PoC，直接单元测试每个 Result.status+metadata 组合。

**task 建议**：
- 建议 task 名：`agent-tree-run-terminal-classifier`（task-2）
- 对应 DoD：DoD-5
- 是否进入 x-req：是
- 原因：低风险纯函数，吃现有 Result，下游全消费，前置稳定

---

### 模块 F：审批 agent_id 维度

**职责**：`_PendingApproval` 加 agent_id；子 runner 共享树 ApprovalManager/bridge；cancel_subtree 取消子树 pending future。

**为什么需要**：审批是控制面，必须绕过 mailbox 直达会话级 inbox（否则父在跑 run 时子的审批请求排队挂死）。子 agent 走同一 session 审批（共享树 bridge）。`_PendingApproval` 现状只有 channel+thread_id，子 agent 审批归属无法展示。需求要点 9 已明确「需显式加 agent_id 字段」（v2 文档说「dict 天然支持」是错的，已核实 `repo:src/safety/approval/manager.py:69` 无 agent_id）。

**判断依据**：需求要点 9 + 代码核实 `repo:src/safety/approval/manager.py::ApprovalManager._PendingApproval`（只有 channel+thread_id）+ `repo:src/hosts/web/approvals/global_inbox/broadcaster.py::ApprovalInboxBroadcaster`。

**缺失后果**：父 run 时子审批挂死、审批归属丢失、cancel_subtree 漏取消子树 pending future。

**边界类**：复用现有 `ApprovalManager`（加字段）+ `ApprovalInboxBroadcaster`（共享 bridge）。

**包含范围**：
- `_PendingApproval.agent_id` 字段（仅展示归属；路由仍按 thread_id，子规则=父规则）
- 子 runner 装配共享树 ApprovalManager/bridge
- `cancel_subtree` 取消子树 pending future（asyncio.Future 取消）

**不包含范围**：
- 审批决策逻辑（SafetyGatedApproval 不变）
- 审批规则差异（子规则=父规则）

**依赖**：ApprovalManager（现有）、ApprovalInboxBroadcaster（现有）、TaskRegistry（B，cancel_subtree 编排）

**复用/新建**：**改现有**（显式加 agent_id 字段）。

**数据结构/接口**：

```python
# repo:src/safety/approval/manager.py — 改现有
@dataclass
class _PendingApproval:
    channel: ...            # 现有
    thread_id: str          # 现有，路由键
    agent_id: str           # 新增：展示归属（"user" 看不到，agent_id 标识哪个 agent 触发）
    future: asyncio.Future  # 现有，cancel_subtree 取消靶子
```

**风险等级**：低

**风险类型**：数据兼容（加字段需默认值兼容现有调用）

**风险说明**：_PendingApproval 加 agent_id 需默认值（主 agent = root.agent_id），避免现有调用点报错；pending future 取消需在 cancel_subtree 编排。

**风险判断依据**：`repo:src/safety/approval/manager.py:69` 现状无 agent_id；需求要点 9 明确需加。

**风险缺失后果**：归属丢失、子审批挂死。

**PoC 建议**：无需 PoC。

**task 建议**：
- 建议 task 名：随 task-5（多 agent spawn）一并落地
- 对应 DoD：DoD-6
- 是否进入 x-req：是
- 原因：依赖多 agent 形态，与 spawn 同批

---

### 模块 G：Event/wire 协议扩展

**职责**：Event 补 agent_id/task_id/conversation_id；流式帧带 agent_id；REST agent 树查询（后续）。

**为什么需要**：约束 17（wire 双侧真源）+ 需求要点 14（流式帧首日带 agent_id，成本≈0，否则双侧真源后补极贵）。Event 三坐标字段是 agent_loop 分发、cancel_subtree 编排、前端归属展示的基础。子 agent 来源归属走 metadata['source_agent_id'] 软键（不加 Message 字段）。

**判断依据**：约束 17 + 需求要点 7（Message 不加字段，provenance 走 metadata 软键）+ 需求要点 14。代码核实：`repo:src/core/contracts/event_sink.py::Event`（kind/run_id/turn/payload/timestamp_ms）缺坐标字段；`repo:src/core/contracts/tool_runtime.py::ToolContext`（run_id/session_id/turn/call_id/metadata）缺 agent_id。

**缺失后果**：运行时漂移崩溃（单侧改）、前端无法区分主/子 agent 来源、将来 drain 合并无语义归属。

**边界类**：复用现有 Event（加字段）+ wire 协议模型（约束 17 双侧真源同步）。

**包含范围**：
- Event 加 agent_id/task_id/conversation_id（坐标字段）
- Message 不加字段（provenance 走 metadata['source_agent_id'] 软键）
- ToolContext 加 agent_id（不加 epoch）
- WS 流式帧带 agent_id
- REST agent 树查询（post-v1）

**不包含范围**：
- 树快照帧 / 子 agent 实时展开（post-v1）

**依赖**：wire 协议模型（约束 17 双侧真源）

**复用/新建**：**改现有**（纯加法）。

**数据结构/接口**：

```python
# repo:src/core/contracts/event_sink.py — 改现有（加 3 坐标字段）
@dataclass(frozen=True)
class Event:
    kind: str
    run_id: str
    turn: int
    payload: dict
    timestamp_ms: int
    agent_id: str        # 新增：哪个 agent 产生
    task_id: str         # 新增：关联 TaskRecord
    conversation_id: str # 新增：= tree_id

# repo:src/core/message.py — 复用现有，不加字段（provenance 走 metadata['source_agent_id'] 软键）见 ./04-data-and-state.md
# repo:src/core/contracts/tool_runtime.py — 改现有（加 agent_id）
@dataclass(frozen=True)
class ToolContext:
    run_id: str
    session_id: str
    turn: int
    call_id: str
    metadata: dict
    agent_id: str        # 新增：哪个 agent 的工具调用（不加 epoch）
```

**风险等级**：中

**风险类型**：数据兼容 + 依赖稳定性（wire 双侧同步，约束 17）

**风险说明**：Event 加字段需前后端双侧同步（Python `repo:src/hosts/web/protocol/` ↔ TS `repo:web/src/protocol.ts`）；需协议漂移测试保证 fixture 一致。

**风险判断依据**：约束 17 + 代码核实双侧真源。

**风险缺失后果**：运行时漂移崩溃、fixture 不一致。

**PoC 建议**：无需 PoC；漂移测试是必须的契约测试。

**task 建议**：
- 建议 task 名：`agent-tree-event-coords`（task-1，Event 补字段，步骤 1 纯加法前置）
- 对应 DoD：DoD-7
- 是否进入 x-req：是
- 原因：低风险纯加法，下游全消费，最先稳定

---

### 模块 H：统一时间工具

**职责**：收编代码库散落的 epoch-ms local helper 与 inline `int(time.time()*1000)`，提供唯一 tz-aware 时间来源 `now_epoch_ms()` / `now_iso()`。

**为什么需要**：代码库现状没有统一的 epoch-ms 工具。`repo:src/scheduler/timing.py:83` 的 `utc_now()` 返回 tz-aware datetime 但只在 scheduler 子系统内用；Event.timestamp_ms 及约 8 处 local helper + 约 20 处 inline 全是 naive `int(time.time()*1000)` 无时区。Event/Mail/TaskRecord 补字段时（task-1/4/5）需要单一可信时间来源，否则新字段与老散落 helper 口径不一致、调试困难。

**判断依据**：现状代码调研——散落 helper：`repo:src/sessions/task_progress_models.py:23` current_time_ms、`repo:src/hosts/web/websocket/event_sink.py:61`、`repo:src/hosts/web/websocket/thread_status.py:88`、`repo:src/evolution/state_store.py:15`、`repo:src/application/subagents/manager.py:491` _now_iso、`repo:src/sitian/store.py:453` _utc_now_iso 等 ~8 处；inline `int(time.time()*1000)` ~20 处。

**缺失后果**：Event/Mail/TaskRecord 新字段时间戳口径与老散落 helper 不一致；未来排障时无法统一校正时区；新增字段缺乏 tz-aware 保证。

**边界类**：纯函数模块（无 Manager），对外暴露两个函数。

**包含范围**：
- `now_epoch_ms() -> int` — tz-aware → epoch 毫秒
- `now_iso() -> str` — tz-aware ISO8601 字符串

**不包含范围**：
- scheduler 子系统内的 `utc_now()` datetime（不收编，保持子系统内用）
- 定时/调度逻辑（不在本工具职责内）

**依赖**：无（标准库 `datetime`，tz-aware UTC）

**复用/新建**：**新建并统一收编**。收编清单：`repo:src/sessions/task_progress_models.py:23` current_time_ms、`repo:src/hosts/web/websocket/event_sink.py:61`、`repo:src/hosts/web/websocket/thread_status.py:88`、`repo:src/evolution/state_store.py:15`、`repo:src/application/subagents/manager.py:491` _now_iso、`repo:src/sitian/store.py:453` _utc_now_iso 等 ~8 处散落 helper + ~20 处 inline（详见 task-1 淘汰清理项）。

**数据结构/接口**：

```python
# 统一时间工具（新建，纯函数）
def now_epoch_ms() -> int:
    """tz-aware → epoch 毫秒。取代散落 int(time.time()*1000)。"""

def now_iso() -> str:
    """tz-aware ISO8601 字符串。取代散落 _now_iso/_utc_now_iso。"""
```

**风险等级**：低

**风险类型**：无（纯函数，标准库实现）

**风险说明**：收编需逐处替换调用点，确认语义不变（naive → tz-aware 的绝对值差异需在 Event.timestamp_ms 双侧一致）。

**风险判断依据**：纯标准库 `datetime.now(timezone.utc)`，无可行性风险。

**风险缺失后果**：无。

**PoC 建议**：无需 PoC。

**task 建议**：
- 建议 task 名：随 task-1（`agent-tree-event-coords`）一并落地——Event 补字段时同步引入统一时间工具并收编散落 helper
- 对应 DoD：DoD-7（支撑 Event.timestamp_ms 的单一来源）
- 是否进入 x-req：是
- 原因：低风险纯函数，随 task-1 引入避免时间戳口径分裂
