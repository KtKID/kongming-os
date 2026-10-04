# 核心流程

## 流程 1：首发发送与后续发送共用同一入口

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  UI["Composer 提交输入<br/>P0 · 文本 / 图片 / 思考等级"]:::p0
  CM["ChatManager.sendMessage<br/>P0 · 统一发送入口"]:::p0
  ST["threads store<br/>P1 · 判断是否 pending 新会话"]:::p1
  CT["createThread<br/>P1 · 首次发送时创建真实 thread"]:::p1
  PV["*ChatProvider.send<br/>P0 · 组装 provider 帧"]:::p0
  NM["NetworkManager.send<br/>P0 · 发送原始帧"]:::p0
  BE["provider route / service<br/>P1 · 后端执行"]:::p1

  UI --> CM
  CM --> ST
  ST --> CT
  ST --> PV
  CT --> PV
  PV --> NM
  NM --> BE
```

这个流程把“新建会话按钮进入 pending”和“首条消息发送时创建真实 thread”收口到 `ChatManager`。视图层不再自己判断创建时机，provider 层也不再感知前端 pending 状态。

## 流程 2：实时接收与历史回放走统一事件模型

```mermaid
sequenceDiagram
  participant BE as Provider Backend
  participant NM as NetworkManager
  participant PV as ChatProvider
  participant CM as ChatManager
  participant TL as ChatTimelineStore
  participant RA as ChatRenderAdapter
  participant VW as View

  BE->>NM: 原始 websocket 帧
  NM->>CM: RawFrameEnvelope
  CM->>PV: mapInboundFrame(envelope)
  PV-->>CM: ChatEvent[]
  CM->>TL: applyEvent(event)
  TL->>RA: snapshot()
  RA->>VW: ChatViewModel

  Note over PV,TL: loadHistory 也产出 ChatHistoryBatch<br/>最终进入同一个 ChatTimelineStore
```

这个流程固定了一个核心原则：历史和实时都变成 `ChatEvent` 或 `ChatHistoryBatch` 后再进入状态机。provider 负责翻译差异，`ChatTimelineStore` 负责语义聚合。

## 流程 3：下版切换 Streamdown 的替换边界

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  TL["ChatTimelineStore<br/>P0 · 通用聊天状态"]:::p0
  RA["ChatRenderAdapter<br/>P1 · 当前 UI 数据投影"]:::p1
  SD["StreamdownAdapter<br/>P2 · 下版渲染投影"]:::p2
  VIEW["频道视图<br/>P1 · 只接收 view model"]:::p1

  TL --> RA
  TL -.-> SD
  RA --> VIEW
  SD -.-> VIEW
```

当前版本的重点是把替换面做干净。`Streamdown` 接入时，核心改动集中在 adapter 与视图组件，发送、接收、历史合并和状态机保持稳定。
