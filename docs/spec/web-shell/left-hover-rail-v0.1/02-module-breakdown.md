# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| WebShellRailManager | 生成工具项、可用性、响应式策略和 open 状态策略 | `Layout` 状态、`ChatPage` 线程状态、`useChatLayout` | 已完成 | 本 spec 主门户。 |
| WebShellRailView | 渲染顶层 hover zone、visible rail、按钮 stack、键盘和焦点交互 | WebShellRailManager 输出 | 已完成 | z-index 高于 `LeftSidebar`，展开态覆盖左侧栏。 |
| WebShellRailIntegration | 在 `Layout` / `ChatPage` 接入现有工具入口能力 | 现有 header / toolbar 组件 | 已完成 | 保留原布局语义。 |
| WebShellRailValidation | 验证交互、布局、响应式降级和截图 smoke | Vitest、Testing Library、Playwright | 已完成 | 覆盖桌面主路径和移动降级。 |
| WebRuntimeEnvironmentContract | 定义浏览器 / XSpace 运行环境字段、客户端能力 DTO 和 rail item 能力过滤 | `hosts.web.run`、`/api/config/client`、`useClientConfig`、WebShellRailManager | 已完成 | XSpace 通过配置声明环境，rail 只参考参数。 |

## 模块详情

### 模块 1：WebShellRailManager

**职责**：统一生成 rail items、处理 availability、封装桌面/紧凑/移动响应式策略，并为视图提供 open 状态策略。

**包含范围**：
- 定义 rail item contract。
- 根据全局状态、线程状态、layout mode 输出可见工具项。
- 根据 hover / focus / keyboard intent 更新 open 状态。
- 接收 XSpace / 迁移材料中的尺寸和按钮参数作为参考配置输入。

**外部边界**：
- 具体按钮 DOM 渲染由视图组件承担。
- Tauri、XSpace、宿主 bridge 和原生窗口能力停留在宿主层。
- Scheduler / Sitian / Log / Theme / Logout / Workflow 的内部业务逻辑保留在原组件内。

**依赖**：
- `web/src/components/Layout.tsx` 提供全局入口能力和全局状态。
- `web/src/pages/Chat.tsx` 提供 `threadId`、`threadTitle`、`activeThread` 等线程上下文。
- `web/src/hooks/useChatLayout.ts` 与 `web/src/lib/chat-layout.ts` 提供 mobile / compact 判断。

**复用/新建**：新建 `WebShellRailManager`；复用现有 Layout header 与 Chat toolbar 的按钮能力。

**数据结构/接口**：

```typescript
type WebShellRailScope = 'global' | 'thread'; // 工具入口作用域：global 表示全局入口，thread 表示当前线程入口

type WebShellRailDensity = 'desktop' | 'compact' | 'mobile'; // rail 响应式密度：desktop 为完整桌面，compact 为紧凑桌面，mobile 为移动降级

interface WebShellRailContext {
  density: WebShellRailDensity; // 当前布局密度，来源 useChatLayout / chat-layout 判断
  activeThreadId?: string; // 当前线程 ID，未进入线程页时为空
  activeThreadTitle?: string; // 当前线程标题，用于 title、aria-label 和测试断言
  hasActiveThread: boolean; // 是否存在可用当前线程，决定 thread scope 工具可用性
  isAuthenticated: boolean; // 当前 Web 会话是否已登录，决定登出等入口可用性
}

interface WebShellRailItem {
  id: string; // 工具项稳定且全局唯一的 ID，用于测试选择器、排序和状态追踪
  scope: WebShellRailScope; // 工具项作用域，决定全局入口或线程入口
  priority: 'p0' | 'p1' | 'p2'; // 展示优先级，p0 为核心入口，p1 为主要入口，p2 为辅助入口
  label: string; // 中文或现有 UI 文案标签，用于 aria-label 和 title
  icon: React.ComponentType<{ className?: string }>; // lucide 图标组件，默认入口直接渲染
  available: boolean; // 当前上下文是否可展示或可点击
  disabledReason?: string; // 不可用原因，用于 title 或测试断言
  to?: string; // 链接入口，默认渲染为 Link
  onSelect?: () => void | Promise<void>; // 动作入口，默认渲染为 button
  render?: (props: WebShellRailRenderProps) => React.ReactNode; // 复用复杂现有按钮能力的渲染函数
}

interface WebShellRailState {
  open: boolean; // rail 当前是否展开
  openedBy: 'hover' | 'focus' | 'keyboard' | null; // 最近一次展开来源
  density: WebShellRailDensity; // 当前响应式密度
  visibleItems: WebShellRailItem[]; // 当前可见工具项列表
}
```

**风险等级**：中

**风险说明**：入口能力来自多个现有组件，manager 需要保持统一 contract、重复 ID 防护和 compact 容量裁剪，同时避免复制按钮内部逻辑。

**task 落地**：
- 任务名：`web-shell-rail-manager`
- 对应 DoD：rail item 统一生成和 availability；移动端与紧凑桌面降级
- x-req 状态：已进入并完成
- 结果：contract、状态策略和降级规则已落到 `web/src/components/web-shell-rail/`。

### 模块 2：WebShellRailView

**职责**：实现最左侧 hover 触发区、可见 rail、按钮 stack、自适应高度、focus 管理、Escape 收起和顶层覆盖关系。

**包含范围**：
- `RailHoverZone`：覆盖最左侧窄区域，高度大于 visible rail。
- `WebShellRail`：root 使用 fixed 定位，panel 使用 absolute 定位，高度由按钮 stack 和 hover zone 配置共同约束。
- 鼠标进入、焦点进入、鼠标离开、焦点离开、Escape 收起。
- z-index 高于 `LeftSidebar`，展开态覆盖左侧栏区域。
- 与 header、`WorkspaceDock`、全局弹窗、Toast 的 z-index 协作。

**外部边界**：
- 工具项业务可用性由 `WebShellRailManager` 决定。
- `LeftSidebar` 继续承担 thread 列表职责。
- 宿主层事件和原生窗口交互停留在宿主层。

**依赖**：
- `WebShellRailManager` 输出 `WebShellRailState` 和 `WebShellRailItem[]`。
- 现有 UI 基础样式、lucide icons、原生 `title` 提示和既有 popover/menu 能力。

**复用/新建**：新建 `WebShellRail.tsx` 和样式；复用现有 icon/button 组件约定，默认提示使用原生 `title`。

**数据结构/接口**：

```typescript
interface WebShellRailLayoutConfig {
  railWidthPx: number; // 可见 rail 宽度，单位 px，桌面端固定
  hoverZoneWidthPx: number; // 最左侧 hover 触发区宽度，单位 px
  hoverZoneHeightPx: number; // hover 触发区高度，单位 px，必须大于按钮 stack 高度参考值
  buttonSizePx: number; // rail 按钮边长，单位 px
  buttonGapPx: number; // rail 按钮间距，单位 px
  zIndex: number; // rail 层级，高于 LeftSidebar 和页面内容，低于全局弹窗与 Toast
  overlayLeftSidebar: true; // rail 展开态覆盖 LeftSidebar 区域，固定为 true
}

interface WebShellRailProps {
  manager: WebShellRailManager; // rail 状态、layout config 和 visible items 的唯一输入
  className?: string; // 外层样式扩展入口
}
```

**风险等级**：中

**风险说明**：hover zone 高度、visible rail 高度、LeftSidebar 覆盖关系、Toast、弹窗层级需要真实浏览器截图验证。

**task 落地**：
- 任务名：`web-shell-rail-view`
- 对应 DoD：hover/focus 展开；自适应高度；既有布局语义稳定
- x-req 状态：已进入并完成
- 结果：交互边界和布局约束已落到 `WebShellRail` 组件。

### 模块 3：WebShellRailIntegration

**职责**：把 `WebShellRailManager`、`WebShellRail` 和 registry 接入现有 `Layout` 与 `ChatPage`，并把现有全局/线程级入口转成 rail items。

**包含范围**：
- `Layout` 提供管理/聊天切换、Workflow、Scheduler、Sitian、Log、ConnectionIndicator、Theme、Logout 等入口能力。
- `ChatPage` 提供 thread scope 入口能力，包括 `ThreadCronRunsPopover`、`ThreadTaskProgressPopover`、`WorkflowViewerEntryLink`。
- header 中必要状态展示继续保留，适合迁入 rail 的工具入口可 rail item 化。
- 移动端继续走 `MobileToolsMenu` 或 rail disabled 策略。

**外部边界**：
- 工具入口背后的业务能力保留在原组件内。
- 后端 API 保持现状。
- Chat 消息发送、thread 列表、WorkspaceDock 的数据流保持现状。

**依赖**：
- `web/src/components/Layout.tsx`
- `web/src/pages/Chat.tsx`
- `web/src/components/LeftSidebar.tsx`
- `web/src/hooks/useChatLayout.ts`
- `web/src/lib/chat-layout.ts`

**复用/新建**：复用现有组件能力；新增 registry hook 与 render factory，把入口映射为 rail item。

**数据结构/接口**：

```typescript
interface WebShellRailRegistryValue {
  items: WebShellRailItem[]; // 已注册的线程级 rail items
  registerItems: (sourceId: string, items: WebShellRailItem[]) => () => void; // 注册入口，返回清理函数
}

interface WebShellRailRegistration {
  token: symbol; // 同 sourceId 重复注册时保护最新注册
  items: WebShellRailItem[]; // sourceId 对应的当前 rail items
}
```

**风险等级**：中

**风险说明**：header 与 rail 的入口分布需要保留状态可见性，避免用户丢失连接状态、当前页切换和移动端工具入口。

**task 落地**：
- 任务名：`web-shell-rail-integration`
- 对应 DoD：Layout / ChatPage 提供入口能力和线程上下文；既有布局语义稳定
- x-req 状态：已进入并完成
- 结果：`Layout` 提供全局入口，`ChatPage` 注册线程级入口。

### 模块 4：WebShellRailValidation

**职责**：建立 rail 的自动化验证和视觉 smoke，保证交互、布局和降级策略可重复确认。

**包含范围**：
- Vitest + Testing Library 覆盖 manager、view、registry、integration 行为。
- Playwright smoke 覆盖桌面 hover 截图和移动端降级。
- 对 `Layout.test.tsx` 的 rail host、`LeftSidebar` 分离和响应式回归补强；对 `Chat.test.tsx` 的真实 `Layout` + `ChatPage` 线程级注册链路补强。

**外部边界**：
- 真实外部服务调用由既有集成测试体系覆盖。
- 后端路由契约测试归属后端协议变更任务。
- Tauri / XSpace 宿主测试归属宿主交付任务。

**依赖**：
- `web/package.json` 中 React 19、Vitest、Testing Library、Playwright。
- 现有 `web/src/components/__tests__/Layout.test.tsx` 与 `web/src/pages/__tests__/Chat.test.tsx`。

**复用/新建**：复用现有测试框架；新增 rail 专属测试文件和 smoke 截图用例。

**数据结构/接口**：

```typescript
interface WebShellRailTestFixture {
  density: WebShellRailDensity; // 测试布局密度
  hasActiveThread: boolean; // 是否模拟当前线程
  expectedItemIds: string[]; // 预期出现的工具项 ID 列表
  expectedOpenState: boolean; // 预期 rail 是否展开
}
```

**风险等级**：低

**风险说明**：测试框架已存在，主要风险是 Playwright 截图断言需要稳定选择器和固定 viewport。

**task 落地**：
- 任务名：`web-shell-rail-tests`
- 对应 DoD：自动化与截图验证；移动端与紧凑桌面降级
- x-req 状态：已进入并完成
- 结果：Vitest 与浏览器 smoke 结果已记录到 `dev-report.md`。

### 模块 5：WebRuntimeEnvironmentContract

**职责**：定义 Web sidecar 当前运行环境和能力集合，让 XSpace 专属入口可被 rail 精确过滤。

**包含范围**：
- `web.host_environment` 配置字段和可选 `--host-environment` 覆盖参数。
- `GET /api/config/client` 下发 `host_environment` 与 `capabilities`。
- `useClientConfig()` 归一化为 `hostEnvironment` 与 `capabilities`。
- `WebShellRailItem.requiredCapability` 声明入口所需能力。

**外部边界**：
- XSpace 原生 API、Tauri bridge、文件选择实现和跨进程控制面归属后续宿主能力 task。
- XSpace 宿主控制面 API 按需新增到 `/api/xspace/...`，环境识别本身走配置字段。
- rail 不通过 user agent、全局变量或 URL 猜测环境。

**依赖**：
- `src/hosts/web/run.py` 提供 sidecar 可选覆盖参数入口。
- `src/infrastructure/config/models.py` 提供 `WebConfig` 字段校验。
- `src/hosts/web/routers/config.py` 提供客户端配置 DTO。
- `web/src/hooks/useClientConfig.ts` 提供前端运行时配置。
- `web/src/components/web-shell-rail/` 提供 rail item contract 与 manager 过滤逻辑。

**复用/新建**：复用现有 `/api/config/client`；新增运行环境字段和能力集合，不新增 XSpace 宿主公开 API。

**数据结构/接口**：

```typescript
type WebHostEnvironment = 'browser' | 'xspace'; // Web sidecar 宿主环境

interface WebShellCapabilities {
  xspaceHost: boolean; // 是否由 XSpace 桌面宿主启动
  nativeFileDialog: boolean; // 是否具备宿主原生文件或目录选择能力
}

interface WebShellRailItem {
  requiredCapability?: keyof WebShellCapabilities; // 入口所需宿主能力，缺省表示浏览器环境也可展示
}
```

完整契约见 [运行环境与能力契约](./06-runtime-environment-capabilities.md)。

**风险等级**：中

**风险说明**：字段归属横跨配置加载、可选覆盖参数、后端 DTO、前端 hook 和 rail manager，必须通过后端合同测试、配置契约测试和前端单元测试防止协议漂移。

**task 落地**：
- 任务名：`web-shell-runtime-capabilities`
- 对应 DoD：XSpace 与浏览器环境能力区分
- x-req 状态：已完成
- 结果：`web-shell-runtime-capabilities` 已完成开发、x-verify 和 QA gate。
