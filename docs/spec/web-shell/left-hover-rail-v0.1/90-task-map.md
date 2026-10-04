# Task Map

| 模块 | task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| WebShellRailManager | `web-shell-rail-manager` | 无 | rail item 统一生成和 availability；移动端与紧凑桌面降级 | 中 | 已完成 | 已定义 contract、context、density、availability。XSpace 参考参数只进入 layout config。 |
| WebShellRailView | `web-shell-rail-view` | `web-shell-rail-manager` | hover/focus 展开；自适应高度；顶层覆盖 `LeftSidebar`；既有布局语义稳定 | 中 | 已完成 | 纯 `web/src` React / DOM / CSS 实现，已验证 hover zone、z-index 和左侧栏覆盖。 |
| WebShellRailIntegration | `web-shell-rail-integration` | `web-shell-rail-manager` + `web-shell-rail-view` | Layout / ChatPage 提供入口能力和线程上下文；既有布局语义稳定 | 中 | 已完成 | 复用现有 header 与 toolbar 能力，保留必要状态展示。 |
| WebShellRailValidation | `web-shell-rail-tests` | 前 3 个 task | 自动化与截图验证；移动端与紧凑桌面降级 | 低 | 已完成 | Vitest 覆盖交互，Playwright 覆盖 desktop hover 与 mobile 降级。 |
| WebRuntimeEnvironmentContract | `web-shell-runtime-capabilities` | 已完成 rail 主体 | XSpace 与浏览器环境能力区分 | 中 | 已完成 | 新增独立运行环境字段、客户端能力 DTO 和 rail item `requiredCapability`。 |

## 落地顺序

1. `web-shell-rail-manager` 已先落 contract、重复 ID 防护、density 和 availability 规则。
2. `web-shell-rail-view` 已实现 hover zone、visible rail、顶层 z-index、panel max-height 和交互收起逻辑。
3. `web-shell-rail-integration` 已在 `Layout` 接入全局 items，在 `ChatPage` 通过 registry 注册线程级 items。
4. `web-shell-rail-tests` 已补齐自动化测试、浏览器 smoke 截图和 `dev-report.md` / verify / QA gate 报告。
5. `web-shell-runtime-capabilities` 已作为独立后续 task 落地，先改配置字段和客户端配置合同，再接 rail manager 能力过滤。

## 实现记录

`web-shell-left-hover-rail-v0.1` 已完成真实入口接入，验证记录见 `dev-pipeline/tasks/web-shell-left-hover-rail-v0.1/dev-report.md`。

运行环境与能力识别补充说明见 [运行环境与能力契约](./06-runtime-environment-capabilities.md)。该补充已由 `web-shell-runtime-capabilities` task 实现。
