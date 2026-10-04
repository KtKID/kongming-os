# 核心流程

5 条主链路。所有跨模块交互都经过 `UsageTokenManager`。

## 流程 1：写盘（record_run_usage）

一轮 LLM 调用结束后写入 ThreadMetadata.cumulative_usage。

```mermaid
sequenceDiagram
    participant LP as LLMProvider<br/>(Anthropic/OpenAI)
    participant R as core.Runner
    participant S as EventSink<br/>(UsagePersist)
    participant M as UsageTokenManager
    participant Ch as _channel_xxx
    participant P as _persistence
    participant TM as thread_metadata.py

    LP->>R: LLMResponse.usage = {input/output/cache_*}<br/>+ provider_kind
    R->>R: emit Event(kind="usage",<br/>payload={channel, raw_payload})
    R->>S: dispatch event
    S->>M: record_run_usage(thread_id,<br/>channel="anthropic", raw_payload, turn, run_id)

    M->>Ch: parse_raw_to_usage(raw_payload)
    Ch-->>M: _AnthropicTokenUsage（私有）

    M->>TM: read_thread_metadata(thread_id)
    TM-->>M: ThreadMetadata（含 cumulative_usage dict 或 None）

    M->>P: from_persisted_dict(meta.cumulative_usage)
    P-->>M: prev TokenUsage（私有）

    M->>Ch: merge_cumulative(prev, delta)
    Ch-->>M: new TokenUsage（累加后）

    M->>P: to_persisted_dict(new_usage)
    P-->>M: dict

    M->>TM: write_thread_metadata(meta.model_copy(update={cumulative_usage: dict}))
    M->>M: 缓存 last_run_snapshot[thread_id] = Snapshot

    M-->>S: UsageTokenSnapshot
    S-->>R: (no-op)
```

**关键点**：
- LLMProvider 在 LLMResponse.usage **直接放 SDK 原生字段 + provider_kind**（不再 lossy 归一化）
- runner emit usage event payload 含 `channel` 标识（由 provider_kind 映射：`anthropic` → `anthropic`，`openai_compatible` → `openai`）
- EventSink（重命名后的 UsagePersistSink）唯一职责是调 `manager.record_run_usage`
- manager 内部：parse → 读 prev → merge → 落盘 → 缓存 snapshot

## 流程 2：读取（get_thread_summary）

REST `GET /api/threads` 返 ThreadMetadataDTO 时调。

```mermaid
sequenceDiagram
    participant FE as 前端
    participant R as routers/threads.py
    participant M as UsageTokenManager
    participant TM as thread_metadata.py
    participant P as _persistence
    participant Ch as _channel_xxx

    FE->>R: GET /api/threads
    R->>TM: list_thread_metadata()
    TM-->>R: [ThreadMetadata, ...]

    loop 每个 thread
        R->>M: get_thread_summary(thread_id)
        M->>M: 检查内存缓存（has snapshot?）
        opt cumulative_usage 非 None
            M->>P: from_persisted_dict(meta.cumulative_usage)
            P-->>M: TokenUsage（私有）
            M->>Ch: context_usage(last_snapshot.usage)
            Ch-->>M: int
        end
        M-->>R: ThreadUsageSummary
    end

    R-->>FE: list[ThreadMetadata.model_dump() | summary 字段]
```

**关键点**：
- router 不再做 token 字段映射；直接调 `manager.get_thread_summary`
- claude_code 通道**不再调 `parse_transcript_usage` 临时算**（数据已在 ThreadMetadata.cumulative_usage）
- generic_chat / claude_code / codex **统一路径**

## 流程 3：v7→v8 lazy upgrade

读盘时遇到 schema_version=7 自动升级。

```mermaid
flowchart TD
    A[read_thread_metadata] --> B{schema_version}
    B -->|1-6| C[现存 lazy upgrade 链<br/>v1→v2→...→v7]
    B -->|7| D[upgrade_v7_to_v8]
    B -->|8| E[直接返回]
    C --> D
    D --> F{backend_kind}
    F -->|claude_code| G[channel=anthropic<br/>4 字段映射]
    F -->|codex| H[channel=openai<br/>cache_read→cached_input<br/>cache_creation 丢弃]
    F -->|generic_chat| I{cache_creation > 0?}
    I -->|是| G
    I -->|否| H
    G --> J[dict 嵌入 cumulative_usage]
    H --> J
    J --> K[schema_version=8]
    K --> L[ThreadMetadata 校验通过<br/>extra=forbid 不接受旧字段]
```

**注意**：
- `_migration.upgrade_v7_to_v8` 是纯函数（输入 v7 dict 输出 v8 dict）
- 集成在 `thread_metadata.read_thread_metadata` 现存懒升级链末尾
- 幂等：v8 不再升级
- 旧字段必须 `pop`（不能 setdefault）——否则 `extra="forbid"` 会拒

## 流程 4：WS emit (to_ws_frame)

每轮结束 ws_event_sink 推 UsageFrame。

```mermaid
sequenceDiagram
    participant R as core.Runner
    participant S as ws_event_sink.WSEventSink
    participant M as UsageTokenManager
    participant WS as WebSocket

    R->>S: Event(kind="usage", payload={channel, raw_payload, turn, run_id})
    S->>S: _build_frame(event)
    Note over S: 旧实现：直接 new UsageFrame(prompt/completion/total)
    S->>M: to_ws_frame(thread_id, turn=event.turn, run_id=event.run_id)
    M->>M: 取 last_run_snapshot[thread_id]
    M-->>S: UsageFrame(kind="usage", snapshot=Snapshot, turn, run_id)
    S->>WS: send_json(frame.model_dump())
```

**关键点**：
- ws_event_sink **不再直接 import / new UsageFrame**；通过 manager 拿
- `record_run_usage` 必须**先于** `to_ws_frame` 调用（保证 last_run_snapshot 已缓存）
- 实际顺序：runner emit `usage` event → 同一个 EventSink 列表里 UsagePersistSink 先跑（写盘 + 缓存 snapshot），然后 WSEventSink 跑（emit UsageFrame）

## 流程 5：前端消费

```mermaid
sequenceDiagram
    participant FE_Store as web/src/stores/chat.ts
    participant FE_SL as StatusLine.tsx
    participant FE_API as web/src/api/threads.ts
    participant BE_R as routers/threads.py
    participant BE_WS as WebSocket

    Note over FE_Store: 初始化：fetchThreads()
    FE_API->>BE_R: GET /api/threads
    BE_R-->>FE_API: [{..., usage_summary: ThreadUsageSummary}]
    FE_API-->>FE_Store: ThreadMetadataDTO[]
    FE_Store->>FE_Store: hydrateUsageFromThreads(threads)

    Note over FE_Store: 实时：appendUsage（来自 WS）
    BE_WS-->>FE_Store: UsageFrame{snapshot}
    FE_Store->>FE_Store: usageByThread[tid] = snapshot

    Note over FE_SL: 渲染
    FE_SL->>FE_Store: useChatStore(s => s.usageByThread[tid])
    FE_Store-->>FE_SL: UsageTokenSnapshot | ThreadUsageSummary
    FE_SL->>FE_SL: switch(snapshot.channel) {<br/>  case "anthropic": renderClaude(snapshot)<br/>  case "openai":    renderCodex(snapshot)<br/>}
    FE_SL->>FE_SL: 派生百分比：snapshot.context_usage / summary.model_context_window
```

**关键点**：
- 前端不再有 `cumulativePrompt / cumulativeTotal` 累加逻辑
- `UsageSnapshot` 独立 TS shape 删除；直接持 codegen 产出的 `UsageTokenSnapshot` / `ThreadUsageSummary`
- StatusLine **按 channel 分支**显示，所有数字前缀中文
- `tokenBudget` per-message 路径完全删除；ClaudeCodeView / CodexView 也改消费 UsageFrame

## 调用顺序约束（task 实施时严守）

`record_run_usage` 必须在每轮真实结束**当下**调用（保证 ws_event_sink 拿到的 snapshot 是最新的）。三通道的接入点：

| 通道 | 接入点 | 调用 |
|---|---|---|
| `generic_chat` | `core.Runner` emit `usage` event → `UsagePersistSink` | `manager.record_run_usage(channel=<由 provider_kind 决定>, raw_payload=...)` |
| `claude_code` | `web/claude_code/ws_handler.py` 每轮 message.usage 解析后 | `manager.record_run_usage(channel="anthropic", raw_payload=...)` |
| `codex` | `web/codex/ws_handler.py`（或对应位置）每轮 usage 解析后 | `manager.record_run_usage(channel="openai", raw_payload=...)` |

3 个通道接入点的同步是 task#3 的核心改造。
