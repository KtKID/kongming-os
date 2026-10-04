# 目标与完成标准

## 第一性原理推导

| 项 | 结论 | 判断依据 | 为什么重要 | 缺失后果 |
|----|------|---------|------------|----------|
| 需求本质 | 让主 agent A 派出后台子 agent B 做事时不阻塞、能继续和用户聊；B 完成后报告 A 汇总给用户；打断 A 连带打断 B | 需求要点 1-3 + 现状 `repo:src/application/subagents/manager.py::SubAgentManager.run_task` 同步阻塞 `await runner.run(...)` | 保护「主 agent 永远在线可聊」核心用户结果 | 沿用阻塞语义 → A 卡死、用户挂起、与 AI 助手心智背离 |
| 基础事实 | 概念统一：整个框架只有一个「agent」；循环叫 agent_loop；SubAgentManager 改名 AgentManager。主/子差异只在数据字段（parent_id/lifecycle/depth），零代码分支 | 需求要点 1 + 用户确认 | 命名统一是减少代码分支的前提 | 概念分裂（actor/agent/subagent）→ 维护双套机制、回归测试盲区 |
| 基础事实 | 唯一 run loop：只有 `repo:src/core/runner.py::Runner` 有 turn 推进逻辑（已核实 `_drive_turns` 是唯一 while loop）；`Runner.run()` 接受单条 user_input + per-call session/agent_spec/llm/tools/approval | 代码核实 | 复用而非重写 run loop，降低风险 | 另写 run loop → 双套推进逻辑、cancelled 收口约束 16 失效 |
| 关键约束 | 约束 16：Runner 顶层吞 CancelledError、收口成 `Result(status="cancelled")`、不外抛；`_execute_tool_calls` 对当前 call + 同 assistant 未起跑的 call 全部写占位 tool_result，保证 tool_use↔tool_result 配对 | 代码核实 `repo:src/core/runner.py` | cancelled 从异常控制流变成数据值，传播链在 runner 边界终止；此后必须以数据形式（run 终态分类器）手工重建 | 不重建 → cancelled 在 runner 之上失语、agent_loop 无 action 依据 |
| 关键约束 | 约束 17：Web wire 协议前后端双侧真源（`repo:src/hosts/web/protocol/` ↔ `repo:web/src/protocol.ts`），增删字段必须双侧同步 | 代码核实 | 单侧改 = 运行时漂移崩溃 | 单侧改 Event 字段 → 前端 fixture 不一致 |
| 关键约束 | spawn 深度 v1 配置固定 1 层（子 agent 不能再 spawn）；depth 字段和退出条件写通用式，将来放开只改配置不改代码 | 需求要点 4 | 防止将来放开时返工 | 写死 1 层 → 放开时改代码分支 |
| 关键约束 | spawn 统一只有异步一种（无同步 wait=True）；「等 B 回来再干」是 agent 的行为（LLM 在收到 child_result 前不推进），不是机制 | 需求要点 5 | 避免同步阻塞复活，保证 A 不卡 | 引入 wait=True → 阻塞语义复活 |
| 系统不变量 | 打断只阻止未来，不回滚过去：抛弃动作全系统只存在于 mailbox 消费侧的 epoch 门卫；进行中的靠 cancel 使其「永不到达」；已提交进 session 的一律保留 | 约束 16 + tool_use/tool_result 配对约束（回滚撕开配对链导致 400） | 保护 session 一致性 + tool 配对 | 任意环节回滚 → session 与用户所见分裂 + 400 |
| 系统不变量 | cancel 与 lifecycle 正交：cancel 职责是停止正在进行的工作（砍 run_task、杀 PID）；agent 本体存亡由 lifecycle 决定 | 第一性原理 + 需求要点 1 | 单一职责，避免 cancel 误杀 persistent agent | 混合 → persistent agent 被误注销 |
| 系统不变量 | agent_loop 永不被单独 cancel（只随树销毁），否则 agent 永久失聪、mailbox 静默堆积 | 第一性原理 | 保护 agent 可达性 | 单独 cancel agent_loop → 死信队列 |
| 系统不变量 | 审批是控制面，绕过 mailbox 直达会话级 inbox（否则父在跑 run 时子的审批请求排队挂死） | 需求要点 9 + 第一性原理 | 保护审批路径不被 run 阻塞 | 审批进 mailbox → 父 run 时子的审批挂死 |
| 系统不变量 | TaskRegistry 登记先于暴露：spawn 必须先原子登记 TaskRecord(pending) 再返回 tool_result；cancel_subtree 时 registry 置关门标志拒绝新登记 | 第一性原理（防 dispatched 与登记之间的打断漏杀） | 防孤儿子 | 漏登记先返回 → cancel 瞬间孤儿子 |
| 可重新评估假设 | 历史命名 SubAgentManager → AgentManager（去 sub，管理主+子）；SubAgentLifecycleRegistry 双账本合并进 TaskRegistry | 需求要点 1 | 释放统一抽象方案空间 | 沿用旧名/双账本 → 概念分裂 |
| 可重新评估假设 | ThreadCell 不退场，演进为树态 owner（加 root_agent/registry/epoch 三字段，不新建 ConversationTree 类）；InterruptFrame 从 cancel current_run_task 改为 cancel_subtree | 需求要点 13 + 代码核实 `repo:src/hosts/web/threads/cell.py` | 复用 host 装配壳，减少改动面 | 重写 ThreadCell → 连带改 host 装配链 |

## 目标充分性判断

| 必须目标 | 状态 | 判断依据 | 为什么重要 | 缺失后果 | 下一动作 |
|---------|------|---------|------------|----------|----------|
| 需求本质 | 已满足 | 需求要点 1-3 已确认 | 保护核心用户结果 | 目标漂移 | 文档模式 |
| 成功标准 | 已满足 | DoD 可验证、smoke/e2e 链路清晰 | 可验收 | 不可验收 | 文档模式 |
| 范围边界 | 已满足 | 需求要点 4/10/11/12 划清不做项 | 防过宽过窄 | 拆分失真 | 文档模式 |
| 关键约束 | 已满足 | 约束 16/17 + 深度 1 层 + 异步唯一 + 代码核实 | 限制方案空间 | 实现冲突 | 文档模式 |
| 系统不变量 | 已满足 | 6 条不变量已列 + 第一性原理 | 保护稳定性 | 破坏兼容/数据可信度 | 文档模式 |
| 现状依据 | 已满足 | 可复用/淘汰/保持现状三清单已调研 | 方案推导地基 | 基于假设写 spec | 文档模式 |
| 推荐方案 | 已满足 | 三分方案 + 判断依据 + 代价风险 | 选择核心原因 | 缺方向风险 | 文档模式 |
| 模块边界 | 已满足 | 7 模块 + 边界类 + 依赖 + 包含/不包含 | 可拆 task | 边界混乱 | 文档模式 |
| 数据和状态 | 已满足 | 核心数据结构 + 状态流转 + epoch 门卫 | 可实现 | 状态归属错 | 文档模式 |
| 验证策略 | 已满足 | 单元/契约/smoke/对抗性四层 | 可验证 | 验证盲区 | 文档模式 |
| task 拆分 | 已满足 | 5 步落地顺序 + PoC 建议 | 可进 x-req | 拆分错 | 文档模式 |

## 需求要点

[已与用户确认的需求要点，大白话逐条落入——文档审核基准]

1. **命名统一**：整个框架只有一个概念叫 **agent**（不叫 actor）。循环叫 **agent_loop**。原 SubAgentManager 改名为 **AgentManager**（去掉 sub，管理主+子所有 agent），提供 spawn / cancel_subtree / list_agents / get_agent 等工具函数。子 agent 也是 agent，主/子差异只在数据字段（parent_id / lifecycle / depth），零代码分支。
2. **目标场景**：用户和 agent A 对话；A 派出子 agent B 去做任务（如读文档）；A 能继续和用户聊天（不阻塞）；B 做完后报告 A；A 再汇总报告给用户。
3. **打断语义**：打断 A 时，A 的所有附属子 agent（B）和它们正在执行的任务都要一起打断销毁。只有树级一种打断粒度。
4. **spawn 深度**：v1 配置固定 **1 层**（子 agent 不能再 spawn）；但 depth 字段和退出条件写通用式，将来放开只改配置不改代码。
5. **spawn 统一只有异步一种**（没有同步 wait=True）。「等 B 回来再干下一步」是 agent 的行为（LLM 在收到 child_result 前不推进），不是机制。
6. **run 终态分类器**：确定要做 Disposition 分类器。把「run 终态怎么处置」从 try/catch 异常控制流里剥成数据（Disposition 带 action + reason + tree_wide），处置决策集中到 agent_loop 唯一一个 action 二选一点（emit_only / deliver_up）。边界以内（provider/tool/runner）用 try/finally 清理资源 + 翻译成分类；边界以外只有 agent_loop 一个消费者。
7. **消息结构**：复用现有 `repo:src/core/message.py` 的 `Message`，**不加字段**。子 agent 来源归属用 metadata['source_agent_id'] 软键（遵循现有 attachments 软契约先例 `repo:src/core/message.py:53`），过压缩透传。避免改 wire DTO NormalizedMessage（约束17 双侧同步成本）。
8. **上下文传递结构**：定义 Mail（mailbox 传输信封，含 sender/recipient_agent_id/task_id/epoch/payload）+ ThreadCell 演进为树态 owner（加 root_agent/registry/epoch 字段，bump_epoch 方法，不新建 ConversationTree 类）。run_epoch 在 run 启动时从 mail.epoch 捕获，该 run 的 Event/Disposition/上投 Mail 全继承它。
9. **审批**：子 agent 走**同一 session 审批**（和主 agent 一样，共享树的 ApprovalManager/bridge）。`ApprovalManager._PendingApproval` 现状只有 channel+thread_id，**需显式加 agent_id 字段**（仅展示归属；路由仍按 thread_id，子规则=父规则）。
10. **drain（同世代消息合并进一个 run）**：v1 **不做合并**，逐条消费。子 agent provenance 已用 metadata['source_agent_id'] 软键为将来合并留好语义归属。
11. **crash recovery**：先不做（journal 拆后续），但现有审计字段（status/started_at/finished_at/error_message）保留并挂到 TaskRecord 上。
12. **不做 detach 豁免**（cron 派生豁免级联杀整条砍掉）。TaskRegistry 只登记 {agent_run, external_process} 两种 kind。
13. **保留 ThreadCell**：ThreadCell 就是 tree（加 root_agent/registry/epoch 三字段 + bump_epoch 方法），不新建 ConversationTree 类。
14. **流式帧第一天就带 agent_id**（成本≈0，否则约束 17 双侧真源后补极贵）。
15. **落地顺序**（每步独立可测可单独提交，铁律=mailbox 是地基，spawn 是住户）：步骤 1 Event 补字段 → 步骤 2 run 终态分类器 → 步骤 3 TaskRegistry + cancel_subtree → 步骤 4 loop mailbox 化 → 步骤 5 多 agent。
16. **用户消息优先级最高**：agent 的输入 inbox 拆 **双 queue**——`user_inbox`（用户消息专用 lane）+ `agent_inbox`（child_result / system_notice lane）。agent_loop 取 mail 时**先 drain user_inbox 全部**，再 `wait_either` 等两个 queue。一个单 FIFO queue 把"到达顺序"和"紧迫性"耦合了，物理上做不到优先级；双 queue 是结构必然解（asyncio 单线程下两个 `Queue.get()` 用 `asyncio.wait(..., FIRST_COMPLETED)` 合并等待，无需锁/channel）。
17. **用户消息默认不打断当前 run**：用户消息进 `user_inbox` 排队，等当前 run 跑到自然终态（LLM 不再要工具 / max_turns / cancel）后，agent_loop 回顶部 drain user_inbox 才被处理。run 是不可分割的处理单元——**agent_loop / runner 都不做"自动让行"检查（不引入 `should_yield` 之类的每 turn 早退信号）**。用户要干预只有两种显式动作：① 打断（现有 cancel 语义，砍 run + bump epoch 丢 mailbox + 收口成 `Result(cancelled)`）；② 立即发送（**post-v1 新功能**：cancel 当前 run 但**保留已落 session 的 turn 历史**，收尾后立刻用新消息起 run，复用 cancel 机制不写新机制）。这两种都是用户点按钮触发，agent 自身不主动让位。子 agent 不受主 agent 用户消息影响（独立 cell / 独立 agent_loop / 独立 run_task）。

## 系统目标

把 kongming-agent 从「单 agent + 同步阻塞 subagent + workflow 双机制」重构为「统一 agent 抽象 + mailbox 串行驱动 + 异步 spawn 派生 + 树级打断」，让主 agent 在派出后台子 agent 时保持在线可聊。

## 成功证据

- 用户发消息 → A run → spawn B → A 立即回「已派出 B」→ A idle → 用户继续和 A 聊（A 响应，不阻塞）→ B 完成 → A 汇总报告用户。
- 用户点 Stop → A 的附属子 agent 全部被打断销毁（run_task cancel + bash PID kill+wait）→ A 回 idle，无「复活说话」。
- WS 流式帧带 agent_id，前端能区分主/子 agent 来源。
- 单元测试：run 终态分类器对每个 Result.status+metadata 组合断言 Disposition.action + reason 正确；epoch 门卫丢弃旧世代内部投递；TaskRegistry.cancel_subtree 后序遍历顺序正确。
- 契约测试：Event 加 agent_id/task_id/conversation_id 后前后端 fixture 双侧一致。

## 完成目标（DoD）

- [ ] **DoD-1**：整个框架只有「agent」一个概念；AgentManager 管理 main+子所有 agent，主/子零代码分支（差异仅在 AgentCell 字段）。
- [ ] **DoD-2**：spawn 是纯异步——父 tool_result 立即返回 `{child_id, status:dispatched}`；子最终结果走 `child_result` 在父下一个 run 注入；父永不阻塞等待。
- [ ] **DoD-3**：打断 A 时，A 的所有附属子 agent 及其正在执行的任务（run_task + external_process PID）一起打断销毁；只有树级一种打断粒度。
- [ ] **DoD-4**：打断不回滚已提交进 session 的内容（epoch 门卫只在 mailbox 消费侧抛弃）；session 与用户所见一致、tool_use↔tool_result 配对不撕开。
- [ ] **DoD-5**：cancelled 从异常控制流剥成数据——run 终态分类器把 Result 翻译成 Disposition（action + reason + tree_wide），处置决策集中在 agent_loop 唯一 action 二选一点。
- [ ] **DoD-6**：子 agent 走同一 session 审批，共享树的 ApprovalManager/bridge；`_PendingApproval` 显式带 agent_id；cancel_subtree 取消子树 pending future。
- [ ] **DoD-7**：Event 带 agent_id/task_id/conversation_id；WS 流式帧带 agent_id；wire 协议前后端双侧真源同步（约束 17）。Message 不加字段（provenance 走 metadata 软键）。
- [ ] **DoD-8**：spawn 深度 v1 固定 1 层；depth 字段和退出条件写通用式，放开只改配置不改代码。

## 范围边界

**包含**：
- 统一 agent 抽象（AgentCell）、AgentManager（收编 SubAgentManager + SubAgentLifecycleRegistry）
- mailbox（**双 queue：user_inbox + agent_inbox**）+ agent_loop 串行驱动内核、epoch 门卫、Disposition 按 action 二选一分发
- TaskRegistry 账本 + cancel_subtree 后序遍历 + kill+wait 兜底 + 关门标志
- run 终态分类器（Disposition 单 dataclass：action ∈ {deliver_up, emit_only} + reason 封闭枚举 + tree_wide）
- ThreadCell 演进为树态 owner（加 root_agent/registry/epoch 字段，epoch/registry/event_sinks/approval_manager 的 owner；不新建 ConversationTree 类）
- 审批 _PendingApproval 加 agent_id + 子 runner 共享树 bridge + pending future 取消
- Event 补 3 坐标字段、流式帧带 agent_id、REST agent 树查询（后续）；Message 不加字段（provenance 走 metadata 软键）
- 审计字段（status/started_at/finished_at/error_message）挂到 TaskRecord

**不包含**：
- crash recovery（journal 拆后续，需求要点 11）
- drain 同世代消息合并（v1 逐条消费，需求要点 10）
- detach 豁免（需求要点 12）
- 树快照帧 / 子 agent 实时展开（post-v1）
- 立即发送（post-v1 新功能，需求要点 17：cancel 当前 run + 保留历史 + 接力新消息）
- agent workflow 收编为 policy agent（v2）

## 关键约束

- **技术约束（约束 16）**：Runner 顶层吞 CancelledError 收口成 Result(status="cancelled")；`_execute_tool_calls` 写占位 tool_result 保证 tool_use↔tool_result 配对。→ cancelled 在 runner 边界终止，必须在 runner 之上以 run 终态分类器手工重建。
- **技术约束（约束 17）**：Web wire 协议双侧真源（`repo:src/hosts/web/protocol/` ↔ `repo:web/src/protocol.ts`），Event 加字段必须双侧同步 + 漂移测试。
- **技术约束（唯一 run loop）**：只有 `repo:src/core/runner.py::Runner._drive_turns` 是 turn 推进逻辑；继续作为 run_fn 实现，不改 turn loop。
- **业务约束（深度 1 层）**：v1 spawn 深度固定 1，但写通用式。
- **业务约束（审批同 session）**：子规则=父规则，路由按 thread_id，agent_id 仅展示归属。
- **资源约束**：落地分 5 步，每步独立可测可单独提交；mailbox 是地基，spawn 是住户。

## 系统不变量

- **打断只阻止未来，不回滚过去**：抛弃动作全系统只存在于 mailbox 消费侧 epoch 门卫；进行中靠 cancel 使其「永不到达」；已提交进 session 的一律保留（否则 session 与用户所见分裂 + tool_use/tool_result 配对链撕开导致 400）。
- **cancel 与 lifecycle 正交**：cancel 砍 run_task/杀 PID；agent 本体存亡由 lifecycle 决定（persistent 任何终态后回 idle；single_shot 终态且无存活子孙后退出注销）。
- **agent_loop 永不被单独 cancel**（只随树销毁），否则 agent 永久失聪、mailbox 静默堆积。
- **审批是控制面**，绕过 mailbox 直达会话级 inbox（否则父在跑 run 时子的审批请求排队挂死）。
- **TaskRegistry 登记先于暴露**：spawn 先原子登记 TaskRecord(pending) 再返回 tool_result；cancel_subtree 时关门标志拒绝新登记。
- **数据面/控制面/账本面严格三分**：数据面走 mailbox（串行），控制面绕 mailbox（打断/审批），账本面全经 registry（登记先于暴露）。三者混在一条通道是早期版本全部致命洞的根源。
- **禁止新老并存缝补**：每个 task 合并前必须删除其淘汰清单中的老数据结构，grep 确认零残留引用。开发期不做向后兼容 shim/wrapper/deprecation 分支（AGENTS.md 约束）。新建结构取代老结构时，老结构在同 task 内删除，不保留过渡期。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 判断依据 | 缺失后果 | 状态 |
|---------|------------|-------------|---------|----------|------|
| DoD-1 统一 agent 概念、零分支 | A（AgentManager）+ ThreadCell（树态 owner，root_agent/registry）+ G（Event 字段） | task-1, task-5 | 需求要点 1；AgentCell 主/子差异仅字段 | 概念分裂、双套机制 | 待实现 |
| DoD-2 spawn 纯异步、父不阻塞 | A（spawn）+ C（mailbox/child_result 注入） | task-5 | 需求要点 2/5；SubAgentManager 阻塞语义淘汰 | 阻塞复活、A 卡死 | 待实现 |
| DoD-3 树级打断、连带销毁 | A（cancel_subtree）+ B（TaskRegistry 后序+kill+wait+关门）+ C（epoch 门卫） | task-3, task-5 | 需求要点 3；约束 16；asyncio cancellation 树传播 | 漏杀孤儿子、复活说话 | 待实现 |
| DoD-4 打断不回滚 session | C（epoch 门卫）+ ThreadCell（epoch owner） | task-4 | 第一性原理 + tool 配对约束 | session 分裂、400 | 待实现 |
| DoD-5 cancelled 剥成数据 | D（run 终态分类器）+ C（agent_loop action 二选一） | task-2, task-4 | 约束 16 | cancelled 在 runner 之上失语 | 待实现 |
| DoD-6 审批同 session + agent_id | F（_PendingApproval.agent_id + 共享 bridge + 取消 future） | task-5 | 需求要点 9 | 父 run 时子审批挂死 | 待实现 |
| DoD-7 wire 双侧坐标字段 | G（Event/流式帧）+ H（时间工具） | task-1, task-5 | 约束 17 | 运行时漂移崩溃 | 待实现 |
| DoD-8 深度 1 层通用式 | A（depth/退出条件）+ ThreadCell（树态 owner） | task-5 | 需求要点 4 | 放开时改代码 | 待实现 |

<!-- 追溯规则：每条 DoD 至少对应一个模块；每个进入实现链路的模块至少回指一个 DoD。支撑性 owner（ThreadCell，演进为树态 owner，原模块 E 已删除）回指系统不变量（epoch owner）。 -->
