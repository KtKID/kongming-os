# XSpace Avatar Channel Client Interface v0.1

> 交接对象：XSpace Desktop Avatar、XSpace Android Avatar  
> 用途：XSpace 侧实现 Avatar 对话 client  
> 边界：本文只描述 XSpace 需要调用的函数、入参出参、事件回调和错误码

## 接入结论

XSpace 侧实现 `KongmingAvatarChannelClient`。Avatar UI 调用这个 client 完成能力探测、消息提醒拉取、对话连接、发送消息、接收 LLM 回复、处理中断和审批。

Kongming 对 XSpace 暴露两类能力：

| 能力 | 用途 |
|---|---|
| Avatar registry | 拉取 approval / task / system 等提醒消息，并 ack 消费 |
| Avatar chat channel | Avatar 发送用户输入，实时接收 assistant 回复 |

## 最小调用顺序

1. `getCapabilities()`
2. `ensureAvatarThread(...)`
3. `connectAvatarThread(...)`
4. `sendAvatarMessage(...)`
5. 在 `onFrame(...)` 中处理 `content.delta` / `assistant.final` / `error`
6. 收到 registry 的 `open_approval` 消息时调用 `resolveAvatarApproval(...)`
7. Avatar 展示完提醒消息后调用 `ackMessage(...)`

## Client 门户接口

```typescript
/**
 * XSpace Avatar 对接 Kongming 的唯一 client 门户。
 *
 * Avatar UI、桌面 overlay、Android UI 都通过这个接口使用 Kongming 能力。
 */
export interface KongmingAvatarChannelClient {
  /**
   * 读取 Kongming Avatar 能力。
   *
   * 返回协议版本、registry 能力、chat 能力、endpoint 模板和 scope 要求。
   */
  getCapabilities(): Promise<AvatarCapabilities>;

  /**
   * 拉取 Avatar 提醒消息。
   *
   * 用于启动补齐、断线补齐、审批提醒列表和系统通知列表。
   */
  listMessages(input?: AvatarMessageListInput): Promise<AvatarMessageListResult>;

  /**
   * ack 或 consumed 单条提醒消息。
   *
   * XSpace 展示后可传 consumed；只确认收到可传 acked。
   */
  ackMessage(input: AvatarAckMessageInput): Promise<AvatarMessage>;

  /**
   * 批量 ack 或 consumed 提醒消息。
   */
  ackMessages(input: AvatarAckMessagesInput): Promise<AvatarAckBatchResult>;

  /**
   * 确保 Avatar 对话 thread 可用。
   *
   * 传入已有 threadId 时返回该 thread。
   * 传入 presetId/cwd/name 时创建新的 Avatar 对话 thread。
   */
  ensureAvatarThread(input: EnsureAvatarThreadInput): Promise<ThreadMetadataDTO>;

  /**
   * 打开 Avatar 实时对话连接。
   *
   * 连接成功后 Kongming 会先推 thread.history。
   * 后续 assistant 输出全部从 onFrame 回调进入 XSpace。
   */
  connectAvatarThread(input: AvatarConnectInput): AvatarChannelConnection;

  /**
   * 通过已连接的 Avatar channel 发送一轮用户输入。
   *
   * Promise resolve 只代表消息已经写入 socket。
   * LLM 回复通过 onFrame 的 content.delta / assistant.final 返回。
   */
  sendAvatarMessage(input: AvatarSendMessageInput): Promise<void>;

  /**
   * REST 方式发送一轮用户输入。
   *
   * 用于首发创建 thread，或 socket 暂不可用时提交消息。
   */
  sendAvatarMessageViaRest(input: AvatarRestChatInput): Promise<AvatarChatAccepted>;

  /**
   * 中断当前 Avatar 回复。
   */
  interruptAvatarRun(input: AvatarInterruptInput): Promise<void>;

  /**
   * 回复 Avatar registry 中 action.type=open_approval 的审批消息。
   */
  resolveAvatarApproval(input: AvatarApprovalResolveInput): Promise<void>;

  /**
   * 关闭连接并释放本地资源。
   */
  close(): void;
}
```

## 构造参数

```typescript
export interface KongmingAvatarChannelClientOptions {
  /** Kongming origin，例如 http://127.0.0.1:60000。 */
  serverUrl: string;
  /** Native 客户端使用 device token；WebView 可留空并使用 cookie。 */
  deviceToken?: string | null;
  /** XSpace 侧设备 ID，用于日志和 ack consumer 标识。 */
  deviceId?: string | null;
  /** 默认消息 consumer ID。 */
  consumerId?: string;
}
```

建议默认值：

```typescript
const client = createKongmingAvatarChannelClient({
  serverUrl: "http://127.0.0.1:60000",
  deviceToken: savedDeviceToken,
  deviceId: "xspace-desktop-main",
  consumerId: "xspace-avatar",
});
```

## 能力探测

```typescript
export interface AvatarCapabilities {
  protocolVersion: "1";
  messageRegistry: boolean;
  restList: boolean;
  restAck: boolean;
  wsNotifications: boolean;
  avatarChat: boolean;
  avatarRealtimeChat: boolean;
  chatTransports: {
    websocket: string;
    rest: string;
  };
  requiredScopes: {
    list: string[];
    ack: string[];
    chat: string[];
  };
}
```

调用：

```typescript
const capabilities = await client.getCapabilities();
```

XSpace 使用规则：

| 字段 | 行为 |
|---|---|
| `messageRegistry=true` | 启用提醒消息拉取 |
| `restAck=true` | 展示后可调用 ack |
| `avatarChat=true` | 启用 Avatar 输入框 |
| `avatarRealtimeChat=true` | 启用实时打字效果 |

## 提醒消息接口

### listMessages

```typescript
export interface AvatarMessageListInput {
  cursor?: string | null;
  limit?: number;
  since?: string | null;
  level?: Array<"info" | "success" | "warning" | "error">;
  source?: string[];
  threadId?: string | null;
  status?: Array<"active" | "acked" | "consumed" | "expired">;
}

export interface AvatarMessageListResult {
  items: AvatarMessage[];
  nextCursor: string | null;
  serverTime: string;
}
```

### ackMessage / ackMessages

```typescript
export interface AvatarAckMessageInput {
  messageId: string;
  status?: "acked" | "consumed";
  consumerId?: string;
  at?: string | null;
}

export interface AvatarAckMessagesInput {
  messageIds: string[];
  status?: "acked" | "consumed";
  consumerId?: string;
  at?: string | null;
}

export interface AvatarAckBatchResult {
  results: AvatarAckItemResult[];
}

export interface AvatarAckItemResult {
  messageId: string;
  ok: boolean;
  message?: AvatarMessage | null;
  error?: string | null;
}
```

### AvatarMessage

```typescript
export interface AvatarMessage {
  messageId: string;
  sequence: number;
  revision: number;
  status: "active" | "acked" | "consumed" | "expired";
  source: string;
  title: string;
  body?: string | null;
  level: "info" | "success" | "warning" | "error";
  priority: number;
  threadId?: string | null;
  runId?: string | null;
  requestId?: string | null;
  action?: AvatarMessageAction | null;
  dedupeKey?: string | null;
  expiresAt?: string | null;
  ackedAt?: string | null;
  consumedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export interface AvatarMessageAction {
  type: "open_thread" | "open_approval" | "open_url" | "none";
  label?: string | null;
  target?: string | null;
  payload?: Record<string, unknown>;
}
```

## 对话 thread 接口

```typescript
export interface EnsureAvatarThreadInput {
  /** 已有 thread。 */
  threadId?: string | null;
  /** 创建新 thread 时使用。 */
  presetId?: string | null;
  /** 创建新 thread 时使用。 */
  cwd?: string | null;
  /** 新 thread 名称，建议用 Avatar。 */
  name?: string | null;
}

export interface ThreadMetadataDTO {
  id: string;
  name: string;
  preset_id: string;
  backend_kind: "generic_chat" | "claude_code" | "codex";
  cwd: string;
  created_at: number;
  updated_at: number;
  message_count: number;
}
```

用法：

```typescript
const thread = await client.ensureAvatarThread({
  presetId: "local-default",
  cwd: "/Volumes/machub_app/proj/XSpace",
  name: "Avatar",
});
```

## 实时连接接口

```typescript
export interface AvatarConnectInput {
  threadId: string;
  onFrame(frame: AvatarServerFrame): void;
  onState?(state: AvatarChannelState): void;
  onError?(error: AvatarClientError): void;
}

export type AvatarChannelState =
  | "connecting"
  | "open"
  | "reconnecting"
  | "closed"
  | "failed";

export interface AvatarChannelConnection {
  threadId: string;
  state: AvatarChannelState;
  send(frame: AvatarClientFrame): void;
  close(): void;
}
```

用法：

```typescript
const connection = client.connectAvatarThread({
  threadId: thread.id,
  onState: (state) => avatarStore.setConnectionState(state),
  onFrame: (frame) => avatarStore.applyKongmingFrame(frame),
  onError: (error) => avatarStore.showError(error.message),
});
```

## 发送消息接口

```typescript
export interface AvatarSendMessageInput {
  threadId: string;
  text: string;
  requestId?: string;
  reasoningEffort?: "low" | "medium" | "high" | null;
  attachments?: UserInputAttachment[] | null;
  metadata?: Record<string, unknown> | null;
}
```

用法：

```typescript
await client.sendAvatarMessage({
  threadId: thread.id,
  text: "现在该做什么？",
  reasoningEffort: "medium",
  attachments: null,
});
```

底层 frame：

```typescript
export interface AvatarUserInputFrame {
  frame_type: "user.input";
  text: string;
  request_id: string;
  reasoning_effort?: "low" | "medium" | "high" | null;
  attachments?: UserInputAttachment[] | null;
}
```

## REST 发送接口

```typescript
export interface AvatarRestChatInput {
  threadId?: string | null;
  presetId?: string | null;
  cwd?: string | null;
  message: {
    text: string;
    reasoningEffort?: "low" | "medium" | "high" | null;
    attachments?: UserInputAttachment[] | null;
    metadata?: Record<string, unknown> | null;
  };
  client: {
    deviceId?: string | null;
    clientMessageId: string;
    capabilities?: Record<string, boolean>;
  };
}

export interface AvatarChatAccepted {
  accepted: true;
  threadId: string;
  runId: string;
  transport: "websocket" | "rest";
  websocketUrl: string;
  serverTime: string;
}
```

用法：

```typescript
const accepted = await client.sendAvatarMessageViaRest({
  threadId: null,
  presetId: "local-default",
  cwd: "/Volumes/machub_app/proj/XSpace",
  message: {
    text: "帮我看一下当前任务",
    reasoningEffort: "medium",
    attachments: null,
  },
  client: {
    deviceId: "xspace-desktop-main",
    clientMessageId: crypto.randomUUID(),
    capabilities: {
      realtime: true,
      approvalUi: true,
      markdown: true,
    },
  },
});
```

## 中断与审批

```typescript
export interface AvatarInterruptInput {
  threadId: string;
  runId?: string | null;
}

export interface AvatarApprovalResolveInput {
  threadId: string;
  callId: string;
  action: "accept_once" | "accept_for_session" | "reject";
}
```

用法：

```typescript
await client.interruptAvatarRun({ threadId: thread.id });

await client.resolveAvatarApproval({
  threadId: thread.id,
  callId: "call_abc",
  action: "accept_once",
});
```

## 附件 DTO

```typescript
export interface UserInputAttachment {
  asset_id: string;
  kind: "image" | "video" | "file";
  mime_type: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  duration_ms?: number | null;
  preview_url: string;
  status: "ready" | "processing" | "failed";
}
```

## XSpace 需要处理的服务端事件

```typescript
export type AvatarServerFrame =
  | ThreadHistoryFrame
  | TurnStartFrame
  | ContentDeltaFrame
  | ReasoningDeltaFrame
  | AssistantFinalFrame
  | TurnEndFrame
  | ApprovalDecisionFrame
  | ToolCallStartFrame
  | ToolCallEndFrame
  | RunInterruptedFrame
  | ErrorFrame
  | PongFrame;
```

第一阶段最低处理：

| Frame | XSpace 行为 |
|---|---|
| `thread.history` | 恢复历史气泡 |
| `turn.start` | Avatar 进入回复中 |
| `content.delta` | 追加 assistant 气泡文本 |
| `assistant.final` | 固化 assistant 气泡 |
| `turn.end` | 当前回复完成 |
| `error` | 展示失败状态 |
| `approval.decision` | 关闭审批 UI |
| `run.interrupted` | 标记已中断 |

核心事件字段：

```typescript
export interface ThreadHistoryFrame {
  frame_type: "thread.history";
  timestamp_ms: number;
  messages: NormalizedMessage[];
}

export interface TurnStartFrame {
  frame_type: "turn.start";
  timestamp_ms: number;
  turn: number;
  run_id: string;
}

export interface ContentDeltaFrame {
  frame_type: "content.delta";
  timestamp_ms: number;
  delta: string;
  turn: number;
  seq: number;
  run_id: string;
}

export interface AssistantFinalFrame {
  frame_type: "assistant.final";
  timestamp_ms: number;
  content: string;
  turn: number;
  run_id: string;
}

export interface TurnEndFrame {
  frame_type: "turn.end";
  timestamp_ms: number;
  turn: number;
  run_id: string;
}

export interface ErrorFrame {
  frame_type: "error";
  timestamp_ms: number;
  error_code: "network" | "llm_error" | "tool_error" | "approval_timeout" | "internal";
  message: string;
  turn?: number | null;
}

export interface ApprovalDecisionFrame {
  frame_type: "approval.decision";
  timestamp_ms: number;
  call_id: string;
  outcome: "approved" | "rejected" | "cancelled";
  turn: number;
}
```

## 历史消息 DTO

```typescript
export type NormalizedMessage =
  | NormalizedTextMessage
  | NormalizedToolUseMessage
  | NormalizedToolResultMessage;

export interface NormalizedTextMessage {
  id: string;
  provider: "generic_chat" | "claude_code" | "codex";
  frame_type: "text";
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export interface NormalizedToolUseMessage {
  id: string;
  provider: "generic_chat" | "claude_code" | "codex";
  frame_type: "tool_use";
  role: "assistant";
  toolId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: number;
}

export interface NormalizedToolResultMessage {
  id: string;
  provider: "generic_chat" | "claude_code" | "codex";
  frame_type: "tool_result";
  role: "tool";
  toolId: string;
  toolName: string;
  content: string;
  isError: boolean;
  timestamp: number;
}
```

## 错误码

```typescript
export interface AvatarClientError {
  code:
    | "avatar_forbidden"
    | "avatar_invalid_request"
    | "avatar_thread_not_found"
    | "avatar_invalid_thread"
    | "avatar_preset_required"
    | "avatar_runtime_refresh_failed"
    | "avatar_run_failed"
    | "avatar_invalid_frame"
    | "avatar_network_error";
  message: string;
  details?: Record<string, unknown>;
}
```

| Code | XSpace 行为 |
|---|---|
| `avatar_forbidden` | 重新登录或重新配对 |
| `avatar_invalid_request` | 记录错误并提示版本不匹配 |
| `avatar_thread_not_found` | 重新创建 Avatar thread |
| `avatar_invalid_thread` | 重新创建 Avatar thread |
| `avatar_preset_required` | 让用户选择模型 preset |
| `avatar_runtime_refresh_failed` | 提示稍后重试 |
| `avatar_run_failed` | 当前气泡显示失败并保留重试 |
| `avatar_invalid_frame` | 记录协议错误 |
| `avatar_network_error` | 进入重连状态 |

## REST / WS 路径

| 函数 | Kongming 路径 |
|---|---|
| `getCapabilities` | `GET /api/avatar/v1/capabilities` |
| `listMessages` | `GET /api/avatar/v1/messages` |
| `ackMessage` | `POST /api/avatar/v1/messages/{messageId}/ack` |
| `ackMessages` | `POST /api/avatar/v1/messages/ack` |
| `ensureAvatarThread` | `POST /api/threads` 或已有 thread 校验接口 |
| `connectAvatarThread` | `WS /ws/avatar/v1/threads/{threadId}` |
| `sendAvatarMessageViaRest` | `POST /api/avatar/v1/chat` |
| `resolveAvatarApproval` | `POST /api/avatar/v1/approvals/{callId}/resolve` |

## 交付验收

XSpace 侧完成以下行为即满足首版接入：

- 能调用 `getCapabilities()` 并根据 `avatarChat` 控制 Avatar 输入能力。
- 能调用 `ensureAvatarThread()` 拿到 `threadId`。
- 能打开 `connectAvatarThread()` 并处理 `thread.history`。
- 能调用 `sendAvatarMessage()` 发送 `user.input`。
- 能通过 `content.delta` 和 `assistant.final` 渲染 assistant 回复。
- 能处理 `error`、`run.interrupted`、`approval.decision`。
- 能从 registry 的 `open_approval` 消息打开审批 UI，并调用 approval resolve REST API。
- 能通过 `listMessages()` 和 `ackMessage()` 消费提醒类消息。
