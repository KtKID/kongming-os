# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| Normalizer 扩展 | 将 SSE 控制帧转为 `stream_status` + 给 `stream_delta` 加 `deltaType` | 无 | 可进入 x-req | 改动 ~30 行 |
| WS 协议扩展 | `MessageKind` + `NormalizedMessage` TypedDict 新增字段 | 无 | 可进入 x-req | 改动 ~10 行 |
| 前端状态渲染 | 消费 `stream_status` 帧，渲染状态指示器 | WS 协议扩展 | 可进入 x-req | 新增组件 + hook 修改 |

## 模块详情

### 模块 1：Normalizer 扩展

**职责**：将之前被丢弃的 `message_start` / `content_block_start` SSE 事件转化为 `stream_status` 消息；给已有的 `stream_delta` 增加 `deltaType` 字段。

**包含范围**：
- `src/web/integrations/claude_code/normalizer.py` 的 `_handle_stream()` 方法扩展
- 对应单元测试 `tests/unit/web/integrations/claude_code/test_normalizer.py`

**不包含范围**：
- 不改变 `AssistantMessage` / `ResultMessage` 等非 StreamEvent 的处理逻辑
- 不处理 `message_delta`（仅含 stop_reason，前端不需要）

**依赖**：无（只依赖 `claude_agent_sdk.types.StreamEvent` 已有类型）

**复用/新建**：复用已有 `_handle_stream()` 方法，扩展其分支逻辑

**数据结构/接口**：

```python
# _handle_stream 新增产出示例

# message_start → stream_status
{"kind": "stream_status", "phase": "responding", "model": "claude-sonnet-4-5"}

# content_block_start(thinking) → stream_status
{"kind": "stream_status", "phase": "thinking", "blockIndex": 0}

# content_block_start(text) → stream_status
{"kind": "stream_status", "phase": "responding", "blockIndex": 1}

# content_block_start(tool_use) → stream_status
{"kind": "stream_status", "phase": "tool_calling", "blockIndex": 2, "toolName": "read_file"}

# 已有 stream_delta 扩展 deltaType
{"kind": "stream_delta", "content": "你好", "deltaType": "text"}
{"kind": "stream_delta", "content": "让我想想...", "deltaType": "thinking"}
```

**风险等级**：低
**风险说明**：无——事件结构已知，只是之前主动丢弃

**task 建议**：
- 建议 task 名：`stream-progress`（合并三模块为一个 task）
- 对应 DoD：DoD#1 ~ DoD#7
- 是否进入 x-req：是
- 原因：改动范围小且集中，无需单独拆

---

### 模块 2：WS 协议扩展

**职责**：在 `llm_protocol.py` 中注册新的 `stream_status` kind，扩展 `NormalizedMessage` TypedDict。

**包含范围**：
- `src/web/app_support/llm_protocol.py` — `MessageKind` Literal 新增 `"stream_status"`
- `NormalizedMessage` TypedDict 新增可选字段

**不包含范围**：
- 不改变现有入站命令格式
- 不改变其他 kind 的字段定义

**依赖**：无

**复用/新建**：扩展已有文件

**数据结构/接口**：

```python
# MessageKind 新增
MessageKind = Literal[
    ...,
    "stream_status",   # 新增
]

# NormalizedMessage 新增字段
class NormalizedMessage(TypedDict, total=False):
    ...
    # stream_status 专用
    phase: NotRequired[Literal["responding", "thinking", "tool_calling"]]
    blockIndex: NotRequired[int]
    toolName: NotRequired[str]  # 已有字段，stream_status 复用
    model: NotRequired[str]

    # stream_delta 扩展
    deltaType: NotRequired[Literal["text", "thinking", "input_json"]]
```

**前端对应 TS 类型**：

```typescript
// 新增帧类型
interface StreamStatusFrame {
  kind: "stream_status"
  phase: "responding" | "thinking" | "tool_calling"
  blockIndex?: number
  toolName?: string
  model?: string
  // ...base fields
}

// stream_delta 扩展
interface StreamDeltaFrame {
  kind: "stream_delta"
  content: string
  deltaType?: "text" | "thinking" | "input_json"  // 新增可选
  // ...base fields
}
```

**风险等级**：低
**风险说明**：新增 Literal 值 + NotRequired 字段，完全向后兼容

**task 建议**：合并到 `stream-progress` task

---

### 模块 3：前端状态渲染

**职责**：消费 `stream_status` 帧，在聊天界面显示当前 agent 阶段状态。

**包含范围**：
- `web/src/` 下 WS 帧处理（已有 `useStreamingRender` 或对应 hook）
- 新增状态指示器 UI 组件
- Zustand store 扩展（新增 `currentPhase` 状态）

**不包含范围**：
- 不改变已有 `stream_delta` 的 buffer + RAF 批量逻辑
- 不做动画 / spinner 动词 / 卡死检测
- 不做 thinking 内容的展示（只显示"思考中"状态文字，思考内容由 `stream_delta(deltaType=thinking)` 处理）

**依赖**：WS 协议扩展（需要知道 `stream_status` 帧结构）

**复用/新建**：
- 复用已有 WS hook（`useStreamingRender` / `useWS`）
- 新建状态指示器组件

**数据结构/接口**：

```typescript
// Zustand store 扩展
interface ChatState {
  // 已有
  streaming: boolean
  // 新增
  streamPhase: "idle" | "responding" | "thinking" | "tool_calling"
  streamToolName?: string
}

// 状态指示器组件 props
interface StreamStatusProps {
  phase: ChatState["streamPhase"]
  toolName?: string
}
```

**UI 渲染规则**：

| phase | 显示文案 | 备注 |
|-------|---------|------|
| `idle` | 无（隐藏） | 默认态 |
| `responding` | "生成中..." | `message_start` 到达即显示 |
| `thinking` | "思考中..." | 仅 extended thinking 开启时出现 |
| `tool_calling` | "调用工具: {toolName}..." | 显示具体工具名 |

**状态切换时机**：

| 事件 | 动作 |
|------|------|
| 收到 `stream_status(phase=X)` | `streamPhase = X` |
| 收到第一个 `stream_delta` | 保持当前 phase（不切换） |
| 收到 `turn.end` / `complete` | `streamPhase = "idle"` |

**风险等级**：低
**风险说明**：前端逻辑简单——按帧类型更新状态即可

**task 建议**：合并到 `stream-progress` task
