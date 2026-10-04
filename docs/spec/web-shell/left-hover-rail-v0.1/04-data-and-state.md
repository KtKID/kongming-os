# 数据模型与状态

## 核心实体

```typescript
type WebShellRailScope = 'global' | 'thread'; // 工具入口作用域：global 为全局工具，thread 为当前线程工具

type WebShellRailDensity = 'desktop' | 'compact' | 'mobile'; // 响应式密度：desktop 为完整桌面，compact 为紧凑桌面，mobile 为移动端

type WebShellRailOpenSource = 'hover' | 'focus' | 'keyboard' | null; // rail 展开来源：hover 鼠标，focus 键盘焦点，keyboard 快捷键或 Escape 流程，null 表示收起

type WebHostEnvironment = 'browser' | 'xspace'; // Web sidecar 宿主环境：browser 为普通浏览器，xspace 为 XSpace 启动

interface WebShellCapabilities {
  xspaceHost: boolean; // 是否由 XSpace 桌面宿主启动
  nativeFileDialog: boolean; // 是否具备宿主原生文件或目录选择能力
}

interface WebShellRailItem {
  id: string; // 工具项稳定且全局唯一的 ID，用于排序、测试和埋点
  scope: WebShellRailScope; // 工具项作用域
  priority: 'p0' | 'p1' | 'p2'; // 展示优先级，决定紧凑模式保留顺序
  label: string; // 工具项可见或无障碍标签
  icon: React.ComponentType<{ className?: string }>; // 图标组件，优先使用 lucide-react 图标
  available: boolean; // 当前上下文是否可用
  disabledReason?: string; // 不可用原因说明
  to?: string; // 链接入口，默认渲染为 Link
  onSelect?: () => void | Promise<void>; // 动作入口，默认渲染为 button
  requiredCapability?: keyof WebShellCapabilities; // 该入口所需宿主能力，缺省表示普通浏览器环境也可展示
  render?: (props: WebShellRailRenderProps) => React.ReactNode; // 复用现有工具按钮能力的渲染函数
}

interface WebShellRailContext {
  density: WebShellRailDensity; // 当前布局密度，来源 useChatLayout / chat-layout
  activeThreadId?: string; // 当前线程 ID
  activeThreadTitle?: string; // 当前线程标题
  hasActiveThread: boolean; // 是否有当前线程
  isAuthenticated: boolean; // 当前用户是否已认证
  hostEnvironment: WebHostEnvironment; // 当前 Web sidecar 宿主环境
  capabilities: WebShellCapabilities; // 当前前端可使用的宿主能力集合
}

interface WebShellRailState {
  open: boolean; // rail 是否展开
  openedBy: WebShellRailOpenSource; // 最近一次展开来源
  visibleItems: WebShellRailItem[]; // 当前可见工具项
  density: WebShellRailDensity; // 当前响应式密度
}

interface WebShellRailLayoutConfig {
  railWidthPx: number; // 可见 rail 宽度，单位 px
  hoverZoneWidthPx: number; // hover 触发区宽度，单位 px
  hoverZoneHeightPx: number; // hover 触发区高度，单位 px
  buttonSizePx: number; // 按钮边长，单位 px
  buttonGapPx: number; // 按钮间距，单位 px
  zIndex: number; // rail 层级，高于 LeftSidebar 和页面内容，低于全局弹窗与 Toast
  overlayLeftSidebar: true; // 展开态覆盖 LeftSidebar 区域，固定为 true
}
```

## 实体关系

`WebShellRailContext` 来自 `Layout`、`ChatPage`、`useChatLayout` 和 `useClientConfig`。`WebShellRailManager` 基于 context 生成 `WebShellRailItem[]` 与 `WebShellRailState`，构造时校验重复 `id`，按 `requiredCapability` 过滤宿主能力，compact 模式按 hover zone 可容纳按钮数裁剪。`WebShellRailView` 消费 state 与 layout config，只负责 DOM 渲染和事件回调。实体关系图见 `diagrams.md` 的“WebShellRailManager”与“WebShellRailView”章节；运行环境契约见 [运行环境与能力契约](./06-runtime-environment-capabilities.md)。

## 状态流转

rail 状态围绕 `closed`、`hoverOpen`、`focusOpen`、`keyboardOpen` 四类状态运转。

```text
closed -> hoverOpen -> closed
closed -> focusOpen -> closed
closed -> keyboardOpen -> closed
hoverOpen / focusOpen / keyboardOpen -> closed by Escape
```

状态图见 `diagrams.md` 的“WebShellRailView”章节。

## 持久化方案

| 数据 | 存储方式 | 位置 | 备注 |
|------|---------|------|------|
| rail open 状态 | React runtime state | `web/src` 运行时内存 | 页面刷新后重置。 |
| rail item 列表 | 运行时派生 | `WebShellRailManager` | 由 context 和入口 render factory 派生。 |
| layout config | 静态配置或组件常量 | `WebShellRail` 相关文件 | XSpace / 迁移材料只提供尺寸参考。 |
| host environment | 配置 / 覆盖参数派生 | `web.host_environment` → `/api/config/client` | XSpace 桌面包通过 `setting.yaml` 声明，普通浏览器默认 `browser`。 |
| capabilities | 后端运行时派生 | `/api/config/client` → `useClientConfig()` | rail 只消费布尔能力，不直接探测宿主。 |
| overlay rule | 静态配置 | `WebShellRailLayoutConfig.overlayLeftSidebar` | rail 固定覆盖 `LeftSidebar`，保持顶层工具入口手感。 |
| thread context | 现有页面状态 | `ChatPage` | 不新增持久化字段。 |
| global actions | 现有组件能力 | `Layout` | 不新增后端状态。 |

## 共享数据结构

`WebShellRailItem`、`WebShellRailContext`、`WebShellRailState`、`WebShellRailLayoutConfig` 是本 spec 的核心共享结构，已放在 `web/src/components/web-shell-rail/types.ts`，并通过 `web/src/components/web-shell-rail/index.ts` 导出给视图与测试使用。`WebHostEnvironment` 与 `WebShellCapabilities` 已随 `web-shell-runtime-capabilities` task 落入前后端类型。
