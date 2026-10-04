# Cron Run Session History

> 状态：可进入 x-req
> 目标：同一个定时任务 thread 作为入口，按每次执行时间切换独立 run session 历史。本期交付历史查看、刷新恢复、实时分流和手动运行自动切换；run 内追问作为下一阶段。

## 系统目标

现有 `scheduled-task-thread` 已完成“一个 cron task 绑定一个 scheduled_task thread”。当前缺口是多次执行共享同一个 thread session，今天、昨天和手动运行会混在同一条聊天时间线里。这个 spec 把“任务入口”和“执行上下文”拆成两层：`thread_id` 表示定时任务入口，`run_id/session_id` 表示某一次执行的独立上下文。

本轮基于已提交的实时刷新修复 `32b68d21` 与 `f400fd44` 继续演进。已有 `cron.message.appended` 解决了实时结果进入 thread 的问题；本 spec 要求所有 cron 实时帧都携带 `thread_id/task_id/run_id/session_id`，前端据此把消息分流到当前选中的 run。

## 最小可用路径

用户打开“测试定时任务”这个 scheduled_task thread -> 右侧或顶部运行记录列出今天、昨天和手动运行记录 -> 点击某次 run -> chat timeline 加载该 run 对应 `session_id` 的消息 -> 当前 run context 进入只读查看态 -> cron 实时帧按 `run_id/session_id` 更新当前 timeline 或运行记录列表。

## 范围边界

### 包含

- 同一个 `thread_id` 继续作为定时任务入口和导航目标。
- 每次 cron 自动触发或手动 `run_now` 都创建独立 `run_id` 与 `session_id`。
- `ScheduledRun` 成为 `run_id -> session_id -> thread_id/task_id` 的索引源。
- Web API 支持按 task 查询 runs、按 run 查询 messages。
- cron 实时帧携带 `frame_type` 和 `thread_id/task_id/run_id/session_id`。
- 前端 scheduler store 维护 selected run，chat provider/timeline 按 run 分流。
- 旧共享 thread session 作为 legacy 历史入口展示，新执行全部进入独立 run session。

### 暂缓范围

- cron 表达式、tick 调度、并发策略和审批策略重写。
- scheduler store SQLite 化。
- 多用户权限模型。
- 跨任务合并搜索和全局运行回放。
- 对旧共享历史做自动逐条拆分。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| M1 scheduler run index contract | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#m1-scheduler-run-index-contract) | 是 | `ScheduledRun.thread_id/session_id`、run summary DTO、store roundtrip |
| M2 execution bridge run session | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#m2-execution-bridge-run-session) | 是 | `ExecutionBridge` 每次执行创建独立 session，并把 run/session/thread 写入审计 |
| M3 web thread run API | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#m3-web-thread-run-api) | 是 | cron router 提供 run history/messages 能力 |
| M4 cron realtime protocol | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#m4-cron-realtime-protocol) | 是 | `cron.*` 帧统一携带 run/session 字段，前端可分流 |
| M5 frontend run timeline | 可进入 x-req | [02-module-breakdown.md](./02-module-breakdown.md#m5-frontend-run-timeline) | 是 | scheduler store、chat provider、路由 query 和只读 run context |
| M6 migration and validation | 可进入 x-req | [05-validation-and-evolution.md](./05-validation-and-evolution.md) | 是 | legacy 兼容、协议漂移、薄 e2e 验证 |

## 文档导航

- [图集：总览 + 数据 + 执行 + 前端分流](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

本 spec 可直接进入 x-req。首个 task 覆盖一条完整薄切片：新 run 生成独立 session -> run list 暴露 `session_id` -> 前端点击 run 切 timeline -> 刷新恢复同一 run -> cron WS 帧按 run 分流。
