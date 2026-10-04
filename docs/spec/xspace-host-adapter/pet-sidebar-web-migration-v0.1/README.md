# Pet/Sidebar Web 迁移

> 状态：可进入 x-req
> 目标：把 XSpace Pet runtime、左侧 rail 和 Pet 设置面板迁入 Kongming Web，由 Host Adapter 承接 Web 基线 surface 和 Tauri 桌面增强。

## 系统目标

Kongming Web 成为 Pet、左侧 rail、设置入口、审批气泡和 Pet chat 的产品界面宿主。Kongming 后端继续作为 Avatar 消息、审批回写和 Pet chat 的事实层。XSpace Tauri Host 提供透明桌面窗口、主窗口 rail overlay、窗口 bounds、点击穿透、置顶、sidecar ready 和本地诊断。

## 最小可用路径

Tauri 启动 Kongming Web 后调用 `host.openSurface({ kind: "pet", route: "/-/xspace/pet", placement: "desktop-window" })` 打开桌面 Pet；同一份 Web 代码在浏览器中渲染页面内 Pet。Pet runtime 通过 `/api/avatar/v1/capabilities`、`/api/avatar/v1/messages`、`/api/avatar/v1/chat`、`/api/avatar/v1/approvals/{requestId}/resolve` 和 `/api/avatar/v1/messages/{messageId}/ack` 完成消息、审批和对话闭环。

## 范围边界

**包含**：
- `/-/xspace/pet` Pet runtime route，承接形象、动作、气泡、审批按钮、右键/操作菜单和 Pet 输入。
- `/-/xspace/rail` 左侧 rail route，承接主窗口左侧入口、Pet 图标、设置入口和浏览器页面内降级。
- `/-/settings/pet` 或现有 `/manage/config/pet` Pet 设置入口，首版聚合产品配置、host 窗口状态、资源包和调试覆盖。
- Web 侧 `HostSurfaceManager`，统一 Web 基线实现与 `TauriHost` 增强实现的 capability、surface lifecycle、route focus、通知、文件选择和 Pet 窗口操作。
- Avatar/Pet 资源包从 `x-space/client/public/avatar/` 迁入 `kongming-agent/web/public/avatar/`。
- Kongming Web Avatar API client，复用现有 `/api/avatar/v1/*` 后端合同。
- XSpace Tauri command/webview manager 到 `TauriHost` 的映射合同。

**范围外**：
- 资源包编辑器、在线资源市场、素材生成和远程资源同步。
- 语音输入、TTS、长期人格配置和 Pet 专属记忆。
- 移动连接完整重构；本 spec 只保留 `mobile-connect` surface 入口兼容。
- XSpace sidecar 打包、ready JSON 和 shutdown 机制重做。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| HostSurfaceManager | 可进入 x-req | [模块拆分](./02-module-breakdown.md#hostsurfacemanager) | 是 | Web 访问宿主能力的唯一 TypeScript 门户。 |
| AvatarWebRuntimeManager | 可进入 x-req | [模块拆分](./02-module-breakdown.md#avatarwebruntimemanager) | 是 | Pet route 的形象、动作、气泡、审批和输入运行时。 |
| AvatarMessageClientManager | 可进入 x-req | [模块拆分](./02-module-breakdown.md#avatarmessageclientmanager) | 是 | Web 侧 Avatar REST/WS client、poller、ack 和 action 分发。 |
| AvatarProfileBackend | 可进入 x-req | [模块拆分](./02-module-breakdown.md#avatarprofilebackend) | 是 | 在现有 AvatarManager 门户下补 Pet profile 读写。 |
| RailSurfaceManager | 可进入 x-req | [模块拆分](./02-module-breakdown.md#railsurfacemanager) | 是 | 左侧 rail route、页面内 fixed rail 和 Tauri overlay rail。 |
| PetSettingsManager | 可进入 x-req | [模块拆分](./02-module-breakdown.md#petsettingsmanager) | 是 | Pet 设置面板，合并后端 profile、host 状态、资源包和覆盖层。 |
| XSpaceNativeBridge | 方案确认 | [模块拆分](./02-module-breakdown.md#xspacenativebridge) | 是 | XSpace Rust 命令与 Web Host Adapter 的桌面实现合同。 |

## 文档导航

- [图集：总览 + 各模块局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

第一批进入 x-req：`host-surface-adapter-contract`、`avatar-web-runtime-route`、`avatar-message-web-client`、`rail-web-surface`、`pet-settings-surface`。`xspace-native-bridge-alignment` 与前四项并行准备，集成阶段用同一套 route 和 command mapping 做 Windows smoke。
