> spec_version: 3
> adversarial_risk_version: 3
> complexity: 5
> importance: 4
> risk_average: 4.5
> review_budget: full
> adversarial_review: complete

# scheduled-thread-submit-run-v1

## 任务目标

- 新增宿主无关的 `ScheduledRunManager.submit_scheduled_run(...)` 作为 cron 自动触发、手动触发和测试触发的唯一运行入口；Web 与 CLI 装配同一门户。
- cron ticker 只扫描和预留到期任务，再调用 `submit_scheduled_run` 完成快速提交；运行 task、并发槽位、取消、关闭和结果收口全部归 `ScheduledRunManager`。
- 每次 scheduled run 复用普通 thread 的 `HostDispatcher → AgentManager → TaskRegistry → SessionEngine/Runner` 启动链，`TaskRegistry` 的真实可取消 handle 同时绑定 `thread_id/task_id/run_id/session_id`。
- 保持 scheduled task 的两层身份：稳定 `thread_id` 表示任务入口，每次执行使用独立 `run_id + session_id`；同一任务的多次历史继续隔离。
- `FORBID / ALLOW / REPLACE` 基于 live owner 做原子准入；`REPLACE` 先取消并等待旧真实 run 收口，再启动新 run，旧 run 的迟到结果和投递无法覆盖取消终态。
- 同一 reservation 的并发提交与结果未知重试复用同一个 run identity 和最终结果，重复提交不会产生第二次模型调用或投递。
- Store 在消费调度游标前写入带稳定身份和任务快照的 `RESERVED`；进程重启会重新提交同一 run，Runner 真正启动时再原子写 `RUNNING + started_at`。
- 定时任务面板继续实时显示运行中状态、最终状态、结果摘要、失败原因和投递结果；刷新后通过持久化 `ScheduledRun` 恢复同一结果。
- 保留 cron 专属运行语义：任务级模型快照、工具裁剪、task 级审批模式、inactivity watchdog、per-run trace、`[SILENT]`、delivery 和审计。

## 非目标

- 本规格保留现有 cron 表达式、misfire、manual-run reservation、task lifecycle、fresh session 和投递目标语义。
- 本规格保留 `ScheduledTask` 与 `ScheduledRun` 的持久化数据格式；只有并发安全需要新增的运行租约或终态版本字段可进入 schema 迁移。
- 本规格保留 scheduled run history 的只读 timeline、run 内人工追问和 legacy shared-history 行为。
- 本规格排除 scheduler Store 的 SQLite 化、多进程 leader election、分布式执行和跨主机 live cancellation。
- 本规格排除 provider transport 重写；模型调用仍由唯一 `Runner` 推进。
- 本规格直接迁移仓库内调用方和测试，删除旧 ticker `ExecutionBridge` 参数、旧 raw `asyncio.Task` in-flight 集合和兼容 wrapper。

## 根因与目标架构

当前 ticker 为每条 reservation 直接执行 `asyncio.create_task(_run_one(...))`，只把 handle 放进匿名 `set[asyncio.Task[None]]`。`ScheduledRun` 已持有 `thread_id/task_id/run_id/session_id`，该业务身份没有索引到 live handle；`REPLACE` 只能把 Store 中旧行写成 `CANCELLED`，旧 Runner 仍可继续执行、写终态和投递消息。

目标调用链：

```text
ticker
  └─ Store.reserve_due_tasks()
      ├─ 生成稳定 reservation_id/run_id/session_id
      ├─ 写 ScheduledRun(RESERVED) + frozen task snapshot
      └─ 推进 task 调度状态
  └─ Store.list_reserved_reservations()
      └─ await ScheduledRunManager.submit_scheduled_run(reservation)
          ├─ 按 reservation_id 幂等占位，复用 Store 身份
          ├─ 登记 owned pending run
          ├─ 按 task_id 原子执行 FORBID/ALLOW/REPLACE 准入
          ├─ 进入 manager 持有的 max_inflight 槽位
          ├─ Runner 启动时写 ScheduledRun(RUNNING) + cron.run.started
          └─ HostDispatcher
              └─ AgentManager
                  └─ TaskRegistry(thread_id/task_id/run_id/session_id → live Task)
                      └─ ExecutionBridge 组装 RunExecutionOverrides
                          └─ SessionEngine.run
                          └─ Runner
          └─ CAS 收口 terminal → 清理 live 索引 → cron.run.finished
```

`ScheduledRunManager` 持有两层运行索引：

- `run_id → ScheduledRunCell`：保存冻结身份、owner task、`HostDispatcher`、准入代次和终态状态。
- `task_id → set[run_id]`：服务 `ALLOW` 多 run、`FORBID` 判定、`REPLACE` 全量取消和 task 面板 live 投影。
- `reservation_id → run_id/receipt/result`：服务同一 reservation 的并发提交和结果未知重试；终态后按固定上限保留幂等结果。

## 风险评分依据

- 复杂度：5。改动跨 ticker、scheduler application portal、HostDispatcher、AgentManager/TaskRegistry、SessionEngine 运行参数、Store 终态写入、CLI/Web lifespan、REST/WS 协议和前端面板；同时涉及并发准入、取消传播、迟到写防护、持久化恢复和资源关闭。
- 重要性：4。该链路覆盖全部定时任务用户；错误会造成重复副作用、替换任务继续执行、面板假状态、运行结果丢失、关闭时孤儿任务或 scheduled thread 历史串线。
- 预算升级：平均分 4.5 对应 `full`；并发取消与持久化/投递属于两个独立故障轴，需要 RAG Top5 与独立失败假设审查。

## 影响边界与不变量

| 模块 | 角色 | 本次影响 | 主要风险 | 必须保持的不变量 | 依据 |
|---|---|---|---|---|---|
| `src/scheduler/ticker.py` | 触发器 | 参数改为 `ScheduledRunManager` 门户；预留后逐条调用 `submit_scheduled_run`；移除 `_run_one`、Semaphore、inflight 集合和 drain | ticker 再次持有运行 task，形成第二 owner | ticker 只拥有 tick loop 自身；提交成功表示运行已被 Manager 接管；单 run 完成速度不阻塞下一次 tick | `J1`、`J8` |
| `src/application/scheduled_runs/manager.py` | 新目标门户 / live owner | 新增 `ScheduledRunManager`、`ScheduledRunCell`、`ScheduledRunSubmitReceipt`、live/幂等索引、并发槽位、准入锁、关闭和结果收口 | 注册与取消竞态产生无 owner task；同 task 并发误判；关闭遗漏 pending run；重试产生重复副作用 | live handle 暴露前完成身份登记；每个 reservation 恰好一个 run identity 和 terminal；所有 task 均可由 run_id 和 task_id 找回并取消 | 用户任务、`J2`—`J6`、`J18` |
| `src/application/scheduled_runs/execution_bridge.py` | 旧执行编排 | cron 专属 plan 构造、结果分类、delivery、audit 能力迁入 Manager 或拆成私有 helper；删除 direct `Runner.run()` 与 raw task 创建 | 保留第二套运行入口，或迁移时丢失审批/工具/watchdog/trace 语义 | 唯一 turn loop 仍是 `Runner`；实际 run task 只由 AgentManager/TaskRegistry 启动并登记；cron 专属语义逐项保持 | `J3`、`J7` |
| `src/hosts/shared/host_dispatcher.py` | 共用启动门户 | 接收 typed scheduled execution context，显式区分稳定 `thread_id` 与 fresh `session_id`，把 `run_id/task_id/source` 传给下游 | 回落 `thread_id=session_id` 造成权限本子、事件和历史归属错误 | ordinary run 默认 `thread_id=session_id`；scheduled run 显式使用 task thread_id；Result 回到同一 submission future | `J4`、`J9` |
| `src/application/agents/manager.py`、`loop.py`、`registry.py` | live resource owner | root run 登记完整 scheduled identity；提供按 task record 或 run identity 取消/查询的 Manager 方法 | 只取消业务投影，真实 Task 继续运行；匿名字段无法定位 handle | TaskRegistry record 注册先于 started 对外可见；`run_id → handle` 唯一；取消会 await handle 与外部 PID 收回；具名 callback 使用显式 Task 类型 | `J2`、`J10` |
| `src/runtime_assembly/session_engine.py` | 唯一 Runner 门户 | 通过显式 typed run overrides 承载 cron 的 run_id、AgentSpec/provider、approval、工具视图、max_turns、sink/hooks 和 tool context | HostDispatcher 复用时丢失 cron tool/approval/model 限制，或继续绕过门户直调 Runner | SessionEngine 仍只调用唯一 Runner；cron plan 每个字段只有一个真源；普通 thread 默认行为不变 | `J3`、`J7` |
| scheduler domain/store/policy | durable owner | reservation 增加稳定 id；Store 在推进 task 前持久化 RESERVED 与任务快照；并发策略迁到 live Manager；Store 增加按 run_id 的条件状态提交 | 领取后崩溃导致 one-shot/manual/recurring occurrence 丢失；旧 run 被取消后迟到 success 覆盖；同 reservation 重试重复执行 | 同一 occurrence 绑定一个 reservation/run/session 身份；RESERVED 可跨重启重放；RUNNING 表示 Runner 已真实启动；同一 run 的首个合法 terminal 获胜 | `J5`、`J6`、`J11`、`J18` |
| `src/scheduler/runtime_factory.py` | 装配 helper | 构造 `ScheduledRunManager` 和其共享 runtime dependencies；停止返回 ticker 可直接执行的 bridge | Web/CLI 装配出两套 Manager，导致 live registry 分裂 | 每个进程、每个 scheduler Store 只有一个 ScheduledRunManager；manual/automatic trigger 共用实例 | `J8`、`J12` |
| CLI/Web lifespan | composition root | startup 先 recover stale，再构造 Manager 和 ticker；shutdown 先停新触发，再关闭 Manager 和 runtime | runtime 先关导致活跃 run 写不出终态；ticker stop 未关闭 live owner | 关闭顺序固定为 stop ticker → close ScheduledRunManager → close runtime；超时取消全部 owned run并等待收口 | `J12`、`J13` |
| `SchedulerManager` 与 cron REST router | task/history 投影 | `latest_run_status` 继续来自 durable terminal；`live_runtime_status` 从 live owner 投影，run 列表继续读 Store | stale RUNNING 行让刷新后永久显示运行中；内存 live 与历史结果混为一份状态 | task lifecycle、latest terminal、live runtime 三者正交；`CronRunDTO` 完整保留 run/session/thread/result/delivery 字段 | 用户任务、`J14` |
| Web cron lifecycle sink 与协议真源 | 实时投影 | `cron.run.started/finished` 纳入 Python/TS wire 真源；顺序固定为 durable commit 后广播 | started 先于落盘，前端刷新查不到；finished 先于 terminal 写入，面板回读旧状态 | started 对应已持久化 RUNNING；finished 对应已持久化 terminal；每帧携带 thread/task/run/session 四身份 | 用户任务、`J14`、`J15` |
| scheduler 前端 store / runs panel / thread timeline | 用户界面 | 保留多 live run 集合、运行记录刷新、结果摘要和 timeline 路由；按 run_id 幂等处理帧 | `ALLOW` 的一个 finished 把同 task 其他 live run 清空；replace 旧 finished 覆盖新 run | `liveRunIdsByTaskId` 按 run_id 增删；面板运行态由集合非空派生；结果列表以后端 `CronRunDTO` 为真源 | 用户任务、`J15` |
| tests / module docs / import contracts | 验收与架构门禁 | 新增跨层红线、协议、并发和 e2e 测试；更新 scheduler/application/host README 与 `.importlinter` | 局部测试全绿仍保留 raw create_task 或第二 Runner 入口 | scheduler ticker 仅依赖 Manager 门户；hosts.web 依旧不会被 scheduler/application 反向 import；旧 bridge API 零引用 | `J16` |

## 判断依据

| J-ID | 判断 | 来源 | 证据或推断 | 状态 |
|---|---|---|---|---|
| J1 | 当前 ticker 为每个 reservation 调 `asyncio.create_task(_run_one(...))`，inflight 只有 Task 集合，没有业务身份索引 | 仓库事实 | `src/scheduler/ticker.py::tick/run_ticker_loop` | 已确认 |
| J2 | 当前 scheduled task 与 run 已有 `thread_id/task_id/run_id/session_id`，P0 缺口是这些 ID 到 cancellable live handle 的映射 | 仓库事实 | `src/scheduler/domain.py::ScheduledTask/ScheduledRun/DueTaskReservation`、`src/application/scheduled_runs/execution_bridge.py::execute` | 已确认 |
| J3 | 当前 `ExecutionBridge._drive_runner` 直接创建 Runner task，形成 scheduler 专属 live task owner | 仓库事实 | `src/application/scheduled_runs/execution_bridge.py::_drive_runner` | 已确认 |
| J4 | 普通 generic thread 通过 `ThreadManager → HostDispatcher → AgentManager/TaskRegistry` 启动和取消真实 run | 仓库事实 | `src/hosts/web/threads/manager.py::_start_host_dispatcher_run`、`src/hosts/shared/host_dispatcher.py`、`src/application/agents/loop.py` | 已确认 |
| J5 | 当前 `REPLACE` 只调用 `Store.cancel_run`，没有取消旧 live coroutine；旧 run 后续仍可落 success 与投递 | 仓库事实、并发推断 | `src/scheduler/policy.py::apply_concurrency_policy`、`ExecutionBridge.execute` | 已确认 |
| J6 | live 注册、并发判定、旧 run cancel/await 和新 run 启动需要同一 task admission owner；Store latest-row 查询无法封闭 TOCTOU | 并发推断 | 两个 due/manual submission 可同时读到相同 latest 状态并各自启动 | 已确认 |
| J7 | cron 当前有任务级 model snapshot、filtered tools、approval wrapper、watchdog、trace、delivery 和结果分类，复用 thread 启动链必须逐项迁移 | 仓库事实 | `src/application/scheduled_runs/execution_bridge.py`、`src/scheduler/runtime_factory.py` | 已确认 |
| J8 | CLI 和 Web lifespan 当前各自 build bridge 并启动 ticker；新的 Manager 必须保持宿主无关 | 仓库事实 | `src/hosts/cli/main.py`、`src/hosts/web/app.py` | 已确认 |
| J9 | scheduled task 的 stable thread 与 fresh run session 语义已经落地，二者在普通 thread 中通常相等，在 scheduled run 中必须显式分离 | 仓库事实 | `docs/spec/scheduler/cron-run-session-history/README.md`、`SessionEngine.run(thread_id=...)` | 已确认 |
| J10 | TaskRegistry 已能保存 `thread_id/source/task_run_id/session_id` 与真实 Task handle，但 root agent run 当前登记时没有传 scheduled identity | 仓库事实 | `src/application/agents/registry.py::TaskIdentity/register_run`、`src/application/agents/loop.py` | 已确认 |
| J11 | 当前 Store 允许同 run 后续 supersede 写入，replace cancel 后缺少“首个 terminal 获胜”的条件写保护 | 仓库事实、并发推断 | `Store.cancel_run` 与 `Store.supersede_and_append_run` 分属不同调用链 | 已确认 |
| J12 | `max_inflight`、pending tasks、shutdown drain 都由 ticker 持有；ticker 退出与 run owner 退出当前属于同一对象 | 仓库事实 | `src/scheduler/ticker.py::run_ticker_loop/_drain_inflight` | 已确认 |
| J13 | 持久化 stale RUNNING 已有 startup recovery；新 live Manager 仍需按固定 shutdown 顺序让本进程运行先正常收口 | 仓库事实 | `SchedulerManager.recover_stale_runs_on_startup`、CLI/Web lifespan | 已确认 |
| J14 | scheduler panel 的 task 投影来自 `SchedulerManager`，run 详情来自 Store/REST；实时 started/finished 由 lifecycle sink 广播 | 仓库事实 | `src/scheduler/manager.py::project_task`、`src/hosts/web/routers/cron.py`、`WebDeliverySink` | 已确认 |
| J15 | 前端已用 `liveRunIdsByTaskId: Record<string, string[]>` 支持同 task 多 live run，started/finished 帧会驱动状态和 run 刷新 | 仓库事实 | `web/src/modules/scheduler/store.ts`、`hooks/useSchedulerRealtime.ts` | 已确认 |
| J16 | 仓库规范要求跨模块只调门户、异步生命周期 callback 使用具名函数、Web wire Python/TS 双侧同步、用户链路提供真实跨层测试 | 仓库规范 | `AGENTS.md` 架构原则、约束 17/18、必需测试用例 | 已确认 |
| J17 | `ALLOW` 必须继续允许同一 scheduled task 的多个 run 同时执行；单一普通 thread mailbox 的串行队列无法直接承载该语义 | 仓库事实、架构推断 | `ConcurrencyPolicy.ALLOW`、前端多 live run 集合；每个 run 需要 fresh dispatcher/cell 并共享 stable business thread_id | 已确认 |
| J18 | `submit_scheduled_run` 返回结果未知时，调用方可能重试同一 reservation；缺少 reservation idempotency key 会创建两次模型调用和投递 | RAG 风险、架构推断 | `AR-004`；当前 `DueTaskReservation` 只有 task/scheduled_for，缺少稳定 reservation identity | 已确认 |
| J19 | 并发策略必须覆盖 accepted pending cell；准入放在 semaphore 之后会让等待槽位的旧 submission 躲过 REPLACE，随后再启动 | 独立对抗性假设 | Manager 同时拥有 pending 与 running，业务语义都属于 live work；取消边界应覆盖两者 | 已确认 |

## 详细状态与时序合同

### 提交状态

`ScheduledRunManager.submit_scheduled_run` 返回冻结 `ScheduledRunSubmitReceipt`：

- `accepted`: Manager 已拥有该 submission。
- `reservation_id/task_id/thread_id/run_id/session_id`: Store 领取时冻结的五身份。
- `disposition`: 使用 `StrEnum` 表达 `accepted / skipped_forbid / rejected_closing / failed_to_register`。

`accepted` 的成立条件是 pending cell 已写入 `run_id` 索引，且 owner task 已绑定到 cell。ticker 只记录 receipt 和派发异常；run terminal 由 Manager 自行写入。

同一 `reservation_id + request fingerprint` 的并发调用共享原子占位、receipt 和最终结果；相同 reservation_id 携带不同 task/scheduled_for/input snapshot 时返回稳定冲突错误。幂等记录终态后进入有界 LRU，活跃记录永不裁剪。

### 准入与并发

- `max_inflight` 的 semaphore、owned task 集合和 shutdown drain 归 `ScheduledRunManager`。
- pending submission 等待槽位期间保持 durable `RESERVED`，并已受 Manager 管理；此时 Web 展示“等待执行”。
- 每个 submission 在占位时分配单调递增 sequence；每个 task 使用独立 admission
  lock，准入只观察更早的 live cell，因此较晚 owner 先获得事件循环时间也无法反向
  淘汰较早 submission；不同 task 可并行准入。
- 顺序固定为 durable RESERVED → 幂等占位 → pending live 登记 → task concurrency 准入 → global semaphore → RUNNING；`FORBID/REPLACE` 因而覆盖等待槽位的 pending cell。
- `ALLOW` 为每个 run 创建独立 fresh dispatcher/cell，多个 run 共享 stable `thread_id`，各自持有 fresh `session_id`。
- `FORBID` 在 admission lock 内检查 task 索引中 pending/running cell；存在 live owner时生成可审计 skip 结果，Runner 启动次数为 0。
- `REPLACE` 在 admission lock 内冻结待取消 cell；pending cell 取消 owner task，running cell 调用 TaskRegistry/HostDispatcher cancel 并等待真实 handle 与外部资源收口，再允许新 run 竞争 global semaphore。旧 cell 的 terminal finalizer 使用 run-local guard，不重入 admission lock。

### 持久化与终态

- `RESERVED` 先写 Store，再推进任务调度状态；提交失败或进程重启按持久化退避时间重放同一身份。
- Runner 真正启动时原子写 `RUNNING + started_at`，随后广播 `cron.run.started`。
- terminal 采用 `finish_run_if_running` 或等价 compare-and-set：输入 `task_id/run_id/expected=RUNNING/terminal payload`，只有当前仍为 RUNNING 时提交。
- `REPLACE`、shutdown、用户取消均写 `CANCELLED` 和明确 `cancel_reason`；watchdog 单独写 `INACTIVITY_TIMEOUT`；startup stale recovery 写 `ABANDONED`。
- Runner 结果先形成 terminal candidate；允许的 delivery 在 candidate 上合并投递
  字段，随后 `finish_run_if_running` 一次提交最终 durable terminal。取消在 delivery
  await 期间可先赢得同一 CAS，随后中断已注册 Task，迟到 candidate 只读取既有 winner。
- `ScheduledRunManager` 等待 HostDispatcher/TaskRegistry 收口，进入 `FINISHING`
  后移除 `run_id` live 索引并完成 `wait_for_run` future，再广播
  `cron.run.finished`。阻塞的生命周期 sink 仍由 owner 持有到收口；面板收到
  finished 后发起 REST refresh 时必然读取到 terminal 和非 live 投影。
- Web 的 thread 级人工审批工厂只提供 ConsentResolver 终点；
  `InteractiveApprovalRebinder` 在运行时 `SafetyGatedApproval` 内复用
  DangerGuard、处置模式、thread permissions 与事件链。
- CAS 失败代表该 run 已有 authoritative terminal；late Result、late delivery 和 late callback 只写诊断 audit，保持现有 terminal。
- 每个 terminal 路径都释放 provider、trace sink、dispatcher、TaskRegistry record、semaphore 和 live 索引。

### 面板与历史

- `CronTaskDTO.lifecycle` 继续来自 `ScheduledTask.lifecycle`。
- `CronTaskDTO.latest_run_status` 继续来自最近 durable terminal run。
- `CronTaskDTO.live_runtime_status` 来自 `ScheduledRunManager` 的 task live index；startup recovery 完成前不开放 router/ticker。
- `CronRunDTO` 继续包含 `run_id/task_id/session_id/thread_id/status/failure_reason/final_message_excerpt/delivery_status/delivery_error`，其中 `status=reserved` 展示为“等待执行”。
- `cron.run.started` 与 `cron.run.finished` 在 Python `ws_frames.py` 和 TypeScript `protocol.ts` 各有 1:1 模型；后端通过模型校验后 `model_dump()`。
- 前端按 run_id 增删 `liveRunIdsByTaskId[task_id]`；`ALLOW` 中任一 run finished 只删除自身。`cron.run.completed` 只表示 delivery 消息已产生，不收口面板 live 状态。
- 刷新恢复以 REST Store 数据为真源；WS 只提供实时加速，丢帧后 refresh 能恢复同一 running/terminal/result 状态。

## 建模覆盖声明

| 维度 | 覆盖位置或具体不适用理由 |
|---|---|
| 数据流 | `根因与目标架构`、`详细状态与时序合同`、`SC_01`、`SC_11`、`SC_12`、`SC_16` |
| 状态 | `提交状态`、`准入与并发`、`持久化与终态`、`SC_03`—`SC_10`、`SC_16`、`SC_17` |
| 时序 | `RUNNING → started → terminal/delivery → finished`、`SC_05`—`SC_09`、`SC_14`、`SC_17` |
| 资源 | `run_id → ScheduledRunCell → TaskRegistry handle`、`SC_02`、`SC_08`、`SC_10`、`SC_17` |
| 不变量 | `影响边界与不变量`、`SC_13` |
| 故障 | `SC_06`—`SC_10`、`SC_12`、`SC_14` |

## 验收清单

### 单元测试

- [ ] ticker fake Manager 测试证明每个 reservation 恰好调用一次 `submit_scheduled_run`，ticker 返回前无需等待 run Result；AST/架构测试证明 `src/scheduler/ticker.py` 零 `asyncio.create_task`、零 `ExecutionBridge`、零 live task set。
- [ ] `ScheduledRunManager` receipt 测试证明返回 `accepted` 前，五身份、owned task、幂等占位和 `run_id/task_id` 双索引已经完成登记；发布 started 前 TaskRegistry 已绑定真实 Runner task。
- [ ] 同一 reservation 的两个并发 `submit_scheduled_run` 和一次结果未知重试返回同一 run_id/session_id/result，真实 Runner 与 delivery 各执行一次；同 key 不同 fingerprint 返回稳定冲突。
- [ ] `max_inflight=2`、10 条 submission 的门控测试证明同时进入真实 Runner 的数量最多为 2，全部 pending 都可由 Manager 查询和关闭。
- [ ] `ALLOW` 对同 task 启动两个独立 dispatcher，断言 thread_id 相等、run_id/session_id 不同、两个 TaskRegistry handle 同时 live。
- [ ] `FORBID` 使用冲突哨兵：Store 无 RUNNING，live index 有旧 run；断言新 Runner 启动 0 次并产生 skip audit，证明 live owner 是并发真源。
- [ ] `REPLACE` 使用事件门闩证明旧 Runner 收到 cancel、外部 PID 已 wait、旧 terminal 已写 `CANCELLED` 后新 Runner 才开始；Store 预写 CANCELLED 且 live handle 未取消的错误实现会使测试失败。
- [ ] pending REPLACE 测试让 global semaphore 被其他 task 占满，旧同-task submission 等待槽位；新 REPLACE 必须取消旧 pending owner，释放槽位后只有新 submission 进入 Runner。
- [ ] late completion 对抗测试证明旧 run 被 replace 后返回 success/触发 delivery，Store 仍为 `CANCELLED`，消息投递次数为 0，late-terminal audit 为 1。
- [ ] cancel 分类测试分别断言 replace/shutdown/user cancel=`CANCELLED`、watchdog=`INACTIVITY_TIMEOUT`、startup recovery=`ABANDONED`。
- [ ] RUNNING 持久化失败测试断言已登记的 live task 被取消并 await、started 帧为 0、semaphore/live index/provider/trace 均释放。
- [ ] Manager shutdown 测试覆盖 pending、running、ALLOW 多 run 和超时强杀；关闭返回后 live index 为空、所有 TaskRegistry 无 live handle、每个 accepted run 有 terminal。
- [ ] TaskRegistry 冲突哨兵测试把 session_id 与 thread_id 设为不同值，断言 record、Runner event、Safety thread key 和 run session 各自读取合同指定字段。
- [ ] Store CAS 测试覆盖 `RUNNING→COMPLETED` 成功、`CANCELLED→COMPLETED` 拒绝、重复 terminal 幂等、两个 terminal 并发只有一个获胜。
- [ ] Web lifecycle sink 合同测试断言 started/finished 帧通过 Python 模型输出，字段与 TypeScript fixture 完全一致，frame 到达时 REST 已可读对应 durable 状态。
- [ ] 前端 store 测试覆盖同 task 两个 live run：一个 finished 后另一个仍保持 running；旧 replace run 的 late finished 无法移除新 run 或覆盖其结果。
- [ ] CLI/Web composition 测试断言 ticker、manual run 和 router projection 取得同一个 `ScheduledRunManager` 实例，关闭顺序符合合同。
- [ ] cron 专属回归测试逐项覆盖 model snapshot、tool filter、approval mode、watchdog、trace、`[SILENT]`、delivery、audit 和 fresh session。
- [ ] 代码搜索门禁断言旧 `ExecutionBridge.execute` ticker path、`apply_concurrency_policy` durable-only replace、ticker `_run_one/_drain_inflight` 和匿名 done callback 零残留。

### Smoke 测试

- [ ] 用真实 `Store + ScheduledRunManager + HostDispatcher + AgentManager/TaskRegistry + SessionEngine/Runner`，只替换外部 LLM 为可控 fake；`tick()` 触发一次任务后观察 RUNNING、TaskRegistry 四身份、独立 session history、terminal result、delivery 和 live index 清理。
- [ ] 用同一真实链路启动阻塞旧 run，再提交 REPLACE；断言旧 fake tool/LLM 收到取消并完成清理，新 run 才启动，面板 REST 最终返回旧 `cancelled` 与新 terminal 两条记录。
- [ ] CLI scheduler lifespan 启动真实 ticker 和 Manager，触发一次任务并关闭；断言结果可从 Store 读取，进程退出时无 pending asyncio task 警告。

### E2E 测试

- 决策：需要
- 依据：该重构贯穿 Web scheduler UI → REST/manual reservation → ticker → application Manager → shared thread runtime → Store → WS → 前端面板，且结果正确性依赖跨层时序。
- [ ] Web 创建 scheduled task，点击“立即运行”，面板先显示 running，再显示 fake LLM 最终摘要；刷新页面后同一 run、session、状态和摘要保持，点击 run 能加载对应 session history。
- [ ] Web 对阻塞任务触发 REPLACE，观察旧 run 显示 cancelled、新 run 显示 running/terminal；旧 run 在释放门闩后不会追加消息或改变面板结果。
- [ ] Web 用 ALLOW 同时触发两个 run，面板维护两个 live run；第一个结束后任务仍显示 running，第二个结束后回到 idle，两个结果分别可打开。

## 测试驱动开发

1. `SC_01`、`SC_02` → 先写 ticker 门户边界和 identity-to-handle 红灯测试。
2. `SC_03`、`SC_04`、`SC_05` → 先写 `max_inflight / ALLOW / FORBID` 并发红灯测试。
3. `SC_06`、`SC_07`、`SC_08` → 先写 REPLACE 真取消、迟到终态和取消分类红灯测试。
4. `SC_09`、`SC_10` → 先写持久化失败补偿与 shutdown 资源收口红灯测试。
5. `SC_11`、`SC_12`、`SC_13` → 先写 identity 冲突哨兵、面板时序和 fresh-session 回归测试。
6. `SC_14`、`SC_15` → 先写 startup recovery 和 Web E2E 红灯测试。
7. `SC_16`、`SC_17` → 先写 reservation 幂等与 pending REPLACE 对抗红灯测试。
8. 实现最小 `ScheduledRunManager` 与 typed execution plan，迁移 ticker/HostDispatcher/SessionEngine/Store/装配层，删除旧执行入口。
9. 复跑 scheduler、agents、host dispatcher、CLI/Web lifespan、protocol、frontend 和 e2e 全套测试，再执行 mypy、ruff、import-linter 与协议漂移门禁。

## 对抗性审查记录

| Review | 预算 | 风险来源 | 查询 | 召回 ID | 复用 Scenario | 新增 Scenario | CLI |
|---|---|---|---|---|---|---|---|
| ARV-1 | full | RAG:AR-004; assumption:pending replace escapes cancellation | 功能关键词：scheduled run identity/live handle；Risk：重试重复副作用、取消清理、历史状态与权限身份漂移 | AR-005, AR-003, AR-002, AR-004, AR-006 | SC_03, SC_06, SC_09, SC_10, SC_11, SC_13, SC_14 | SC_16, SC_17 | exit=0; matches=5 |

## Scenarios

### Scenario SC_01: ticker 只提交 reservation

- **GIVEN** Store 一次返回三条 due reservation，fake `ScheduledRunManager` 在提交后立即返回 receipt，三个实际 run 均保持阻塞
- **WHEN** 执行一次 `tick`
- **THEN** `submit_scheduled_run` 按 reservation 各调用一次，tick 返回 `due_count=3/accepted=3`，ticker 内没有 run task、semaphore 或结果等待
- 测试层：unit
- 依据：用户任务、`J1`
- 来源：initial-spec

### Scenario SC_02: accepted 前完成身份到 Manager owner 登记

- **GIVEN** Store 已把一条带稳定 `thread_id/task_id/run_id/session_id` 的 reservation 写成 RESERVED
- **WHEN** `submit_scheduled_run` 返回 accepted receipt
- **THEN** receipt 复用 Store 的 `run_id/session_id`，Manager 的 run/task/reservation 三个索引可定位同一 cell 并取消 owner task；该 run 发布 started 前，TaskRegistry record 携带四身份并绑定真实 Runner task
- 测试层：unit
- 依据：`J2`、`J10`
- 来源：initial-spec

### Scenario SC_03: max_inflight 归 Manager 管理

- **GIVEN** `max_inflight=2`，提交十条会阻塞的不同 task reservation
- **WHEN** 全部 submission 被 Manager 接管
- **THEN** 最多两个 run 进入 Runner，其余八个保持 owned pending；释放槽位后依次启动，ticker 始终不持有这些任务
- 测试层：unit
- 依据：`J12`
- 来源：initial-spec

### Scenario SC_04: ALLOW 保持同 task 多 run 并发

- **GIVEN** 同一 scheduled task 使用 `ALLOW`，连续提交两次 reservation
- **WHEN** 两次都取得并发槽位
- **THEN** 两个 run 同时进入 Runner，stable thread_id 相同，run_id/session_id/dispatcher/TaskRegistry handle 各自独立，面板 live run 集合含两个 ID
- 测试层：smoke
- 依据：`J17`
- 来源：initial-spec

### Scenario SC_05: FORBID 读取 live owner

- **GIVEN** Store 中没有 RUNNING 行，Manager task index 中已有一个真实 live run
- **WHEN** 同 task 的 `FORBID` submission 进入准入
- **THEN** 新 Runner 启动次数为 0，返回 `skipped_forbid`，写一条含旧 run_id 的 audit；测试中的相反 Store 哨兵不会改变结果
- 测试层：unit
- 依据：`J6`
- 来源：initial-spec

### Scenario SC_06: REPLACE 先收旧真实 run再启新 run

- **GIVEN** 旧 run 正在 fake tool 中阻塞并登记了外部 PID，同 task 新 reservation 使用 `REPLACE`
- **WHEN** 新 submission 进入准入
- **THEN** Manager 通过 TaskRegistry 取消旧 handle、kill+wait PID、写旧 run `CANCELLED` 并清理资源；随后新 run 才发布 RUNNING 和 started
- 测试层：smoke
- 依据：用户任务、`J5`、`J6`
- 来源：initial-spec

### Scenario SC_07: 被替换 run 的迟到成功失效

- **GIVEN** SC_06 的旧底层依赖在取消后仍返回 success 并尝试写 result/delivery
- **WHEN** old finalizer 执行终态 CAS
- **THEN** CAS 拒绝改写 `CANCELLED`，delivery 与 completed message 均为 0，diagnostic audit 记录 late terminal，新 run 状态保持
- 测试层：unit
- 依据：`J11`
- 来源：initial-spec

### Scenario SC_08: 取消来源得到不同终态

- **GIVEN** 四个活跃 run 分别遭遇 replace、shutdown、用户取消和 inactivity watchdog
- **WHEN** 各自取消传播到 Runner 并收口
- **THEN** 前三个状态为 `CANCELLED` 且 cancel_reason 可区分，watchdog 状态为 `INACTIVITY_TIMEOUT`，任何外部 cancel 都不会伪装成 inactivity
- 测试层：unit
- 依据：`J7`
- 来源：initial-spec

### Scenario SC_09: RUNNING 写入失败会补偿 live 资源

- **GIVEN** Manager 已登记 owned cell，Store 在 `mark_run_started` 写 RUNNING 时抛错
- **WHEN** submission 尝试进入执行态
- **THEN** Manager 取消并 await TaskRegistry handle，关闭 dispatcher/provider/trace，释放 semaphore 与双索引，started 帧为 0，并写可诊断 incident
- 测试层：unit
- 依据：`J6`
- 来源：initial-spec

### Scenario SC_10: shutdown 收编 pending 与 running

- **GIVEN** Manager 同时持有等待 semaphore 的 submission、一个普通 running 和两个 ALLOW running
- **WHEN** composition root 先停止 ticker，再调用 Manager close 并达到 shutdown timeout
- **THEN** 新提交被稳定拒绝，pending 取消，running 优雅收口或超时强制 cancel；close 返回后无 live handle、无 dispatcher/provider 泄漏，每个 accepted run 均有 terminal 或 incident
- 测试层：unit
- 依据：`J12`、`J13`
- 来源：initial-spec

### Scenario SC_11: stable thread 与 fresh session 冲突哨兵

- **GIVEN** scheduled task `thread_id=thread-A`，本次 `session_id=sched-B`，错误 fallback 值设为 `sched-B`
- **WHEN** run 经 HostDispatcher、AgentManager、SessionEngine 到 Runner 和 Safety
- **THEN** TaskRegistry/Event/ToolContext/permissions 使用 thread-A，session history 和 Result.session_id 使用 sched-B，ScheduledRun 同时保存两者
- 测试层：smoke
- 依据：`J9`、`J10`
- 来源：initial-spec

### Scenario SC_12: 面板 started 与 finished 具备持久化先行顺序

- **GIVEN** Web 订阅 cron lifecycle frames，并可同步调用 task/run REST
- **WHEN** 收到 `cron.run.started` 和随后 `cron.run.finished`
- **THEN** started 时 REST 已有同 run 的 RUNNING，finished 时 REST 已有同 run 的 terminal、结果摘要和 delivery 字段；两帧均带四身份并通过双侧协议模型
- 测试层：e2e
- 依据：用户任务、`J14`、`J15`
- 来源：initial-spec

### Scenario SC_13: cron 专属执行语义完整迁移

- **GIVEN** task 指定独立 preset、max_turns、approval_mode、cwd 和 delivery，模型尝试调用被裁剪的 schedule tool并最终输出 `[SILENT]`
- **WHEN** run 经统一 thread 启动链执行
- **THEN** provider/AgentSpec/审计使用同一 model snapshot，schedule tool 无法执行，审批按 task mode，trace 写入本 run 文件，SILENT terminal 落盘且外部 delivery 被抑制
- 测试层：smoke
- 依据：`J7`
- 来源：initial-spec

### Scenario SC_14: startup stale recovery 先于开放入口

- **GIVEN** Store 留有上个进程的 RUNNING 行，当前进程 live index 为空
- **WHEN** Web 或 CLI scheduler lifespan 启动
- **THEN** stale 行先转为 `ABANDONED`，再开放 REST/manual/ticker；task 面板显示 idle，run 历史显示 abandoned
- 测试层：unit
- 依据：`J13`、`J14`
- 来源：initial-spec

### Scenario SC_15: Web 面板完整结果链

- **GIVEN** 用户在 Web 创建 scheduled task 并点击立即运行
- **WHEN** ticker 领取 manual reservation 并经 `submit_scheduled_run` 完成 fake LLM run
- **THEN** 面板依次显示“等待执行”、running 与 terminal/result，刷新后结果保持，点击 run 加载 fresh session history；同一执行只有一个 run_id 和一份消息
- 测试层：e2e
- 依据：用户任务
- 来源：initial-spec

### Scenario SC_16: 同一 reservation 并发重试只执行一次

- **GIVEN** 两个调用方并发提交相同 `reservation_id + fingerprint`，首次调用的 receipt 在返回途中丢失后又重试一次
- **WHEN** 三次调用进入 `submit_scheduled_run`
- **THEN** 三者观察到同一 run_id/session_id 和最终结果，Store 只保留同一 run 的 RESERVED/RUNNING/terminal 状态链，Runner 与 delivery 各执行一次；相同 reservation_id 的不同 fingerprint 得到稳定冲突且无副作用
- 测试层：smoke
- 依据：`J18`
- 来源：adversarial-review (rag:AR-004)

### Scenario SC_17: REPLACE 取消等待槽位的 pending run

- **GIVEN** 另一个 task 占满唯一 global semaphore，旧同-task submission 已 accepted 并等待槽位，新 submission 使用 `REPLACE`
- **WHEN** 新 submission 完成 task concurrency 准入，随后外部 task 释放槽位
- **THEN** 旧 pending owner 在取得槽位前已取消并写明确终态或 skip audit，只有新 submission 进入 Runner；Manager 关闭后两条 identity 均无 live handle
- 测试层：unit
- 依据：`J19`
- 来源：adversarial-review (assumption:replace取消pending提交)

### Scenario SC_18: 领取后崩溃恢复同一执行

- **GIVEN** one-shot、manual 或 recurring occurrence 已到期
- **WHEN** Store 完成领取后，进程在 Manager/Runner 启动前崩溃并重启
- **THEN** 任务调度状态和同一条 `RESERVED` run 已同时持久化；ticker 到达退避时间后使用原 `reservation_id/run_id/session_id` 与冻结任务快照重新提交，Runner 启动时推进为 `RUNNING`
- 测试层：integration
- 依据：nightly scheduler durable-claim P0
- 来源：fix
