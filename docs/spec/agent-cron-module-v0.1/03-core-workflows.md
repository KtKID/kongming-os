# 核心流程

## 1. 创建任务

```text
User / Agent Request
  -> schedule management entrypoint
  -> approval(operation=schedule)
  -> validate trigger / policy / payload
  -> persist ScheduledTask
  -> register or reload APScheduler trigger
```

关键约束：

- 创建任务必须先过 `operation=schedule`
- trigger 解析失败直接拒绝创建
- `next_run_at` 由 store 计算并持久化，不以内存值为准

## 2. 调度触发

```text
APScheduler fires
  -> Trigger Engine asks Store to reserve due task (file lock 区间内)
  -> Store advances next_run_at for recurring task
  -> create ScheduledRun(status=running)
  -> call Execution Bridge
```

关键约束：

- recurring task 先推进 `next_run_at`，再开始执行（继承 Hermes `advance_next_run`，至多一次语义）
- one-shot task 执行后直接进入 completed 或 disabled
- one-shot 任务命中 `ONESHOT_GRACE_SECONDS = 120` 宽限：`run_at` 比当前时间早 ≤120s 仍可在下个 tick 触发，避免边界丢任务
- reserve / status update 在同一 file lock 区间内完成
- 错过窗口太久的 recurring task（超过 grace = 周期/2，clamp [120s, 7200s]）触发"快进"：直接更新 `next_run_at` 到下个未来时刻，跳过本次执行，避免补跑风暴

## 3. fresh run 执行

```text
Execution Bridge
  -> create fresh session_id
  -> create fresh run_id
  -> build scheduled RunRequest
  -> trim disallowed tools
  -> wrap ApprovalProvider with ScheduleApprovalProvider (fail-closed)
  -> start inactivity watchdog
  -> Runner.run(...)
  -> capture Result
```

关键约束：

- 定时任务默认不复用旧会话
- 任务 prompt / payload 必须自包含
- schedule 管理工具默认从本次 run 的 enabled tools 里裁掉
- **运行期审批**：`ScheduleApprovalProvider` 包裹现有 `SafetyGatedApproval`，cron run 命中需要 consent 的高风险动作时直接 deny → 工具失败 → run 整体 `failed(error=needs_approval:<capability>)`，不挂起、不交互
- **inactivity watchdog**：监听 turn / tool / stream 活动，连续无活动 N 秒（默认 600s，可由 `KONGMING_CRON_INACTIVITY_TIMEOUT` 覆盖）则强制取消，记录 `error=inactivity_timeout`

## 4. 结果回写与投递

```text
Result
  -> check [SILENT] marker (final_message starts with "[SILENT]" → skip delivery)
  -> write ScheduledRun(status/result/error)
  -> update ScheduledTask(last_run_at/last_status)
  -> emit audit/event
```

关键约束：

- 结果写入不能依赖最终 message 一定存在
- **`[SILENT]` 投递抑制**：final message 以 `[SILENT]` 开头时跳过对外投递，但 `ScheduledRun` 与 audit 仍正常落盘；适合"无异常即静默"类监控任务
- 失败与 delivery-style 错误要分开建模（`error_message` vs `delivery_error`）
- 审计记录必须覆盖 create / update / pause / resume / remove / run
- 审计动作显式包含 `silent_suppressed` / `inactivity_timeout` / `needs_approval_failed` 三种新 reason

## 5. 服务恢复

```text
App restart
  -> load enabled tasks from Store
  -> rebuild APScheduler registrations
  -> inspect stale running tasks
  -> mark abandoned runs or recover conservatively
```

关键约束：

- 不补跑过期很久的 recurring task
- 允许一部分任务被保守跳过
- `running` 状态的中断 run 需要显式收尾，不能永久悬挂

## 6. Hermes 参考点

本方案明确继承 Hermes 的**六条**运行语义：

1. fresh session 执行隔离
2. recurring job 执行前先推进 `next_run_at`（at-most-once 倾向）
3. missed-run 采用保守快进策略（grace = 周期/2，clamp [120s, 7200s]）
4. **`[SILENT]` 静默标记**：抑制无变化时的对外投递
5. **`ONESHOT_GRACE_SECONDS = 120`**：一次性任务边界宽限
6. **inactivity timeout**：长任务允许跑数小时，仅在连续无活动时强制收尾

本方案明确替换 Hermes 的三条底层实现：

1. `jobs.json` 单文件 → `scheduled_tasks.json` + per-task `runs/<task>.jsonl` + `audits.jsonl`（仍是文件存储，不上 SQLite）
2. `60s tick + file lock` → APScheduler `MemoryJobStore` + 进程级 file lock（防多实例抢 due）
3. env var 注入运行上下文 → 显式 `TaskExecutionContext`
