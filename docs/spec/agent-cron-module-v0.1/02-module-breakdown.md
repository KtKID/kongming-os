# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|---|---|---|---|---|
| Schedule Domain Model | 定义任务、触发器、运行记录、策略字段 | `core` 协议 | 方案确认 | 这层是调度系统的数据真源 |
| Scheduler Store | 持久化任务与运行状态 | Domain Model | 方案确认 | v0.1 用 JSON / JSONL 文件，跟 file session backend 同风格；SQLite 推迟到 v0.2 |
| Trigger Engine | 计算触发与唤起执行 | Store | 方案确认 | 采用 APScheduler `MemoryJobStore`，重启从 Store 重建；不让 APScheduler 成为状态真源 |
| Execution Bridge | 将 due task 变成一次 fresh `Runner.run()` | `core.runner`、Session | 方案确认 | 复用当前 agent runtime；卡死超时（inactivity）兜底 |
| Safety and Policy Integration | 创建审批 + 运行期 fail-closed + 递归保护 + 并发/卡死超时策略 | Safety 模块、Execution Bridge | 方案确认 | v0.1 不引入 lease；包一层 `ScheduleApprovalProvider`，未授权动作整 run 失败 |
| Management Surfaces | 为 CLI / Web / tool 暴露管理能力 | 上述全部 | 探索中 | 等底层稳定后再拆 |

## 边界矩阵

| 模块 | 生产的数据 | 消费的数据 | 允许依赖 | 明确不拥有 |
|---|---|---|---|---|
| Schedule Domain Model | 任务实体定义、策略枚举、运行状态枚举 | `AgentSpec`、`Result` 抽象 | `core` 共享协议 | 文件存取、scheduler lifecycle |
| Scheduler Store | `scheduled_tasks.json`、`runs/<task_id>.jsonl`、`audits.jsonl` 持久化记录 | Domain Model DTO | Domain Model、文件层 | `Runner` 调用、trigger 计算 |
| Trigger Engine | in-memory scheduler registration、due event | Store 查询结果 | Store、app lifespan | 业务真源、运行结果写回 |
| Execution Bridge | `RunRequest`、`TaskExecutionContext`、运行摘要、inactivity 收尾 | ScheduledTask、SchedulePolicy | `Runner`、Session、Store | 审批策略裁决、文件 schema |
| Safety and Policy Integration | schedule 创建审批、cron-aware ApprovalProvider 包装、裁剪后的 enabled tools、fail-closed 决策 | ScheduledTask、RunRequest、TaskExecutionContext | safety 模块、Execution Bridge | 时间计算、任务持久化、partial run 恢复 |
| Management Surfaces | CLI/Web/API request/response 形态 | Store 查询结果、Domain Model | 上述核心模块 | 自行维护状态真源 |

## 模块详情

### 模块 1：Schedule Domain Model

**职责**：定义定时任务模块内部的唯一业务真源，统一任务配置、触发器、执行策略、运行结果和审计字段。

**包含范围**：

- `ScheduledTask`
- `ScheduleTrigger`
- `ScheduledRun`
- `TaskExecutionPolicy`
- `TaskTarget`

建议字段：

- `ScheduledTask`
  - `task_id`
  - `name`
  - `enabled`
  - `trigger_type`
  - `trigger_expr`
  - `timezone`
  - `payload`
  - `target_agent`
  - `target_session_mode`
  - `concurrency_policy`
  - `misfire_policy`
  - `next_run_at`
  - `last_run_at`
  - `created_at`
  - `updated_at`
- `ScheduledRun`
  - `run_id`
  - `task_id`
  - `status`
  - `scheduled_for`
  - `started_at`
  - `finished_at`
  - `result_summary`
  - `error_message`

**不包含范围**：

- 不定义具体数据库 schema 细节
- 不关心 APScheduler 的 job object 结构
- 不直接承载外部消息投递目标

**依赖**：

- `core.agent_spec.AgentSpec`
- `core.result.Result`
- `core.session.Session`

**风险与讨论点**：

- 当前仓库已有 `run_id / session_id / agent_spec` 语义，定时任务字段命名要与这些已有概念对齐；
- `payload` 必须是稳定可序列化结构，不能塞隐式 Python callable；
- `target_session_mode` 建议只保留 `fresh_session`，后续再评估 `existing_session`。

**task 建议**：

- 建议 task 名：`schedule-domain-model`
- 是否进入 x-req：是
- 原因：这层一旦稳定，存储和执行桥接都能并行推进

### 模块 2：Scheduler Store

**职责**：持久化任务、运行记录和审计记录，并提供 due-job 查询、状态更新、抢占和恢复的最小存储接口。

**包含范围**：

- `scheduled_tasks.json`：完整任务定义集合（原子写入：tmp + rename）
- `runs/<task_id>.jsonl`：每任务独立 append-only 运行记录
- `audits.jsonl`：全局 append-only 审计日志
- `.scheduler.lock`：进程级 file lock，防止多实例同时抢 due task
- 原子更新 `next_run_at / last_run_at / state`
- due-job 查询 + recurring job 执行前推进 `next_run_at`（继承 Hermes `advance_next_run`）

**不包含范围**：

- 不把 APScheduler 的 job store 当业务真源
- v0.1 不上 SQLite（推迟到任务量 / 查询压力上来后再迁）
- 不实现跨节点分布式锁

**依赖**：

- Schedule Domain Model
- 现有 file session backend 的原子写入工具（tmp file + os.replace + fsync）

**风险与讨论点**：

- Hermes 的 `jobs.json` 单文件方案够用，本方案在此基础上把 run 记录拆到 per-task JSONL，避免单 JSON 越写越大；
- due-job 选择与 `advance_next_run` 必须在同一个 file lock 区间内完成，减少重复触发；
- 文件备份/损坏的恢复策略需要在 Store 层提供 reload 容错（参考 Hermes `load_jobs` 的 `strict=False` retry）。

**task 建议**：

- 建议 task 名：`schedule-store-file`
- 是否进入 x-req：是
- 原因：技术边界清晰，和运行桥接可解耦

### 模块 3：Trigger Engine

**职责**：以 APScheduler 负责时间计算、任务唤醒和进程内常驻调度，把业务任务映射成内部触发事件。

**包含范围**：

- `AsyncIOScheduler` + `MemoryJobStore` 装配（**显式不使用 SQLAlchemyJobStore**）
- `cron / interval / date` trigger 映射
- 启动时从 Store 加载启用任务，全量重建 in-memory registrations
- 任务增删改后的 scheduler reload（任务级粒度 reload，不重建全量）
- scheduler 生命周期绑定 web/app runtime

**不包含范围**：

- 不让 APScheduler 成为业务状态真源（jobstore 重启后丢空，由 Store 重建是预期行为）
- 不在 scheduler 内直接执行业务逻辑（仅触发 Execution Bridge）
- 不依赖系统 `crontab` 维护任务本体

**依赖**：

- Scheduler Store
- Web/app lifespan

**风险与讨论点**：

- APScheduler 更适合当前进程内模型，时间计算、DST、misfire 都比手写 tick 稳；
- 系统 `cron` 适合拉起进程，不适合承载审批、审计和动态任务编辑；
- scheduler 自身重启后应从 Store 重建，不从内存恢复。

**task 建议**：

- 建议 task 名：`schedule-trigger-engine`
- 是否进入 x-req：是
- 原因：技术方案已经收敛，输入输出边界很明确

### 模块 4：Execution Bridge

**职责**：把一个 due task 转成一次 fresh `Runner.run()`，并把执行结果回写 `ScheduledRun`。

**包含范围**：

- 从 `ScheduledTask` 生成 `ScheduledRunRequest`
- 创建 fresh `session_id / run_id`
- 裁剪可用工具集（schedule 管理工具默认裁掉，防止递归创建任务）
- 触发 `Runner.run(...)`
- **inactivity timeout 监听**：执行期监听 turn / tool / stream 活动；连续无活动 N 秒则强制取消，记录 `error_message=inactivity_timeout`
- **`[SILENT]` 投递抑制**：final message 以 `[SILENT]` 开头时跳过外部投递（仅落审计）
- 记录运行结果与错误

**不包含范围**：

- 不复用旧聊天上下文
- 不在第一期引入复杂 queue/worker 架构
- 不把消息投递耦合进核心执行链

**依赖**：

- `core.runner.Runner`
- `executors/agent_runtime/session_engine.py`
- Session store

**风险与讨论点**：

- Hermes 的“fresh session execution”非常值得保留，这样定时任务天然隔离；
- 运行桥接必须显式传递 cron context，避免 Hermes 式环境变量注入扩散到全局；
- inactivity timeout 与 wall timeout 是两个维度，前者面向"卡死"、后者面向"长跑超预算"，v0.1 优先做 inactivity；
- 结果记录应保存 `Result.status / final_message / turn_count / error` 的映射摘要。

**task 建议**：

- 建议 task 名：`schedule-execution-bridge`
- 是否进入 x-req：是
- 原因：一旦跑通，就能验证整套方案最核心的用户价值

### 模块 5：Safety and Policy Integration

**职责**：把“任务定义”和“任务执行”纳入现有 safety 体系，形成显式审批、递归保护、并发控制和故障恢复规则。

**包含范围**：

- **创建审批**：CLI/Web 创建/编辑/删除任务时，调用现有 `SafetyGatedApproval` 走 schedule capability 审批（capability 复用现有 enum，**不新增 `operation` 字段**，避免污染 `safety/types.py`）
- **运行期审批接线**：装配期把现有 `SafetyGatedApproval` 包一层 `ScheduleApprovalProvider`，cron run 命中需要 consent 的高风险动作时**直接拒绝**（fail-closed），而不是调起交互式审批；ApprovalProvider 返回 deny → 工具执行失败 → 整 run `status=failed, error_message=needs_approval:<capability>`
- **递归保护**：cron run 的 enabled tools 默认裁掉 schedule 管理工具（在装配层拒绝注册），防止任务内自我繁殖
- 定时任务默认 `fresh_session`
- **并发策略 (`concurrency_policy`)**：`forbid / allow / replace`
- **补跑策略 (`misfire_policy`)**：`skip / catch_up_once / fire_now`
- **超时**：v0.1 仅实现 inactivity timeout（卡死兜底），wall timeout 字段保留但运行时不强制
- **重试**：`retry_limit` 字段保留，v0.1 只在调度层失败重试

**不包含范围**：

- v0.1 **不引入** `Lease` / `waiting_approval` / "批准后从断点续跑"（推迟到 v0.2）
- 不改写现有 `safety/types.py` / `safety/decision_engine.py` 核心字段
- 不在第一期接 LLM 智能审批
- 不实现跨进程 distributed lock（用 file lock 顶住）

**依赖**：

- `safety/chain.py::SafetyGatedApproval`（被包装的目标）
- `safety/capability_policy.py`（cron capability 走现有路径）
- Execution Bridge（cron 上下文标记由 `TaskExecutionContext` 传入）

**风险与讨论点**：

- 创建任务和执行任务是两层不同风险，必须分开看；创建走交互式审批，执行走 fail-closed；
- Hermes 的递归保护很重要，本方案以装配层 tool 裁剪 + cron 上下文标记两道防线；
- 补跑策略必须保守，重启后跑一串积压任务通常比错过一次更糟；
- v0.2 再加 lease 时，`ScheduleApprovalProvider` 是切入点：lease 命中改判 silent_allow，其余动作仍 fail-closed。

**task 建议**：

- 建议 task 名：`schedule-safety-policy`
- 是否进入 x-req：是
- 原因：和执行桥接强耦合，必须一起定义

### 模块 6：Management Surfaces

**职责**：为用户、web 宿主、CLI 宿主、未来的 agent tool 暴露统一的任务管理能力。

**包含范围**：

- CLI：`schedule list/create/pause/resume/run/remove`
- Web：任务列表、详情、最近运行记录
- 后续 tool-facing action API：`create/list/update/pause/resume/remove`

**不包含范围**：

- 不在第一期做自然语言转 schedule 的复杂交互层
- 不直接把 UI 结构写死到存储模型

**依赖**：

- 上述所有核心模块

**风险与讨论点**：

- 当前仓库先把底层跑通更重要，管理入口可以后置；
- 一旦底层模型不稳，CLI / Web / tool 三套接口会一起返工。

**task 建议**：

- 建议 task 名：`schedule-management-surfaces`
- 是否进入 x-req：否
- 原因：当前更适合继续停留在方案层，等待底层接口冻结
