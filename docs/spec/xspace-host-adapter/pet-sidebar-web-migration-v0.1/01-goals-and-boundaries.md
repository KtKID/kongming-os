# 目标与完成标准

## 需求要点

| # | 需求要点 | 文档化目标 |
|---|----------|------------|
| 1 | 分析 XSpace Host Adapter 架构边界 | 以 `Web Product App + Host Adapter + Tauri Host + Kongming backend` 为迁移边界。 |
| 2 | 先做迁移方案 | 产出 x-spec 文档包，后续可拆 x-req 和开发清单。 |
| 3 | Pet 功能移入 Kongming | `/-/xspace/pet` 在 Kongming Web 渲染 Pet runtime，后端事实走 `/api/avatar/v1/*`。 |
| 4 | 侧边栏功能移入 Kongming | `/-/xspace/rail` 在 Kongming Web 渲染左侧 rail，浏览器固定显示，Tauri overlay 显示。 |
| 5 | XSpace 保留宿主能力 | 透明窗口、置顶、bounds、点击穿透、主窗口 child WebView overlay 和 sidecar ready 归 Tauri Host。 |
| 6 | 业务组件统一走 Host Adapter | Web 组件只依赖 `HostSurfaceManager`，Tauri command 名留在 `TauriHost` 内部。 |
| 7 | 复用现有 Avatar API | 消息 list/ack、审批 resolve、Pet chat 和 capabilities 复用 Kongming 现有后端合同。 |
| 8 | 有不确定项集中暴露 | 文档中标出待确认项和风险，进入 x-req 前一次性确认。 |

## 系统目标

这次迁移把 XSpace 已验证的 Pet/rail 产品能力沉到 Kongming Web，使浏览器访问和 Tauri 内嵌 WebView 共用同一套 React route、资源包、Avatar message client 和设置面板。Tauri Host 继续承担 OS 级能力，Host Adapter 形成 Web 到宿主的唯一通道。

## 成功标准

- 浏览器访问 Kongming Web 时，页面内 Pet 和 fixed rail 可用；Tauri WebView 复用同一 Web route 并启用桌面增强 capability。
- Tauri 加载同一份 Kongming Web dist 时，`/-/xspace/pet` 进入透明桌面窗口，`/-/xspace/rail` 进入主窗口左侧 overlay。
- Pet runtime 能展示 `/api/avatar/v1/messages` 的 active 消息，显示审批气泡并回写三态 `action`。
- Pet 输入框能通过 `/api/avatar/v1/chat` 创建或复用 `generic_chat` thread，并返回 accepted 响应。
- Pet 设置面板能读取 Kongming profile、host 窗口状态、资源包 manifest 和 localStorage/debug 覆盖。
- 业务组件源码中没有散落的 Tauri `invoke` 调用；Tauri 调用集中在 `TauriHost`。
- 资源包路径在 Kongming `web/public/avatar/` 下稳定可访问。

## 范围

### 包含范围

- Web route：`/-/xspace/pet`、`/-/xspace/rail`、Pet 设置入口。
- Web 模块：Host adapter、Pet runtime、Avatar API client、rail surface、Pet settings。
- 后端增量：Avatar profile/settings API，挂在现有 `AvatarManager` 门户下。
- 资源迁移：`avatar/backgrounds`、`avatar/packs/liuming` 和 manifest/actions。
- XSpace 对齐：现有 `AvatarOverlayManager`、`WebviewManager`、`commands/instance.rs` command 映射到 TauriHost。
- 测试：后端 router/manager 测试、前端组件/store 测试、HostAdapter mock 测试、跨前后端 smoke。

### 边界外

- XSpace sidecar 生命周期重构。
- 新移动连接协议。
- 资源包编辑器和素材管理后台。
- Pet voice/TTS。
- 公开插件市场或第三方资源下载。

## 关键约束

- `src/core/` 保持宿主无关，Avatar/Pet Web 能力归 `src/hosts/web/avatar` 与 `web/src/`。
- 后端 Avatar 事实层继续以 `AvatarManager` 为业务门户；新增 profile/settings 能力通过该门户收口。
- 前端新模块门户使用 `*Manager` 命名，模块外只 import 门户或 `index.ts` 导出。
- `@tauri-apps/api` 只允许在 `TauriHost` 实现内出现。
- Web 基线 surface 行为必须直接可用，浏览器访问和 Tauri WebView 都共享这套基线。
- 桌面窗口位置、置顶、透明、点击穿透、WebView bounds 属于 HostWindowState。
- Pet profile、资源选择、行为偏好属于 Kongming backend ProductState。
- 迁移验证必须写成 pytest/vitest/Playwright 测试文件。

## DoD

| DoD | 完成标准 | 验收方式 |
|-----|----------|----------|
| DoD#1 | `HostSurfaceManager` 暴露 capability、surface lifecycle、route focus 和 Pet host commands。 | Vitest mock + import 边界测试。 |
| DoD#2 | `/-/xspace/pet` route 渲染 Pet runtime，加载迁移后的资源包。 | Vitest 组件测试 + Playwright smoke。 |
| DoD#3 | Pet runtime 使用 Kongming Avatar API client 完成 list -> classify -> bubble -> ack。 | MSW/Vitest + FastAPI TestClient fixture。 |
| DoD#4 | 审批气泡三态动作调用 `/api/avatar/v1/approvals/{requestId}/resolve`。 | 前端 action 测试 + `test_avatar_message_router.py` 增量用例。 |
| DoD#5 | Pet 输入框调用 `/api/avatar/v1/chat`，缺 preset 时走 Web 侧 preset 选择策略。 | 前端 client 测试 + 后端 chat accepted 测试。 |
| DoD#6 | `/-/xspace/rail` route 支持浏览器 fixed rail 和 Tauri overlay rail。 | React 交互测试 + HostAdapter mock。 |
| DoD#7 | Pet 设置面板展示 profile、host status、manifest、actions、debug overrides。 | 后端 profile 测试 + Store 单测 + 组件测试。 |
| DoD#8 | XSpace TauriHost 能打开 pet desktop-window 和 rail overlay，command mapping 可追踪。 | XSpace Rust 单测 + Windows debug smoke。 |
| DoD#9 | `web/public/avatar/` 资源路径和 manifest 字段稳定。 | 前端资源加载测试 + build。 |
| DoD#10 | 浏览器和 Tauri 两种宿主路径都能运行同一套 Web 代码。 | Playwright 浏览器 smoke + XSpace Windows smoke。 |

## DoD 到模块追溯矩阵

| DoD | 需要模块 | 需要 task |
|-----|----------|-----------|
| DoD#1 | HostSurfaceManager | `host-surface-adapter-contract` |
| DoD#2 | AvatarWebRuntimeManager + HostSurfaceManager | `avatar-web-runtime-route` |
| DoD#3 | AvatarMessageClientManager + AvatarWebRuntimeManager | `avatar-message-web-client` |
| DoD#4 | AvatarMessageClientManager + AvatarWebRuntimeManager | `avatar-approval-action-web` |
| DoD#5 | AvatarMessageClientManager + AvatarWebRuntimeManager | `avatar-pet-chat-web` |
| DoD#6 | RailSurfaceManager + HostSurfaceManager | `rail-web-surface` |
| DoD#7 | PetSettingsManager + AvatarProfileBackend + HostSurfaceManager + AvatarMessageClientManager | `avatar-profile-api` + `pet-settings-surface` |
| DoD#8 | XSpaceNativeBridge + HostSurfaceManager | `xspace-native-bridge-alignment` |
| DoD#9 | AvatarWebRuntimeManager + PetSettingsManager | `avatar-asset-pack-migration` |
| DoD#10 | 全部模块 | `pet-rail-cross-host-smoke` |

## 模块到 DoD 反向追溯

| 模块 | 支撑 DoD | 对应 task |
|------|----------|-----------|
| HostSurfaceManager | DoD#1、DoD#2、DoD#6、DoD#7、DoD#8、DoD#10 | `host-surface-adapter-contract`、`xspace-native-bridge-alignment` |
| AvatarWebRuntimeManager | DoD#2、DoD#3、DoD#4、DoD#5、DoD#9、DoD#10 | `avatar-web-runtime-route`、`avatar-approval-action-web`、`avatar-pet-chat-web` |
| AvatarMessageClientManager | DoD#3、DoD#4、DoD#5、DoD#7 | `avatar-message-web-client` |
| AvatarProfileBackend | DoD#7、DoD#10 | `avatar-profile-api` |
| RailSurfaceManager | DoD#6、DoD#10 | `rail-web-surface` |
| PetSettingsManager | DoD#7、DoD#9、DoD#10 | `pet-settings-surface`、`avatar-asset-pack-migration` |
| XSpaceNativeBridge | DoD#8、DoD#10 | `xspace-native-bridge-alignment`、`pet-rail-cross-host-smoke` |

## 待确认项

| 项 | 默认方案 | 影响 |
|----|----------|------|
| Pet 设置入口最终路径 | 使用 `/-/settings/pet`，同时可在 `/manage/config/pet` 放入口 | 影响 router 和导航测试。 |
| Pet profile 首版字段 | `enabled`、`packRoot`、`backgroundUrl`、`bubbleAutoHideMs`、`inputMaxLength` | 影响后端 profile API 和设置表单。 |
| XSpace generic surface command 命名 | 首版 `TauriHost` 包装现有 command，后续沉淀 `host_surface_*` | 影响 XSpace Rust 改动范围。 |

## 图引用

模块依赖、核心流程和状态流转见 [diagrams.md](./diagrams.md)。
