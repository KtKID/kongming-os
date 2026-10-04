# 目标与完成标准

## 需求要点

1. 每个 cron 定时任务有一个专属 thread。
2. 创建定时任务时先创建或注册对应 thread，再把 thread id 写入定时任务参数。
3. 定时任务触发时，执行上下文和默认消息历史写入这个专属 thread。
4. thread 类型要标记为定时任务；`backend_kind` 是传输通道字段，业务类型建议新增 `thread_kind`。
5. 定时任务侧要能从列表打开对应 thread 历史，左侧要有专门“定时任务”列表。
6. 一个 cron 对应一个 thread，避免多个 cron 或每天触发的上下文混到同一个共享定时任务 thread。
7. 保留已有 cron 广播与 preset 行为；本轮把旧 v0.4 “投递回来源 thread”升级为“任务绑定专属 thread + 执行 session 落绑定 thread”。

## 系统目标

定时任务需要具备长期、可追踪、可打开的业务上下文。专属 thread 让 cron 的创建参数、执行输入、运行输出、preset 选择和用户查看入口全部落在同一个会话对象上，降低历史混用、重复投递和前端入口分散的风险。

## 完成目标（DoD）

- [ ] DoD#1：Web 创建 cron 任务时先创建 `thread_kind="scheduled_task"` 的 thread，返回的任务 DTO 含 `thread_id`。
- [ ] DoD#2：schedule_tool 创建 cron 任务时获得同样的 thread provisioning 能力，且工具层只依赖 scheduler 边界或注入协议。
- [ ] DoD#3：`ScheduledTask.thread_id` 作为一等字段持久化；读取旧任务时兼容 `payload.get("thread_id", "")`，并能从 `target.metadata["thread_id"]` 或 `delivery.target="thread:<id>"` 回填。
- [ ] DoD#4：cron 触发时 `ExecutionBridge` 使用 `task.thread_id` 作为 `Runner.run(session_id=...)`，`TaskExecutionContext.thread_id`、run audit 和 payload 都记录绑定 thread。
- [ ] DoD#5：绑定 thread 执行路径保留 `/ws/cron` 广播，并避免 `ThreadTargetSink.append_cron_message` 对同一 thread 重复追加消息。
- [ ] DoD#6：thread metadata schema v11 增加 `thread_kind`、`source_kind`、`source_id`，老 thread 懒升级为 `thread_kind="chat"`。
- [ ] DoD#7：前端 thread 列表显示“定时任务”分组，scheduler 列表行可以打开对应 thread 历史。
- [ ] DoD#8：新增后端路由/Manager/store/execution pytest、前端 API/ThreadList/scheduler vitest，以及一条 Web UI → API → store → cron run → thread history 的 smoke/e2e 验收描述。

## 范围边界

**包含**：
- scheduler domain/store 增加 `thread_id` 字段和兼容读写。
- 新增 SchedulerManager 或 provisioning Protocol，把 thread 创建、task 创建和失败补偿收口。
- Web REST create 和 schedule_tool create 共用同一创建边界。
- ExecutionBridge 使用绑定 thread session 写历史。
- DeliveryDispatcher 在绑定 thread 执行路径保留广播，跳过同 thread target append。
- ThreadManager 和 metadata 增加定时任务业务类型能力。
- 前端协议、列表分组、任务行打开 thread。

**范围外**：
- cron 触发器解析、misfire、concurrency、approval mode 的语义调整。
- scheduler store schema bump 和重置式迁移。
- 用 `backend_kind` 表达业务类型。
- 新增共享“定时任务 thread”。
- 移除已有 `/ws/cron` 广播能力。

## 关键约束

- scheduler `SCHEMA_VERSION` 当前为 5，历史迁移是重置式；本轮字段升级采用兼容读取和写新字段，保持 schema 版本。
- `backend_kind` 取值 `generic_chat` / `claude_code` / `codex`，表达传输或运行通道；业务类型使用 `thread_kind`。
- `ScheduleDelivery.target` 已约定 `thread:<thread_id>`，绑定 thread 方案继续复用该目标格式。
- `Runner._seed_messages` 会写入 user message，非流式终态会写入 assistant message；ExecutionBridge 使用绑定 thread session 即可把默认输入输出落到 thread 历史。
- schedule_tool 属于 `src/tools/`，工具层通过 Protocol、callable 或 SchedulerManager 边界注入创建能力，保持跨模块 import 边界。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD#1 Web 创建任务创建专属 thread | M2 + M4 | `scheduled-task-thread` | 待实现 |
| DoD#2 schedule_tool 共用 provisioning | M2 + M4 | `scheduled-task-thread` | 待实现 |
| DoD#3 `ScheduledTask.thread_id` 持久化与回填 | M1 | `scheduled-task-thread` | 待实现 |
| DoD#4 cron run 落绑定 thread | M1 + M3 | `scheduled-task-thread` | 待实现 |
| DoD#5 保留广播并避免重复 append | M3 | `scheduled-task-thread` | 待实现 |
| DoD#6 thread metadata v11 | M4 | `scheduled-task-thread` | 待实现 |
| DoD#7 前端分组与打开历史 | M5 | `scheduled-task-thread` | 待实现 |
| DoD#8 测试和 smoke/e2e | M6 | `scheduled-task-thread` | 待实现 |
