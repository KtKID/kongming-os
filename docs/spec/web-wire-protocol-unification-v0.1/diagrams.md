# web-wire-protocol-unification-v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/04 是文字事实源，本文件是只读视图，增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](./diagrams.md#总览)
- [E2E 测试链路](./diagrams.md#e2e-测试链路)
- [修复主流程](./diagrams.md#修复主流程)
- [Web Protocol Models](./diagrams.md#web-protocol-models)
- [Protocol Frame Emission](./diagrams.md#protocol-frame-emission)
- [Frontend Wire Consumers](./diagrams.md#frontend-wire-consumers)
- [Protocol Drift Tests](./diagrams.md#protocol-drift-tests)
- [协议数据关系](./diagrams.md#协议数据关系)

图例：P0 蓝色表示核心/阻塞性，P1 橙色表示主要/必须完成，P2 灰色表示辅助/可选。

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Models["Web Protocol Models<br/>双侧 wire DTO 和 endpoint union<br/>类/函数：WebWireProtocolRegistry.validate_s2c()"]:::p0
  Emitters["Protocol Frame Emission<br/>后端发送端模型化输出<br/>类/函数：WebFrameEmitter.dump_thread_status()"]:::p1
  Consumers["Frontend Wire Consumers<br/>前端按 @/protocol 和 frame_type 消费<br/>类/函数：WebProtocolClientTypes.dispatchThreadStatus()"]:::p1
  Tests["Protocol Drift Tests<br/>漂移和导入边界回归网<br/>类/函数：ProtocolDriftTestSuite.run()"]:::p1
  Docs["Protocol Docs Alignment<br/>模块文档与旧引用对齐<br/>类/函数：WebProtocolDocsOwner.update()"]:::p2

  Models --> Emitters
  Models --> Consumers
  Models --> Tests
  Emitters --> Tests
  Consumers --> Tests
  Tests -.-> Docs
```

## E2E 测试链路

```mermaid
flowchart LR
  classDef setup fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef action fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef assert fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Fixture["准备协议 fixture<br/>endpoint + direction + frame_type"]:::setup
  Python["Python adapter 校验<br/>TypeAdapter dispatch/rejection"]:::action
  Route["真实 route/service 输出<br/>model_dump 后广播"]:::action
  Frontend["前端 hook/socket 分派<br/>frame.frame_type"]:::action
  Boundary["导入边界扫描<br/>局部 wire type 禁止复生"]:::assert
  Drift["Python/TS 漂移断言<br/>模型集合和判别值一致"]:::assert

  Fixture --> Python --> Route --> Frontend --> Boundary --> Drift
```

## 修复主流程

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  P0["Phase 0<br/>锁定 wire inventory<br/>frame_type + 目标帧列表"]:::p0
  P1["Phase 1<br/>Protocol Models<br/>Python/TS union + adapter"]:::p0
  P2["Phase 2<br/>后端发送端<br/>模型构造 + model_dump"]:::p1
  P3["Phase 3<br/>前端消费者<br/>@/protocol + frame_type 分派"]:::p1
  P4["Phase 4<br/>漂移测试<br/>adapter/route/hook/import-boundary"]:::p1
  P5["Phase 5<br/>文档清理<br/>Web README + 旧 kind/帧数"]:::p2

  P0 --> P1
  P1 --> P2
  P1 --> P3
  P2 --> P4
  P3 --> P4
  P4 --> P5
  P1 -.Models gate.-> P2
  P1 -.Models gate.-> P3
  P4 -.Drift gate.-> P5
```

## Web Protocol Models

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Models["Web Protocol Models（边界 = 协议包）"]
    Registry["WebWireProtocolRegistry<br/>P0 · endpoint adapter 入口"]:::p0
    PyModels["Python Pydantic Models<br/>P0 · frame_type + union"]:::p0
    TsTypes["TS protocol.ts Types<br/>P0 · 1:1 wire 类型"]:::p0
    Exports["__init__ exports<br/>P1 · 显式导出"]:::p1
    Payloads["Payload DTO<br/>P2 · dict[str, Any] 边界"]:::p2
  end

  TypedDicts["app_support TypedDict<br/>迁移来源"]:::p2
  LocalTs["feature/lib 局部 union<br/>迁移来源"]:::p2

  TypedDicts -.-> PyModels
  LocalTs -.-> TsTypes
  Registry --> PyModels
  Registry --> Exports
  PyModels --> Payloads
  TsTypes --> Payloads
```

### 判别规则

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Raw["Raw JSON<br/>来自 WebSocket"]:::p2
  Adapter["Endpoint TypeAdapter<br/>按 direction 选择 union"]:::p0
  Discriminator["frame_type<br/>统一判别字段"]:::p0
  Model["Frame Model<br/>Pydantic / TS 类型"]:::p1
  Dump["model_dump<br/>wire 输出"]:::p1

  Raw --> Adapter --> Discriminator --> Model --> Dump
```

## Protocol Frame Emission

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Emitters["Protocol Frame Emission（边界 = 发送端模型化）"]
    Emitter["WebFrameEmitter<br/>P1 · dump/validate 入口"]:::p1
    ThreadStatus["thread_status.py<br/>phase + pong timestamp_ms + resolve allow"]:::p1
    Inbox["global_inbox broadcaster<br/>ApprovalInboxItem 顶层字段"]:::p1
    Usage["Claude/Codex service<br/>usage_summary_updated frame_type"]:::p1
    CodexRoute["Codex route<br/>options + attachments + isProcessing"]:::p2
  end

  Models["Web Protocol Models<br/>P0 · Frame Models"]:::p0
  Socket["WebSocket send_json<br/>wire dict"]:::p2

  ThreadStatus --> Emitter
  Inbox --> Emitter
  Usage --> Emitter
  CodexRoute --> Emitter
  Emitter --> Models
  Emitter --> Socket
```

## Frontend Wire Consumers

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Consumers["Frontend Wire Consumers（边界 = @/protocol）"]
    ProtocolTs["protocol.ts<br/>P0 · wire 类型真源"]:::p0
    ThreadHook["useThreadStatusWS<br/>P1 · frame_type 分派"]:::p1
    InboxStore["approval inbox store<br/>P1 · UI 状态"]:::p1
    CodexSocket["codex-ws.ts<br/>P1 · socket 实现"]:::p1
    Providers["Claude/Codex providers<br/>P2 · endpoint 消费"]:::p2
  end

  LocalTypes["feature/lib types<br/>业务状态类型"]:::p2

  ProtocolTs --> ThreadHook
  ProtocolTs --> InboxStore
  ProtocolTs --> CodexSocket
  ProtocolTs --> Providers
  InboxStore --> LocalTypes
```

## Protocol Drift Tests

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Tests["Protocol Drift Tests（边界 = 回归测试套件）"]
    Suite["ProtocolDriftTestSuite<br/>P1 · 测试入口"]:::p1
    Adapter["Python adapter tests<br/>P1 · dispatch/rejection"]:::p1
    Route["Route/service tests<br/>P1 · 真实 handler"]:::p1
    Frontend["Frontend hook/socket tests<br/>P1 · 分派和导入"]:::p1
    ImportScan["Import-boundary scan<br/>P0 · 禁止局部 wire type"]:::p0
    Hash["Fixture/hash drift<br/>P0 · Python/TS 一致"]:::p0
  end

  Models["Web Protocol Models<br/>P0 · fixture 输入"]:::p0

  Models --> Suite
  Suite --> Adapter
  Suite --> Route
  Suite --> Frontend
  Suite --> ImportScan
  Suite --> Hash
```

## 协议数据关系

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#181A1F", "primaryColor": "#242933", "primaryTextColor": "#F5F7FA", "primaryBorderColor": "#6BA7FF", "lineColor": "#AAB4C0", "textColor": "#F5F7FA", "edgeLabelBackground": "#181A1F"}}}%%
flowchart LR
  classDef entity fill:#1F2633,stroke:#6BA7FF,color:#F5F7FA,stroke-width:1.5px
  classDef supporting fill:#191F29,stroke:#AAB4C0,color:#F5F7FA,stroke-width:1.2px

  ENDPOINT["ENDPOINT<br/>────────<br/>PK name<br/>direction"]:::entity
  FRAME["WIRE_FRAME<br/>────────<br/>PK frame_type<br/>direction"]:::entity
  MODEL["PY_MODEL<br/>────────<br/>PK class_name<br/>frame_type"]:::entity
  TSTYPE["TS_TYPE<br/>────────<br/>PK type_name<br/>frame_type"]:::entity
  TEST["DRIFT_TEST<br/>────────<br/>PK test_id<br/>status"]:::supporting

  ENDPOINT -->|owns 1:N| FRAME
  FRAME -->|implemented by 1:1| MODEL
  FRAME -->|mirrored by 1:1| TSTYPE
  TEST -->|checks N:N| FRAME
```
