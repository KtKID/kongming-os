# 数据模型与状态

## 后端真源

pending queue 真源位于 `ThreadCell`，由 `ThreadManager` 在 `pending_input_lock` 下读写。前端只持有渲染用 snapshot，刷新、重连、多 tab 都以服务端帧为准。

## 核心实体

```python
@dataclass
class PendingInput:
    id: str                         # 队列项稳定 ID
    thread_id: str                  # 所属 thread ID
    source: str                     # user_input / choice_submit / avatar
    priority: str                   # choice_response / user_message
    content: str                    # 最终进入 run 的 user input 文本
    preview: str                    # UI 展示摘要
    status: str                     # queued / starting
    created_at_ms: int              # 服务端创建时间
    updated_at_ms: int              # 服务端最近更新时间
    sequence: int                   # 同优先级 FIFO 序号
    metadata: dict[str, object]     # request_id、avatar_id、client_id 等来源元数据
```

```python
@dataclass
class PendingInputSubmitResult:
    accepted: bool                  # 服务端是否接受提交
    started: bool                   # 是否立即启动 run
    pending_input: PendingInput | None # 入队或启动的输入
    snapshot: PendingInputSnapshot  # 提交后的服务端队列快照
    error_reason: str | None        # pending_input_queue_full 等机器可读错误
```

```python
@dataclass
class PendingInputSnapshot:
    thread_id: str                  # 所属 thread ID
    items: list[PendingInput]       # 当前队列，已按优先级和 FIFO 排序
    max_items: int                  # 队列容量，固定 20
    active_run_id: str | None       # 当前 run ID
    version: int                    # snapshot 版本号，用于前端丢弃旧帧
```

## ThreadCell 状态扩展

```python
class ThreadCell:
    current_run_task: asyncio.Task | None       # 当前 active run
    pending_inputs: list[PendingInput]          # 后端队列真源
    pending_input_lock: asyncio.Lock            # 队列和 run start gate 锁
    pending_input_sequence: int                 # 单 cell 内 FIFO 序号
    runtime_preset_id: str | None               # 已有模型 preset 状态
    preset_refresh_lock: asyncio.Lock           # 已有 runtime refresh 锁
```

## 排序与容量规则

| 规则 | 说明 |
|------|------|
| 容量 | `pending_inputs` 最多 20 条，当前 active run 不占队列容量 |
| 满队列 | 第 21 条返回 `pending_input_queue_full` |
| 优先级 | `choice_response` 排在 `user_message` 前 |
| FIFO | 同一 priority 内按 `sequence` 升序 |
| 编辑 | 只允许编辑 `status=queued` 的队列项 |
| 删除 | 只允许删除 `status=queued` 的队列项 |
| 重排 | 只在同 priority 内移动，保持 choice 优先级边界 |

## Drain Policy

| completion_reason | drain | 说明 |
|-------------------|-------|------|
| `normal` | true | 当前 run 正常完成后立即取下一条 |
| `user_interrupt` | true | Stop 只中断当前 run，后续排队输入继续 |
| `runtime_refresh_failed` | false | runtime 状态不可靠，跳过 drain |
| `evicted` | false | cell 已被回收，跳过 drain |
| `shutdown` | false | server 正在关闭，跳过 drain |
| `deleted` | false | thread 已删除，跳过 drain |

## WebSocket 帧

```typescript
interface PendingInputSnapshotFrame {
  frame_type: "pending-input.snapshot"; // 全量 snapshot
  thread_id: string;
  items: PendingInputDTO[];
  max_items: number;
  active_run_id?: string | null;
  version: number;
}

interface PendingInputChangedFrame {
  frame_type: "pending-input.changed";  // 增删改重排或 drain 后 snapshot
  thread_id: string;
  items: PendingInputDTO[];
  reason: "added" | "updated" | "removed" | "reordered" | "drained" | "cleared";
  version: number;
}

interface PendingInputStartedFrame {
  frame_type: "pending-input.started";  // 某队列项已成为下一轮 run
  thread_id: string;
  pending_input_id: string;
  run_id: string;
  version: number;
}
```

协议关系见 `./diagrams.md#protocol`。

## 前端状态

```typescript
interface PendingInputQueueState {
  threadId: string;                    // 当前 thread
  items: PendingInputDTO[];            // 后端 snapshot
  maxItems: number;                    // 20
  activeRunId?: string | null;          // 当前 run
  version: number;                     // 最近 snapshot 版本
  lastError?: string | null;            // pending_input_queue_full 等错误
  editingId?: string | null;            // 正在编辑的队列项
}
```

前端状态只用于渲染和乐观禁用按钮。后端 changed / snapshot 到达后覆盖本地状态。

## 状态流转

```text
queued -> starting -> running as current_run_task -> completed
queued -> updated -> queued
queued -> removed
running -> normal -> drain_next
running -> user_interrupt -> drain_next
running -> runtime_refresh_failed | evicted | shutdown | deleted -> skip_drain
```

状态图和数据关系图见 `./diagrams.md#数据关系状态流转`。
