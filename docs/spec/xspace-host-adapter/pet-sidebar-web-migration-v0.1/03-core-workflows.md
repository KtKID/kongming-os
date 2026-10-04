# 核心流程

流程图集中在 [diagrams.md](./diagrams.md)。本文件记录链路事实和异常处理。

## Pet Surface 启动

1. Web 基线路径：用户进入 Kongming Web，`Layout` 或 rail 调用 `HostSurfaceManager.openSurface({ kind: "pet", route: "/-/xspace/pet", placement: "inline" })`，页面内 floating Pet 挂载。
2. Tauri 增强路径：XSpace Tauri 调用 `openSurface({ kind: "pet", route: "/-/xspace/pet", placement: "desktop-window" })`，透明桌面窗口加载同一路由。
3. `AvatarWebRuntimeManager.load()` 并行读取 Host pet status、Avatar profile、resource pack manifest 和 capabilities。
4. Runtime 按 manifest defaults 选择初始 action，按 host capability 决定拖拽、置顶、窗口命令和输入框可用状态。

## Avatar 消息展示

1. `AvatarMessageClientManager.getCapabilities()` 确认 message registry、REST list、REST ack、chat 能力。
2. Poller 调用 `GET /api/avatar/v1/messages?status=active&limit=N`。
3. Display controller 对消息分类为 blocking、toast、panel。
4. Pet bubble 展示当前消息；展示成功后按策略写 `acked` 或保留 active。
5. 用户点击、关闭或自动隐藏后调用 `POST /api/avatar/v1/messages/{messageId}/ack`，目标状态为 `consumed`。
6. ack 成功后从当前展示队列移除。

## 审批气泡处理

1. Kongming `AvatarApprovalSink` 在 ApprovalManager pending 时注册 `source=approval` 消息。
2. Pet runtime 拉到消息后解析 `threadId`、`requestId`、`callId` 和倒计时 metadata。
3. 气泡展示三态动作：`reject`、`accept_once`、`accept_for_session`。
4. 用户点击后调用 `POST /api/avatar/v1/approvals/{requestId}/resolve`，请求体只包含三态 `action`、thread/call/request/client 标识。
5. 后端 Avatar router 调用 ApprovalManager.resolve，并返回稳定结果。
6. Runtime 将该消息 consumed，进入 `done` action 或错误 action。

## Pet Chat

1. 用户在 Pet 输入框提交文本。
2. `AvatarMessageClientManager.resolvePresetId()` 优先读取 `/api/model-providers/model-families` 的 `presetId`，回退 `/api/presets` 第一项 `id`。
3. Client 调用 `POST /api/avatar/v1/chat`，请求体包含 `presetId`、`message.text`、`client.clientMessageId` 和 capabilities。
4. 后端 `AvatarAssistantManager` 创建或复用 `generic_chat` thread，后台启动 `bridge.run_once`。
5. REST 返回 accepted、threadId、runId、transport 和 websocketUrl。
6. Runtime 展示发送成功或失败气泡，后续回复继续走普通 thread/status 和 Avatar message 通道。

## Rail Surface

1. Web 基线渲染页面内 fixed rail，hover/focus 后展开。
2. TauriHost 创建或复用 child WebView overlay，加载同一个 `/-/xspace/rail` route。
3. Rail hover/focus 调用 `HostSurfaceManager.updateSurface(surfaceId, { visibility: "open" })`。
4. Rail pointer leave 调用 `updateSurface(..., { visibility: "hidden" })`。
5. Pet icon 点击调用 `openSurface({ kind: "settings", route: "/-/settings/pet", placement: "modal" })` 或 `focusRoute("/manage/config/pet")`。
6. Rail 需要显示 Pet 时调用 `openSurface({ kind: "pet", route: "/-/xspace/pet", placement: "desktop-window" })`。

## Pet 设置加载

1. `PetSettingsManager.load()` 读取 `GET /api/avatar/v1/profile`。
2. 同时读取 `HostSurfaceManager.getPetStatus()`。
3. 根据 profile 的 pack/background 解析 manifest 和 action URL。
4. 读取 query/localStorage 覆盖，并在 UI 中标明来源。
5. 用户保存 product profile 时调用 `PATCH /api/avatar/v1/profile`。
6. 用户执行 host window 操作时调用 HostSurfaceManager 的 Pet commands。

## 错误处理

| 错误 | UI 行为 | 日志字段 |
|------|---------|----------|
| `CAPABILITY_UNAVAILABLE` | 隐藏桌面增强按钮，保留页面内 Pet/rail。 | `hostMode`、`capability`、`surfaceId` |
| `BACKEND_UNAVAILABLE` | Pet 显示连接失败气泡，rail 保持可打开设置。 | `baseUrl`、`route`、`elapsedMs` |
| `avatar_preset_required` | Pet 输入框提示先配置模型 preset。 | `clientMessageId`、`threadId` |
| `avatar_approval_not_found` | 审批气泡切换为过期/已处理状态。 | `requestId`、`action` |
| manifest 加载失败 | 使用 fallback action 或显示资源错误气泡。 | `packRoot`、`manifestUrl` |

## 待确认流程

Pet 设置入口路径首版默认 `/-/settings/pet`，实现阶段可根据现有 `ManagePage` 导航改为 `/manage/config/pet`。这只影响 route 与导航测试，核心 Host Adapter 合同保持稳定。
