# 验证策略与演进

## 验证策略

| 层级 | 覆盖点 | 建议命令 / 方式 |
|------|--------|-----------------|
| 后端 profile API | `GET/PATCH /api/avatar/v1/profile`、默认值、字段校验、持久化 | `uv run pytest tests/unit/web/test_avatar_profile_router.py -v` |
| 后端 Avatar 现有合同 | capabilities、messages、ack、approval resolve、chat accepted | `uv run pytest tests/unit/web/test_avatar_message_router.py -v` |
| 前端 HostAdapter | Web 基线/TauriHost capability、surface lifecycle、error mapping、import 边界 | `cd web; npm run test:unit -- HostSurfaceManager` |
| 前端 Avatar client | list/ack/resolve/chat/preset 选择、错误码映射 | `cd web; npm run test:unit -- avatar-message` |
| 前端 Pet runtime | manifest 加载、action 选择、approval bubble、Pet input、viewMode 同步 | `cd web; npm run test:unit -- avatar-runtime` |
| 前端 rail | hover/focus 展开、Pet icon、settings route、Web fixed 模式 | `cd web; npm run test:unit -- rail` |
| 前端设置 | profile + host status + manifest + overrides snapshot | `cd web; npm run test:unit -- pet-settings` |
| 构建 | TS 类型、Vite 静态资源、public avatar 路径 | `cd web; npm run build` |
| XSpace Rust | pet window、rail overlay、command mapping、viewMode、bounds | `cd client/src-tauri; cargo test --lib avatar_overlay --target-dir target\\codex-env-test` |
| 跨宿主 smoke | 浏览器页面内 Pet/rail + Tauri desktop-window/overlay | Playwright + `build_agent_space --debug` Windows smoke |

## 必测场景

1. 浏览器打开 `/chat` 后，HostSurfaceManager capabilities 返回 `mode=web`。
2. 浏览器打开 `/-/xspace/pet`，Pet 以页面内 floating 模式加载默认资源包。
3. TauriHost 打开 `/-/xspace/pet`，透明桌面窗口加载同一 Pet route。
4. TauriHost 调用 `setPetViewMode("expanded")` 后窗口尺寸变化，Pet anchor 保持稳定。
5. Pet runtime 拉取 active approval 消息，展示审批气泡和倒计时。
6. 用户点击 `accept_for_session` 后，前端只发送三态 `action` 合同。
7. Pet 输入框发送文本，首发携带 `presetId`、`message`、`client`。
8. 浏览器打开 `/-/xspace/rail`，hover 展开并显示 Pet 图标。
9. Tauri rail overlay 调用展开/收起时，不遮挡主 WebView 常态点击。
10. Pet 设置面板展示 profile、host status、manifest 和 actions。
11. 清除 debug overrides 后，pack/background 回到 profile 默认值。
12. import 边界检查确认业务组件只依赖 `HostSurfaceManager` 门户。

## 风险与处理

| 风险 | 等级 | 处理 |
|------|------|------|
| Web route 与 Tauri WebviewUrl 历史路由冲突 | 高 | 首版固定 `/-/xspace/*`，XSpace WebviewUrl 直接加载 route；打包 smoke 验证 SPA fallback。 |
| ProductState 与 HostWindowState 混写 | 高 | Pet profile 存 Kongming，桌面 bounds 存 Tauri Host；设置 snapshot 明确来源。 |
| Tauri command 散落进业务组件 | 高 | `@tauri-apps/api` import 边界测试，只允许 `TauriHost`。 |
| Pet runtime 组件体量过大 | 中 | 先抽 `AvatarWebRuntimeManager`、message client、presentational components，再迁 UI。 |
| preset 选择策略漂移 | 中 | 前端测试覆盖 model families 优先、presets fallback、空列表错误。 |
| rail overlay z-order 影响主 WebView | 中 | hotzone 默认 8px，展开只在 hover/focus，Windows smoke 覆盖点击。 |
| 资源包路径遗漏 | 中 | build 测试读取 `/avatar/packs/liuming/manifest.json` 和全部 action 文件。 |

## 演进路线

### 第一批：可进入 x-req

- HostSurfaceManager contract。
- AvatarMessageClientManager Web client。
- AvatarProfileBackend profile API。
- Avatar assets 迁移。
- Pet route runtime。
- Rail route surface。
- Pet settings surface。
- XSpace NativeBridge command mapping。

### 第二批：产品状态收敛

- `AvatarManager` profile API 和 repository。
- Pet profile 与 Web manage/config 导航整合。
- Web 基线页面内 Pet 开关和持久配置同步。

### 第三批：桌面体验增强

- 通用 `host_surface_*` Rust command。
- surface lifecycle event 双向通知。
- Pet notification、tray、screen boundary 和点击穿透精细控制。

### 第四批：资源与人格

- 资源包选择器。
- 自定义资源导入。
- Pet 长期人格配置。
- 语音/TTS。

## 进入 x-req 条件

当前 spec 的 P0 模块可进入 x-req。建议首个 task 包命名为 `xspace-pet-sidebar-web-migration`，按 `90-task-map.md` 的 T1 到 T8 顺序推进。XSpace NativeBridge 涉及跨仓库改动，task 描述需要明确目标 repo 和验证命令。
