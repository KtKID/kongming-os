能看到，而且 **kongming-agent 现在其实已经具备了做轨迹功能大约 70% 的基础**。最重要的结论是：**不要再造一套 Trace Recorder，更不要把轨迹逻辑塞进 Runner。应该直接基于现有 EventSink + `trace.jsonl` 做一个独立 Trajectory Projection。**

你现在已经有完整事件体系：

```text
Runner
  ↓
Event
  ├─ run.start / run.end
  ├─ turn.start / turn.end
  ├─ llm.request / llm.response
  ├─ llm.chunk.first
  ├─ llm.stream.end
  ├─ tool.call.start / end
  ├─ usage
  └─ error ...
       ↓
  EventSink fan-out
       ├─ WSEventSink
       └─ JsonlTraceSink
```

源码依据很明确：

- `src/core/contracts/event_sink.py:14-139` 已经定义了这些事件，以及 `run_id / turn / agent_id / task_id / conversation_id`
- `src/core/runner.py` 已经在唯一 Agent Loop 中完整 emit
- `src/infrastructure/tracing/trace_sink.py` 已经把事件 append-only 写 JSONL
- Web 创建每个 thread 时，甚至已经自动挂了：

```text
<session_root>/<thread_id>/trace.jsonl
```

见 `src/hosts/web/run.py:1202-1213`

所以你的轨迹不是：

```text
Agent
 ↓
再加 Trace 埋点
 ↓
Trajectory
```

而应该是：

```text
                     ┌→ Chat Projection
Runner → Event Log ──┤
                     └→ Trajectory Projection
```

这和 DSH 思路基本一致。

---

### 我建议第一版只做“历史可回放轨迹”

先别急着做实时动画。

增加：

```text
src/.../trajectory/
    trajectory_manager.py
    projector.py
    models.py
```

核心：

```python
events = read_trace(thread_id)

trajectory = projector.project(events)
```

投影成这种数据：

```text
TrajectoryRun
  run_id
  start_at
  end_at
  status

  Turn 1
    start_at
    end_at

    LLM
      request_at
      first_chunk_at
      response_at
      stream_end_at
      ttft_ms
      duration_ms
      usage

    Tool
      call_id
      name
      arguments
      start_at
      end_at
      duration_ms
      ok
      output
      error
```

然后 Web：

```text
GET /api/threads/{thread_id}/trajectory
```

前端单独建：

```text
web/src/modules/trajectory/
    TrajectoryManager.ts
    TrajectoryStore.ts
    TrajectoryPanel.tsx
    TrajectoryTimeline.tsx
```

**不要塞进现在的 `ChatTimelineStore`。**

你当前 `ChatTimelineStore`：

```text
messagesById
toolsById
turnsById
```

已经是很标准的 **Chat Projection**。

轨迹应该是另一个 Projection。

---

### 有一个我检查源码时发现的真实问题，建议先修

你的 Runner 发：

`src/core/runner.py:1843`

```python
Event(
    kind="tool.call.start",
    payload={
        "call_id": call.call_id,
        "tool_name": call.tool_name,
    },
)
```

但是 WebSocket 转换代码：

`src/hosts/web/websocket/event_sink.py:284-293`

却在读：

```python
arguments=_safe_dict(payload.get("arguments"))
```

也就是说：

```text
Runner 没发 arguments
        ↓
WSEventSink 却认为有 arguments
        ↓
generic_chat 前端收到的 arguments 实际基本是 {}
```

而你的前端 `ChatToolRecord` 明明已经支持：

```ts
arguments?: Record<string, unknown>
```

所以第一步应该直接变成：

```python
payload={
    "call_id": call.call_id,
    "tool_name": call.tool_name,
    "arguments": call.arguments,
}
```

这对轨迹尤其重要，因为以后 Inspector 要展示：

```text
read_file
input:
{
  "path": "src/core/runner.py"
}
```

---

### 还有一个关键区别：轨迹历史不能用 `thread.history`

你现在 Web 重连时：

```text
thread.history
    ↓
NormalizedMessage[]
```

它适合恢复聊天。

但不适合恢复轨迹，因为很多东西已经丢了：

```text
LLM request 时间
TTFT
LLM duration
run.start
run.end
精确 tool start/end 时间
usage 时序
error 时序
```

这些都在：

```text
trace.jsonl
```

所以：

```text
Chat 恢复
→ Session history

Trajectory 恢复
→ Event trace
```

必须分开。

---

### 你的 Event 甚至已经为多 Agent 轨迹做好准备了

这个非常适合 kongming-agent。

Event 已经带：

```python
agent_id
task_id
conversation_id
```

所以以后完全可以从：

```text
Turn 3
  LLM
  Tool
  Tool
```

自然升级成：

```text
Run

Main Agent
├─ Turn 1
│   ├─ LLM
│   └─ Tool
│
├─ Research Agent
│   ├─ LLM
│   ├─ Search
│   └─ Read
│
└─ Coding Agent
    ├─ LLM
    └─ apply_patch
```

甚至 Timeline 做成：

```text
time ───────────────────────────────>

main       █LLM██  █tool█       █LLM███

research          █LLM█ █search██ █read█

coding                         █LLM█ █patch█
```

**现有 Event schema 不需要为这个重新设计。**

---

### 唯一比较大的后端缺口

现在 `WSEventSink` 会实时发送：

```text
turn.start/end
tool.call.start/end
content.delta
reasoning.delta
usage
error
```

但是它明确丢掉：

```text
run.start
run.end
llm.request
llm.response
llm.chunk.first
llm.stream.end
```

`src/hosts/web/websocket/event_sink.py:401-404` 就直接 return 了。

因此第一版历史轨迹完全没问题，因为 `trace.jsonl` 都有。

第二版如果做 **DSH 那种实时 Timeline**，再补：

```text
trajectory.event
```

专门把这些观测事件推给 `TrajectoryManager`。

我不建议把：

```text
llm.request.start
llm.first_token
llm.response
...
```

全部做成几十种新的 Web UI Frame。

更干净的是一个：

```ts
interface TrajectoryEventFrame {
    frame_type: "trajectory.event"
    seq: number
    event: TrajectoryEvent
}
```

Chat 协议继续是 Chat 协议。

Trajectory 协议自己消费原始观测事实。

---

### 还有一个设计我建议你现在就定下来

轨迹要有稳定 `seq`。

你现在 `Event` 有：

```text
timestamp_ms
run_id
turn
```

但没有全局顺序号。

仅靠：

```text
timestamp_ms
```

不够，因为多个 Event 完全可能发生在同一毫秒。

历史 JSONL 暂时可以：

```text
文件行号 = seq
```

但实时轨迹最终最好变成：

```text
event.seq = monotonic sequence
```

这样：

```text
历史 replay
实时 append
WS reconnect
分页
断点续传
```

都会非常舒服。

这点非常像 DSH Session Event 的 `seq`。

---

## 我建议实际开发顺序

只做这四步：

```text
1. 修 tool.call.start arguments 丢失

2. TrajectoryProjector
   trace.jsonl
       ↓
   Run / Turn / LLM / Tool

3. GET /threads/{id}/trajectory

4. Web TrajectoryPanel
   左边 Ledger
   右边 Timeline / Inspector
```

先实现：

```text
一次对话跑完
↓
点“轨迹”
↓
能完整看到

Turn
LLM
TTFT
token
Tool
duration
input/output
error
```

**先不要动 Runner 架构，也不要实现复杂 realtime replay。**

这版做出来以后，再把 `TrajectoryProjector` 接到实时 Event 流上：

```text
历史 Event ─┐
            ├→ 同一个 TrajectoryProjector → TrajectoryStore
实时 Event ─┘
```

这时候就真正和 DeepSeek Harness 的思路接近了。

我目前只检查和分析了源码，**没有修改 kongming-agent**。下一步最值得做的是我直接帮你把 **Trajectory 数据模型 + Projector 接口 + 第一版目录结构**设计出来，然后再开始写代码。