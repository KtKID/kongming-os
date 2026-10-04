# 目标与完成标准

## 需求要点

1. 当前方向收敛到 Web 源码内的左侧工具入口，迁移方案停止作为本轮目标。
2. rail 是纯原生 Web 逻辑，方案以 `web/src` 内的 React、DOM、CSS hover / focus / keyboard 逻辑为主。
3. XSpace / 迁移材料只作为尺寸、触发区域、按钮参数等参考输入。
4. 在 Web 最左侧新增一条独立工具 rail，与已有 thread 列表 `LeftSidebar` 分离。
5. 可见侧边栏的高度由内部按钮容器自适应决定，最左侧 hover 触发区域高度大于可见侧边栏。
6. rail 位于 Web shell 顶层，z-index 高于原本左侧 thread `LeftSidebar`，展开时覆盖左侧栏区域。
7. rail 承载全局和线程级工具入口，优先复用现有 `Layout` header 与 `Chat` toolbar 中的按钮能力。
8. 主聊天区、现有 `LeftSidebar`、`WorkspaceDock`、全局弹窗、Toast 继续保持原布局语义。
9. 第一版以桌面端可用为主，紧凑/移动端有明确降级策略。
10. 后续 XSpace 能力入口通过独立运行环境字段和能力集合控制，rail 继续只消费 Web 参数。

## 系统目标

本 spec 让 Web 外壳拥有独立的左侧工具入口层。用户在桌面端通过 hover、focus 或键盘操作快速打开全局和线程级工具；rail 展开态覆盖左侧 thread 列表区域，聊天主体、工作区 dock 和浮层系统保持既有布局关系。

## 完成目标（DoD）

- [x] 桌面端最左侧存在独立 hover 触发区域，鼠标进入或焦点进入后展开工具 rail。
- [x] 可见 rail 的高度由按钮 stack 内容决定，hover 触发区域高度大于按钮 stack。
- [x] rail 位于 Web shell 顶层，z-index 高于 `LeftSidebar`，展开态覆盖左侧栏。
- [x] rail item 由 `WebShellRailManager` 统一生成，包含全局入口和线程级入口的 availability 规则。
- [x] `Layout` 与 `ChatPage` 能向 rail 提供全局状态、线程状态和现有工具入口能力。
- [x] `LeftSidebar` 继续承担 thread 列表职责，主聊天区、`WorkspaceDock`、弹窗、Toast 的布局语义保持稳定。
- [x] 移动端保留 `MobileToolsMenu` 或禁用 rail，紧凑桌面端使用受限按钮集合。
- [x] Vitest 覆盖 hover / focus / Escape / availability / responsive 行为，浏览器 smoke 覆盖桌面截图与移动降级。
- [x] 运行环境能力契约补充：XSpace 通过 `setting.yaml` 声明 `host_environment=xspace`，前端通过客户端配置 DTO 获得 `capabilities`，rail item 通过 `requiredCapability` 过滤。

## 范围边界

**包含**：
- `web/src` 内新增 `WebShellRailManager` 和 `WebShellRail` 相关类型、组件、hook、样式。
- React state、DOM pointer/focus/keyboard event、CSS absolute positioning 与 z-index 管理。
- 复用 `SchedulerEntryButton`、`SitianReportEntryButton`、`LogViewerEntryButton`、`ThemeToggle`、`Logout`、Workflow 入口和线程内 toolbar 能力。
- `useChatLayout` 与 `chat-layout` 的 mobile / compact 判断接入。
- XSpace / 迁移材料中的尺寸、触发区高度、按钮密度、按钮参数参考。
- `web.host_environment`、客户端配置 DTO、rail item `requiredCapability` 的方案契约，详见 [运行环境与能力契约](./06-runtime-environment-capabilities.md)。

**外部边界**：
- Tauri / XSpace 宿主迁移设计停留在本轮之外。
- 原生窗口 API、宿主 bridge、sidecar 生命周期、跨进程事件停留在宿主层。
- `LeftSidebar` 继续承担 thread 列表职责，rail 展开态覆盖 `LeftSidebar` 的左侧区域。
- 当前已完成的 rail 主体不改动后端路由、WebSocket frame、持久化 schema；运行环境能力补充会扩展 `GET /api/config/client`。
- 全局弹窗、Toast、WorkspaceDock 继续沿用现有职责。

## 关键约束

- rail 实现必须位于 `web/src`，运行时依赖浏览器 DOM、React 和 CSS。
- `WebShellRailManager` 是本 spec 的主门户，rail item 生成、可用性、响应式策略和 open 状态策略由该门户收口。
- 视图组件只消费 manager 输出，避免复制现有业务按钮内部逻辑。
- hover zone 与 visible rail 使用固定宽度、absolute 定位和稳定 z-index；rail 层级高于 `LeftSidebar`，低于全局弹窗/Toast。
- 桌面端是第一版主路径；移动端保留现有 `MobileToolsMenu` 或禁用 rail。
- 所有新增共享类型字段必须有中文注释。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| 桌面端 hover/focus 展开 rail | WebShellRailManager + WebShellRailView | `web-shell-rail-manager` + `web-shell-rail-view` | 已完成 |
| 自适应高度 visible rail + 更高 hover zone | WebShellRailView | `web-shell-rail-view` | 已完成 |
| 顶层 rail 覆盖 `LeftSidebar` | WebShellRailView + WebShellRailValidation | `web-shell-rail-view` + `web-shell-rail-tests` | 已完成 |
| rail item 统一生成和 availability | WebShellRailManager | `web-shell-rail-manager` | 已完成 |
| Layout / ChatPage 提供入口能力和线程上下文 | WebShellRailIntegration | `web-shell-rail-integration` | 已完成 |
| 既有布局语义稳定 | WebShellRailView + WebShellRailIntegration + WebShellRailValidation | `web-shell-rail-view` + `web-shell-rail-integration` + `web-shell-rail-tests` | 已完成 |
| 移动端与紧凑桌面降级 | WebShellRailManager + WebShellRailView + WebShellRailValidation | `web-shell-rail-manager` + `web-shell-rail-view` + `web-shell-rail-tests` | 已完成 |
| 自动化与截图验证 | WebShellRailValidation | `web-shell-rail-tests` | 已完成 |
| XSpace 与浏览器环境能力区分 | WebRuntimeEnvironmentContract + WebShellRailManager | `web-shell-runtime-capabilities` | 已完成 |
