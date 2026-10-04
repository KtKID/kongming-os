# Agent Cron Module v0.1

> 状态：方案确认中
> 目标：为 `kongming-agent` 提供一套可持久化、可审计、可审批、可恢复的定时任务模块，让 agent 能稳定创建和执行 `once / interval / cron` 任务。

## 系统目标

当前仓库已经有稳定的 `Runner`、`Session`、`ApprovalProvider`、Web 宿主和 CLI 宿主，但还没有一层正式的 scheduled execution 语义。定时任务如果直接交给系统 `cron` 或零散脚本，任务定义、审批、审计、状态恢复、运行隔离都会散落在框架外。

本方案的目标是把“定时任务”变成框架内的一等能力：

- 用户或 agent 可以创建、查看、暂停、恢复、立即触发任务；
- 任务定义持久化在框架自有存储中，支持 `once / interval / cron`；
- 每次触发都生成一次新的 `run`，复用现有 `Runner` 执行；
- 创建、修改、删除任务走 `operation=schedule` 审批；
- 运行结果、失败原因、下次执行时间都可审计；
- 服务重启后可恢复，不因重启补跑一串过期任务。

## 范围边界

**包含**：

- 调度任务领域模型：`ScheduledTask`、`ScheduleTrigger`、`ScheduledRun`
- 应用内调度内核：以 `APScheduler` 负责时钟和触发计算
- SQLite 持久化：任务表、运行表、审计表
- 运行桥接：定时任务触发后创建 fresh `session/run`，调用现有 `Runner`
- 安全集成：`schedule` 操作审批、递归保护、工具裁剪、超时/并发策略
- 管理入口：CLI / Web / 未来的 tool-facing schedule API
  - v0.1 Web 仅提供 REST API（前缀 `/api/schedule/tasks`，见 `src/web/routers/schedule.py`），React 管理页面留到 v0.1.x

**不包含**：

- 分布式 worker 集群与跨节点抢占
- 外部消息平台投递编排
- 完整工作流编排 DSL
- 秒级高精度实时调度
- 依赖系统 `cron` 直接承载任务定义

## 核心结论

- **主方案**：`APScheduler + 文件持久化 + app-owned task model`
- **宿主策略**：应用进程内常驻 scheduler，systemd / launchd / cron 只负责拉起服务与保活
- **执行语义**：每次 job 触发都创建 fresh `run`，不复用旧对话上下文
- **持久化语义**：v0.1 用文件存储（`scheduled_tasks.json` + `runs/<task>.jsonl` + `audits.jsonl`），跟现有 file session backend 风格一致；查询/索引压力上来再迁 SQLite
- **调度器语义**：APScheduler 只当"闹钟"——使用 `MemoryJobStore`，重启时由文件真源重建 registrations，**不让 APScheduler 自带的 jobstore 成为状态真源**
- **可靠性语义**：recurring job 默认采用偏 `at-most-once` 的策略，服务恢复后快进到未来窗口，避免补跑风暴
- **安全语义**：v0.1 走 fail-closed —— cron run 命中未授权高风险动作时整次 run 直接失败（`status=failed, reason=needs_approval`），下次 trigger 再跑；不做"挂起等审批 → 批准后从断点续跑"。lease + waiting_approval 推迟到 v0.2
- **审批接线**：v0.1 不污染 `core.contracts` / `safety.types`；做法是装配期包一层 `ScheduleApprovalProvider`，外部包裹现有 `SafetyGatedApproval`，cron 上下文标记由 `TaskExecutionContext` 显式传入

## Hermes 参考与取舍

Hermes 的 cron 子系统提供了很好的产品语义样板，重点在：

- fresh session 执行隔离；
- `once / interval / cron` 三类统一任务模型；
- `next_run_at` 驱动的 due-job 扫描；
- recurring job 执行前先推进 `next_run_at`，把崩溃后的重复触发风险压低；
- missed-run grace window，避免服务恢复后补跑一串旧任务；
- cron 上下文禁用部分工具，防递归和错误交互。

本方案保留这些语义，替换底层实现：

- Hermes 用 `jobs.json + 60s tick + file lock`，这里改为 `APScheduler + 文件存储`（仍保留文件而非 SQLite，仅替换 tick loop）
- Hermes 的 delivery / messaging 很重，当前仓库先聚焦“调起 agent run”
- Hermes 大量依赖环境变量注入运行上下文，当前仓库应改为显式 `RunRequest` / `TaskExecutionContext`

此外明确**沿用** Hermes 三条小特性（详见 [05-hermes-feature-tradeoffs.md](./05-hermes-feature-tradeoffs.md)）：

- `[SILENT]` 静默标记：cron run 返回 `[SILENT]` 时跳过对外投递（仅落审计），适合监控类周期任务
- 一次性任务 `ONESHOT_GRACE_SECONDS = 120`：one-shot run_at 偏过去 ≤120s 仍可在下个 tick 触发，避免边界丢任务
- 卡死超时（inactivity timeout）：定时任务允许长时间运行，只要还在 tool call / stream，连续无活动 N 秒才视为卡死强制收尾

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| Schedule Domain Model | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-1schedule-domain-model) | 是 | 任务、触发器、运行记录的真源 |
| Scheduler Store | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-2scheduler-store) | 是 | SQLite 持久化与查询 |
| Trigger Engine | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-3trigger-engine) | 是 | APScheduler 装配层 |
| Execution Bridge | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-4execution-bridge) | 是 | 调度任务到 `Runner.run()` |
| Safety and Policy Integration | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-5safety-and-policy-integration) | 是 | `schedule` 审批、递归保护、并发策略 |
| Management Surfaces | 探索中 | [模块拆分](./02-module-breakdown.md#模块-6management-surfaces) | 否 | CLI / Web / tool-facing 接口 |

## 文档导航

- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)
- [Hermes 特性取舍](./05-hermes-feature-tradeoffs.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 先把 `Schedule Domain Model + Scheduler Store + Trigger Engine` 作为第一批方案冻结，这三块决定后续所有接口形状。
2. 第二批进入 `Execution Bridge`，把“定时任务触发一次 fresh run”跑通，优先本地执行，不做外部投递。
3. `Safety and Policy Integration` 与执行桥接一起进 `x-req`，避免先有无审计的 scheduler。
4. `Management Surfaces` 继续停留在方案层，等底层模型稳定后再拆 CLI / Web / tool 接口。
