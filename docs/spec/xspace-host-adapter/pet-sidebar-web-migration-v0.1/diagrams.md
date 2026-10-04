# Pet/Sidebar Web 迁移 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/03/04 是文字事实源，本文件是只读视图——增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](#总览)
- [HostSurfaceManager](#hostsurfacemanager)
- [AvatarWebRuntimeManager](#avatarwebruntimemanager)
- [AvatarMessageClientManager](#avatarmessageclientmanager)
- [AvatarProfileBackend](#avatarprofilebackend)
- [RailSurfaceManager](#railsurfacemanager)
- [PetSettingsManager](#petsettingsmanager)
- [XSpaceNativeBridge](#xspacenativebridge)

图例：P0 核心/阻塞 · P1 主要/必须 · P2 辅助/可选

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Backend["Kongming Avatar backend<br/>P0 · /api/avatar/v1/* 事实层"]:::p0
  Host["HostSurfaceManager<br/>P0 · Web 到宿主门户"]:::p0
  Runtime["AvatarWebRuntimeManager<br/>P0 · Pet route 运行时"]:::p0
  Client["AvatarMessageClientManager<br/>P0 · Avatar REST client"]:::p0
  Profile["AvatarProfileBackend<br/>P1 · Pet profile 事实"]:::p1
  Rail["RailSurfaceManager<br/>P0 · 左侧 rail route"]:::p0
  Settings["PetSettingsManager<br/>P1 · Pet 设置 surface"]:::p1
  Native["XSpaceNativeBridge<br/>P0 · Tauri 桌面实现"]:::p0
  Assets["Avatar assets<br/>P1 · web/public/avatar"]:::p1

  Runtime --> Host
  Runtime --> Client
  Runtime --> Assets
  Client --> Backend
  Profile --> Backend
  Rail --> Host
  Rail --> Assets
  Settings --> Host
  Settings --> Client
  Settings --> Profile
  Settings --> Assets
  Host --> Native
  Native -.-> Backend
```

## HostSurfaceManager

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph HostSurfaceManager["HostSurfaceManager"]
    Manager["HostSurfaceManager<br/>P0 · 唯一 TS 门户"]:::p0
    WebBase["WebHostBase<br/>P0 · Web 基线 surface"]:::p0
    Tauri["TauriHost<br/>P0 · Tauri 桌面增强"]:::p0
    Errors["HostSurfaceError<br/>P1 · 稳定错误码"]:::p1
  end

  Runtime["AvatarWebRuntimeManager<br/>邻居"]:::p2
  Rail["RailSurfaceManager<br/>邻居"]:::p2
  Settings["PetSettingsManager<br/>邻居"]:::p2
  Native["XSpaceNativeBridge<br/>邻居"]:::p2

  Runtime --> Manager
  Rail --> Manager
  Settings --> Manager
  Manager --> WebBase
  Manager --> Tauri
  Manager --> Errors
  Tauri --> Native
```

### Surface 生命周期

```mermaid
stateDiagram-v2
  [*] --> mount
  mount --> ready: route initialized
  ready --> focus: user activates
  focus --> blur: focus leaves
  blur --> focus: user activates
  ready --> suspend: hidden
  suspend --> resume: shown
  resume --> focus: user activates
  ready --> close: closeSurface
  focus --> close: closeSurface
  suspend --> close: closeSurface
  close --> [*]
```

## AvatarWebRuntimeManager

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph AvatarWebRuntimeManager["AvatarWebRuntimeManager"]
    Manager["AvatarWebRuntimeManager<br/>P0 · Pet route 边界"]:::p0
    Route["AvatarPetRoute<br/>P0 · /-/xspace/pet"]:::p0
    Bubble["AvatarBubbleController<br/>P0 · 消息和审批气泡"]:::p0
    Input["PetInputController<br/>P1 · chat 输入"]:::p1
    Asset["AvatarAssetManager<br/>P1 · manifest/action URL"]:::p1
  end

  Host["HostSurfaceManager<br/>邻居"]:::p2
  Client["AvatarMessageClientManager<br/>邻居"]:::p2

  Route --> Manager
  Manager --> Bubble
  Manager --> Input
  Manager --> Asset
  Manager --> Host
  Manager --> Client
```

### Pet 消息流程

```mermaid
sequenceDiagram
  participant Runtime as AvatarWebRuntimeManager
  participant Client as AvatarMessageClientManager
  participant API as Kongming Avatar API
  participant Host as HostSurfaceManager

  Runtime->>Client: getCapabilities()
  Client->>API: GET /api/avatar/v1/capabilities
  Runtime->>Client: listMessages(status=active)
  Client->>API: GET /api/avatar/v1/messages
  Runtime-->>Runtime: classify + show bubble
  Runtime->>Host: setPetViewMode(expanded)
  Runtime->>Client: ackMessage(consumed)
  Client->>API: POST /api/avatar/v1/messages/{id}/ack
  Runtime->>Host: setPetViewMode(compact)
```

## AvatarMessageClientManager

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph AvatarMessageClientManager["AvatarMessageClientManager"]
    Manager["AvatarMessageClientManager<br/>P0 · REST client 门户"]:::p0
    Poller["AvatarMessagePoller<br/>P0 · active 消息轮询"]:::p0
    Display["AvatarMessageDisplayController<br/>P0 · classify/queue/action"]:::p0
    Ack["AvatarAckController<br/>P1 · displayed/consumed"]:::p1
    Preset["AvatarPresetResolver<br/>P1 · preset 选择"]:::p1
  end

  API["Kongming Avatar API<br/>邻居"]:::p2

  Manager --> Poller
  Manager --> Display
  Manager --> Ack
  Manager --> Preset
  Poller --> API
  Ack --> API
  Preset --> API
  Manager --> API
```

## AvatarProfileBackend

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph AvatarProfileBackend["AvatarProfileBackend"]
    Manager["AvatarManager<br/>P1 · profile 方法收口"]:::p1
    Model["AvatarProfile models<br/>P1 · DTO 和默认值"]:::p1
    Repo["AvatarProfileRepository<br/>P1 · JSON 持久化"]:::p1
    Router["Avatar router<br/>P1 · GET/PATCH profile"]:::p1
  end

  Settings["PetSettingsManager<br/>邻居"]:::p2

  Settings --> Router
  Router --> Manager
  Manager --> Model
  Manager --> Repo
```

## RailSurfaceManager

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph RailSurfaceManager["RailSurfaceManager"]
    Manager["RailSurfaceManager<br/>P0 · rail 边界"]:::p0
    Route["RailSurfaceRoute<br/>P0 · /-/xspace/rail"]:::p0
    Hotzone["RailHotzoneController<br/>P0 · hover/focus"]:::p0
    Actions["RailActionController<br/>P1 · pet/settings/mobile"]:::p1
  end

  Host["HostSurfaceManager<br/>邻居"]:::p2
  Assets["Avatar assets<br/>邻居"]:::p2

  Route --> Manager
  Manager --> Hotzone
  Manager --> Actions
  Manager --> Host
  Manager --> Assets
```

### Rail 打开设置流程

```mermaid
sequenceDiagram
  participant User as User
  participant Rail as RailSurfaceManager
  participant Host as HostSurfaceManager
  participant Settings as PetSettingsManager

  User->>Rail: pointer enters left edge
  Rail->>Host: updateSurface(open)
  User->>Rail: click Pet icon
  Rail->>Host: openSurface(settings, /-/settings/pet)
  Host->>Settings: route mounts
  Settings-->>User: show Pet settings
```

## PetSettingsManager

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph PetSettingsManager["PetSettingsManager"]
    Manager["PetSettingsManager<br/>P1 · settings 边界"]:::p1
    Profile["PetProfileClient<br/>P1 · 后端 profile"]:::p1
    Snapshot["PetSettingsSnapshotBuilder<br/>P1 · 合并状态"]:::p1
    Panel["PetSettingsPanel<br/>P1 · 设置 UI"]:::p1
  end

  Host["HostSurfaceManager<br/>邻居"]:::p2
  Assets["Avatar assets<br/>邻居"]:::p2
  API["Kongming Avatar API<br/>邻居"]:::p2

  Manager --> Profile
  Manager --> Snapshot
  Manager --> Panel
  Snapshot --> Host
  Snapshot --> Assets
  Profile --> API
```

## XSpaceNativeBridge

### Command Mapping

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph XSpaceNativeBridge["XSpaceNativeBridge"]
    TauriHost["TauriHost<br/>P0 · Web 侧桌面实现"]:::p0
    AvatarOverlay["AvatarOverlayManager<br/>P0 · 透明 Pet window"]:::p0
    WebviewManager["WebviewManager<br/>P0 · rail child WebView"]:::p0
    Sidecar["KongmingSidecarManager<br/>P1 · backend ready/base URL"]:::p1
  end

  Host["HostSurfaceManager<br/>邻居"]:::p2
  PetRoute["/-/xspace/pet<br/>邻居"]:::p2
  RailRoute["/-/xspace/rail<br/>邻居"]:::p2

  Host --> TauriHost
  TauriHost --> AvatarOverlay
  TauriHost --> WebviewManager
  TauriHost --> Sidecar
  AvatarOverlay --> PetRoute
  WebviewManager --> RailRoute
```

### Pet host 状态流转

```mermaid
stateDiagram-v2
  [*] --> disabled_persistently
  [*] --> hidden
  hidden --> visible_compact: showPet
  visible_compact --> visible_expanded: setPetViewMode(expanded)
  visible_expanded --> visible_compact: setPetViewMode(compact)
  visible_compact --> hidden: hidePet
  visible_expanded --> hidden: hidePet
  hidden --> disabled_session: disablePetForSession
  visible_compact --> disabled_session: disablePetForSession
  visible_expanded --> disabled_session: disablePetForSession
  hidden --> disabled_persistently: disablePetPersistently
  visible_compact --> disabled_persistently: disablePetPersistently
  disabled_session --> visible_compact: showPet
  disabled_persistently --> visible_compact: showPet
```
