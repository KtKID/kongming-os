# Avatar 消息注册与消费通道 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/04 是文字事实源，本文件是只读视图，增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](#总览)
- [Avatar Message Registry](#avatar-message-registry)
- [消费与 ack 时序](#消费与-ack-时序)
- [状态流转](#状态流转)
- [数据模型](#数据模型)
- [AvatarAssistant 预留边界](#avatarassistant-预留边界)

图例：P0 核心/阻塞 · P1 主要/必须 · P2 辅助/可选

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Producers["Kongming 内部模块<br/>P1 · approval/thread/task/system"]:::p1
  Manager["AvatarManager<br/>P0 · 消息业务门户"]:::p0
  Repo["AvatarMessageRepository<br/>P0 · SQLite 消息真源"]:::p0
  Router["AvatarMessageRouter<br/>P0 · REST/WS 合同"]:::p0
  Auth["XSpace mobile token / Web cookie<br/>P1 · scope 鉴权"]:::p1
  XSpace["XSpace Avatar<br/>P0 · 拉取/订阅/ack/展示"]:::p0
  Assistant["AvatarAssistantManager<br/>P2 · chat disabled capability"]:::p2

  Producers --> Manager
  Manager --> Repo
  Router --> Manager
  Router --> Auth
  XSpace --> Router
  Manager -.-> Assistant
```

## Avatar Message Registry

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph AvatarMessage["Avatar Message Registry"]
    Manager["AvatarManager<br/>P0 · 唯一业务门户"]:::p0
    Repo["AvatarMessageRepository<br/>P0 · 持久化与查询"]:::p0
    Router["AvatarMessageRouter<br/>P0 · REST/WS 边界"]:::p0
    Producer["AvatarMessageProducer<br/>P1 · 事件适配器"]:::p1
    Assistant["AvatarAssistantManager<br/>P2 · 对话预留"]:::p2
    Notifier["NotificationBroadcaster<br/>P2 · 在线轻量通知"]:::p2
  end

  MobileToken["XSpace Mobile TokenService<br/>P1 · device token scope"]:::p1
  WebAuth["Web Auth Cookie<br/>P2 · 桌面调试"]:::p2
  Approval["Approval Inbox Payload<br/>P1 · 首个 producer 来源"]:::p1
  XSpace["XSpace Avatar<br/>P0 · 消费端"]:::p0

  Approval --> Producer
  Producer --> Manager
  Router --> Manager
  Router --> MobileToken
  Router -.-> WebAuth
  Manager --> Repo
  Manager -.-> Assistant
  Manager -.-> Notifier
  XSpace --> Router
```

## 消费与 ack 时序

```mermaid
sequenceDiagram
  participant Approval as Approval/Event Source
  participant Producer as AvatarMessageProducer
  participant Manager as AvatarManager
  participant Repo as AvatarMessageRepository
  participant Router as AvatarMessageRouter
  participant XSpace as XSpace Avatar

  Approval->>Producer: pending approval payload
  Producer->>Manager: register(AvatarMessageInput)
  Manager->>Repo: upsert_by_dedupe(input)
  Repo-->>Manager: AvatarMessageSnapshot
  Manager-->>Router: notify(messageId, sequence, revision)
  XSpace->>Router: GET /api/avatar/v1/messages?cursor=NEXT_CURSOR
  Router->>Manager: list(query, scopes)
  Manager->>Repo: list_messages(query)
  Repo-->>Manager: items + nextCursor
  Manager-->>Router: AvatarMessageListResult
  Router-->>XSpace: items + nextCursor
  XSpace->>Router: POST /api/avatar/v1/messages/{id}/ack
  Router->>Manager: ack(messageId, consumed)
  Manager->>Repo: ack_idempotent(messageId)
  Repo-->>Manager: final snapshot
  Router-->>XSpace: final snapshot
```

## 状态流转

```mermaid
stateDiagram-v2
  [*] --> active: register
  active --> active: dedupe update / revision+1
  active --> acked: ack(status=acked)
  active --> consumed: ack(status=consumed)
  active --> expired: expiresAt reached
  acked --> consumed: ack(status=consumed)
  acked --> expired: expiresAt reached
  expired --> consumed: late ack
  consumed --> consumed: idempotent ack
  expired --> expired: idempotent expire
```

## 数据模型

```mermaid
erDiagram
  AVATAR_MESSAGE ||--o{ AVATAR_ACK : receives
  AVATAR_MESSAGE ||--o{ AVATAR_NOTIFICATION : emits
  AVATAR_MESSAGE ||--o| AVATAR_ACTION : suggests
  AVATAR_CAPABILITY ||--o{ AVATAR_MESSAGE : enables

  AVATAR_MESSAGE {
    string message_id
    int sequence
    int revision
    string source
    string level
    int priority
    string thread_id
    string run_id
    string request_id
    string dedupe_key
    string status
    datetime expires_at
    datetime created_at
    datetime updated_at
  }
  AVATAR_ACTION {
    string type
    string target
    string payload_json
  }
  AVATAR_ACK {
    string message_id
    string consumer_id
    string status
    datetime acked_at
    datetime consumed_at
  }
  AVATAR_NOTIFICATION {
    string frame_type
    string message_id
    int sequence
    int revision
  }
  AVATAR_CAPABILITY {
    string protocol_version
    bool message_registry
    bool ws_notifications
    bool avatar_chat
  }
```

## AvatarAssistant 预留边界

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph AvatarAssistant["AvatarAssistant Boundary"]
    Assistant["AvatarAssistantManager<br/>P2 · capabilities/chat facade"]:::p2
    Cap["AvatarCapabilities<br/>P1 · avatarChat=false"]:::p1
    Chat["AvatarChatRequest<br/>P2 · 后续 LLM 输入合同"]:::p2
  end

  Router["AvatarMessageRouter<br/>P0 · /api/avatar/v1/capabilities /chat"]:::p0
  Scope["avatar.chat scope<br/>P1 · 反向发送权限"]:::p1
  FutureLLM["Future Avatar LLM Channel<br/>P2 · 后续独立 spec"]:::p2

  Router --> Assistant
  Router --> Scope
  Assistant --> Cap
  Assistant -.-> Chat
  Assistant -.-> FutureLLM
```
