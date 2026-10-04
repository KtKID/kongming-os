# Task Map

落地顺序铁律：**mailbox 是地基，spawn 是住户**。每步独立可测可单独提交。

> **淘汰清理验收项（硬约束，AGENTS.md：开发期不做过度兼容）**：每个 task 合并前必须删除其淘汰清单中的老数据结构，grep 确认零残留引用才能合并。新建结构取代老结构时，老结构在同 task 内删除，不保留过渡期、不写向后兼容 shim/wrapper/deprecation 分支。

| 模块 | 建议 task 名 | 为什么先/后做 | 判断依据 | 前置依赖 | 对应 DoD | 风险 | 缺失后果 | 状态 | 备注 |
|------|--------------|--------------|---------|---------|---------|------|----------|------|------|
| G · Event/wire | `agent-tree-event-coords`（task-1） | 先做：纯加法，下游全消费，最先稳定 | 需求要点 14 + 约束 17；Event 三坐标字段是 agent_loop/前端基础 | 无 | DoD-7 | 低 | 加法遗漏、漂移崩溃 | 可进入 x-req | 步骤 1 |
| D · run 终态分类器 | `agent-tree-outcome-classifier`（task-2） | 次做：纯函数吃现有 Result，下游 action 二选一依赖 | 约束 16（cancelled 收口已是翻译层雏形）；处置集中到 match | 无（吃现有 Result） | DoD-5 | 低 | 分类遗漏、action 落空 | 可进入 x-req | 步骤 2 |
| B · TaskRegistry | `agent-tree-task-registry`（task-3） | 第三：账本地基，被 A/C 依赖；单 agent 退化先跑通 | 不变量登记先于暴露；cancel_subtree 后序+kill+wait | 无 | DoD-3 | 中（kill+wait 兜底） | 漏杀孤儿子 | 可进入 x-req | 步骤 3，单 agent 退化形态 |
| C · Mailbox + ThreadCell（树态 owner） | `agent-tree-loop-mailbox`（task-4） | 第四：最难竞态集中地，建议先 PoC epoch 门卫；ThreadCell→AgentCell 演进；**双 queue 优先级**（需求要点 16） | 约束 16 + 唯一 run loop；epoch 门卫是打断正确性核心 | task-1, task-2, task-3 | DoD-2, DoD-4, DoD-5 | 高（epoch 盖章时机、三段时间线、双 queue 取法） | 复活说话、失聪、用户消息被 child_result 抢先 | 探索中（先 PoC） | 步骤 4，单 agent |
| A · AgentManager + F · 审批 + G · wire 树帧 | `agent-tree-spawn`（task-5） | 最后：组合 task 1-4 产物 + 收编 SubAgentManager + 审批 bridge 共享 + 用量分桶 + wire 协议加树帧与流式 agent_id | 需求要点 1/9/15；铁律 mailbox 先行 | task-1, task-2, task-3, task-4 | DoD-1, DoD-2, DoD-3, DoD-6, DoD-8 | 高（核心链路、cancel 时序竞态） | 主链路不可用 | 探索中 | 步骤 5，多 agent |

## 淘汰清理验收项（合并门槛）

每个 task 的合并门槛：必须删除以下老结构，grep 确认零残留才能合并。

| task | 淘汰清理项 | 验收命令 |
|------|-----------|---------|
| task-1 | Event.timestamp_ms inline `time.time()` → 统一时间工具 `now_epoch_ms()`；移除散落 epoch-ms local helper（`repo:src/sessions/task_progress_models.py:23` current_time_ms、`repo:src/hosts/web/websocket/event_sink.py:61`、`repo:src/hosts/web/websocket/thread_status.py:88` 等 ~8 处）改调统一工具 | `grep -rn "time.time()" src/` 确认 epoch-ms 取时点全部走统一工具 |
| task-2 | 无（纯新建 run 终态分类器，无老数据结构冲突） | — |
| task-3 | SubAgentLifecycleRecord / SubAgentLifecycleStore 审计字段迁移到 TaskRecord 后，删除 `repo:src/application/subagents/lifecycle.py` 中相关 class；SubAgentLifecycleRegistry 全局单例标记 deprecated（task-5 正式删除） | `grep -rn "SubAgentLifecycleRecord\|SubAgentLifecycleStore" src/` 确认零残留 |
| task-4 | ThreadCell.current_run_task 单一 task 字段演进为 tree 驱动后，清理旧 interrupt 直接 cancel current_run_task 逻辑（改为 cancel_subtree） | `grep -rn "current_run_task" src/hosts/web/threads/` 确认旧 cancel 逻辑已清除 |
| task-5 | **彻底删除**：SubAgentManager 整个类（含 run_task 阻塞语义 `repo:src/application/subagents/manager.py`）、SubAgentLifecycleRegistry 全局单例、SubAgentTask / SubAgentRun / ResolvedSubAgentRuntime 旧数据结构、SubAgentGrant.working_dir / ResolvedSubAgentRuntime.role_id/role_nickname/role_description（被 AgentCell.cwd/role_id 取代）、AgentWorkflowManager 里调用 SubAgentManager 的胶水代码（`repo:src/application/agent_workflows/manager.py`）、`repo:src/tools/agent_workflow_tool.py` 里两个 LLM 工具入口对 SubAgentManager 的直接依赖 | `grep -rn "SubAgentManager\|SubAgentLifecycleRegistry\|SubAgentTask\|SubAgentRun\|ResolvedSubAgentRuntime\|SubAgentGrant" src/` 确认零残留 |

## Task 详情

### task-1：`agent-tree-event-coords`（步骤 1）

- **对应模块**：G · Event/wire 协议扩展
- **DoD**：DoD-7（Event 带 agent_id/task_id/conversation_id；wire 双侧同步；Message 不加字段）
- **范围**：Event 加 3 坐标字段；ToolContext 加 agent_id；TS/Python 双侧 fixture 同步；漂移测试；同步引入统一时间工具（模块 H），移除散落 epoch-ms local helper 改调统一工具。
- **前置依赖**：无
- **风险**：低（纯加法）；需漂移测试保证双侧一致
- **PoC 建议**：无；漂移测试即验收
- **淘汰清理验收项**：Event.timestamp_ms inline `time.time()` → 统一时间工具 `now_epoch_ms()`；移除散落 epoch-ms local helper（`repo:src/sessions/task_progress_models.py:23` current_time_ms、`repo:src/hosts/web/websocket/event_sink.py:61` 等 ~8 处）改调统一工具。验收命令 `grep -rn "time.time()" src/` 确认 epoch-ms 取时点全部走统一工具

### task-2：`agent-tree-outcome-classifier`（步骤 2）

- **对应模块**：D · run 终态分类器
- **DoD**：DoD-5（cancelled 剥成数据，处置集中到 agent_loop match）
- **范围**：Disposition 单 dataclass（action + reason + tree_wide）；classify_result 纯函数；reason 映射表（对齐 claude query.ts）；build_mail 单一 Mail 构造助手（按 reason 决定 payload）。
- **前置依赖**：无（吃现有 `repo:src/core/result.py::Result`）
- **风险**：低（纯函数）；约束 16 已为 cancelled 铺好
- **PoC 建议**：无；单元测试每个 Result.status+metadata 组合即验收
- **淘汰清理验收项**：无（纯新建，无老数据结构冲突）

### task-3：`agent-tree-task-registry`（步骤 3）

- **对应模块**：B · TaskRegistry
- **DoD**：DoD-3（树级打断、连带销毁）
- **范围**：TaskRecord（审计字段迁移自 SubAgentLifecycleRecord）；register_run/register_external/cancel_subtree/close_registry/no_live_descendants；单 agent 退化形态先跑通账本/kill+wait 兜底/关门标志。
- **前置依赖**：无（纯账本，单 agent 退化）
- **风险**：中（kill+wait 兜底正确性、关门标志 double-check）
- **PoC 建议**：无；单 agent 退化形态即最小验证（真实 subprocess 验证 kill+wait）
- **淘汰清理验收项**：SubAgentLifecycleRecord / SubAgentLifecycleStore 审计字段迁移到 TaskRecord 后，删除 `repo:src/application/subagents/lifecycle.py` 中相关 class；SubAgentLifecycleRegistry 全局单例标记 deprecated（task-5 正式删除）。验收命令 `grep -rn "SubAgentLifecycleRecord\|SubAgentLifecycleStore" src/` 确认零残留

### task-4：`agent-tree-loop-mailbox`（步骤 4）

- **对应模块**：C · Mailbox + agent_loop（含 ThreadCell 树态 owner）
- **DoD**：DoD-2（spawn 纯异步）、DoD-4（打断不回滚 session）、DoD-5（agent_loop match）
- **范围**：Mail；AgentCell（单 agent 退化，parent_id=None，**双 queue：user_inbox + agent_inbox**）；ThreadCell（树态 owner，epoch owner）；agent_loop 协程（**先 drain user_inbox → wait_either 合并等 → epoch 门卫 → run_task → classify_result → Disposition → 按 action 二选一**，epoch 用 `current_epoch_getter` 实时读不用 int 快照）；验证串行消费/epoch 门卫/双 queue 优先级/Disposition action 二选一闭环。
- **前置依赖**：task-1（Event 字段）、task-2（Disposition）、task-3（TaskRegistry）
- **风险**：高（epoch 盖章时机、三段时间线）——**强烈建议先 PoC**
- **PoC 建议**：见下表
- **淘汰清理验收项**：ThreadCell.current_run_task 单一 task 字段演进为 tree 驱动后，清理旧 interrupt 直接 cancel current_run_task 逻辑（改为 cancel_subtree）。验收命令 `grep -rn "current_run_task" src/hosts/web/threads/` 确认旧 cancel 逻辑已清除

### task-5：`agent-tree-spawn`（步骤 5）

- **对应模块**：A · AgentManager（+ F 审批 + G wire 树帧）
- **DoD**：DoD-1（统一 agent）、DoD-2（spawn 异步）、DoD-3（树级打断）、DoD-6（审批同 session）、DoD-8（深度 1 层通用式）
- **范围**：AgentManager（收编 SubAgentManager + SubAgentLifecycleRegistry）；spawn = 建 AgentCell + 登记 registry + Disposition 上投；cancel_subtree 编排；审批 bridge 共享 + _PendingApproval.agent_id + 取消 pending future；用量分桶；wire 协议加树帧与流式 agent_id。
- **前置依赖**：task-1, task-2, task-3, task-4
- **风险**：高（核心链路、cancel 时序竞态、wire 双侧）
- **PoC 建议**：单 agent 形态（task-3/4）先行降险；多 agent spawn 用对抗性检验（B 恰在 cancel 瞬间完成）
- **淘汰清理验收项**：**彻底删除**——SubAgentManager 整个类（含 run_task 阻塞语义 `repo:src/application/subagents/manager.py`）、SubAgentLifecycleRegistry 全局单例、SubAgentTask / SubAgentRun / ResolvedSubAgentRuntime 旧数据结构、SubAgentGrant.working_dir / ResolvedSubAgentRuntime.role_id/role_nickname/role_description（被 AgentCell.cwd/role_id 取代）、AgentWorkflowManager 里调用 SubAgentManager 的胶水代码（`repo:src/application/agent_workflows/manager.py`）、`repo:src/tools/agent_workflow_tool.py` 里两个 LLM 工具入口对 SubAgentManager 的直接依赖。验收命令 `grep -rn "SubAgentManager\|SubAgentLifecycleRegistry\|SubAgentTask\|SubAgentRun\|ResolvedSubAgentRuntime\|SubAgentGrant" src/` 确认零残留

## PoC / 排序依据

| task | PoC 目标 | 通过标准 | 失败后的备选方向 | 排序依据 |
|------|----------|----------|------------------|----------|
| `task-4-poc`（epoch 门卫 + 双 queue） | 验证 epoch 门卫在三段时间线的正确性 + 双 queue 优先级：旧世代内部投递丢弃、user_message 永不过期、run_epoch 盖章时机正确、用户消息优先于 child_result | 对抗性检验（B 恰在 cancel 瞬间完成 → 旧 epoch 结果被拦截；段3 session 已提交保留只拦上投 envelope）全通过；**优先级测试**（user_inbox 和 agent_inbox 同时非空，或用户消息晚于 child_result 到达，先消费 user_inbox 全部）；agent_loop 不失聪、不复活说话 | 改用 run_epoch 在 Runner 入参显式传入（而非 agent_loop 捕获 mail.epoch），降低盖章时序耦合 | 高风险且影响主链路（DoD-2/4/5）；epoch 门卫是打断正确性核心，双 queue 是用户消息优先级保证，先验证再铺开 |
| `task-3`（单 agent 退化） | cancel_subtree 后序 + kill+wait + 关门标志在单 agent 形态跑通 | 真实 subprocess kill+wait 无僵尸；关门标志拒绝新登记 | 无（退化形态即可行） | 账本是地基，被 A/C 依赖，先行降险 |

排序总原则：
1. 高风险且会影响主链路的模块排在前面（task-4 高风险先 PoC）。
2. 被多个模块依赖的边界类优先稳定（task-1 Event 字段下游全消费、task-2 Disposition 下游 action 二选一依赖）。
3. mailbox 是地基（task-4），spawn 是住户（task-5）。
