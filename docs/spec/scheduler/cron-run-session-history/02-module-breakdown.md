# 模块拆分

## 模块总览

| 模块 | 边界入口 | 职责 |
|------|----------|------|
| M1 scheduler run index contract | `SchedulerManager` | 管理 task thread 下的 run 索引、run summary、run/session 映射 |
| M2 execution bridge run session | `ExecutionBridge` | 为每次执行创建独立 session，并把 Runner 输出写入该 session |
| M3 web thread run API | cron router | 按 task/run 加载消息 |
| M4 cron realtime protocol | `ExecutionBridge` + `ThreadManager` fanout | 发送带 run/session 字段的 `cron.*` 实时帧 |
| M5 frontend run timeline | scheduler store + chat provider | 维护 selected run，按 run 加载和分流 timeline |
| M6 migration and validation | store migration + tests | 旧数据兼容、协议漂移测试、端到端验证 |

## M1 scheduler run index contract

### 职责

`SchedulerManager` 作为 scheduler 对外门户，提供 thread 下 run 历史索引能力。它封装 `Store.list_runs()`、task lookup、legacy 映射和 DTO 组装。

### 包含

- `ScheduledRun` 新增或等价暴露 `thread_id` 字段。
- 新 run 的 `session_id` 必填，旧 run 保持兼容读取。
- run summary DTO 包含 `thread_id/task_id/run_id/session_id/status/scheduled_for/started_at/finished_at/final_message_excerpt`。
- `SchedulerManager.list_thread_runs(thread_id, limit, cursor)`。
- `SchedulerManager.resolve_run_session(thread_id, run_id)`。

### 暂缓

- 把 scheduler store 改成数据库。
- 把完整 message history 复制进 run record。

### 数据结构

| 类型 | 字段 | 说明 |
|------|------|------|
| `ScheduledRun` | `thread_id: str` | 任务入口 thread，旧数据可从 `ScheduledTask.thread_id` 回填 |
| `ScheduledRun` | `session_id: str` | 该次执行上下文 session，新 run 必填 |
| `CronRunSummaryDTO` | `run_id/session_id/thread_id/task_id` | 前后端分流的最小身份字段 |
| `CronRunSessionRef` | `thread_id/task_id/run_id/session_id/legacy` | messages API 和 WS 分流的解析结果 |

### 依赖

- 依赖 `src/scheduler/store.py` 的 task/run 读写。
- 依赖 `src/scheduler/domain.py` 的领域对象。
- 被 Web router、`ExecutionBridge` 和测试调用。

### 风险

字段兼容读取是主要风险。旧 run 缺 `thread_id` 时按 `task_id -> ScheduledTask.thread_id` 回填；旧 run 的 `session_id == thread_id` 时标记 `legacy=true`。

## M2 execution bridge run session

### 职责

`ExecutionBridge` 决定 cron run 的执行 session。新逻辑把 `task.thread_id` 用作入口 thread，把新生成的 `session_id` 用作 Runner session。

### 包含

- 每次执行先生成 `run_id`，再生成稳定可追踪的 `session_id`。
- `ScheduledRunRequest.session_id` 使用 run session。
- `TaskExecutionContext` 记录 `thread_id/task_id/run_id/session_id`。
- run audit payload 记录 `thread_id/task_id/run_id/session_id`。
- final message 仍写入 run session 历史和 run summary。

### 暂缓

- 改动 `Runner` 的 turn 推进逻辑。
- 在 `ExecutionBridge` 内直接操作 Web UI 状态。

### 建议 session id 规则

| 场景 | 规则 |
|------|------|
| 自动触发 | `cronrun-{task_id}-{run_id}` |
| 手动 `run_now` | 仍使用同一规则，触发来源写入 run audit |
| legacy | `session_id == thread_id` 的历史共享 session 标记为 legacy |

### 依赖

- 调用 `session_factory(session_id)` 创建 run session。
- 调用 `SchedulerManager` 或 store 写 run record。
- 通过 delivery / notifier 发出 run lifecycle 帧。

### 风险

审批、tool call、trace、audit 都需要随 run session 走。验证时必须检查 trace/run/session 三者一致。

## M3 web thread run API

### 职责

cron router 提供“在某个 scheduled_task 下查看某次 run messages”的入口。`ThreadManager` 保持 thread 生命周期门户职责。

### 包含

- `ThreadManager.list_cron_runs(thread_id)` 委托 `SchedulerManager`。
- `ThreadManager.load_cron_run_messages(thread_id, run_id)` 解析 run session 并读取 session history。
- `ThreadManager.send_cron_run_message(thread_id, run_id, content, preset/context)` 解析 run session 后复用 generic_chat 运行链路。
- REST API：
  - `GET /api/cron/tasks/{task_id}/runs`
  - `GET /api/cron/tasks/{task_id}/runs/{run_id}/messages`

### 暂缓

- 前端直接传本地 session path。
- router 直接 import scheduler store 内部 helper。
- 为 run session 新建第二套聊天 runtime。

### 依赖

- 依赖 `SchedulerManager.resolve_run_session()`。
- 依赖现有 generic_chat cell/runtime 发送能力。
- 依赖 session store 读取消息。

### 风险

本期 run context 禁用 composer。后续启用 follow-up 时，pending/running 状态需要归属到 run session，同时入口 thread 的列表状态也要更新。

## M4 cron realtime protocol

### 职责

cron 实时协议负责让前端在同一个 thread 页面里按 run 分流。所有 cron 相关 S2C frame 使用 `frame_type`，并携带身份四元组。

### 必备字段

| Frame | 必备字段 |
|-------|----------|
| `cron.run.started` | `thread_id/task_id/run_id/session_id/status/started_at` |
| `cron.run.finished` | `thread_id/task_id/run_id/session_id/status/finished_at/final_message_excerpt` |
| `cron.run.completed` | 保留兼容，补齐 `thread_id/task_id/run_id/session_id` |
| `cron.message.appended` | `thread_id/task_id/run_id/session_id/message_id/content` |

### 边界入口

- Python DTO 位于 `src/hosts/web/protocol/ws_frames.py`。
- TypeScript DTO 位于 `web/src/protocol.ts`。
- `ThreadManager.append_cron_message()` 只负责实时 fanout。
- `ExecutionBridge` 或 delivery notifier 负责提供 run/session 字段。

### 风险

`cron.message.appended` 当前已有 `run_id/task_id` 字段，但 `session_id` 仍需补齐。协议漂移测试必须覆盖 Python -> JSON -> TypeScript fixture。

## M5 frontend run timeline

### 职责

前端把 scheduled_task thread 页面升级为 run-aware 页面。scheduler store 保存 run 列表和 selected run，chat provider 把 WS frame 归一化成带 run 身份的 timeline event。

### 包含

- scheduler store 新增 `selectedRunIdByTaskId`、`runsByTaskId`、run timeline key 或等价结构。
- route query 使用 `?runId=<run_id>`，无 query 时选择最新 running run 或最新 completed run。
- run selector 显示今天、昨天、具体时间和状态。
- timeline 加载 `GET run messages` 的返回值。
- run context 下 composer 禁用，避免写入入口 thread session。
- `GenericChatProvider` 处理 `cron.message.appended` 时带上 `runId/sessionId/source="cron"`。
- 当前 selected run 命中时追加 timeline，其他 run 更新列表状态和未读计数。

### 暂缓

- 多 run 并排对比。
- run history 全文搜索。

### 风险

当前 chat timeline 以 `threadId` 为主要 key。实现时需要增加 active context key，建议使用 `threadId + runId` 的复合 key，避免切换 run 时复用旧消息。

## M6 migration and validation

### 职责

保证旧 scheduled_task thread 可以打开，新 run 使用独立 session，测试覆盖数据、协议和 UI 分流。

### 包含

- 旧 run 缺 `thread_id`：从 task 回填。
- 旧 run 缺 `session_id`：显示为不可打开或 legacy 摘要，按实际数据保守处理。
- 旧 run `session_id == thread_id`：归入 legacy run 入口。
- 新 run 强制独立 session。
- 后端和前端 fixture 同步。

### 风险

旧共享 thread history 不能可靠按日期拆分。产品语义应展示为“历史混合记录”，从新版本之后开始严格隔离。
