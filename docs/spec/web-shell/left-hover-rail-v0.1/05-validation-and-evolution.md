# 验证策略与演进

## 验证策略

### 单元测试

- **覆盖模块**：`WebShellRailManager`、rail item contract、availability 规则、responsive density 策略。
- **框架**：Vitest。
- **重点场景**：desktop 完整入口、compact 裁剪入口、compact 超量入口裁剪、重复 item id 防护、registry 重复 sourceId cleanup 防护、mobile disabled / MobileToolsMenu 降级、无 active thread 时线程级入口不可用、XSpace 参考参数只进入 layout config、`requiredCapability` 按客户端能力过滤。

### 组件交互测试

- **覆盖模块**：`WebShellRailView`、`Layout` 集成、`ChatPage` 集成。
- **框架**：Testing Library + Vitest。
- **重点场景**：mouseenter 展开、mouseleave 收起、focusin 展开、blur 收起、Escape 收起、点击按钮后页面布局稳定、展开态覆盖 `LeftSidebar`。
- **现有测试补强**：扩展 `web/src/components/__tests__/Layout.test.tsx` 覆盖 rail 入口来源、`LeftSidebar` 分离、desktop / compact / mobile 响应式状态；扩展 `web/src/pages/__tests__/Chat.test.tsx` 覆盖真实 `Layout` + `ChatPage` 路由下线程级 rail 注册。

### 浏览器 smoke

- **端到端链路**：桌面 viewport 打开 Chat → hover 最左侧触发区 → rail 展开 → 截图确认 visible rail 自适应高度、rail 覆盖 `LeftSidebar`、主聊天区位置稳定。
- **移动降级链路**：移动 viewport 打开 Chat → rail disabled 或继续使用 `MobileToolsMenu` → 截图确认工具入口可用。
- **环境要求**：本地 Web dev server，后端可使用现有 fake / stub 数据。
- **触发方式**：x-dev 在实现后把具体命令和截图产物写入 `dev-report.md`；x-verify 复跑可自动执行的 Vitest 与 build 命令。

### 手动验证

- **必须人工过的场景**：hover zone 高度手感、按钮密度、rail 覆盖 `LeftSidebar` 的层级关系、rail 与 header / Toast 的层级关系。
- **验收人**：Web shell 功能 owner。

## 测试覆盖要求

| 模块 | 最低覆盖 | 重点文件 |
|------|---------|---------|
| WebShellRailManager | availability + density 全分支 | `WebShellRailManager` 测试文件 |
| WebShellRailView | hover / focus / keyboard 交互 | `WebShellRail` 组件测试 |
| WebShellRailIntegration | Layout / ChatPage 入口映射 | `Layout.test.tsx`、`Chat.test.tsx` |
| WebShellRailValidation | desktop + mobile smoke | 浏览器 smoke 截图与 `dev-report.md` |

## 演进路线

### 短期（本轮 task）

- [x] 定义 `WebShellRailManager`、types、availability 规则。
- [x] 实现 hover zone、自适应高度 visible rail 和 keyboard/focus 交互。
- [x] 在 `Layout` 与 `ChatPage` 接入现有工具入口能力。
- [x] 补齐 Vitest 与 Playwright smoke。

### 中期（下 1-2 轮）

- [x] 落地 `web-shell-runtime-capabilities`：新增 `web.host_environment`、客户端能力 DTO、前端归一化和 rail item 能力过滤。
- [ ] 根据用户使用频率调整 rail item priority。
- [ ] 为更多线程级工具提供统一入口。
- [ ] 增加可访问性细节，例如 roving tabindex 或更稳定的 title / aria 说明。

### 长期（方向性）

- 将 Web Shell 外壳工具入口沉淀为统一的 Web 导航能力，继续保持浏览器原生实现和 Web 端可测试性。
