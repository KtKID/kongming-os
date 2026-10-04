# 数据模型与状态

## 核心实体

```python
@dataclass(frozen=True)
class ScheduledTask:
    task_id: str  # 定时任务唯一 id
    name: str  # 用户可见任务名
    trigger: ScheduleTrigger  # cron、once、interval 或 seconds 触发器
    target: TaskTarget  # 执行代理和输入文本
    policy: TaskExecutionPolicy  # 并发、misfire、silent、approval 配置
    delivery: ScheduleDelivery | None  # 投递配置；绑定 thread 时 target 为 thread:<thread_id>
    preset_id: str = ""  # 任务执行使用的 preset id
    thread_id: str = ""  # 专属 thread id；历史任务可为空

@dataclass(frozen=True)
class TaskExecutionContext:
    task_id: str  # 定时任务 id
    scheduled_for: str  # 本次预定触发时间，ISO8601 字符串
    trigger_type: TriggerType  # 触发器类型，来自任务 trigger
    origin: TaskOrigin  # 任务来源，区分 web、tool 等创建入口
    is_scheduled_run: bool  # 是否由 scheduler 触发执行
    thread_id: str = ""  # 绑定 thread id；用于 audit、事件和前端定位

@dataclass(frozen=True)
class ScheduledRunRequest:
    user_input: str  # 传给 Runner.run 的用户输入文本
    agent_name: str  # 执行使用的 agent 名称
    session_id: str  # Runner.run 使用的 session id；绑定 thread 时等于 thread_id
    run_id: str  # 本次 scheduled run id
    max_turns_override: int | None  # 单次执行最大 turn 覆盖值
    execution_context: TaskExecutionContext  # 本次执行的确定性上下文

class ThreadMetadata(BaseModel):
    id: str  # thread id
    backend_kind: Literal["generic_chat", "claude_code", "codex"]  # 运行或传输通道类型
    thread_kind: Literal["chat", "scheduled_task"] = "chat"  # 业务类型
    source_kind: str = ""  # 来源业务对象类型；定时任务为 scheduled_task
    source_id: str = ""  # 来源业务对象 id；定时任务为 task_id
    preset_id: str = ""  # generic_chat thread 使用的 preset id
```

```typescript
export interface SchedulerTaskVM {
  id: string; // 定时任务 id
  name: string; // 用户可见任务名
  threadId: string; // 专属 thread id
  presetId: string; // 任务默认 preset id
}

export interface ThreadMetadataDTO {
  id: string; // thread id
  backend_kind: BackendKind; // 运行或传输通道
  thread_kind: "chat" | "scheduled_task"; // 业务类型
  source_kind: string; // 来源业务类型
  source_id: string; // 来源业务 id
}
```

## 实体关系

一个 `ScheduledTask` 对应一个 `ThreadMetadata(thread_kind="scheduled_task")`。`ScheduledTask.thread_id` 是主关联字段，`ThreadMetadata.source_id` 反向记录 `task_id`。`ScheduleDelivery.target="thread:<thread_id>"` 继续作为投递目标格式，兼容已有 target sink 约定。实体关系图见 [diagrams.md](./diagrams.md#数据关系)。

## 状态流转

创建链路状态：

```text
request_received -> thread_created -> task_created -> created
                         |
                         v
                 thread_rollback_requested -> failed
```

执行链路状态：

```text
reserved -> session_bound -> runner_running -> run_completed -> cron_broadcasted -> recorded
                                |
                                v
                            run_failed -> recorded
```

状态图见 [diagrams.md](./diagrams.md#状态流转)。

## 持久化方案

| 数据 | 存储方式 | 位置 | 备注 |
|------|---------|------|------|
| `ScheduledTask.thread_id` | JSON 字段 | scheduler `tasks.json` | 写新字段，读旧 payload 时兼容回填 |
| `ThreadMetadata.thread_kind/source_*` | JSON metadata | thread metadata 文件 | schema v11 lazy migration 默认 `chat` 和空 source |
| `TaskExecutionContext.thread_id` | 运行时对象 + audit payload | scheduler audits/runs | 用于定位 run 与 thread |
| `ScheduledRunRequest.session_id` | 运行时内部入参 | `ExecutionBridge` 内部 | Runner.run 消费的 session id；绑定 thread 时取 `task.thread_id` |
| cron run 历史消息 | thread session history | 绑定 thread 的 session 后端 | Runner 写入 user/assistant messages |
| cron 广播事件 | WS/event sink | `/ws/cron` | 保留现有前端刷新能力 |

## 兼容回填规则

| 优先级 | 来源 | 规则 |
|--------|------|------|
| 1 | `payload["thread_id"]` | 非空字符串直接使用 |
| 2 | `target.metadata["thread_id"]` | 历史辅助字段存在时回填 |
| 3 | `delivery.target` | 匹配 `thread:<thread_id>` 时提取 |
| 4 | 空字符串 | 历史任务继续可运行，前端隐藏打开历史动作 |

## 共享数据结构

```python
ThreadKind = Literal["chat", "scheduled_task"]  # thread 业务类型
SourceKind = Literal["", "scheduled_task"]  # thread 来源业务类型
ThreadId = str  # thread id 字符串
TaskId = str  # scheduler task id 字符串
```

```typescript
export type ThreadKind = "chat" | "scheduled_task"; // thread 业务类型
export type CronThreadTarget = `thread:${string}`; // cron delivery target 格式
```
