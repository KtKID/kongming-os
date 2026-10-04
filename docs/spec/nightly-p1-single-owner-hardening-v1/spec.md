> spec_version: 3
> adversarial_risk_version: 3
> complexity: 5
> importance: 4
> risk_average: 4.5
> review_budget: full
> adversarial_review: complete

# nightly-p1-single-owner-hardening-v1

## 任务目标

- 后端 `ThreadStatusManager` 成为 thread 运行状态的唯一 owner；前端只保存发送中的瞬时交互态和服务端状态投影，发送失败可恢复输入且不会留下虚假 `responding`。
- `/ws/thread-status` 在每次新连接和重连时先发送带 sequence watermark 的 active-status snapshot，再按同一连接的单写队列发送增量；每次 run 在发布状态前取得 monotonic run lease，旧 run 的迟到增量或终态无法覆盖新 run。
- approval inbox 卡片在服务端 `approval.inbox.remove` 到达前保持可见；resolve 失败恢复为可重试态，snapshot、remove 与 resolve_result 的乱序组合保持幂等。
- `SessionEngine` 提供历史读取、单消息追加和空会话历史播种三个任务级异步方法；Web 首条消息、历史推送和 thread fork 全部通过公开门户调用。
- `AgentManager + TaskRegistry` 成为 workflow child 的唯一生命周期 owner；workflow 统一走 spawn 路径，Web `/subagents` 通过 `ThreadManager → HostDispatcher → AgentManager` 读取同一投影。
- scheduler 用 `TaskLifecycleState` 表达任务定义生命周期，用 `ScheduledRun.status` 表达每次执行结果；一次性任务领取、执行终态、REST DTO 与前端展示各自消费明确真源。
- Web 启动不再按 Web metadata 对全局 permissions 目录做孤儿删除；权限本子只在显式删除对应顶层 thread 时清理。
- Runner 对每个 tool call 恰好执行一次 preparation；全部默认填充、校验和语义归一化都在审批前完成，审批与执行消费这一次 preparation 的等值深拷贝，执行入口不再改变参数语义。

## 非目标

- 本规格不处理 nightly 报告中的三个 P0：`FORCE_ASK` 顺序、Shell cwd 双源、scheduler live-run cancel owner。
- 本规格不重做 Claude Code、Codex 或 generic_chat 的 provider transport；三条通道只需把 canonical phase 交给同一个 `ThreadStatusManager`。
- 本规格不持久化 thread-status active map；服务重启后的 active 状态由运行时重新发布，客户端连接后以新的空 snapshot 清除旧投影。
- 本规格不引入跨宿主 permissions namespace，也不执行全局 permissions GC；未来 GC 必须由 Safety 获取所有宿主的完整顶层 thread 清单后独立设计。
- 本规格不新增跨服务重启的子 agent 历史持久化；`TaskRegistry` 只在当前 `HostDispatcher` 生命周期内保留最多 200 条终态记录。
- 本规格不改变 scheduler 的 concurrency、misfire、manual run、delivery 或 live cancellation 策略。
- 本规格不保留旧 Web wire、旧 `ScheduledTask.enabled/state` 双字段或旧 Tool execute 签名的兼容分支；开发期直接迁移所有仓库内调用方和测试。

## 根因与修复方案

| P1 | 根因 | 修复方案 | 完成判据 |
|---|---|---|---|
| P1-1 前端虚假运行态 | `ChatManager.sendMessage()` 在 transport 成功前把 `responding` 写进 canonical thread-status store，调用页又丢弃 Promise；发送异常缺少 rollback owner | 删除 `markThreadRunning` 对 canonical store 的写入；新增独立 `ThreadDispatchState`，仅表达 `dispatching/error`；调用页显式 await/catch，失败恢复草稿、附件和引用 | canonical store 的全部写入都来自 `/ws/thread-status` 当前连接；send 抛错后 `useThreadRunning=false` 且输入可重试 |
| P1-2 审批卡提前消失 | 单次审批走本地乐观删除，`resolve_result` 仅在卡仍存在时更新，服务端冲突回执失去承载对象 | 卡片状态改为 `pending/submitting/error`；点击只进入 submitting；唯一删除事件为 authoritative `approval.inbox.remove`；失败结果恢复 pending 并展示错误 | accepted=false 后卡片仍在且可重试；remove 先于 late resolve_result 时保持已删除 |
| P1-3 status 无连接补偿 | `ThreadStatusBroadcaster` 只保存 socket 集合，服务端没有 active 状态表、连接 snapshot、run identity 或单连接发送顺序 owner | 以 `ThreadStatusManager` 收口 active map、global sequence、monotonic run lease、连接队列和 writer；producer 在 run 启动前 `begin_run`，后续 publish 必须携带 lease；attach 时原子入队 snapshot | 新 tab 首帧得到全部 active thread；重连空 snapshot 清除旧 running；attach/emit 无漏帧；旧 run terminal 不会清除新 run |
| P1-4 Web 穿透 SessionEngine | Web 通过 `_session_factory/_sessions/_get_or_create_session` 取得 raw `Session`，把缓存和后端选择细节泄露给宿主 | `SessionEngine` 新增 `read_session_history`、`append_session_message`、`seed_empty_session_history`；Web 删除 raw Session 与私有字段访问 | `src/hosts/web/` 对上述私有名和 `get_or_create_session()` 零引用；冲突哨兵证明公开方法为实际真源 |
| P1-5 child 生命周期双账本 | workflow 在 AgentManager 可用时走新 TaskRegistry，缺失时回落旧 SubAgentManager；Web 只读全局旧 registry | workflow spawn 前强制取得父 AgentManager；扩展 TaskRecord 的冻结运行身份与有界查询；Web 经 manager 门户读新投影；删除旧 subagents 生命周期/manager 和装配胶水 | 所有 child started/terminal 只写 TaskRegistry；`/subagents` 能看到同一次真实 spawn；旧符号在 `src/` 零残留 |
| P1-6 scheduler task/run 混态 | `TaskState` 同时包含 scheduled/paused 与 running/failed/completed，`enabled` 又表达一份可运行性；reserve 和 execution 分别写任务态 | 用 `TaskLifecycleState={scheduled,paused,disabled,exhausted,deleted}` 替换持久化 `enabled+state`；执行态只写 `ScheduledRun.status`；v5→v6 原子迁移并备份 | recurring run 失败后 task 仍 scheduled 且 latest run 为 failed；one-shot 领取后 task exhausted，run 独立从 running 收口 |
| P1-7 Web 误删其他宿主权限 | `cleanup_orphans(existing_web_thread_ids)` 把 Web 局部清单当成全局 thread universe | 删除 Web startup orphan scan 和 `PermissionsManager.cleanup_orphans`；保留显式 `delete_thread(thread_id)` 与失败重试 | Web 启动保留 CLI/cron/Web 全部本子；显式删除 Web thread 只删除该 thread 本子 |
| P1-8 prepare 双 owner | Runner 已 prepare 后把 arguments 传给 `BaseBuiltinTool.execute`，基类通过 `isinstance(ToolCallPreparer)` 再 prepare；审批后的 validation 仍可能默认填充、归一化或改写参数 | `Tool.execute` 消费 `PreparedToolCall`；`BaseBuiltinTool.prepare` 提供审批前默认校验，语义 preparer 在同一次调用内完成全部归一化；execute 只执行已准备快照 | prepare spy 调用数严格为 1；审批与执行看到相同 arguments/scope；审批方修改自己的副本和 execute 侧旧 normalization 都无法改变执行语义 |

## 风险评分依据

- 复杂度：5。改动跨 Web 前端交互态、全局 WS 顺序、Python/TS wire、SessionEngine 门户、Agent 树、scheduler schema 迁移、Safety 清理边界和核心 Tool 协议；同时涉及并发、持久化迁移和仓库内广泛签名收紧。
- 重要性：4。八项都影响全体 Web 或核心执行用户；错误会造成停止按钮假死、审批丢失、历史为空、子 agent 不可观测、定时任务误判、权限丢失或审批事实与实际执行分叉。
- 预算升级：平均分 4.5 对应 `full`；执行最多两个不同故障轴的独立对抗性假设。用户明确跳过 RAG，CLI 记录为 `skipped:no-corpus`。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `src/hosts/web/websocket/thread_status_manager.py` | 新目标门户 | 管理 active status、global sequence、per-thread run generation、连接状态、bounded outbound queue 和单 writer | attach 与 emit 竞态漏终态，旧 run terminal 清掉新 run，或多协程并发写同一 WS | `begin_run` 在 phase 发布前分配 lease；publish/finish 只接受当前 lease；attach 原子入队 snapshot；网络 IO 不持全局锁；每连接只有一个 writer | `J2`—`J4`、`J21` |
| `src/hosts/web/websocket/thread_status.py` | 路由/adapter | EventSink、Claude、Codex phase 映射后只调用 Manager；handler 只处理鉴权和连接生命周期 | 路径自行广播或丢失 run lease 形成第二 owner | generic/Claude/Codex 在启动异步 run 前取得 lease；路由不保存 active 状态，不直接并发 `send_json` | `J2`、`J4`、`J21` |
| `src/hosts/web/protocol/` ↔ `web/src/protocol.ts` | 双侧 wire 真源 | `ThreadStatusFrame` 增加 sequence、runId、runGeneration；新增 snapshot frame；scheduler REST DTO 收口到 protocol | 单侧字段变更或局部重复定义造成协议漂移 | Python Pydantic 与 TS 1:1；后端发送经模型校验和 `model_dump()`；未知字段按现有 strict 规则处理 | `J5`、`J14`、`J21` |
| `web/src/stores/threadStatus.ts`、`useThreadStatusWS` | 服务端投影 | snapshot 原子替换 active map；按连接 generation/sequence 忽略旧帧 | 旧 socket late frame 覆盖新 snapshot，或空 snapshot 未清旧状态 | canonical store 只接收当前连接服务端帧；snapshot 是 replace 语义；terminal frame 删除 active 项 | `J3`、`J6` |
| `ChatManager`、`Chat.tsx`、dispatch store | 瞬时 UI 状态 | 把 transport dispatch 与 thread running 分离，显式处理 reject | 本地 dispatch 再次被当作业务运行态 | dispatch state 不写 ThreadStatusFrame；失败恢复用户输入；Stop 只由 server active phase驱动 | `J1`、`J6` |
| approval inbox frontend reducer | 服务端投影 + 瞬时提交态 | 保留卡片到 authoritative remove；处理 result/remove/snapshot 乱序 | 多 tab resolve winner/loser 回执让已删除卡复活 | remove 和 snapshot omission 是终态；late failure 只作用于仍存在的 request；重连 snapshot 清除 submitting | `J7` |
| `src/runtime_assembly/session_engine.py` | session 门户 | 新增任务级历史 API，隐藏 raw Session/caches | seed 部分失败留下半段 fork，或 history fallback 静默空 | `seed_empty_session_history` 先证实目标为空，失败时清空目标并抛错；所有方法复用同一 `_get_or_create_session` | `J8`、`J9` |
| `src/hosts/web/threads/manager.py`、WS history route | SessionEngine 下游 | 首条消息、fork、history frame 改调公开任务级方法 | 当前 dirty thread-fork 继续保留新私有旁路 | Web 不取得 raw Session；fork 结构化 Message、附件复制、闭合 turn 校验和 rollback 语义保持 | `J8`、`J9` |
| `AgentManager`、`TaskRegistry`、`HostDispatcher` | child 生命周期 owner | TaskRecord 增加冻结 identity；状态查询、200 条终态裁剪；workflow 统一 spawn | close_cell 后元数据丢失、fallback 继续双写、资源账本裁剪误删 live task | live resource record 永不因裁剪删除；只裁剪最旧终态；register pending 先于 child 暴露；一个 terminal 只写一次 | `J10`、`J11` |
| `ThreadManager`、`thread_subagents` router | child 投影下游 | 经 HostDispatcher/AgentManager 公共方法返回 DTO | app.state 旧 registry 或空 fallback 隐藏配置错误 | 路由穿过真实 thread cell owner；AgentManager 未启动时返回稳定空投影，装配错误返回可诊断 5xx | `J10`、`J12` |
| scheduler domain/store/manager | 任务定义 owner | schema v6、生命周期转换、迁移、latest run summary | 迁移清空任务、一次性任务重复领取、last_run_at 保留预领取假值 | 任务生命周期与 run 结果正交；one-shot 领取原子转 exhausted；last_run_at 只来自 terminal run.finished_at | `J13`、`J15`、`J16` |
| scheduler REST/前端 | 下游投影 | 显示 lifecycle 与 latest run status 两个独立字段；移除本地混合 union | 前端重新把 failed/running 塞回 task lifecycle | task 筛选读 lifecycle；执行徽标读 latest/live run；创建意图只映射初始 lifecycle | `J13`、`J14` |
| `PermissionsManager`、Web ThreadManager | Safety owner/下游 | 删除不完整 universe 的 cleanup API 和启动调用；保留显式删除补偿 | thread 删除失败失去最终补偿，或 Web 启动误删其他宿主 | permissions 身份继续是顶层 thread_id；显式 delete 先提交 metadata，再异步重试本子清理；启动零全局删除 | `J17` |
| `core.contracts.Tool`、Runner、tools | Tool 协议真源/执行 | execute 收紧为 PreparedToolCall；Runner 单次 prepare 并深拷贝到 approval/execute；Base 默认校验迁入 prepare | 工具直调绕过 prepare、审批方修改共享 dict、执行入口审批后归一化、旧签名残留 | 全部语义变换在 prepare 完成；approval/execute 消费隔离且等值的 arguments/scope；execute 不调用 prepare/default/normalize | `J18`、`J19`、`J22` |
| 模块 README 与架构门禁 | 下游 | 更新 owner、门户、wire、scheduler 状态和 Tool 顺序说明 | 文档继续指导私有访问和双 owner | README 与代码索引同步；mypy/ruff/import-linter/protocol drift 全绿 | `J20` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | 当前 `ChatManager` 在 provider send 前调用 `markThreadRunning`，`Chat.tsx` 丢弃 send Promise，transport 未连接会抛错 | 仓库事实 | `web/src/chat/ChatManager.ts:58-99`、`web/src/chat/runtimeWiring.ts:174-180`、`web/src/pages/Chat.tsx:673`、`web/src/network/manager.ts` | 已确认 |
| J2 | 当前 `ThreadStatusBroadcaster` 只维护连接集合，handler 只给 approval inbox 推 snapshot | 仓库事实 | `src/hosts/web/websocket/thread_status.py:181-248,388-490` | 已确认 |
| J3 | active status snapshot 必须与增量共享一个序列和单连接 writer，才能覆盖 attach/emit 并发且避免同一 WS 并发发送 | 并发推断 | “先读 map 再注册”会漏事件；“先注册再直接发 snapshot”会让 broadcast 与 snapshot 交错 | 已确认 |
| J4 | active map 只保留非终态，`idle/complete/error` 广播后删除；snapshot 只列 active 项 | LLM 推断、产品语义 | 新连接只需要知道哪些 thread 正在运行；空项自然表示 idle，避免终态 map 无界增长 | 已确认 |
| J5 | Web wire 变更必须同步 Python protocol、TS protocol、后端模型序列化和 drift tests | 仓库规范 | AGENTS 约束 17；`docs/modules/Web前端/README.md:442-460` | 已确认 |
| J6 | 前端 dispatching 是 transport 交互态，Stop/running 是后端业务态；两个 store 需要独立类型和消费者 | 架构推断 | 当前虚假 responding 正来自把发送意图写入业务状态投影 | 已确认 |
| J7 | 当前 approval hook 对单次审批立即 `removeLocal`，resolve_result 只更新仍存在卡片 | 仓库事实 | `web/src/features/approval-inbox/useApprovalInbox.ts:152-168,206-229` | 已确认 |
| J8 | Session Protocol 的 `append/history/clear` 都是 async，SessionEngine 已拥有统一 `_get_or_create_session` 缓存 | 仓库事实 | `src/core/contracts/session.py`、`src/runtime_assembly/session_engine.py:468,519,737-745` | 已确认 |
| J9 | 当前 Web 首条消息、fork 和 history route 会取得 raw Session，并包含 `_get_or_create_session/_session_factory/_sessions` fallback | 仓库事实 | `src/hosts/web/threads/manager.py:954,1023,1061,1177-1193`、`src/hosts/web/websocket/routes.py:1189-1241` | 已确认 |
| J10 | AgentManager spawn 已先登记 TaskRegistry，TaskRecord 持有 status/timestamps/error；AgentCell 终态后会被注销 | 仓库事实 | `src/application/agents/manager.py:252,746-770`、`src/application/agents/registry.py:71-260` | 已确认 |
| J11 | workflow 当前按父 agent 可用性分流到 AgentManager 或旧 SubAgentManager，旧 lifecycle 文件已声明由 task-5 删除 | 仓库事实、既有规格 | `src/application/agent_workflows/manager.py:840-890`、`src/application/subagents/lifecycle.py:1-16`、`docs/spec/agent-tree-v0.1/90-task-map.md:23-25,69-77` | 已确认 |
| J12 | `/api/threads/{thread_id}/subagents` 当前只读 app.state 的旧 registry | 仓库事实 | `src/hosts/web/routers/thread_subagents.py:128-203`、`src/hosts/web/run.py:813-848,1404-1425` | 已确认 |
| J13 | `TaskState` 当前同时含 scheduled/paused/running/completed/failed，ScheduledTask 另存 enabled，ScheduledRun 已有独立 RunStatus | 仓库事实 | `src/scheduler/domain.py:93-125,429-555` | 已确认 |
| J14 | 当前 cron DTO 在 router 局部定义，前端 task union 混入 running/failed，触及共享 REST DTO 时应迁到双侧 protocol 真源 | 仓库事实、仓库规范 | `src/hosts/web/routers/cron.py:60-180`、`web/src/modules/scheduler/types.ts:10-70`、AGENTS 约束 17 | 已确认 |
| J15 | one-shot 在 reservation 阶段预写 `last_run_at/state=completed/enabled=false`，execution 终态再覆盖 last_run_at | 仓库事实 | `src/scheduler/store.py:1090-1165`、`src/application/scheduled_runs/execution_bridge.py:673-689` | 已确认 |
| J16 | scheduler 当前 schema version 为 5，任务数据保存在原子覆盖的 tasks.json，run 历史是 per-task append-only JSONL | 仓库事实 | `docs/modules/定时任务/README.md:83-100`、`src/scheduler/domain.py`、`src/scheduler/store.py` | 已确认 |
| J17 | PermissionsManager 扫描共享目录的全部 snapshot，Web 只传 Web metadata IDs；CLI/cron 顶层 thread 不在该集合 | 仓库事实 | `src/safety/approval/permissions_manager.py:229-249`、`src/hosts/web/threads/manager.py:2372-2410`、Safety 顶层 thread_id 合同 | 已确认 |
| J18 | Runner 当前在审批前 prepare，`BaseBuiltinTool.execute` 对 preparer 再 prepare | 仓库事实 | `src/core/runner.py:1780-1875,1963-1978`、`src/tools/runtime/base.py:50-62` | 已确认 |
| J19 | PreparedToolCall 和 ToolCallPreparer 已在 `core.contracts`，现有 Tool.execute 仍只接收裸 arguments | 仓库事实 | `src/core/contracts/tool_runtime.py:35-100` | 已确认 |
| J20 | 本任务修改用户可见 WS/REST、Manager 状态机、持久化 schema 和核心 Tool 合同，必须覆盖路由、状态机、前端、smoke/e2e、协议漂移及静态架构检查 | 仓库规范 | AGENTS “必需测试用例”“测试设计红线” | 已确认 |
| J21 | sequence 只能排序“Manager 收到事件”的先后；同一 thread 的旧 run terminal 在新 run start 之后到达时，缺少 run lease 会把新 active 状态错误清除 | 对抗性推断 | back-to-back run、cancel callback 和 provider transport 都可能让旧 terminal 延迟；当前 ThreadStatusFrame 没有 run identity | 已确认 |
| J22 | prepare count=1 仍不足以保证审批事实等于执行事实；execute 内 validation/default/normalization 或共享 mutable dict 都能在 approval 后改变 arguments | 对抗性推断 | 当前 BaseBuiltinTool 在 execute 内二次验证 prepared arguments；未来校验升级到 jsonschema/default coercion 时风险更高 | 已确认 |

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | user send → dispatch state → provider WS → ThreadStatusManager → snapshot/delta → status store；approval resolve → server manager → result/remove/snapshot；Session/Agent/scheduler/Tool 流见 `SC_01`、`SC_05`、`SC_10`、`SC_13`、`SC_18`、`SC_21` |
| 状态 | dispatching 与 running 分离；approval pending/submitting/error；thread active/terminal；child pending/running/terminal；task lifecycle 与 run status；见 `SC_01`、`SC_03`、`SC_06`、`SC_12`、`SC_15` |
| 时序 | status attach/snapshot/live、旧 socket late frame、旧 run terminal/new run start、approval remove/result 乱序、one-shot reserve/execute、prepare/approve/execute；见 `SC_06`—`SC_08`、`SC_14`、`SC_21`、`SC_27`、`SC_28` |
| 资源 | per-connection bounded queue + single writer；active map 只留活跃项；TaskRegistry 最多 200 条终态且 live 不裁剪；migration 临时文件/备份；见 `SC_09`、`SC_13`、`SC_17` |
| 不变量 | `影响边界与不变量`、`SC_02`、`SC_07`、`SC_11`、`SC_16`、`SC_20`、`SC_22` |
| 故障 | transport 发送失败、resolve 冲突、WS 重连/慢客户端、旧 run 迟到终态、Session seed 中断、spawn 装配缺失、schema 迁移失败、权限清理失败、prepare/审批后改写对抗值；见 `SC_01`、`SC_04`、`SC_09`、`SC_11`、`SC_14`、`SC_17`、`SC_19`、`SC_21`、`SC_27`、`SC_28` |

## 验收清单

### 单元测试

- [ ] 前端 send 成功/失败均只修改 dispatch store；失败恢复 draft/attachments/references，canonical thread status 未被本地改写（`SC_01`、`SC_02`）。
- [ ] approval reducer 覆盖 accepted=false、remove→late result、result→remove、snapshot 重连和双 tab winner/loser（`SC_03`、`SC_04`、`SC_05`）。
- [ ] ThreadStatusManager 覆盖 snapshot 首帧、attach/emit 竞态、terminal 清理、旧连接 generation、sequence 去重、慢连接队列溢出和旧 run terminal/new run start（`SC_06`—`SC_09`、`SC_27`）。
- [ ] SessionEngine 公开历史方法覆盖 read/append/seed、非空目标拒绝和部分 append rollback；Web fake 私有字段设置相反哨兵或直接抛错（`SC_10`、`SC_11`）。
- [ ] TaskRegistry identity、状态查询、live 保留、200 条终态裁剪和 terminal 幂等；workflow 缺少父 AgentManager 时在任何 child 副作用前失败（`SC_12`—`SC_14`）。
- [ ] TaskLifecycleState 转移矩阵、one-shot exhausted、recurring failed run 正交、v5→v6 映射/备份/失败回滚/last_run_at 纠偏（`SC_15`—`SC_17`）。
- [ ] Web 启动与显式 thread 删除使用 CLI/cron/Web 对抗 ID，证明局部 owner 不会删除域外本子（`SC_18`、`SC_19`）。
- [ ] preparer spy 用“第一次=A、第二次=B”的相反对抗值，断言 count=1 且 approval/execute 均为 A；审批 spy 修改自身 nested arguments 后执行仍为 A；execute 侧旧 normalization spy 不被调用；所有直接 Tool 调用迁移到 PreparedToolCall（`SC_20`—`SC_22`、`SC_28`）。
- [ ] Python/TS thread-status 与 cron REST DTO round-trip、未知字段、必填字段、枚举和 schema 生成漂移全覆盖（`SC_23`）。

### Smoke 测试

- [ ] 真实 FastAPI `/ws/thread-status` + ThreadStatusManager + TS 等价 reducer fixture：连接首帧 snapshot，随后 generic EventSink/Claude/Codex 任一路径发增量，并以旧 lease terminal 对抗新 lease responding，断言 sequence、run identity 和最终 active map（`SC_06`、`SC_07`、`SC_27`）。
- [ ] 真实 approval manager/inbox broadcaster + WS handler：两个连接同时 resolve 同一 request，断言一个 accepted、两个连接都由 remove 收口，失败方不复活卡片（`SC_05`）。
- [ ] 真实 ThreadManager → SessionEngine → FileSession 跑首条消息、history frame 和 fork，fake 只替换 LLM；断言结构化历史与 rollback（`SC_10`、`SC_11`）。
- [ ] 真实 AgentManager spawn → TaskRegistry → HostDispatcher → ThreadManager → `/subagents` 路由，fake 只替换 child LLM；断言 running/terminal 来自同一 task_id（`SC_12`、`SC_13`）。
- [ ] 真实 Store v5 fixture 迁移到 v6，经 SchedulerManager 和 cron REST 返回 lifecycle/latest_run_status，前端 mapper 分开投影（`SC_15`—`SC_17`）。
- [ ] 真实 PermissionsManager store 含三个宿主本子，Web lifespan 启动零删除；删除一个 Web thread 后只有对应 hash 文件消失（`SC_18`、`SC_19`）。
- [ ] 真实 Runner + Safety approval spy + ShellTool 执行无副作用命令，断言 canonical cwd preparation 一次、审批/执行相等，审批 spy 对 nested arguments 的修改不进入执行（`SC_21`、`SC_28`）。
- [ ] 运行目标 pytest、前端 Vitest、mypy、ruff、import-linter、`make web-protocol-check`、`git diff --check`，并用静态搜索确认私有 Session 和旧 subagent 符号零残留。

### E2E 测试

- 决策：需要
- 依据：新 tab/reconnect、双 tab approval 和 scheduler 展示都跨浏览器 store、真实 WS 顺序、REST owner 与后端状态机；单元 fixture无法证明用户可见状态最终收敛。
- [ ] 浏览器 A 启动长回复，浏览器 B 后打开同一服务；B 连接首帧 snapshot 后显示 Stop；断开重连期间 run 结束，B 收到空 snapshot 后恢复 idle，旧 socket late frame 不会复活 running（`SC_24`）。
- [ ] 两个浏览器 tab 展示同一 approval；A 成功 resolve，B 同时提交得到失败回执；两端卡片最终都消失且 B 不出现幽灵卡，服务端 pending 为空（`SC_25`）。
- [ ] scheduler 页面同时展示 recurring task lifecycle=`scheduled` 与 latest run=`failed`，one-shot 领取后 lifecycle=`exhausted` 与 live run=`running`；刷新后两组语义保持（`SC_26`）。

## 测试驱动开发

1. `SC_01`—`SC_05` → 先写前端 dispatch/approval 红灯测试，固定发送失败、卡片保留和乱序 reducer 语义。
2. `SC_06`—`SC_09`、`SC_23`、`SC_27` → 先写 ThreadStatusManager 并发模型、旧 run 迟到终态和 Python/TS wire 红灯测试，再实现 manager、run lease、snapshot、sequence、单 writer 与前端 replace。
3. `SC_10`、`SC_11` → 先让 Web fake 的私有 Session 字段抛错，证明当前首发/history/fork 失败；实现 SessionEngine 任务级方法并迁移全部 Web 消费者。
4. `SC_12`—`SC_14` → 先写真实 spawn 对旧 `/subagents` 不可见和 fallback 双路径红灯；扩展 TaskRegistry/AgentManager 查询，迁移 route，删除旧 subagents 全家桶。
5. `SC_15`—`SC_17`、`SC_23` → 先写生命周期/运行结果对抗值和 v5 fixture 迁移红灯；实现 schema v6、SchedulerManager 投影、协议 DTO 和前端分离展示。
6. `SC_18`、`SC_19` → 先写三宿主 permission 本子红灯，删除 startup global scan，保留显式 delete/retry 并同步 Safety/Web README。
7. `SC_20`—`SC_22`、`SC_28` → 先写 prepare count、A/B 哨兵、审批方 nested mutation 和 execute 侧 normalization 红灯；收紧 Tool 协议，把 Base validation/defaulting 迁入 prepare，迁移所有 Tool 实现、Runner、直接调用方和测试。
8. 完成 smoke 后执行 `SC_24`—`SC_26` 浏览器 E2E，保存失败前后截图/trace 和后端状态证据。
9. 重构后复跑 unit、Smoke、E2E、mypy、ruff、import-linter、协议漂移、静态零残留搜索和 `git diff --check`。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | full | assumption:stale-terminal-after-new-run | 功能关键词：ThreadStatusManager、run lease、active map、back-to-back run、terminal、WebSocket snapshot；Risk：旧 run 的迟到 terminal 在新 run responding 后到达，按 thread_id 清除新 run 的 active 状态 | 无 | SC_07 | SC_27 | skipped:no-corpus |
| ARV-2 | full | assumption:post-approval-argument-mutation | 功能关键词：PreparedToolCall、Runner、approval、BaseBuiltinTool、deep copy、normalization；Risk：prepare 只调用一次，但审批共享 dict 或 execute 内校验在 approval 后改变真正执行参数 | 无 | SC_21 | SC_28 | skipped:no-corpus |

## Scenarios

### Scenario SC_01: transport 发送失败只回滚瞬时 dispatch

- **GIVEN** 当前 thread 的服务端 status snapshot 为空，Composer 持有文本、附件和引用，provider WS 尚未连接
- **WHEN** 用户发送且 transport 抛出连接错误
- **THEN** dispatch 从 `dispatching` 进入可展示错误后恢复 idle，文本、附件和引用仍可重试；thread-status store 没有新增 `responding`，Stop 不显示
- 测试层：unit
- 依据：`J1`、`J6`
- 来源：initial-spec

### Scenario SC_02: transport 成功与服务端 running 分阶段展示

- **GIVEN** thread 当前 idle，transport 可以发送，服务端稍后发布 `responding`
- **WHEN** 用户点击发送
- **THEN** Composer 先以独立 dispatching 态禁用重复提交；send resolve 后 dispatching 清除；只有服务端 frame 到达后 `useThreadRunning` 才为 true 并显示 Stop
- 测试层：unit
- 依据：`J6`
- 来源：initial-spec

### Scenario SC_03: approval resolve 失败保留可重试卡片

- **GIVEN** request 卡片处于 pending，服务端因 revision 冲突返回 `accepted=false,error`
- **WHEN** 用户点击单次允许
- **THEN** 卡片先进入 submitting，失败回执后回到 pending 并显示 error；卡片、remember candidate 和按钮仍可用于下一次提交
- 测试层：unit
- 依据：`J7`
- 来源：initial-spec

### Scenario SC_04: approval remove 与 late result 乱序保持幂等

- **GIVEN** request 已收到 authoritative `approval.inbox.remove`，随后当前 tab 收到同 request 的 accepted=false resolve_result
- **WHEN** reducer 依次处理两帧
- **THEN** request 保持不存在，late result 被安全忽略且不重建卡片；反向顺序最终同样以 remove 收口
- 测试层：unit
- 依据：`J7`
- 来源：initial-spec

### Scenario SC_05: 双 tab 同时 resolve 只保留服务端终态

- **GIVEN** 两个连接的 snapshot 都含同一 pending request
- **WHEN** 两个 tab 同时 resolve，服务端接受一个并拒绝另一个
- **THEN** 服务端只执行一次 decision 并广播一次 remove；两个 tab 最终都无该卡，失败方的 late result 不复活 request
- 测试层：smoke
- 依据：`J7`、`J20`
- 来源：initial-spec

### Scenario SC_06: 新连接首帧是 active-status snapshot

- **GIVEN** Manager active map 已含 thread A=`responding` 和 B=`tool_running`，global sequence 为 41
- **WHEN** 新 `/ws/thread-status` 连接 attach
- **THEN** 该连接单 writer 的首个业务帧是 snapshot，watermark=41 且只含 A/B canonical frame；后续 frame sequence 大于 41
- 测试层：smoke
- 依据：`J2`—`J4`
- 来源：initial-spec

### Scenario SC_07: attach 与 terminal emit 并发不漏帧

- **GIVEN** attach 正在登记连接并创建 snapshot，同时 thread A 收口 idle
- **WHEN** 两个协程在 manager lock 边界交错
- **THEN** 连接观察到“snapshot 含 A 后跟 terminal”或“snapshot 已不含 A”其中一种完整顺序，最终 active map 无 A，连接永远不会停在 A running
- 测试层：unit
- 依据：`J3`、`J4`
- 来源：initial-spec

### Scenario SC_08: 重连 snapshot 清除旧状态并隔离旧 socket

- **GIVEN** 前端旧连接曾保存 A=`responding`，断线期间 A 已结束，新连接 snapshot 为空，旧连接随后迟到一帧 A=`tool_running`
- **WHEN** hook 切换 connection generation 并应用新 snapshot
- **THEN** store 原子清空 A，旧 generation 的迟到帧被忽略，A 保持 idle
- 测试层：unit
- 依据：`J3`、`J6`
- 来源：initial-spec

### Scenario SC_09: 慢连接队列溢出走可恢复断连

- **GIVEN** 一个客户端停止读取，per-connection outbound queue 达到固定上限，其他连接正常
- **WHEN** Manager 继续发布 phase
- **THEN** 慢连接被关闭并清理 writer/queue，其他连接和 global active map继续工作；客户端重连后通过 snapshot 收敛，Manager 不静默丢 terminal
- 测试层：unit
- 依据：`J3`、资源不变量
- 来源：initial-spec

### Scenario SC_10: Web 历史链只调用 SessionEngine 任务级门户

- **GIVEN** runtime 的公开 history 返回哨兵 B，所有 `_session_factory/_sessions/_get_or_create_session` 访问都会抛错或返回相反哨兵 A
- **WHEN** Web 发送 history frame、创建首条消息并读取 fork source history
- **THEN** 三条链路都得到 B 并成功；私有字段访问次数为 0，Web 从未获得 raw Session
- 测试层：smoke
- 依据：`J8`、`J9`
- 来源：initial-spec

### Scenario SC_11: fork 目标历史播种失败原子清空

- **GIVEN** source 有一段闭合结构化历史，target 为空，session backend 在第 N 条 append 抛错
- **WHEN** `seed_empty_session_history` 播种 target
- **THEN** 方法清空 target 并抛出原始可诊断错误；ThreadManager 后续删除 target metadata 和已复制附件，source 历史不变
- 测试层：unit
- 依据：`J8`、`J9`
- 来源：initial-spec

### Scenario SC_12: workflow child 从 spawn 到 Web 投影共用 TaskRecord

- **GIVEN** workflow 通过父 AgentManager spawn 一个 child，TaskRegistry 先登记 pending identity
- **WHEN** child 进入 running 后 completed，Web 在两个时点查询 `/subagents`
- **THEN** 两次 DTO 使用同一个 task_id/agent_id/session_id/workflow_id，状态依次 running/completed，started_at 不变且 terminal 只写一次
- 测试层：smoke
- 依据：`J10`—`J12`
- 来源：initial-spec

### Scenario SC_13: TaskRegistry 裁剪只作用于最旧终态

- **GIVEN** 一个 thread 有 live pending/running records 和超过 200 条 terminal records
- **WHEN** 新 terminal 写入触发 retention
- **THEN** 所有 live record 保留，terminal 只保留按 updated/finished 坐标排序的最新 200 条，Web limit/include_finished 投影稳定
- 测试层：unit
- 依据：`J10`
- 来源：initial-spec

### Scenario SC_14: 缺失父 AgentManager 时 workflow 早失败

- **GIVEN** workflow request 缺少已 boot 的父 AgentManager 或 parent agent identity
- **WHEN** manager 尝试启动第一个 child
- **THEN** 在创建 child session、workdir、TaskRecord、audit started 和 LLM 请求前返回稳定配置错误；旧 SubAgentManager fallback 调用次数为 0
- 测试层：unit
- 依据：`J11`
- 来源：initial-spec

### Scenario SC_15: recurring 失败只改变 run status

- **GIVEN** lifecycle=`scheduled` 的 recurring task 触发一次 run，Runner 返回失败
- **WHEN** ExecutionBridge 写 terminal ScheduledRun
- **THEN** task lifecycle 仍为 scheduled、next_run_at 已按 trigger 推进、last_run_at 等于该 run.finished_at，latest_run_status 为 failed
- 测试层：smoke
- 依据：`J13`、`J15`
- 来源：initial-spec

### Scenario SC_16: one-shot 领取原子转 exhausted 并独立收口 run

- **GIVEN** 到期 one-shot lifecycle=`scheduled` 且尚无 reservation
- **WHEN** tick 原子领取
- **THEN** task 同步变为 exhausted、next_run_at 为空且 last_run_at 仍为空，只生成一个 reservation；对应 ScheduledRun 独立从 running 收口 terminal，完成后才写 last_run_at
- 测试层：unit
- 依据：`J13`、`J15`
- 来源：initial-spec

### Scenario SC_17: scheduler v5→v6 迁移可恢复且纠正时间语义

- **GIVEN** v5 fixture 同时含 scheduled、paused、disabled、one-shot completed、recurring failed/running、deleted 和一个预领取但无 terminal run 的 last_run_at
- **WHEN** Store 首次加载并迁移
- **THEN** 原文件先写唯一备份，再原子写 schema v6；各 task 按确定性矩阵映射，last_run_at 优先取最新 terminal run.finished_at，无 terminal 的预领取值清空并写 migration audit；任何解析/写入失败保留 v5 原文件并让启动明确失败
- 测试层：unit
- 依据：`J13`、`J16`
- 来源：initial-spec

### Scenario SC_18: Web 启动保留所有宿主 permissions 本子

- **GIVEN** shared store 有 `web-A`、`cli-B`、`cron-C` 三个合法顶层 thread 本子，Web metadata 只含 A
- **WHEN** Web lifespan 启动 ThreadManager
- **THEN** 三个 snapshot 内容和 revision 全部不变，启动路径没有枚举后删除 permissions 文件
- 测试层：smoke
- 依据：`J17`
- 来源：initial-spec

### Scenario SC_19: 显式删除只清理目标 Web thread

- **GIVEN** A/B/C 三个本子存在，用户显式删除 Web thread A
- **WHEN** metadata 删除提交并执行 permissions cleanup
- **THEN** 只有 A 的本子被删除，B/C 保持；A 清理失败时进入现有可观测重试且 metadata 删除结果不回滚
- 测试层：smoke
- 依据：`J17`
- 来源：initial-spec

### Scenario SC_20: 普通 Tool 获得默认 PreparedToolCall

- **GIVEN** 一个未实现 ToolCallPreparer 的 Tool 收到 arguments
- **WHEN** Runner 进入审批前准备
- **THEN** Runner 构造 execution_scope 为空的 PreparedToolCall，approval 与 execute 收到等值深拷贝，原始 model arguments 不被 Tool 修改
- 测试层：unit
- 依据：`J18`、`J19`
- 来源：initial-spec

### Scenario SC_21: preparer 只调用一次且审批执行同值

- **GIVEN** spy preparer 第一次返回 arguments=A/scope=A，第二次会返回相反的 B
- **WHEN** Runner 审批并执行该工具
- **THEN** prepare count=1，ApprovalRequest 与 Tool.execute 都观察 A，B 永远不可见；审批拒绝时 execute count=0
- 测试层：smoke
- 依据：`J18`、`J19`
- 来源：initial-spec

### Scenario SC_22: BaseBuiltinTool 与直接 Tool 调用方不再隐式 prepare

- **GIVEN** BaseBuiltinTool 子类同时实现 preparer，仓库内测试或 adapter 需要直接执行
- **WHEN** 调用方先显式构造/获取 PreparedToolCall 再调用 execute
- **THEN** BaseBuiltinTool 只校验 prepared.arguments 并执行 `_run`；全仓 `prepare(` 的生产调用点只有 Runner，旧裸 dict execute 调用在 mypy/静态搜索中为零
- 测试层：unit
- 依据：`J18`—`J20`
- 来源：initial-spec

### Scenario SC_23: Python/TS wire 与 scheduler DTO 同步漂移门禁

- **GIVEN** thread-status snapshot/sequence 和 scheduler lifecycle/latest_run_status 已加入 Python Pydantic 真源
- **WHEN** 生成或检查 TS protocol 并跑双侧 round-trip fixtures
- **THEN** 字段名、必选性、nullability、枚举和值完全一致；后端发送端只输出模型校验结果；局部重复 DTO/union 静态搜索为零
- 测试层：unit
- 依据：`J5`、`J14`、`J20`
- 来源：initial-spec

### Scenario SC_24: 新 tab 与重连端到端收敛运行态

- **GIVEN** 浏览器 A 的 thread 正在长回复，浏览器 B 先后经历新开、断线和重连
- **WHEN** B 在运行中首次连接，并在断线期间等待 run 完成后重连
- **THEN** 首次连接显示 Stop；重连后显示 idle；旧连接帧不改变新连接结果，刷新页面得到同样状态
- 测试层：e2e
- 依据：`J2`—`J6`
- 来源：initial-spec

### Scenario SC_25: 双 tab approval 端到端收敛

- **GIVEN** 两个浏览器 tab 都显示同一 pending approval
- **WHEN** 两端同时选择不同 decision
- **THEN** 服务端只接受一个，两个 UI 最终都移除卡片，工具只按 accepted decision 继续一次，刷新后 pending snapshot 为空
- 测试层：e2e
- 依据：`J7`、`J20`
- 来源：initial-spec

### Scenario SC_26: scheduler 生命周期与运行结果端到端分开展示

- **GIVEN** 一个 recurring task 最新 run 失败，一个 one-shot 已领取且 run 仍运行
- **WHEN** 用户打开 scheduler 页面并刷新
- **THEN** recurring 同时显示“已调度”和“最近失败”，one-shot 同时显示“已耗尽”和“运行中”；筛选生命周期不会被运行结果字段改变
- 测试层：e2e
- 依据：`J13`—`J16`
- 来源：initial-spec

### Scenario SC_27: 旧 run 迟到终态不能清除新 run

- **GIVEN** thread A 的 run-1 已取得 generation=7 lease，run-2 随后取得 generation=8 lease并发布 responding，run-1 的 terminal 因 cancel callback 延迟才到达
- **WHEN** ThreadStatusManager 收到携带 generation=7 的 run-1 terminal
- **THEN** Manager 忽略该 stale terminal，active map 与连接增量仍保持 run-2/generation=8 responding；run-2 自己的 terminal 才能清除 A
- 测试层：smoke
- 依据：`J21`
- 来源：adversarial-review (assumption:stale-terminal-after-new-run)

### Scenario SC_28: 审批后参数副本和执行入口都不能改写语义

- **GIVEN** preparer 产出 nested arguments=A/scope=A，ApprovalProvider 尝试把自己收到的 nested dict 改成 B，BaseBuiltinTool 的旧 execute validation 也会把缺省字段归一化成 C
- **WHEN** Runner 获得 approved decision 并调用 Tool.execute
- **THEN** approval mutation 只影响隔离副本，执行看到完整 A/scope=A；execute 侧 normalization 调用数为 0，默认填充与语义校验只在唯一 prepare 内发生
- 测试层：smoke
- 依据：`J22`
- 来源：adversarial-review (assumption:post-approval-argument-mutation)
