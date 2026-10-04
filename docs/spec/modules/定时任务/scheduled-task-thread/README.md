# Scheduled Task Thread Spec

> 状态：可进入 x-req
> 目标：每个 cron 定时任务拥有专属 thread，创建、执行、历史查看和前端导航围绕同一个绑定 thread 收口。

## 系统目标

本 spec 定义定时任务专属 thread 的后续增强方案。现有 v0.4 已完成来源 thread 投递和 preset 继承，本轮把 cron 的长期上下文从来源 thread 升级为任务绑定 thread，让一次任务的创建参数、执行 session、默认消息历史和前端入口指向同一个 thread。

## 最小可用路径

用户在 Web 或 schedule_tool 创建 cron 任务 → 系统先创建 `thread_kind="scheduled_task"` 的 thread → `ScheduledTask.thread_id` 和 `delivery.target="thread:<thread_id>"` 一起落盘 → cron 触发时 `ExecutionBridge` 用该 thread 作为 `session_id` 执行 → 用户从定时任务列表或左侧“定时任务”分组打开完整历史。

## 范围边界

**包含**：
- 每个 cron 绑定一个专属 thread。
- 创建任务时先 provision thread，再创建 `ScheduledTask`。
- 触发执行时把输入、输出和执行上下文写入绑定 thread。
- thread metadata 增加业务类型字段：`thread_kind`、`source_kind`、`source_id`。
- Web 定时任务列表支持打开绑定 thread，左侧 thread 列表增加“定时任务”分组。
- 保留已有 cron 广播和 preset 行为。

**范围外**：
- cron 表达式语义、tick 调度算法和审批模式重写。
- SQLite 化 scheduler store。
- 旧 v0.1 数据迁移。
- 运行历史跨 thread 合并视图。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| M1 scheduler domain/store contract | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#m1-scheduler-domainstore-contract) | 是 | 增加 `ScheduledTask.thread_id` 与 store 兼容回填 |
| M2 scheduler manager/provisioning | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#m2-scheduler-managerprovisioning) | 是 | 收口创建 thread、创建任务、失败补偿 |
| M3 execution bridge session binding | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#m3-execution-bridge-session-binding) | 是 | cron run 落绑定 thread，投递路径避免重复追加 |
| M4 web thread metadata/REST contract | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#m4-web-thread-metadatarest-contract) | 是 | thread schema v11 与 REST/DTO 协议升级 |
| M5 frontend navigation | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#m5-frontend-navigation) | 是 | 左侧分组和定时任务行内打开 thread |
| M6 validation | 可进入 x-req | [05-validation-and-evolution.md](./05-validation-and-evolution.md) | 是 | pytest、vitest、smoke/e2e 验收矩阵 |

## 文档导航

- [图集：总览 + 各模块局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

`scheduled-task-thread` 可直接进入 x-req。首个 task 建议覆盖 M1-M6 的薄切片，先打通 Web create → thread provision → task store → cron run → thread history → frontend open thread 的完整链路。
