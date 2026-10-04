# 模块设计、接口与数据结构

## 调研依据

| 来源 | 当前结论 | 迁移用途 |
|------|----------|----------|
| `E:/xgt/proj/x-space/docs/v1/Host-Adapter-架构边界.md` | Web Product App 承接产品 UI，Host Adapter 承接宿主能力，Kongming backend 承接事实状态。 | 本 spec 的边界基准。 |
| `E:/xgt/proj/x-space/docs/avatar/pet-sidebar-settings/` | 已定义 rail、settings shell、pet settings store、manifest/actions 和 smoke 范围。 | 迁移模块清单和设置字段来源。 |
| `E:/xgt/proj/x-space/client/src/avatar/` | 已实现 Avatar runtime、资源包加载、message client、poller、display controller、ack controller 和 settings store。 | Web runtime 迁移源。 |
| `E:/xgt/proj/x-space/client/src/left-rail-overlay/` | 已实现主窗口左侧 overlay rail、展开/收起和 settings/mobile-connect 事件。 | Rail route 迁移源。 |
| `E:/xgt/proj/x-space/client/src-tauri/src/avatar_overlay.rs` | 已实现透明 Pet 窗口、位置、viewMode、show/hide/disable/move/status commands。 | TauriHost command mapping。 |
| `E:/xgt/proj/x-space/client/src-tauri/src/webview_manager.rs` | 已实现 left rail child WebView overlay 宽度控制。 | TauriHost rail overlay mapping。 |
| `src/hosts/web/avatar/*` + `src/hosts/web/routers/avatar.py` | Kongming 已有 AvatarManager、message registry、approval resolve 和 chat accepted REST 合同。 | 后端事实层复用与 profile 增量。 |
| `web/src/lib/router.tsx` + `web/src/lib/api.ts` | Kongming Web 现有 React Router、AuthGuard、同源 API 封装和测试体系。 | 新 route 和 client 的落点。 |

## 模块总览

| 模块 | 唯一边界类 | 优先级 | 职责 | 主要依赖 | 状态 | x-req |
|------|------------|--------|------|----------|------|------|
| HostSurfaceManager | `HostSurfaceManager` | P0 | Web 到基线 surface/TauriHost 增强的门户。 | Web 基线实现、`TauriHost` | 可进入 x-req | 是 |
| AvatarWebRuntimeManager | `AvatarWebRuntimeManager` | P0 | Pet route 的形象、动作、气泡、审批、输入和菜单运行时。 | HostSurfaceManager、AvatarMessageClientManager | 可进入 x-req | 是 |
| AvatarMessageClientManager | `AvatarMessageClientManager` | P0 | Web 侧 Avatar REST/WS client、poller、ack 和 action dispatch。 | `api.ts`、Avatar router | 可进入 x-req | 是 |
| AvatarProfileBackend | `AvatarManager` | P1 | 在现有 AvatarManager 门户下提供 Pet profile 读写和持久化。 | Avatar router、Web config store | 可进入 x-req | 是 |
| RailSurfaceManager | `RailSurfaceManager` | P0 | 左侧 rail route、hover/focus 状态、入口动作。 | HostSurfaceManager | 可进入 x-req | 是 |
| PetSettingsManager | `PetSettingsManager` | P1 | Pet 设置 snapshot、profile 保存、host status 和资源包展示。 | HostSurfaceManager、Avatar API | 可进入 x-req | 是 |
| XSpaceNativeBridge | `TauriHost` | P0 | Tauri command/webview manager 到 HostSurfaceManager 的实现。 | XSpace Rust commands | 方案确认 | 是 |

## HostSurfaceManager

**建议目录**：`web/src/host/` 或 `web/src/modules/xspace-host/`

**职责**：提供 Web 产品组件访问宿主能力的唯一 TypeScript 门户。业务组件调用 `HostSurfaceManager`，Web 基线 surface 直接运行在浏览器和 Tauri WebView 中，Tauri 环境再追加原生增强能力。

**包含范围**：
- capability 检测。
- `openSurface`、`updateSurface`、`closeSurface`、`focusRoute`。
- Pet host commands：`getPetStatus`、`showPet`、`hidePet`、`disablePetForSession`、`disablePetPersistently`、`movePet`、`setPetViewMode`。
- 通知、外链、文件选择等通用宿主能力预留。
- Host error code 映射。

**边界外**：
- Avatar 消息业务语义。
- Pet 动作资源解析。
- Tauri Rust 具体 command 实现。

**接口草案**：

```typescript
export type HostMode = "web" | "tauri";
export type SurfaceKind = "rail" | "pet" | "settings" | "mobile-connect";
export type SurfacePlacement = "inline" | "main-window" | "overlay" | "desktop-window" | "modal";

export interface HostCapabilities {
  mode: HostMode;
  desktopWindow: boolean;
  overlaySurface: boolean;
  notifications: boolean;
  filePicker: boolean;
  petWindowControls: boolean;
}

export interface SurfaceRequest {
  kind: SurfaceKind;
  route: string;
  placement: SurfacePlacement;
  params?: Record<string, string>;
}

export interface SurfaceHandle {
  surfaceId: string;
  kind: SurfaceKind;
  route: string;
  placement: SurfacePlacement;
  hostMode: HostMode;
}

export interface HostSurfaceManager {
  getCapabilities(): HostCapabilities;
  openSurface(request: SurfaceRequest): Promise<SurfaceHandle>;
  updateSurface(surfaceId: string, patch: Record<string, unknown>): Promise<SurfaceHandle>;
  closeSurface(surfaceId: string): Promise<void>;
  focusRoute(route: string, target?: "main" | "surface"): Promise<void>;
  getPetStatus(): Promise<PetHostStatus>;
  showPet(): Promise<PetHostStatus>;
  hidePet(): Promise<PetHostStatus>;
  disablePetForSession(): Promise<PetHostStatus>;
  disablePetPersistently(): Promise<PetHostStatus>;
  movePet(position: PetWindowPosition): Promise<PetHostStatus>;
  setPetViewMode(mode: "compact" | "expanded"): Promise<PetHostStatus | undefined>;
}
```

**复用标注**：`@tauri-apps/api` 已在 `web/package.json` 中存在；Web 基线实现基于普通 DOM route/fixed panel，TauriHost 只包装原生命令。

**风险等级**：高。它是迁移后的跨宿主边界，任何业务组件绕过它都会让架构继续分裂。

## AvatarWebRuntimeManager

**建议目录**：`web/src/modules/avatar-runtime/`

**职责**：承接 Pet route 的运行时状态，渲染资源包动作、气泡、审批按钮、右键菜单和输入框。

**包含范围**：
- `/-/xspace/pet` route。
- 资源包加载、动作选择、hitbox/canvas 计算。
- Message bubble、approval bubble、panel queue。
- Pet 输入框和 REST chat accepted 反馈。
- `compact/expanded` view mode 与 HostSurfaceManager 同步。
- 浏览器内 floating pet 与 Tauri desktop-window 两种布局。

**边界外**：
- 后端 Avatar 消息持久化。
- Tauri 窗口创建和 bounds。
- 资源编辑器。

**接口草案**：

```typescript
export type AvatarRuntimeMode = "loading" | "ready" | "dragging" | "busy" | "error";

export interface AvatarRuntimeSnapshot {
  mode: AvatarRuntimeMode;
  activeAction: AvatarActionName;
  bubble: AvatarBubbleSnapshot | null;
  panelMessages: AvatarDisplayMessage[];
  petInputDraft: string;
  hostStatus: PetHostStatus;
  pack: LoadedAvatarPack | null;
}

export interface AvatarWebRuntimeManager {
  load(): Promise<AvatarRuntimeSnapshot>;
  startMessageRuntime(): Promise<void>;
  stopMessageRuntime(): void;
  submitPetMessage(text: string): Promise<AvatarRuntimeSnapshot>;
  resolveApproval(action: "accept_once" | "accept_for_session" | "reject"): Promise<AvatarRuntimeSnapshot>;
  dismissMessage(messageId: string): Promise<AvatarRuntimeSnapshot>;
  startDrag(): Promise<AvatarRuntimeSnapshot>;
}
```

**复用标注**：
- 迁移 `x-space/client/src/avatar/AvatarPocApp.tsx` 的 runtime 状态机。
- 迁移 `asset_pack.ts`、`types.ts`、`avatar.css`。
- 资源迁移到 `web/public/avatar/`。

**风险等级**：中。组件体量大，建议拆成 runtime manager、presentational components、hooks 三层。

## AvatarMessageClientManager

**建议目录**：`web/src/modules/avatar-message/`

**职责**：封装 Kongming Avatar REST/WS 合同，提供 capabilities、list、ack、approval resolve、chat、poller 和 display controller。

**包含范围**：
- `GET /api/avatar/v1/capabilities`
- `GET /api/avatar/v1/messages`
- `POST /api/avatar/v1/messages/{messageId}/ack`
- `POST /api/avatar/v1/messages/ack`
- `POST /api/avatar/v1/approvals/{requestId}/resolve`
- `POST /api/avatar/v1/chat`
- preset 选择策略：优先 `/api/model-providers/model-families` 的非空 `presetId`，回退 `/api/presets` 第一项 `id`。
- message classify、display queue、ack controller。

**边界外**：
- UI 呈现。
- 宿主窗口操作。

**接口草案**：

```typescript
export interface AvatarMessageClientManager {
  getCapabilities(): Promise<AvatarCapabilitiesDTO>;
  listMessages(query?: AvatarMessageListQuery): Promise<AvatarMessageListResponse>;
  ackMessage(messageId: string, input?: AvatarAckInput): Promise<AvatarBridgeMessageDTO>;
  ackMessages(input: AvatarBatchAckInput): Promise<AvatarBatchAckResponse>;
  resolveApproval(input: AvatarResolveApprovalInput): Promise<AvatarResolveApprovalResponse>;
  sendChat(input: AvatarChatInput): Promise<AvatarChatAcceptedDTO>;
  resolvePresetId(): Promise<string>;
}
```

**复用标注**：
- 迁移 `x-space/client/src/avatar/kongming_avatar_message_client.ts`。
- 桌面 native HTTP transport 可收敛为 `TauriHost` 内部能力；Web 同源路径走 `web/src/lib/api.ts`。
- 后端 route 已在 `src/hosts/web/routers/avatar.py` 存在。

**风险等级**：中。REST DTO 已稳定，主要风险来自前端 preset 选择和 auth/session cookie。

## AvatarProfileBackend

**边界类**：`AvatarManager`

**建议目录**：`src/hosts/web/avatar/`

**职责**：在现有 Avatar 后端门户下补齐 Pet profile 的读取、保存、默认值和持久化，让跨宿主产品配置归 Kongming backend。

**包含范围**：
- `GET /api/avatar/v1/profile`
- `PATCH /api/avatar/v1/profile`
- 默认 profile 生成。
- profile 持久化。
- 字段校验和稳定错误码。

**边界外**：
- Host window bounds、viewMode、置顶和点击穿透。
- 资源包文件上传。
- Pet runtime UI。

**接口草案**：

```python
class AvatarManager:
    def get_profile(self) -> AvatarProfileSnapshot: ...
    def update_profile(self, patch: AvatarProfilePatch) -> AvatarProfileSnapshot: ...
```

```typescript
export interface AvatarProfileClient {
  getProfile(): Promise<PetProfile>;
  updateProfile(patch: Partial<PetProfile>): Promise<PetProfile>;
}
```

**复用标注**：
- 保持 `AvatarManager` 作为后端 Avatar 门户。
- Repository 可用 JSON 文件首版落地，路径建议 `<kongming_home>/web/avatar_profile.json`。
- Router 挂在现有 `src/hosts/web/routers/avatar.py`。

**风险等级**：中。需要把旧 XSpace `AvatarConfig.enabled` 拆为产品 profile 字段，同时把窗口位置留在 HostWindowState。

## RailSurfaceManager

**建议目录**：`web/src/modules/xspace-surfaces/rail/`

**职责**：管理左侧 rail 的 hover/focus 展开、入口按钮、浏览器 fixed 布局和 Tauri overlay 布局。

**包含范围**：
- `/-/xspace/rail` route。
- 页面内 fixed rail。
- Tauri overlay rail 展开/收起。
- Pet 图标入口：打开 Pet 设置或显示 Pet。
- Mobile connect 入口保留为 surface action。

**边界外**：
- Thread sidebar。
- Pet runtime 内部状态。
- Mobile connect 业务协议。

**接口草案**：

```typescript
export type RailVisibility = "hidden" | "open";

export interface RailSurfaceSnapshot {
  visibility: RailVisibility;
  activeIconUrl: string;
  hostMode: HostMode;
  closeDelayMs: number;
}

export interface RailSurfaceManager {
  snapshot(): RailSurfaceSnapshot;
  pointerEnter(): Promise<RailSurfaceSnapshot>;
  pointerLeave(): Promise<RailSurfaceSnapshot>;
  focus(): Promise<RailSurfaceSnapshot>;
  blur(): Promise<RailSurfaceSnapshot>;
  openPetSettings(): Promise<void>;
  openPetSurface(): Promise<void>;
  openMobileConnect(): Promise<void>;
}
```

**复用标注**：
- 迁移 `x-space/client/src/left-rail-overlay/LeftRailOverlayApp.tsx`。
- `reveal_left_sidebar_layer` 和 `collapse_left_sidebar_layer` 作为 TauriHost 内部映射。

**风险等级**：中。Tauri child WebView z-order 和主窗口 WebView 点击区域需要 smoke。

## PetSettingsManager

**建议目录**：`web/src/modules/xspace-surfaces/pet-settings/`

**职责**：聚合 Pet profile、host 窗口状态、资源包 manifest、actions、debug overrides，渲染 Pet 设置面板。

**包含范围**：
- Pet profile 读取/保存。
- Host pet status 读取和命令操作。
- manifest/actions 只读展示。
- pack/background 默认值与 localStorage/query 覆盖展示。
- 显示、隐藏、本次禁用、持久禁用、清除覆盖。

**边界外**：
- 资源包编辑。
- 动作字段编辑。
- 远程同步。

**接口草案**：

```typescript
export interface PetProfile {
  enabled: boolean;
  packRoot: string;
  backgroundUrl: string;
  bubbleAutoHideMs: number;
  inputMaxLength: number;
}

export interface PetSettingsSnapshot {
  loading: boolean;
  error?: string;
  profile: PetProfile;
  hostStatus: PetHostStatus;
  manifest: AvatarPackManifest | null;
  overrides: AvatarDebugOverrides;
}

export interface PetSettingsManager {
  load(): Promise<PetSettingsSnapshot>;
  saveProfile(patch: Partial<PetProfile>): Promise<PetSettingsSnapshot>;
  showPet(): Promise<PetSettingsSnapshot>;
  hidePet(): Promise<PetSettingsSnapshot>;
  disableForSession(): Promise<PetSettingsSnapshot>;
  disablePersistently(): Promise<PetSettingsSnapshot>;
  clearDebugOverrides(): Promise<PetSettingsSnapshot>;
}
```

**后端增量**：
- 在现有 `AvatarManager` 门户下新增 profile 方法。
- 建议 route：`GET /api/avatar/v1/profile`、`PATCH /api/avatar/v1/profile`。
- 建议存储：`<kongming_home>/web/avatar_profile.json` 或复用现有 Web config store。

**风险等级**：中。首版要拆清楚 ProductState 和 HostWindowState，避免把桌面位置写入跨宿主 profile。

## XSpaceNativeBridge

**边界类**：`TauriHost`（Web 侧）+ XSpace Rust command/webview manager（宿主侧）

**职责**：让 XSpace Tauri Host 成为 Host Adapter 的桌面实现，继续管理透明 Pet window、主窗口 rail overlay 和 sidecar 本地 API 地址。

**包含范围**：
- `TauriHost.openSurface({ kind: "pet", placement: "desktop-window" })` 映射到透明窗口加载 `/-/xspace/pet`。
- `TauriHost.openSurface({ kind: "rail", placement: "overlay" })` 映射到 child WebView 加载 `/-/xspace/rail`。
- Pet status/commands 映射到现有 Avatar overlay commands。
- Avatar REST 访问优先使用 Web 同源 API；需要 native HTTP 时由 TauriHost 内部 transport 处理。
- `setPetViewMode` 映射 `set_avatar_overlay_view_mode`。

**现有 command mapping**：

| HostSurfaceManager 方法 | XSpace command / Rust 能力 |
|-------------------------|----------------------------|
| `getPetStatus()` | `get_avatar_overlay_status` |
| `showPet()` | `show_avatar_overlay` |
| `hidePet()` | `hide_avatar_overlay` |
| `disablePetForSession()` | `disable_avatar_overlay_for_session` |
| `disablePetPersistently()` | `disable_avatar_overlay_persistently` |
| `movePet(position)` | `move_avatar_overlay` |
| `setPetViewMode(mode)` | `set_avatar_overlay_view_mode` |
| `openSurface(rail)` | `reveal_left_sidebar_layer` + rail route child WebView |
| `closeSurface(rail)` | `collapse_left_sidebar_layer` |

**风险等级**：高。跨仓库合同变更需要 XSpace 与 Kongming 同步测试。

## 文件迁移建议

| 来源 | 目标 |
|------|------|
| `x-space/client/public/avatar/` | `kongming-agent/web/public/avatar/` |
| `x-space/client/src/avatar/asset_pack.ts` | `web/src/modules/avatar-runtime/assets/AvatarAssetManager.ts` |
| `x-space/client/src/avatar/types.ts` | `web/src/modules/avatar-runtime/types.ts` |
| `x-space/client/src/avatar/AvatarPocApp.tsx` | `web/src/modules/avatar-runtime/AvatarPetRoute.tsx` + runtime manager |
| `x-space/client/src/avatar/*message*` | `web/src/modules/avatar-message/` |
| `x-space/client/src/left-rail-overlay/` | `web/src/modules/xspace-surfaces/rail/` |
| `x-space/client/src/settings/pet/index.tsx` | `web/src/modules/xspace-surfaces/pet-settings/` |
| `x-space/client/src/avatar/settings_store.ts` | `web/src/modules/xspace-surfaces/pet-settings/PetSettingsManager.ts` |

## 图引用

模块依赖和 command mapping 见 [diagrams.md](./diagrams.md)。
