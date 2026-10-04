# 数据模型与状态

## 数据归属决策

| 数据 / 状态 | 归属模块 | 为什么归这里 | 判断依据 | 缺失后果 |
|------------|---------|--------------|---------|----------|
| AgentCell（agent 实例） | A · AgentManager | 资源/生命周期域，spawn 唯一创建者 | 需求要点 1；边界类 AgentManager | spawn 散落、双套创建逻辑 |
| TaskRecord（账本记录） | B · TaskRegistry | 账本面唯一载体，登记先于暴露 | 不变量登记先于暴露 | 漏杀孤儿子、kill 无账本 |
| mailbox（双 queue：user_inbox + agent_inbox） | C · Mailbox（AgentCell 内部） | 数据面三分的载体，每 agent 一个；双 queue 拆"到达顺序"与"紧迫性"耦合，保证用户消息最高优先级 | 约束 16 + 唯一 run loop + 需求要点 16 | 主 agent 阻塞、复活说话、用户消息被 child_result 抢先 |
| epoch（世代计数器） | ThreadCell（演进为树态 owner） | epoch bump 唯一 owner，防散落 | 不变量 epoch 唯一 owner | epoch 双 bump、门卫失效 |
| registry（TaskRegistry 实例） | ThreadCell（演进为树态 owner） | 持有 owner，与树同生命周期 | 需求要点 8/13 | registry 双 owner 竞态 |
| event_sinks | ThreadCell（演进为树态 owner） | 持有 owner，树内共享 | 需求要点 8 | sink 散落、Event 丢失 |
| approval_manager | ThreadCell（演进为树态 owner） | 持有 owner，子共享树 bridge | 需求要点 9 | 子审批挂死 |
| Disposition（分类产物） | D · run 终态分类器 | 纯函数产出，agent_loop 消费 | 约束 16 + 需求要点 6 | cancelled 失语、action 无依据 |
| RunState（per-run 状态） | Runner（复用） | per-run 可变状态，不加 epoch | `repo:src/core/run_state.py` 现状 | epoch 误入 per-run 导致门卫失效 |
| session（持久历史） | Runner/SessionStore（复用） | 已发生历史，不回滚 | 不变量打断不回滚过去 | session 分裂、400 |

## 核心实体

所有字段带中文注释（含义 + 取值范围）。复用现有类型只标「改现有」+ 新增字段。

```python
# repo:src/core/message.py — 复用现有，不加字段（provenance 走 metadata['source_agent_id'] 软键）
# 子 agent provenance 不加 first-class 字段，用 metadata['source_agent_id'] 软键
# （遵循现有 attachments 软契约先例 repo:src/core/message.py:53，
#   过压缩透传：repo:src/prompting/compaction/history_compactor.py:159 metadata wholesale 保留）
@dataclass(frozen=True)
class Message:
    role: Literal["user", "assistant", "system", "tool"]
    content: str | None = None
    tool_calls: tuple[ToolCall, ...] | None = None
    tool_call_id: str | None = None
    name: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

# Mail — mailbox 传输信封（新建，命名匹配 mailbox）
@dataclass(frozen=True)
class Mail:
    kind: Literal["user_message", "child_result", "system_notice"]
    sender: str                    # 发送者：B 完成时=B 的 agent_id；用户输入="user"；cron="scheduler"
    recipient_agent_id: str        # 接收者：投进谁 mailbox 就是谁；支持第三方投递（sender≠recipient）
    task_id: str                   # 关联 spawn 的 TaskRecord.task_id；user_message="";child_result 时父消费可回溯哪个 spawn 调用
    epoch: int                     # 产生该 mail 的 run 起始 epoch；user_message 不过门卫
    payload: Message               # 复用 Message（无 author 字段，provenance 走 metadata['source_agent_id'] 软键）
    enqueued_at_ms: int = field(default_factory=now_epoch_ms)   # 入队时间戳（用统一时间工具 now_epoch_ms()，tz-aware，不是裸 time.time()），需要写入日志

# AgentCell — agent 实例（新建）
@dataclass
class AgentCell:
    agent_id: str                        # uuid4().hex[:8]，AgentManager.register 校验树内唯一
    parent_id: str | None                # 主 agent = None；子 = 父 agent_id
    child_ids: list[str]                 # 子 agent_id 列表
    depth: int                           # v1 ≤ 1
    spec: AgentSpec                      # 复用 repo:src/core/agent_spec.py
    skill_names: tuple[str, ...]
    session_id: str                      # 每个 agent 独立 session
    cwd: str                             # 工作目录（主 agent=进程 cwd；子=task 专属 agents/<task_run_id>/work/）
    role_id: str | None                  # 角色身份查询键（主 agent=None；子=AgentRolePreset 查询键）
    lifecycle: Literal["persistent", "single_shot"]
    state: Literal["idle", "running", "closed"]
    user_inbox: asyncio.Queue[Mail]      # 用户消息专用 lane（优先级最高，需求要点 16）
    agent_inbox: asyncio.Queue[Mail]     # child_result / system_notice lane
    run_task: asyncio.Task | None = None # cancel 靶子
    # 删除 tree: ConversationTree 反向引用（循环依赖 + 内核反向依赖装配层）。
    # 理由：epoch 通过 Mail.epoch 携带 + run 启动时捕获 run_epoch（局部变量）；
    #   registry 操作走 AgentManager 门户；agent_loop 不直接持有 ThreadCell 引用，
    #   避免循环依赖（ThreadCell.root_agent→AgentCell，若 AgentCell 又指 ThreadCell 则成环）。
    #
    # 双 queue 路由（需求要点 16）：Mail 按 kind 落地——
    #   user_message → user_inbox；child_result / system_notice → agent_inbox。
    # agent_loop 取法：先 drain user_inbox 全部 → wait_either 合并等两个 queue
    # （asyncio.wait(FIRST_COMPLETED)），保证用户消息天然插队到 child_result 前面。
    # 单 FIFO queue 物理上做不到优先级（到达顺序与紧迫性耦合），双 queue 是结构必然解。

# ThreadCell 演进：既是 host 装配外壳，又是 agent 树态 owner（用户决策：不新建 ConversationTree 类）
# repo:src/hosts/web/threads/cell.py — 改现有（加 3 字段）
@dataclass
class ThreadCell:
    # ... 现有字段（thread_id/metadata/runtime/bridge/adapter/event_sinks/boot_lock/last_active_at/status/current_run_task/pending_inputs 等）保留 ...
    root_agent: AgentCell          # 新增：树根（主 agent，parent_id=None）
    registry: TaskRegistry         # 新增：账本 owner（原 ConversationTree.registry）
    epoch: int = 0                 # 新增：世代计数器，cancel_subtree 时 +1（原 ConversationTree.epoch）

    def bump_epoch(self) -> int: ...   # 新增：epoch 唯一 bump 入口（原 ConversationTree.bump_epoch）

# TaskRecord — 账本记录（新建，审计字段迁移自 SubAgentLifecycleRecord）
@dataclass
class TaskRecord:
    task_id: str                                      # 唯一标识
    agent_id: str                                     # 归属 agent
    parent_task_id: str | None                        # 父 task（spawn 链）
    kind: Literal["agent_run", "external_process"]    # 只 2 种（需求要点 12，无 detach）
    status: str                                       # pending/running/completed/failed/cancelled（审计保留）
    handle: asyncio.Task | None                       # agent_run 的 asyncio.Task（cancel 靶）
    resources: list[PidHandle]                        # external_process 的 PID 列表（kill 靶）
    started_at: float                                 # 审计保留（迁移自 SubAgentLifecycleRecord；用统一时间工具）
    finished_at: float | None                         # 审计保留（用统一时间工具）
    error_message: str | None                         # 审计保留

# PidHandle — external_process 的 kill 靶（新建）
@dataclass
class PidHandle:
    pid: int                          # 进程 PID
    kind: Literal["bash", "other"]    # 进程类型

# Disposition — run 终态分类结果（新建，单 dataclass + action 字段）
@dataclass(frozen=True)
class Disposition:
    action: Literal["deliver_up", "emit_only"]   # 消费侧唯一分支依据
    reason: Reason   # 封闭枚举标签，让父 agent / 遥测区分来源
    tree_wide: bool = False   # 仅 cancel 类 reason 有意义

# reason 封闭枚举（替代原 Outcome 4 子类的异构字段，统一成单一 tag 维度）
Reason = Literal[
    "completed", "max_turns", "token_limit", "cost_limit",          # 正常终态 / 预算耗尽
    "user_interrupt", "parent_cascade", "hook_blocked", "watchdog", # 取消（控制面）
    "llm.capability", "llm.protocol_400", "llm.auth", "llm.rate_limit",  # 失败（错误面）
    "tool.execution", "internal.bug",
]
```

> **action 映射规则**（消费侧二选一的依据）：`emit_only` = cancel 类 reason 且 `tree_wide=True`（树级取消，父也被砍，不上投）；`deliver_up` = 其余所有情况（completed / exhausted / failed / 局部 cancel 都上投，payload 里带 reason 让父 agent 区分）。classify 产数据不产控制流，消费方（agent_loop）按 action 二选一，不再 match N 个子类分支（对齐 Claude Code classify 家族范式）。

## 实体关系

ThreadCell 演进为树态 owner（不新建 ConversationTree 类），持有 root（AgentCell）、registry（TaskRegistry）、event_sinks、approval_manager + root_agent/registry/epoch 三字段。AgentCell 通过 parent_id/child_ids 形成树；每 cell 持 mailbox（双 queue：user_inbox + agent_inbox）和 run_task。TaskRecord 通过 agent_id 关联 AgentCell，通过 parent_task_id 形成任务链。Disposition 由 classify_result(result) 产出，被 agent_loop 按 action 二选一消费。ER 图见 `./diagrams.md#数据关系`。

## 状态流转

### AgentCell.state: idle ↔ running ↔ closed

```
idle ──(mailbox.get() 取到消息)──> running
running ──(run_task 完成，Disposition 按 action 处理完)──> idle
running ──(single_shot 终态 且 registry.no_live_descendants)──> closed
idle ──(single_shot 终态 且 无子孙)──> closed   # 退出条件通用式
closed = 终态（注销 + 关 mailbox）
```

- **idle**：mailbox.get() 挂起等待，零开销。
- **running**：run_task 执行中（epoch 已盖章 = run_epoch）。
- **closed**：single_shot 终态且无存活子孙 → close_cell 注销 + mailbox 关闭。
- persistent agent（主 agent）任何终态后回 idle，不进 closed。

状态图见 `./diagrams.md#agentcell-状态流转`。

### ThreadCell.epoch: 单调递增

```
epoch=0 ──(cancel_subtree)──> epoch=1 ──(cancel_subtree)──> epoch=2 ...
```

- cancel_subtree 触发 `bump_epoch()`（ThreadCell 唯一 owner）。
- Mail.epoch < ThreadCell.epoch 且 kind != user_message → mailbox 消费侧丢弃（epoch 门卫）。
- user_message 永不过期（用户输入不携带世代语义）。

状态图见 `./diagrams.md#epoch-世代流转`。

### agent_loop 主循环（伪代码，流程图见 ./diagrams.md#模块-c-mailbox--agent_loop）

```python
# current_epoch_getter 实时读 ThreadCell.epoch（getter 注入，不持 ThreadCell 引用，
# 避免内核反向依赖装配层）。必须用 getter 而非启动时的 int 快照——cancel_subtree
# 调 bump_epoch() +1 后 int 快照不变会导致门卫失效；getter 才能立刻拿到新值。
async def agent_loop(
    cell: AgentCell, *, current_epoch_getter: Callable[[], int]
) -> None:
    try:
        while True:
            # 第一优先：drain user_inbox 全部（用户消息天然插队到 child_result 前面）。
            # 单 FIFO queue 做不到优先级，双 queue 是结构必然解（需求要点 16）。
            while not cell.user_inbox.empty():
                mail = cell.user_inbox.get_nowait()
                await _run_one_mail(cell, mail, current_epoch_getter)
                if cell.lifecycle == "single_shot" and cell._should_exit():
                    return
            # 两个 queue 都空时合并等：asyncio.wait(FIRST_COMPLETED) 同时等两个 get()。
            user_get = asyncio.ensure_future(cell.user_inbox.get())
            agent_get = asyncio.ensure_future(cell.agent_inbox.get())
            done, pending = await asyncio.wait(
                {user_get, agent_get}, return_when=asyncio.FIRST_COMPLETED
            )
            # 取到的那条立刻处理；另一条放回对应 queue（保持顺序，不丢消息）。
            for t in pending:
                t.cancel()
            mail = next(iter(done)).result()
            await _run_one_mail(cell, mail, current_epoch_getter)
            if cell.lifecycle == "single_shot" and cell._should_exit():
                return
            cell.state = "idle"
    finally:
        registry.close_cell(cell)

async def _run_one_mail(cell, mail, current_epoch_getter) -> None:
    """处理一条 Mail：epoch 门卫 → 盖章 → run → classify_result → 按 action 二选一（单轮）。"""
    # epoch 门卫：旧世代内部投递丢弃，user_message 永不过期。
    # user_message 不携带世代语义（用户输入不该因打断被丢）。
    if mail.kind != "user_message" and mail.epoch < current_epoch_getter():
        return
    run_epoch = mail.epoch             # 对内部投递盖 mail.epoch；user_message 用 0（不过门卫）
    cell.state = "running"
    run_task = asyncio.create_task(
        runner.run(seed_from(mail), session=cell.session, ...))
    registry.register_run(run_task, cell)
    try:
        result = await run_task              # 约束16：cancel 收口成 Result，不 raise
    except Exception as exc:
        result = internal_failure_result(exc) # actor 不失聪兜底
    # classify 产数据不产控制流；消费侧按 action 二选一（不写 N 个 match 子类分支，
    # 对齐 Claude Code classify 家族范式）。emit_only=树级取消不上投；
    # deliver_up=其余所有情况（completed/exhausted/failed/局部 cancel）上投，
    # payload 里带 reason 让父 agent 区分来源。
    disp = classify_result(result, current_epoch_getter())
    if disp.action == "emit_only":
        emit_only(cell, result, epoch=run_epoch)
    else:
        deliver_up_or_ui(cell, disp, result, epoch=run_epoch)
```

**关键修正点（相对早期伪代码）**：
1. **epoch 传参**：`current_tree_epoch: int`（启动快照）→ `current_epoch_getter: Callable[[], int]`（实时读）。否则 cancel_subtree 的 `bump_epoch()` 后门卫失效。
2. **双 queue 取法**：原 `mail = await cell.mailbox.get()` 单 queue FIFO → 现"先 drain user_inbox 全部 → `wait_either` 合并等"。用户消息天然插队。
3. **不引入 should_yield**：run 是不可分割的处理单元，agent_loop/runner 不做"自动让行"检查（需求要点 17）。用户要干预只有显式动作——打断（现有 cancel）或立即发送（post-v1，复用 cancel 不写新机制）。
4. **wait_either 的 pending 处理**：`asyncio.wait(FIRST_COMPLETED)` 返回后，未完成的那个 get() task 必须 cancel（否则队列里那条消息会卡在"已被 get 取出但未消费"状态，下次 get 拿不到）。这是个易踩的坑，实现时注意。

**早期伪代码 `if cell.lifecycle == "single_shot" and registry.no_live_descendants(cell): break` 退出条件不变**，v1 深度 1 时无子孙恒真，将来放开只改配置不改这行。上面伪代码抽出 `_should_exit()` 表示该判断，避免主循环与 drain 分支重复。

## 持久化方案

| 数据 | 存储方式 | 位置 | 为什么这样存 | 判断依据 | 缺失后果 | 备注 |
|------|---------|------|------------|---------|----------|------|
| Message（历史） | 持久化（复用现有 Session） | SessionStore | 已发生历史，不回滚 | 不变量打断不回滚 | session 分裂 | 复用现有，不加字段（provenance 走 metadata 软键） |
| TaskRecord 审计字段 | 持久化（迁移自 SubAgentLifecycleRecord） | 审计日志/存储 | crash recovery 拆后续，但审计字段保留 | 需求要点 11 | 无审计追溯 | status/started_at/finished_at/error_message |
| Mail（mailbox） | 内存（asyncio.Queue） | 进程内 | 瞬态待处理输入，进程重启即丢 | 需求要点 11（不做 crash recovery） | 重启丢未处理消息 | v1 接受，journal 拆后续 |
| AgentCell / ThreadCell | 内存 | 进程内 | 运行时树态，进程重启即重建 | 需求要点 11 | 重启丢树 | v1 接受 |
| epoch | 内存（ThreadCell） | 进程内 | 世代计数器，运行时 | 同上 | 重启归零 | v1 接受 |
| Disposition | 内存（瞬态） | 进程内 | 分类产物，消费即弃 | 纯函数 | 无 | 不持久化 |
| Event | 流式（EventSink） | wire 协议 | 实时下发 + 审计 | 约束 17 | 前端无更新 | 带 agent_id/task_id/conversation_id |

## 共享数据结构

跨模块共用的类型定义集中在此，避免各模块重复定义。

```python
# 跨模块共用
type AgentId = str                 # agent 唯一标识
type TaskId = str                  # TaskRecord 唯一标识
type ConversationId = str          # = tree_id = thread_id

# 复用现有（不改）
# repo:src/core/agent_spec.py::AgentSpec（frozen：name/instructions/default_model/tool_names/max_turns/metadata/reasoning_effort）
# repo:src/core/run_state.py::RunState（mutable per-run：run_id/session_id/status/turn/messages/last_error/metadata，不加 epoch）
# repo:src/core/result.py::Result（frozen：run_id/session_id/status/final_message/turn_count/error/metadata；status=completed/failed/cancelled）
```

## 打断链三段时间线

cancel_subtree 的正确性取决于三段时间线的处理（见 `./diagrams.md#打断链时序`）：

| 段 | 状态 | 正确处理 | 判断依据 |
|---|---|---|---|
| 1. child_result 已进父 mailbox，父 run 未启动 | 消息在队列 | 消费侧抛弃：purge 队列 + epoch 门卫兜底 | 不变量打断只阻止未来 |
| 2. 父 run 已启动，LLM 推理中，本地 await | 回复在途 | 不需抛弃逻辑：cancel run_task → CancelledError 在 await 挂起点炸开 → httpx 连接随协程取消关闭。约束 16 收口 + 占位配对。损失仅服务器侧已推理算力 | 约束 16 + asyncio cancellation 沿 await 链 |
| 3. 父 run 已跑完，回复已 append 进 session、已推 UI | 既成事实 | 必须不抛弃：session 已提交不可回滚。该抛弃的只有此 run 完成后向上投递的 mail——带旧 epoch 绕回段 1 被拦截 | 不变量打断不回滚过去 + tool 配对 |
