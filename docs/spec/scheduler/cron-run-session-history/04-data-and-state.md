# 数据模型与状态

## 核心实体

| 实体 | 归属 | 关键字段 | 说明 |
|------|------|----------|------|
| `ScheduledTask` | scheduler domain/store | `task_id/thread_id/name/preset_id/trigger` | 一个定时任务，一个入口 thread |
| `ScheduledRun` | scheduler domain/store | `run_id/task_id/thread_id/session_id/status/scheduled_for` | 一次执行记录，也是 run session 索引 |
| `CronRunSessionRef` | cron router | `thread_id/task_id/run_id/session_id/legacy` | messages API 和 WS 分流使用的解析结果 |
| `ThreadMetadata` | `ThreadManager` | `id/thread_kind/source_kind/source_id` | `thread_kind="scheduled_task"` 表示任务入口 |
| `CronRunSummaryDTO` | Web REST | `thread_id/task_id/run_id/session_id/status/timestamps/excerpt` | 前端运行记录列表数据 |
| `CronMessageAppendedFrame` | Web WS | `frame_type/thread_id/task_id/run_id/session_id/message_id/content` | 实时消息追加帧 |
| `SchedulerRunVM` | frontend scheduler store | `threadId/taskId/runId/sessionId/status/displayTime` | run selector 和运行记录列表视图模型 |
| `ChatRunContext` | frontend chat state | `threadId/runId/sessionId` | timeline 当前上下文，composer 在 run context 禁用 |

## 身份字段语义

| 字段 | 语义 | 稳定性 |
|------|------|--------|
| `thread_id` | 定时任务入口 thread，用户从左侧列表或 scheduler 行进入它 | 一个 task 生命周期内稳定 |
| `task_id` | scheduler 任务 id，run 索引和操作归属 | 一个 task 生命周期内稳定 |
| `run_id` | 一次自动触发或手动运行的执行 id | 每次执行唯一 |
| `session_id` | 该次执行的上下文 session | 每次实际执行唯一；并发跳过类 run 可为空 |

## 存储策略

### Task store

`ScheduledTask.thread_id` 继续保存入口 thread。创建任务时由 `SchedulerManager` 协调 `ThreadManager.create_scheduled_task_thread()` 和 task store 写入，创建失败需要补偿删除新 thread。

### Run store

`ScheduledRun` 保存执行摘要和 session 索引。run jsonl 不复制完整消息历史，消息正文仍由 session store 保存。

建议新字段：

| 字段 | 类型 | 写入时机 |
|------|------|----------|
| `thread_id` | `str` | 创建 RUNNING run 时写入 |
| `session_id` | `str` | 创建 RUNNING run 前生成并写入 |
| `trigger_source` | `str` | 可选，区分 schedule tick / run_now |

### Session store

每次 cron run 使用独立 session 文件。入口 thread session 只承担导航和 legacy 历史承载；run 内 follow-up 是下一阶段。

## 状态流转

### 定时执行

1. ticker 发现 due task。
2. `ExecutionBridge` 创建 `run_id` 和 run `session_id`。
3. `ScheduledRun(status=RUNNING, thread_id, session_id)` append 到 run store。
4. Runner 使用 run `session_id` 执行。
5. final message 写入 run session history。
6. `ScheduledRun(status=COMPLETED/FAILED/...)` supersede 落盘。
7. notifier 广播 `cron.run.finished` 和 `cron.message.appended`，携带四元组。

### 手动运行

手动 `run_now` 与定时执行使用同一执行模型。差异只体现在 audit / DTO 的触发来源字段，run session 隔离规则一致。

### 切换历史

1. 前端进入 `thread_id` 页面。
2. scheduler store 调用 `GET /api/cron/tasks/{task_id}/runs`。
3. 默认选中最新 running run，其次选中最新 completed run。
4. 选中 run 后调用 `GET /api/cron/tasks/{task_id}/runs/{run_id}/messages`。
5. timeline 使用 `threadId + runId` 作为渲染上下文 key。

### 后续追问

本期 run context 禁用 composer，避免消息写入入口 thread session。下一阶段启用时必须先解析 `run_id -> session_id`，再让 Runner 使用该 session 继续执行。

## Legacy 兼容

| 旧数据形态 | 展示策略 | 写入策略 |
|------------|----------|----------|
| run 缺 `thread_id`，task 有 `thread_id` | 从 task 回填后展示 | 新 run 写入显式 `thread_id` |
| run `session_id == thread_id` | 显示为“历史混合记录”或 legacy run | 新 run 使用独立 `session_id` |
| run 缺 `session_id` | 展示摘要，messages 按不可打开处理或指向 legacy fallback | 新 run 强制写入 |
| 旧 thread history 已混合多次执行 | 保留原样 | 从本 spec 上线后开始严格隔离 |

## 前端状态

| 状态 | 所属 store/provider | 说明 |
|------|---------------------|------|
| `runsByTaskId` | scheduler store | task 下运行记录列表 |
| `selectedRunIdByTaskId` | scheduler store | 当前选中的 run |
| `runMessagesCache` | chat/timeline store | run session 消息缓存 |
| `activeRunContext` | chat 页面状态 | 当前 timeline 使用的 run 身份 |
| `pendingCronFrames` | chat provider 或 scheduler store | 未选中 run 的实时帧只更新 badge/list |

## 不变量

- 新 run 的 `session_id` 与入口 `thread_id` 不相同。
- 一个 `run_id` 只映射一个 `session_id`。
- 一个 `session_id` 只属于一个 `task_id/run_id`。
- `cron.*` WS frame 的 `thread_id/task_id/run_id/session_id` 与 run store 一致。
- run context composer 保持禁用；后续启用 follow-up 时只写入当前 selected run 的 `session_id`。
