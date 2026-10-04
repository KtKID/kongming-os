# 数据与状态

## 一、Schema v3 数据结构

### ScheduleDelivery（新增）

```python
class DeliveryChannel(str, Enum):
    WEB = "web"
    CLI = "cli"


@dataclass(frozen=True)
class ScheduleDelivery:
    """
    cron 任务触发后 final_message 的投递配置。
    target 概念已取消（v0.3）；所有 delivery 结果统一进系统消息池。
    """
    channel: DeliveryChannel

    def to_dict(self) -> dict[str, str]:
        return {"channel": self.channel.value}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ScheduleDelivery":
        return cls(channel=DeliveryChannel(data["channel"]))
```

### ScheduledTask（v0.3 增量）

```python
@dataclass
class ScheduledTask:
    # ... v0.2 已有字段 ...
    delivery: ScheduleDelivery | None = None  # v0.3 新增；None = web（向后兼容）
```

### RunRecord（v0.3 字段填空 + 新增）

```python
@dataclass
class RunRecord:
    # v0.2 已有字段
    run_id: str
    task_id: str
    status: RunStatus
    scheduled_for: datetime
    started_at: datetime
    finished_at: datetime | None
    session_id: str
    result_status: ResultStatus | None
    final_message_excerpt: str | None
    error_message: str | None
    failure_reason: FailureReason | None
    delivery_error: str | None        # v0.2 留位 → v0.3 启用
    silent_suppressed: bool

    # v0.3 新增
    delivered_at: datetime | None      # 投递成功时间戳
    delivery_status: DeliveryStatus    # pending / delivered / failed / skipped
    seen_at: datetime | None           # 用户在 web 看过该 run 的时间（红点用）


class DeliveryStatus(str, Enum):
    PENDING = "pending"      # 创建时默认
    DELIVERED = "delivered"  # WebSink/CliSink 成功投递
    FAILED = "failed"        # 投递失败
    SKIPPED = "skipped"      # silent_marker 命中或无对应 sink
```

### ScheduledTaskStateV3（state 枚举增量）

```python
class ScheduledTaskState(str, Enum):
    # v0.2 已有
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

    # v0.3 新增
    PAUSED = "paused"        # 用户主动暂停（enabled=false 但保留任务）
    DELETED = "deleted"      # 软删除
```

## 二、`.kongming/cron/scheduled_tasks.json` v3 格式示例

```json
{
  "schema_version": 3,
  "updated_at": "2026-05-04T10:00:00+00:00",
  "tasks": [
    {
      "task_id": "task-abc123",
      "name": "每天 9 点早安",
      "enabled": true,
      "state": "pending",
      "origin": "tool",
      "trigger": {
        "trigger_type": "cron",
        "expr": "0 9 * * *",
        "timezone": "Asia/Shanghai"
      },
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
        "input_text": "提醒用户：早安！...",
        "metadata": {}
      },
      "delivery": {
        "channel": "web"
      },
      "next_run_at": "2026-05-05T01:00:00+00:00",
      "last_run_at": null,
      "created_by": "agent:thread-xxxx",
      "created_at": "2026-05-04T10:00:00+00:00",
      "updated_at": "2026-05-04T10:00:00+00:00"
    }
  ]
}
```

## 三、`.kongming/cron/runs/task-<id>.jsonl` v3 行示例

```json
{
  "run_id": "run-sched-task-abc123-9f8e7d6c",
  "task_id": "task-abc123",
  "status": "completed",
  "scheduled_for": "2026-05-05T01:00:00+00:00",
  "started_at": "2026-05-05T01:00:00.234+00:00",
  "finished_at": "2026-05-05T01:00:02.567+00:00",
  "session_id": "sched-task-abc123-9f8e7d6c-r1",
  "result_status": "completed",
  "final_message_excerpt": "早安！今天天气不错...",
  "error_message": null,
  "failure_reason": null,
  "delivery_error": null,
  "silent_suppressed": false,
  "_superseded": false,

  "delivered_at": "2026-05-05T01:00:02.601+00:00",
  "delivery_status": "delivered",
  "seen_at": "2026-05-05T09:15:30+00:00"
}
```

## 四、状态流转

### Task state 流转

```
[创建] → pending
   ↓ ticker tick 触发
   pending → running
   ↓ run 完成
   running → pending (recurring)
   running → completed (oneshot)
   running → failed (异常)
   ↓ 用户操作
   pending → paused (用户暂停)
   paused → pending (用户恢复)
   any → deleted (用户删除，软删)
```

### Run delivery_status 流转

```
[run 创建] → pending
   ↓ run completed + DeliveryDispatcher.deliver
   ├─ sink 不存在 / silent_marker 命中 → skipped
   ├─ sink.deliver 成功 → delivered
   └─ sink.deliver 抛异常 → failed (delivery_error 填错误信息)
```

注意：`delivery_status` 与 `status` (run status) 解耦；run completed 但 delivery 可能 failed，反之亦然。

### 红点 (unseen_count) 计算

```python
def count_unseen_runs(self) -> int:
    return sum(
        1 for r in all_runs
        if r.delivery_status == DeliveryStatus.DELIVERED
        and r.seen_at is None
    )
```

`seen_at` 只通过 `mark_run_seen / mark_all_runs_seen_until` 接口写入，store 内部不会自动写。

## 五、迁移路径（v2 → v3）

### 升级步骤

1. ScheduleStore 启动时检测 `schema_version`
2. 如果 == 2：
   - 备份：`scheduled_tasks.json` → `scheduled_tasks.json.v2.bak.<unix_ts>`
   - 备份：`runs/*.jsonl` → `runs.v2.bak.<unix_ts>/` 整体复制
   - 转换 task：每个 task 加 `delivery: {channel: "web"}`（默认）
   - 转换 run：每条 run record 加：
     - `delivered_at: null`
     - `delivery_status: "skipped"`（旧 run 没投递过，标记 skipped 不进未读计数）
     - `seen_at: null`
   - 写 `schema_version: 3`
3. 升级失败 → 抛 SchemaMigrationError，不启动 ticker，让用户手工恢复

### 兼容性

- v0.3 启动时若读到 v3 schema → 直接用
- v0.3 启动时若读到 v2 schema → 自动迁移
- v0.3 启动时若读到 v1 schema → 先走 v0.2 已有的 v1→v2 逻辑，再走 v2→v3
- v0.2 启动时若读到 v3 schema → 当前 v0.2 代码会因为多余字段 raise（forbid extra）→ 用户须知"v0.3 不能降级回 v0.2"

### 单测覆盖

- `test_migrate_v2_to_v3_adds_default_delivery`
- `test_migrate_v2_to_v3_runs_marked_skipped`
- `test_migrate_v1_to_v3_chained`
- `test_v3_round_trip_persistence`
- `test_unknown_schema_raises_error`

## 六、跨进程 / 并发约束

| 约束 | 说明 |
|---|---|
| store 文件锁 | 现有 `.kongming/cron/.lock` mkdir 锁 v0.3 复用 |
| run jsonl 顺序写 | 同 task 按 lock 串行 append；并发不同 task 各自 jsonl 隔离 |
| WS broadcast 异步 | 不阻塞 deliver；broadcast 失败不影响 RunRecord 落盘 |
| seen_at 写入 | 由 web 用户操作触发，不在 ticker / bridge 路径 |
| schema migration | 启动时一次性，ticker 起来之前完成 |

## 七、disk 占用估计

| 项 | 单条大小 | v0.3 增量 |
|---|---|---|
| ScheduledTask | ~1.5 KB | +0.05 KB（delivery 字段） |
| RunRecord | ~0.6 KB | +0.15 KB（3 个新字段 + delivered_at 时间戳） |
| Fresh session messages.jsonl | ~5-50 KB / run（视任务复杂度） | **新增**（M2 修复后） |

按 100 个 task / 每个 task 10 次/天计 → 1000 runs/day × 50KB = **50MB/day**。

需要 cleanup 策略（v0.3 不实现，只在文档说明）：
- 建议运维：定期 `find .kongming/sessions/sched-* -mtime +30 -delete` 清理 30 天前的 fresh session
- 或 v0.4 加 retention 配置
