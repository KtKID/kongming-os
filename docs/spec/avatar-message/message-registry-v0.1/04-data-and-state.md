# 数据模型与状态

## 核心实体

### AvatarMessage

```typescript
type AvatarMessage = {
  messageId: string; // 稳定消息 ID，dedupe 更新时保持不变
  sequence: number; // 单调游标，REST 分页和断线补齐使用
  revision: number; // 消息更新版本号，从 1 开始
  source: "approval" | "thread" | "task" | "system" | string; // 消息来源模块
  title: string; // XSpace 可展示标题
  body?: string; // XSpace 可展示正文
  level: "info" | "success" | "warning" | "error"; // 严重程度
  priority: number; // 0-100 优先级，数字越大越靠前
  threadId?: string; // 关联 thread ID
  runId?: string; // 关联 run ID
  requestId?: string; // 关联审批或外部请求 ID
  action?: AvatarMessageAction; // 建议动作，XSpace 自行决定呈现方式
  dedupeKey?: string; // 同一事实合并键
  status: "active" | "acked" | "consumed" | "expired"; // 消息生命周期状态
  expiresAt?: string; // ISO UTC 过期时间
  ackedAt?: string; // ISO UTC 首次 ack 时间
  consumedAt?: string; // ISO UTC 首次 consumed 时间
  createdAt: string; // ISO UTC 创建时间
  updatedAt: string; // ISO UTC 更新时间
  metadata?: Record<string, unknown>; // 扩展事实，限制为 JSON 可序列化
};
```

### AvatarMessageAction

```typescript
type AvatarMessageAction = {
  type: "open_thread" | "open_approval" | "open_url" | "none"; // 建议动作类型
  label?: string; // XSpace 可展示动作名称
  target?: string; // threadId/requestId/url 等目标标识
  payload?: Record<string, unknown>; // 动作附加参数，Kongming 不解释 UI 语义
};
```

### AvatarMessageCursor

```typescript
type AvatarMessageCursor = {
  sequence: number; // 上一页最后一条消息 sequence
  filtersHash: string; // 当前过滤条件摘要，防止 cursor 混用
  issuedAt: string; // cursor 签发时间，ISO UTC
};
```

### AvatarAck

```typescript
type AvatarAck = {
  messageId: string; // 要确认的消息 ID
  status: "acked" | "consumed"; // 目标状态，默认 consumed
  consumerId?: string; // 消费方标识，如 xspace-avatar
  ackedAt: string; // 服务端确认时间，ISO UTC
  consumedAt?: string; // 服务端 consumed 时间，ISO UTC
};
```

### AvatarCapabilities

```typescript
type AvatarCapabilities = {
  protocolVersion: "1"; // Avatar message registry 协议版本
  messageRegistry: true; // 消息注册和消费能力是否可用
  restList: true; // REST list 是否可用
  restAck: true; // REST ack 是否可用
  wsNotifications: boolean; // WS 通知是否启用
  avatarChat: false; // v1 反向对话默认关闭
  requiredScopes: {
    list: string[]; // list/stream 所需 scope，如 avatar.read/thread.read
    ack: string[]; // ack 所需 scope，如 avatar.ack
    chat: string[]; // chat 所需 scope，如 avatar.chat
  };
};
```

实体关系 ER 图见 [diagrams.md](./diagrams.md#数据模型)。

## 实体关系

`AvatarMessage` 是持久化主实体。`AvatarMessageAck` 记录每个 consumer 的确认事实，v1 可把单一 XSpace consumer 折叠到 `avatar_messages` 表的 `acked_at/consumed_at/status` 字段，后续多 consumer 再拆独立表。`AvatarNotification` 是 WS 的瞬时投递帧，来源于 message upsert 或 ack 事件，断线后由 REST list 通过 `sequence/since` 补齐。`AvatarCapabilities` 由 Router 从 AvatarManager 聚合，不参与消息生命周期。

## 状态流转

消息状态流转图见 [diagrams.md](./diagrams.md#状态流转)。

```text
active -> acked -> consumed
active -> consumed
active -> expired
acked -> expired
expired -> consumed
```

- `active`：消息可被默认 list 返回。
- `acked`：XSpace 已确认收到，可继续保留为可行动消息。
- `consumed`：XSpace 已完成展示或最终处理，默认 list 隐藏。
- `expired`：超过 `expiresAt` 或 TTL 清理边界，默认 list 隐藏。

`ack` 幂等规则：
- 同一 `messageId` 重复 `acked` 返回已有 `ackedAt`。
- 同一 `messageId` 重复 `consumed` 返回已有 `consumedAt`。
- `consumed` 可覆盖 `acked` 成为终态。
- `expired` 消息仍可被 `consumed`，用于客户端断线后补交确认。

## 持久化方案

| 数据 | 存储方式 | 位置 | 备注 |
|------|---------|------|------|
| Avatar 消息 | SQLite | `<kongming_home>/web/avatar_messages.db` | P0 真源，包含 payload/status/cursor 字段 |
| Dedupe 索引 | SQLite unique index | 同库 | `(source, dedupe_key)`，`dedupe_key` 为空时走普通插入 |
| Ack/consumed 状态 | SQLite 字段或 ack 表 | 同库 | v1 单 consumer 可内联，后续多 consumer 可拆表 |
| WS 订阅者 | 内存 | 进程内 | 只用于在线通知，断线通过 REST 补齐 |
| Avatar capabilities | 内存/配置 | app.state/avatar manager | v1 chat 固定 disabled |

建议 SQLite schema：

```sql
CREATE TABLE avatar_messages (
  message_id TEXT PRIMARY KEY,
  sequence INTEGER NOT NULL UNIQUE,
  revision INTEGER NOT NULL,
  source TEXT NOT NULL,
  level TEXT NOT NULL,
  priority INTEGER NOT NULL,
  thread_id TEXT,
  run_id TEXT,
  request_id TEXT,
  action_json TEXT,
  dedupe_key TEXT,
  status TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  expires_at TEXT,
  acked_at TEXT,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 共享数据结构

跨模块共享 DTO 由 `hosts.web.avatar.models` 定义，Router、Manager、Repository 和 Producer 只引用这些公开类型。`core.contracts` 只在未来需要宿主无关 Avatar event protocol 时扩展；v1 Web host 内部能力放在 `hosts.web.avatar`。

建议公开模型：
- `AvatarMessageInput`
- `AvatarMessageAction`
- `AvatarMessageSnapshot`
- `AvatarMessageListQuery`
- `AvatarMessageListResult`
- `AvatarAckRequest`
- `AvatarCapabilities`
- `AvatarChatRequest`
- `AvatarMessageErrorCode`
