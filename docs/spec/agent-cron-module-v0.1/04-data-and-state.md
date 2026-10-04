# 数据与状态

## 1. 数据结构总览

cron 模块的数据真源分三层：

1. **领域结构**
   - `ScheduledTask`
   - `ScheduleTrigger`
   - `TaskExecutionPolicy`
   - `TaskTarget`
   - `ScheduledRun`
2. **持久化结构（v0.1 文件存储）**
   - `scheduled_tasks.json`：全量任务定义集合（原子写入：tmp + rename + fsync）
   - `runs/<task_id>.jsonl`：每任务独立 append-only 运行记录
   - `audits.jsonl`：全局 append-only 审计日志
   - `.scheduler.lock`：进程级 file lock，防止多实例同时抢占 due task
3. **运行时结构**
   - `TaskExecutionContext`
   - `DueTaskReservation`
   - `RunRequest`

边界规则：

- 领域结构决定字段语义
- 持久化结构决定落盘与查询方式（v0.1 是文件，v0.2 视任务量决定是否迁 SQLite）
- 运行时结构决定模块间传参
- APScheduler job object 不是业务真源（仅为 in-memory 闹钟，重启从文件重建）

## 2. 核心枚举

```python
from typing import Literal

TriggerType = Literal["once", "interval", "cron"]
TaskState = Literal["scheduled", "paused", "running", "completed", "failed", "disabled"]
RunStatus = Literal[
    "running",
    "completed",
    "failed",
    "abandoned",       # 进程崩溃 / 重启后悬挂的 run 收尾
    "cancelled",       # replace 策略下被新 run 取代
    "silent",          # final message 命中 [SILENT]，仅落审计、不投递
    "inactivity_timeout",  # 卡死兜底
]
SessionMode = Literal["fresh_session"]
ConcurrencyPolicy = Literal["forbid", "allow", "replace"]
MisfirePolicy = Literal["skip", "catch_up_once", "fire_now"]
TaskOrigin = Literal["cli", "web", "tool", "system"]
RunFailureReason = Literal[
    "needs_approval",       # cron run 命中未授权动作 → fail-closed
    "inactivity_timeout",
    "tool_error",
    "runner_exception",
    "abandoned_on_restart",
    "delivery_error",
]
```

约束：

- `SessionMode` 第一版只允许 `fresh_session`
- `TaskState` 属于任务级状态
- `RunStatus` 属于单次执行状态
- `MisfirePolicy` 只影响错过触发窗口后的处理，不影响正常触发
- v0.1 **不引入 `waiting_approval` 状态**：cron run 命中未授权动作时直接 `failed(reason=needs_approval)`，下次 trigger 重跑；持久化审批与 `waiting_approval -> 批准 -> 续跑` 推迟到 v0.2

## 3. 领域结构

### 3.1 `ScheduleTrigger`

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class ScheduleTrigger:
    trigger_type: TriggerType
    expr: str
    timezone: str
```

字段说明：

- `trigger_type`
  - `once`: `expr` 是 ISO timestamp
  - `interval`: `expr` 是规范化间隔表达，如 `PT30M`
  - `cron`: `expr` 是 5-field cron expression
- `timezone`
  - IANA timezone string
  - 所有 `next_run_at` 计算都基于这个时区

边界：

- Trigger Engine 负责把它映射为 APScheduler trigger
- Store 只持久化，不解释语义

### 3.2 `TaskExecutionPolicy`

```python
@dataclass(frozen=True)
class TaskExecutionPolicy:
    session_mode: SessionMode
    concurrency_policy: ConcurrencyPolicy
    misfire_policy: MisfirePolicy
    max_turns: int | None
    inactivity_timeout_seconds: int | None  # 默认 600；0/None = 不启用
    wall_timeout_seconds: int | None        # v0.1 字段保留但运行时不强制
    retry_limit: int
    silent_marker_enabled: bool = True      # final message 命中 [SILENT] 是否抑制投递
```

字段说明：

- `session_mode`
  - 第一版固定 `fresh_session`
- `concurrency_policy`
  - `forbid`: 已有运行中任务时直接跳过
  - `allow`: 允许并发运行
  - `replace`: 取消旧 run，启动新 run
- `misfire_policy`
  - `skip`: 快进到未来，不补跑
  - `catch_up_once`: 允许补 1 次
  - `fire_now`: 立即执行 1 次
- `max_turns`
  - 覆盖 `AgentSpec.max_turns`
- `inactivity_timeout_seconds`
  - **v0.1 主用超时维度**：监听 turn / tool / stream 活动，连续无活动达阈值则强制取消 → `RunStatus=inactivity_timeout`
  - 默认 600s（10 min）；0/None 表示不启用
  - 可由 env `KONGMING_CRON_INACTIVITY_TIMEOUT` 覆盖
- `wall_timeout_seconds`
  - v0.1 字段保留但运行时不强制；保留是为了 schema 稳定，运行期由 inactivity 兜底
- `retry_limit`
  - 对调度级失败的最多重试次数（不重试 `needs_approval` 类失败）
- `silent_marker_enabled`
  - 是否启用 `[SILENT]` 静默投递抑制；默认开启

边界：

- Policy 由 Safety and Policy Integration 解释
- Execution Bridge 负责消费执行相关字段

### 3.3 `TaskTarget`

```python
@dataclass(frozen=True)
class TaskTarget:
    agent_name: str
    input_text: str
    metadata: dict[str, str]
```

字段说明：

- `agent_name`
  - 指向目标 agent spec
- `input_text`
  - 实际传给 `Runner.run(user_input=...)` 的输入
- `metadata`
  - 来源、展示名、标签、保守扩展字段

边界：

- 第一版不把 Python callable、shell snippet、外部投递目标直接塞进 `TaskTarget`
- `input_text` 必须是自包含任务描述

### 3.4 `ScheduledTask`

```python
@dataclass(frozen=True)
class ScheduledTask:
    task_id: str
    name: str
    enabled: bool
    state: TaskState
    origin: TaskOrigin
    trigger: ScheduleTrigger
    policy: TaskExecutionPolicy
    target: TaskTarget
    next_run_at: str | None
    last_run_at: str | None
    created_by: str
    created_at: str
    updated_at: str
```

字段说明：

- `task_id`
  - 稳定主键
- `enabled`
  - 调度参与开关
- `state`
  - 用于展示与恢复
- `origin`
  - 任务来源入口
- `next_run_at`
  - 当前任务下次应执行的绝对时间
- `last_run_at`
  - 最近一次开始执行时间
- `created_by`
  - 用户、thread、system actor 标识

状态约束：

- `enabled=False` 时，`state` 只能是 `paused` 或 `disabled`
- one-shot 完成后可转为 `completed`
- recurring task 正常执行后回到 `scheduled`

### 3.5 `ScheduledRun`

```python
@dataclass(frozen=True)
class ScheduledRun:
    run_id: str
    task_id: str
    status: RunStatus
    scheduled_for: str
    started_at: str | None
    finished_at: str | None
    session_id: str | None
    result_status: str | None
    final_message_excerpt: str | None
    error_message: str | None
    failure_reason: RunFailureReason | None  # 失败时填写，便于查询和告警
    delivery_error: str | None               # 投递层错误（与 agent 错误分开建模）
    silent_suppressed: bool                  # 是否被 [SILENT] 抑制投递
```

字段说明：

- `scheduled_for`
  - 这次执行原本对应的逻辑触发时间
- `session_id`
  - fresh session 标识
- `result_status`
  - 映射 `Result.status`
- `final_message_excerpt`
  - 用于列表展示与审计；命中 `[SILENT]` 时仍写入（含 marker 本身）
- `failure_reason`
  - `status=failed / inactivity_timeout / abandoned` 时必填
- `delivery_error`
  - 仅记录"投递阶段"失败，不影响 agent 是否 success
- `silent_suppressed`
  - `status=silent` 或开启了 `silent_marker_enabled` 且命中标记时为 True

边界：

- `ScheduledRun` 只保留摘要，不复制整段 session history
- 全量历史仍属于 session store

## 4. 持久化结构（v0.1 文件存储）

> v0.1 不上 SQLite。原因：项目当前 session 默认走 file backend，引入 SQLite 会多养一套迁移/索引/事务体系；Hermes 的 `jobs.json` 单文件方案被验证扛得住。本方案在此基础上把 run 拆 per-task JSONL，避免单 JSON 越写越大。
>
> 升级位：v0.2 视任务量与查询压力决定是否迁 SQLite，文件 schema 字段命名与 SQL 列名保持等价。

### 4.1 `scheduled_tasks.json`

布局：

```json
{
  "version": 1,
  "updated_at": "2026-05-01T08:00:00+08:00",
  "tasks": [
    {
      "task_id": "...",
      "name": "...",
      "enabled": true,
      "state": "scheduled",
      "origin": "cli",
      "trigger": { "type": "cron", "expr": "0 9 * * *", "timezone": "Asia/Shanghai" },
      "policy": {
        "session_mode": "fresh_session",
        "concurrency_policy": "forbid",
        "misfire_policy": "skip",
        "max_turns": null,
        "inactivity_timeout_seconds": 600,
        "wall_timeout_seconds": null,
        "retry_limit": 0,
        "silent_marker_enabled": true
      },
      "target": {
        "agent_name": "default",
        "input_text": "...",
        "metadata": {}
      },
      "next_run_at": "...",
      "last_run_at": null,
      "created_by": "...",
      "created_at": "...",
      "updated_at": "..."
    }
  ]
}
```

写入策略：

- tmp file + `os.replace` + `fsync`，单文件原子覆盖
- 读侧容错：JSONDecodeError 时尝试 `strict=False` 自动修复，参考 Hermes `load_jobs`

### 4.2 `runs/<task_id>.jsonl`

每任务独立 append-only JSONL。每行是一个 `ScheduledRun`：

```json
{"run_id": "...", "task_id": "...", "status": "completed", "scheduled_for": "...", "started_at": "...", "finished_at": "...", "session_id": "...", "result_status": "...", "final_message_excerpt": "...", "error_message": null, "failure_reason": null, "delivery_error": null, "silent_suppressed": false}
```

写入策略：

- 单行 append + fsync；run 状态变更（如 running → completed）用"覆盖最后一行"或"再 append 一行带 `superseded=true` 标记的旧条目"二选一（建议后者，append-only 更稳）
- 查询最新 run：tail-reverse 到第一条非 `superseded` 行

### 4.3 `audits.jsonl`

全局 append-only JSONL：

```json
{"audit_id": "...", "task_id": "...", "action": "...", "actor": "...", "payload": {}, "created_at": "..."}
```

审计动作至少包含：

- `create`
- `update`
- `pause`
- `resume`
- `remove`
- `run_requested`
- `run_started`
- `run_finished`
- `run_failed`
- `run_silent_suppressed`
- `run_inactivity_timeout`
- `run_needs_approval`

### 4.4 `.scheduler.lock`

进程级 file lock（fcntl on Unix / msvcrt on Windows，跟 Hermes `.tick.lock` 同款）。

用途：

- due-task 选择 + `advance_next_run` 必须在 lock 区间内
- 多实例（systemd timer / 手动 tick / web 进程）同时启动时只有一个 owner 抢 due
- lock 不持久化任务状态，仅做互斥

## 5. 运行时结构

### 5.1 `DueTaskReservation`

```python
@dataclass(frozen=True)
class DueTaskReservation:
    task: ScheduledTask
    scheduled_for: str
    reserved_at: str
```

用途：

- Trigger Engine 从 Store 拿到 due task 后，交给 Execution Bridge
- 表示这次执行窗口已经被当前进程占用

### 5.2 `TaskExecutionContext`

```python
@dataclass(frozen=True)
class TaskExecutionContext:
    task_id: str
    scheduled_for: str
    trigger_type: TriggerType
    origin: TaskOrigin
    is_scheduled_run: bool
```

用途：

- 显式传入 Execution Bridge 和 runtime
- 替代 Hermes 的环境变量注入

边界：

- 只传确定性上下文
- 不携带跨模块可变全局状态

### 5.3 `RunRequest`

这里不是新建 `core` 协议，只是调度模块内部的装配输入：

```python
@dataclass(frozen=True)
class ScheduledRunRequest:
    user_input: str
    agent_name: str
    session_id: str
    run_id: str
    max_turns_override: int | None
    execution_context: TaskExecutionContext
```

用途：

- Execution Bridge 生成一次 `Runner.run()` 调用所需入参

边界：

- `Runner` 继续消费现有参数，不要求 core 立即引入新公共协议

## 6. 状态流转

### 6.1 任务状态

```text
scheduled -> running -> scheduled
scheduled -> running -> completed
scheduled -> paused
paused -> scheduled
scheduled -> disabled
running -> failed
failed -> scheduled
```

说明：

- recurring task 正常完成后通常回到 `scheduled`
- one-shot task 完成后通常进入 `completed`
- `failed` 是任务级最近状态，不等于任务结束

### 6.2 运行状态

```text
running -> completed
running -> silent              (final message 命中 [SILENT]，仅落审计、不投递)
running -> failed              (failure_reason ∈ {needs_approval, tool_error, runner_exception, delivery_error})
running -> inactivity_timeout  (无活动 N 秒被强制取消)
running -> abandoned           (进程崩溃或重启时旧 run 收尾)
running -> cancelled           (replace 策略下被新 run 取代)
```

说明：

- `silent` 是成功路径的子状态：agent 跑完了，但主动选择了不打扰
- `inactivity_timeout` 跟 `failed` 分开统计，便于运维区分"真失败"和"卡死"
- `abandoned` 用于进程崩溃或重启后的旧 run 收尾（启动时把所有 `running` 状态强制改为 `abandoned`）
- `cancelled` 用于 `replace` 策略下的旧 run
- v0.1 没有 `waiting_approval` 状态：未授权动作走 `failed(failure_reason=needs_approval)` 路径

## 7. 模块边界约束

### 7.1 Domain Model 边界

- 允许定义字段、枚举和不变量
- 不允许直接访问数据库
- 不允许引用 APScheduler 类型

### 7.2 Store 边界

- 允许序列化/反序列化领域结构
- 允许事务性更新状态
- 不允许直接调用 `Runner`
- 不允许解释审批策略

### 7.3 Trigger Engine 边界

- 允许注册、取消、重载 APScheduler jobs
- 允许从 Store 查询 due task
- 不允许自己生成业务状态真源
- 不允许写最终运行结果

### 7.4 Execution Bridge 边界

- 允许创建 fresh `session_id/run_id`
- 允许调用 `Runner.run(...)`
- 允许回写 `ScheduledRun` 摘要
- 不允许直接决定任务是否有权创建

### 7.5 Safety and Policy 边界

- 允许裁决 create/update/remove 的 `schedule` 权限
- 允许裁剪 cron run 的 enabled tools
- 允许解释 `concurrency_policy / misfire_policy`
- 不允许接管 trigger 计算

### 7.6 Management Surfaces 边界

- 允许把外部请求映射成领域命令
- 允许展示 Store 查询结果
- 不允许定义新状态真源

## 8. 与 Hermes 的结构对照

Hermes 的对应物大致是：

- `jobs.json` ~= `scheduled_tasks.json`（保留文件方案，未上 SQLite）
- `output/<job_id>/<timestamp>.md` ~= `runs/<task_id>.jsonl`（结构化摘要）+ session store（完整对话）
- `tick()` ~= Trigger Engine + Execution Bridge
- `.tick.lock` ~= `.scheduler.lock`

本方案的关键调整：

- 把单文件 `jobs.json` 拆成 `tasks.json` + per-task `runs/<task>.jsonl`，避免单文件越写越大
- 把 env 注入迁到 `TaskExecutionContext`（避免污染全局环境）
- 把手写 60s tick 迁到 APScheduler `MemoryJobStore`（重启从文件重建）
- 沿用 `[SILENT]` / `ONESHOT_GRACE_SECONDS` / inactivity timeout 三条 Hermes 验证过的运行特性

这些调整让当前仓库的 web/runtime/safety 更容易接线，同时保留 Hermes 的可靠性语义。

## 9. 常量

```python
ONESHOT_GRACE_SECONDS = 120        # 一次性任务边界宽限（参考 Hermes）
DEFAULT_INACTIVITY_TIMEOUT = 600   # 默认 10 min 无活动则强制取消
GRACE_MIN_SECONDS = 120            # missed-run 快进 grace 下限
GRACE_MAX_SECONDS = 7200           # missed-run 快进 grace 上限（2 小时）
SILENT_MARKER = "[SILENT]"         # final message 前缀触发投递抑制
```

`grace_seconds_for_period(period_seconds)` 算法（参考 Hermes `_compute_grace_seconds`）：

```text
grace = clamp(period_seconds // 2, GRACE_MIN_SECONDS, GRACE_MAX_SECONDS)
```

效果：daily 任务 grace = 2h，hourly 任务 grace = 30min，10min 任务 grace = 5min。任务越频繁、对"延迟跑"越敏感，grace 越小，快进越激进。
