# Scheduler

> 状态：持续演进
> 责任：定时任务的创建、调度、执行、运行记录、投递和 Web 可视化入口。

## 模块职责

Scheduler 模块负责把用户创建的 cron / one-shot 任务转成可审计、可恢复、可查看的 agent run。后端主入口收口在 `SchedulerManager` 与 `ExecutionBridge`，Web thread 相关能力收口在 `ThreadManager`，前端状态收口在 scheduler store 与 chat provider。

## Spec 导航

| Spec | 状态 | 说明 |
|------|------|------|
| [cron-run-session-history](./cron-run-session-history/README.md) | 可进入 x-req | 同一个定时任务 thread 入口下，按执行时间切换独立 run session 历史和上下文 |

## 相关既有文档

| 文档 | 关系 |
|------|------|
| [定时任务专属 thread](../modules/定时任务/scheduled-task-thread/README.md) | 已完成“一任务一 thread”基础链路，本 spec 在其上增加“一次执行一 run session” |
| [cron delivery v0.3](../cron-delivery-v0.3/README.md) | 已定义运行记录、投递和 Web 可视化基础能力 |
| [web cron center](../web-cron-center/README.md) | 已定义 scheduler 抽屉和运行记录展示入口 |

## 当前建议

`cron-run-session-history` 是下一步主线。开发顺序建议为后端 run session 数据契约和 API、`ExecutionBridge` 执行 session 改造、前端 run 选择与 timeline 分流、迁移兼容和端到端验证。
