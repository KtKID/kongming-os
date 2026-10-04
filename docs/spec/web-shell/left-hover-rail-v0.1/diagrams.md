# left-hover-rail-v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/04 是文字事实源，本文件是只读视图；增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](#总览)
- [WebShellRailManager](#webshellrailmanager)
- [WebShellRailView](#webshellrailview)
- [WebShellRailIntegration](#webshellrailintegration)
- [WebShellRailValidation](#webshellrailvalidation)
- [RuntimeEnvironmentCapabilities](#runtimeenvironmentcapabilities)

图例：P0 核心/阻塞 · P1 主要/必须 · P2 辅助/可选

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Manager["WebShellRailManager<br/>P0 · 工具项与状态策略门户"]:::p0
  View["WebShellRailView<br/>P0 · 顶层 hover rail 视图交互"]:::p0
  Integration["WebShellRailIntegration<br/>P1 · Layout 和 ChatPage 接入"]:::p1
  Validation["WebShellRailValidation<br/>P1 · 自动化与截图验证"]:::p1
  RuntimeCaps["RuntimeEnvironmentCapabilities<br/>P0 · 宿主环境和能力合同"]:::p0

  Manager --> View
  Manager --> Integration
  RuntimeCaps --> Manager
  RuntimeCaps --> Integration
  View --> Integration
  Integration --> Validation
  View --> Validation
```

## WebShellRailManager

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph ManagerMod["WebShellRailManager（边界 = WebShellRailManager）"]
    Manager["WebShellRailManager<br/>P0 · 唯一门户"]:::p0
    Contract["RailItem Contract<br/>P0 · 工具项类型"]:::p0
    DuplicateGuard["Duplicate ID Guard<br/>P0 · 唯一 id 防护"]:::p0
    Availability["Availability Rules<br/>P1 · 上下文可用性"]:::p1
    Density["Density Strategy<br/>P1 · 桌面紧凑移动"]:::p1
    CompactLimit["Compact Capacity<br/>P1 · 容量裁剪"]:::p1
    OpenState["Open State Policy<br/>P1 · hover focus keyboard"]:::p1
  end

  Layout["Layout<br/>全局状态和入口"]:::p2
  ChatPage["ChatPage<br/>线程上下文"]:::p2
  ChatLayout["useChatLayout<br/>响应式判断"]:::p2

  Layout --> Manager
  ChatPage --> Manager
  ChatLayout --> Density
  Manager --> Contract
  Manager --> DuplicateGuard
  Manager --> Availability
  Manager --> Density
  Manager --> CompactLimit
  Manager --> OpenState
```

### 数据关系

```mermaid
classDiagram
  WebShellRailContext --> WebShellRailManager : input
  WebShellRailItem --> WebShellRailManager : input
  WebShellRailManager --> WebShellRailState : creates
  WebShellRailManager --> WebShellRailLayoutConfig : exposes
  WebShellRailState --> WebShellRailItem : visibleItems
  WebShellRailManager --> WebShellRail : manager prop

  class WebShellRailContext {
    density
    activeThreadId
    activeThreadTitle
    hasActiveThread
    isAuthenticated
  }

  class WebShellRailItem {
    id unique
    scope
    priority
    label
    icon
    available
    to
    onSelect
    render
  }

  class WebShellRailState {
    open
    openedBy
    density
    visibleItems
  }

  class WebShellRailLayoutConfig {
    railWidthPx
    hoverZoneWidthPx
    hoverZoneHeightPx
    buttonSizePx
    buttonGapPx
    zIndex
    overlayLeftSidebar
  }
```

## WebShellRailView

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph ViewMod["WebShellRailView（边界 = WebShellRail）"]
    WebShellRail["WebShellRail<br/>P0 · 视图入口"]:::p0
    HoverZone["RailHoverZone<br/>P0 · 最左侧触发区"]:::p0
    ButtonStack["ButtonStack<br/>P1 · 自适应高度按钮容器"]:::p1
    PanelBounds["Panel Bounds<br/>P1 · max-height 和 overflow"]:::p1
    Interaction["Interaction Handlers<br/>P1 · mouse focus escape"]:::p1
    Layering["Layering CSS<br/>P1 · 覆盖 LeftSidebar"]:::p1
  end

  Manager["WebShellRailManager<br/>状态和工具项"]:::p2
  ExistingLayout["Existing Layout<br/>header sidebar dock toast"]:::p2
  LeftSidebar["LeftSidebar<br/>P2 · thread 列表"]:::p2

  Manager --> WebShellRail
  WebShellRail --> HoverZone
  WebShellRail --> ButtonStack
  WebShellRail --> PanelBounds
  WebShellRail --> Interaction
  WebShellRail --> Layering
  Layering --> LeftSidebar
  Layering -.-> ExistingLayout
```

### 状态流转

```mermaid
stateDiagram-v2
  [*] --> closed
  closed --> hoverOpen: mouseenter
  hoverOpen --> closed: mouseleave
  closed --> focusOpen: focusin
  focusOpen --> closed: blur
  closed --> keyboardOpen: keyboard open
  keyboardOpen --> closed: Escape
  hoverOpen --> closed: Escape
  focusOpen --> closed: Escape
```

## WebShellRailIntegration

### 接入关系

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph IntegrationMod["WebShellRailIntegration（边界 = Layout + Registry + ChatPage）"]
    Provider["WebShellRailProvider<br/>P0 · registry 容器"]:::p0
    Registry["Registry Hooks<br/>P0 · 线程级 items 注册"]:::p0
    GlobalItems["Global Rail Items<br/>P1 · Layout 生成"]:::p1
    ThreadItems["Thread Rail Items<br/>P1 · ChatPage 注册"]:::p1
    ResponsiveFallback["Responsive Fallback<br/>P1 · mobile compact 策略"]:::p1
  end

  Layout["Layout<br/>Workflow Scheduler Sitian Log Theme Logout"]:::p2
  ChatPage["ChatPage<br/>threadId toolbar entries"]:::p2
  MobileToolsMenu["MobileToolsMenu<br/>移动工具菜单"]:::p2
  Manager["WebShellRailManager<br/>合并 items 并排序裁剪"]:::p0
  Rail["WebShellRail<br/>工具 rail"]:::p0

  Layout --> Provider
  Layout --> GlobalItems
  Provider --> Registry
  ChatPage --> ThreadItems
  ThreadItems --> Registry
  MobileToolsMenu -.-> ResponsiveFallback
  GlobalItems --> Manager
  Registry --> Manager
  ResponsiveFallback --> Manager
  Manager --> Rail
```

## WebShellRailValidation

### E2E 测试链路

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph ValidationMod["WebShellRailValidation（边界 = 测试套件）"]
    Setup["Test Setup<br/>P0 · viewport 和假数据"]:::p0
    Action["User Action<br/>P0 · hover focus escape click"]:::p0
    Assert["Assertions<br/>P0 · 状态和布局断言"]:::p0
    Screenshot["Screenshot Smoke<br/>P1 · desktop mobile 截图"]:::p1
  end

  Setup --> Action
  Action --> Assert
  Assert --> Screenshot
```

## RuntimeEnvironmentCapabilities

### 配置与能力流

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph RuntimeMod["WebRuntimeEnvironmentContract（边界 = ClientRuntimeConfig）"]
    LaunchArg["--host-environment<br/>P1 · 覆盖参数"]:::p1
    WebConfig["web.host_environment<br/>P0 · 配置字段"]:::p0
    ClientDTO["GET /api/config/client<br/>P0 · 下发 host 和 capabilities"]:::p0
    UseClientConfig["useClientConfig<br/>P1 · 前端归一化"]:::p1
    CapabilityFilter["requiredCapability<br/>P1 · rail item 能力过滤"]:::p1
  end

  XSpace["XSpace Host<br/>setting.yaml 提供方"]:::p2
  Browser["Browser<br/>普通 Web 环境"]:::p2
  RailManager["WebShellRailManager<br/>可见入口计算"]:::p0

  XSpace --> WebConfig
  Browser -.-> WebConfig
  LaunchArg --> WebConfig
  WebConfig --> ClientDTO
  ClientDTO --> UseClientConfig
  UseClientConfig --> CapabilityFilter
  CapabilityFilter --> RailManager
```
