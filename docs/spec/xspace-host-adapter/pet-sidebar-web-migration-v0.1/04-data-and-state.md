# 数据模型与状态

本文件记录状态归属、持久化和关键 DTO。状态图见 [diagrams.md](./diagrams.md)。

## 状态归属

| 状态类型 | 归属 | 说明 |
|----------|------|------|
| AvatarMessageState | Kongming backend | 消息、审批提醒、ack/consumed、dedupe、cursor 和 TTL，已有 `<kongming_home>/web/avatar_messages.db`。 |
| AvatarChatState | Kongming backend | `generic_chat` thread、preset、run task、accepted run id 和 websocketUrl。 |
| PetProfile | Kongming backend | Pet 是否启用、资源包、背景、气泡时长、输入长度等跨宿主产品配置。 |
| PetRuntimeUIState | Web Product App | 当前 action、气泡、输入框、panel queue、hover、dragging、loading/error。 |
| RailUIState | Web Product App | rail 展开状态、active icon、close delay、focused 状态。 |
| HostSurfaceState | Host Adapter | surfaceId、kind、placement、hostMode、route、lifecycle。 |
| HostWindowState | XSpace Tauri Host | 透明窗口、置顶、bounds、viewMode、点击穿透、显示器、主窗口 overlay 宽度。 |
| SidecarLifecycleState | XSpace Tauri Host | packaged backend 启动、ready、health、port、shutdown 和诊断路径。 |
| AvatarAssetPack | Web static assets | `web/public/avatar/packs/<id>/manifest.json` 和 action 素材。 |
| DebugOverrides | Web localStorage/query | pack/background 调试覆盖，只影响当前浏览器或 WebView。 |

## 持久化策略

| 数据 | 持久化位置 | 写入者 | 生命周期 |
|------|------------|--------|----------|
| Avatar 消息队列 | `<kongming_home>/web/avatar_messages.db` | `AvatarMessageRepository` | 跨重启。 |
| Pet profile | `<kongming_home>/web/avatar_profile.json` 或 Web config store | `AvatarManager` profile 方法 | 跨宿主、跨重启。 |
| Pet desktop position | XSpace app data `avatar/config.json` | `AvatarOverlayManager` | 当前桌面宿主跨重启。 |
| Pet viewMode | XSpace Tauri 内存态 | `AvatarOverlayManager` | 当前进程。 |
| Rail overlay visibility | XSpace Tauri child WebView bounds | `WebviewManager` | 当前进程。 |
| Avatar assets | `web/public/avatar/` | 构建资源 | 跟随 Web dist。 |
| pack/background debug override | localStorage/query | Web `AvatarAssetManager` | 本地调试。 |

## ProductState 与 HostWindowState 拆分

| 旧 XSpace 字段 | 迁移后归属 | 说明 |
|----------------|------------|------|
| `AvatarConfig.enabled` | PetProfile | 用户是否启用 Pet 是产品配置。 |
| `AvatarConfig.disabledForSession` | HostWindowState | 本次进程隐藏/禁用属于宿主运行态。 |
| `AvatarConfig.window.x` | HostWindowState | 桌面窗口位置属于当前宿主。 |
| `AvatarConfig.window.y` | HostWindowState | 桌面窗口位置属于当前宿主。 |
| `AvatarConfig.window.displayId` | HostWindowState | 显示器标识属于当前宿主。 |
| pack root | PetProfile + DebugOverrides | profile 是默认值，query/localStorage 是调试覆盖。 |
| background URL | PetProfile + DebugOverrides | profile 是默认值，query/localStorage 是调试覆盖。 |

## 核心 DTO

### Host Surface

```typescript
export interface SurfaceLifecycleEvent {
  surfaceId: string;
  kind: "rail" | "pet" | "settings" | "mobile-connect";
  event:
    | "mount"
    | "ready"
    | "focus"
    | "blur"
    | "boundsChanged"
    | "suspend"
    | "resume"
    | "close";
  route: string;
  placement: "inline" | "main-window" | "overlay" | "desktop-window" | "modal";
  hostMode: "web" | "tauri";
  atMs: number;
  detail?: Record<string, unknown>;
}
```

### Pet Host Status

```typescript
export interface PetWindowPosition {
  x: number;
  y: number;
  displayId?: string;
}

export interface PetHostStatus {
  enabled: boolean;
  visible: boolean;
  viewMode: "compact" | "expanded";
  reason?: "hidden" | "session_disabled" | "persistent_disabled" | "main_window_closed" | string;
  position: PetWindowPosition;
}
```

### Pet Profile

```typescript
export interface PetProfile {
  enabled: boolean;
  packRoot: string;
  backgroundUrl: string;
  bubbleAutoHideMs: number;
  approvalBubbleAutoHideMs: number;
  inputMaxLength: number;
  updatedAt: string;
}
```

默认值建议：

| 字段 | 默认值 |
|------|--------|
| `enabled` | `true` |
| `packRoot` | `/avatar/packs/liuming/` |
| `backgroundUrl` | `/avatar/backgrounds/undersea.svg` |
| `bubbleAutoHideMs` | `10000` |
| `approvalBubbleAutoHideMs` | `0`，由审批截止时间决定 |
| `inputMaxLength` | `800` |

### Pet Settings Snapshot

```typescript
export interface PetSettingsSnapshot {
  profile: PetProfile;
  hostStatus: PetHostStatus;
  assets: {
    packRoot: string;
    backgroundUrl: string;
    defaultPackRoot: string;
    defaultBackgroundUrl: string;
  };
  manifest: AvatarPackManifest | null;
  overrides: {
    queryPackRoot?: string;
    queryBackgroundUrl?: string;
    localStoragePackRoot?: string;
    localStorageBackgroundUrl?: string;
  };
}
```

### Avatar Chat Request

现有 Kongming REST DTO 继续作为事实合同：

```typescript
export interface AvatarChatRequestBody {
  threadId?: string | null;
  presetId?: string | null;
  cwd?: string | null;
  message: {
    text: string;
    reasoningEffort?: "low" | "medium" | "high" | null;
    attachments?: unknown[] | null;
    metadata?: Record<string, unknown> | null;
  };
  client: {
    deviceId?: string | null;
    clientMessageId: string;
    capabilities: Record<string, boolean>;
  };
}
```

## 状态流转说明

### Surface

Surface 由 `openSurface` 创建，route 完成初始化后进入 `ready`。用户聚焦进入 `focus`，失焦进入 `blur`。窗口隐藏进入 `suspend`，重新显示进入 `resume`。关闭时进入 `close` 并释放宿主资源。

### Pet Runtime

Pet runtime 从 `loading` 进入 `ready`。资源、API 或 host command 失败进入 `error`，用户重试后回到 `loading`。拖拽开始进入 `dragging`，保存位置后回到 `ready`。消息发送和审批回写期间进入 `busy`。

### Rail

Rail 常态为 `hidden`。pointer/focus 进入后变为 `open`。pointer leave 并完成延迟后回到 `hidden`。打开 settings/pet surface 时保留最近入口，便于关闭后恢复焦点。

## 数据漂移检查

- `AvatarCapabilities.avatarChat` 与前端输入框可用状态保持一致。
- `PetProfile.packRoot` 指向的 manifest 可成功加载。
- `HostCapabilities.petWindowControls` 与 Pet 设置中显示/隐藏/拖拽按钮保持一致。
- `AvatarMessageStatus` 生命周期只在后端推进，前端只通过 ack API 表达意图。
