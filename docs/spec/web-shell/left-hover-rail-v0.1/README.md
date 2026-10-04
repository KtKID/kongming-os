# left-hover-rail-v0.1

> 状态：已完成；运行环境能力契约补充项已完成
> 目标：在 Web 最左侧新增纯原生 Web hover 工具 rail，把全局和线程级工具入口从 header / chat toolbar 中整理到独立入口层。

## 系统目标

left-hover-rail-v0.1 为 Web 桌面端提供一条独立工具入口 rail。rail 与现有 thread 列表 `LeftSidebar` 分离，位于 Web shell 顶层，展开时覆盖左侧栏区域，保留主聊天区、`WorkspaceDock`、全局弹窗、Toast 的布局语义，并通过 `WebShellRailManager` 收口工具项生成、可用性判断和 hover/open 状态策略。

## 最小可用路径

用户在桌面端把鼠标移入 Web 最左侧触发区域或键盘聚焦 rail → `WebShellRailManager` 输出当前可用工具项 → `WebShellRail` 展开自适应高度按钮容器 → 用户点击全局或线程级入口 → 复用现有 Scheduler / Sitian / Log / Theme / Logout / Workflow 等能力并保持页面布局稳定。

## 范围边界

**包含**：
- Web 源码内的 React 组件、DOM 事件、CSS hover/focus、键盘 Escape 关闭逻辑。
- 最左侧独立工具 rail、较高的 hover 触发区域、自适应高度可见按钮容器。
- `Layout` 全局入口与 `ChatPage` 线程上下文的协作。
- 现有 header 与 chat toolbar 中可复用工具能力的 rail item 化。
- 桌面端主路径与紧凑/移动端降级策略。
- 运行环境能力契约补充，定义 XSpace 配置字段、客户端配置 DTO 和 rail item 能力过滤边界。

**外部边界**：
- Tauri / XSpace 宿主迁移设计停留在本轮之外。
- 原生窗口能力、宿主 bridge、sidecar 或跨进程通信停留在宿主层。
- thread 列表继续由 `LeftSidebar` 承担；rail 的 z-index 高于 `LeftSidebar`，展开态覆盖左侧栏。
- `WorkspaceDock`、全局弹窗、Toast 继续沿用现有布局语义。
- 后端 REST / WS 协议保持现状。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| WebShellRailManager | 已完成 | [模块拆分](./02-module-breakdown.md#模块-1webshellrailmanager) | 已进入 task | 生成 rail items、availability、open 状态策略和响应式策略。 |
| WebShellRailView | 已完成 | [模块拆分](./02-module-breakdown.md#模块-2webshellrailview) | 已进入 task | 实现 hover zone、自适应高度 rail、键盘和焦点交互。 |
| WebShellRailIntegration | 已完成 | [模块拆分](./02-module-breakdown.md#模块-3webshellrailintegration) | 已进入 task | 在 `Layout` / `ChatPage` 接入现有工具入口和线程上下文。 |
| WebShellRailValidation | 已完成 | [验证策略](./05-validation-and-evolution.md) | 已进入 task | 覆盖 Vitest 交互、布局不回归、Playwright smoke 截图。 |

## 文档导航

- [图集：总览 + 模块局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [运行环境与能力契约](./06-runtime-environment-capabilities.md)
- [Task 映射](./90-task-map.md)

## 当前落地

1. `web-shell-left-hover-rail-v0.1` 已进入 x-req / x-dev 并完成实现。
2. `WebShellRailManager` 与 rail item contract 已落在 `web/src/components/web-shell-rail/`。
3. hover 触发区、按钮尺寸、按钮间距只参考 XSpace / 迁移材料中的参数，最终实现落在 `web/src` 的 React / DOM / CSS。
4. 运行环境与能力识别作为补充 task，已通过 `web.host_environment`、`GET /api/config/client` 和 `requiredCapability` 接入。
