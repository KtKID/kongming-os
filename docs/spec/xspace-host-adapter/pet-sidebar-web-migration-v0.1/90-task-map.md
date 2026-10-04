# Task 映射

## Task 总览

| 顺序 | Task | 负责边界类 | 覆盖模块 | 依赖 | DoD | 风险 | 状态 | 备注 |
|------|------|------------|----------|------|-----|------|------|------|
| T1 | `host-surface-adapter-contract` | `HostSurfaceManager` | HostSurfaceManager | 无 | DoD#1 | 高 | 可进入 x-req | 先冻结 Web 基线/TauriHost contract、错误码和 import 边界。 |
| T2 | `avatar-asset-pack-migration` | `AvatarWebRuntimeManager` | AvatarWebRuntimeManager + PetSettingsManager | 无 | DoD#2、DoD#9 | 中 | 可进入 x-req | 复制 `web/public/avatar` 资源并加 manifest 加载测试。 |
| T3 | `avatar-message-web-client` | `AvatarMessageClientManager` | AvatarMessageClientManager | 无 | DoD#3、DoD#5 | 中 | 可进入 x-req | 迁移 REST client、poller、display controller 和 preset 选择。 |
| T4 | `avatar-profile-api` | `AvatarManager` | AvatarProfileBackend | 无 | DoD#7 | 中 | 可进入 x-req | 新增 profile get/patch，保持 AvatarManager 单门户。 |
| T5 | `avatar-web-runtime-route` | `AvatarWebRuntimeManager` | AvatarWebRuntimeManager | T1 + T2 + T3 | DoD#2、DoD#3、DoD#5 | 中 | 可进入 x-req | 实现 `/-/xspace/pet`，先跑通 Web 基线 surface。 |
| T6 | `avatar-approval-action-web` | `AvatarWebRuntimeManager` | AvatarWebRuntimeManager + AvatarMessageClientManager | T3 + T5 | DoD#4 | 中 | 可进入 x-req | 三态 approval action 和 consumed ack。 |
| T7 | `rail-web-surface` | `RailSurfaceManager` | RailSurfaceManager | T1 + T2 | DoD#6 | 中 | 可进入 x-req | 实现 `/-/xspace/rail` 和页面内 fixed rail。 |
| T8 | `pet-settings-surface` | `PetSettingsManager` | PetSettingsManager | T1 + T2 + T4 | DoD#7 | 中 | 可进入 x-req | 实现 Pet 设置 snapshot 与操作按钮。 |
| T9 | `xspace-native-bridge-alignment` | `TauriHost` | XSpaceNativeBridge | T1 + T5 + T7 | DoD#8 | 高 | 可进入 x-req | XSpace 侧路由和 command mapping 对齐。 |
| T10 | `pet-rail-cross-host-smoke` | 全链路 | 全部模块 | T1-T9 | DoD#10 | 高 | 可进入 x-req | 浏览器 + Tauri Windows smoke。 |

## 推荐开发顺序

1. `host-surface-adapter-contract`
2. `avatar-asset-pack-migration`
3. `avatar-message-web-client`
4. `avatar-profile-api`
5. `avatar-web-runtime-route`
6. `avatar-approval-action-web`
7. `rail-web-surface`
8. `pet-settings-surface`
9. `xspace-native-bridge-alignment`
10. `pet-rail-cross-host-smoke`

## 并行策略

- T1、T2、T3、T4 可并行准备，写入范围分离。
- T5 等 T1-T3 完成后进入，先跑通 Web 基线 surface。
- T7 可在 T1-T2 后并行开发。
- T8 等 T1、T2、T4 完成后进入。
- T9 需要 TauriHost contract 和 Web routes 稳定后进入。
- T10 只做集成验收。

## PoC 建议

| PoC | 目标 | 触发 task | 成功信号 |
|-----|------|-----------|----------|
| Web Pet PoC | 验证 `/-/xspace/pet` 在 Web 基线路径加载资源、调用 API client mock。 | T5 | manifest 加载成功，Pet bubble 可展示 fixture。 |
| TauriHost surface PoC | 验证 `openSurface(pet)` 与现有 Avatar window command mapping。 | T9 | 透明窗口加载 Kongming route，status/viewMode 可读写。 |
| Rail overlay PoC | 验证 `/-/xspace/rail` 在 child WebView 热区展开和收起。 | T7 + T9 | hotzone 常态 8px，hover 展开稳定。 |
| Profile split PoC | 验证 Pet profile 与 host window status 分离。 | T4 + T8 | profile 修改不写 Tauri bounds，host move 不改 profile。 |

## 验证命令清单

```powershell
uv run pytest tests/unit/web/test_avatar_message_router.py -v
uv run pytest tests/unit/web/test_avatar_profile_router.py -v

cd web
npm run test:unit -- avatar-message
npm run test:unit -- avatar-runtime
npm run test:unit -- rail
npm run test:unit -- pet-settings
npm run build
```

XSpace 对齐 task 追加：

```powershell
cd E:\xgt\proj\x-space\client\src-tauri
cargo test --lib avatar_overlay --target-dir target\codex-env-test
```

## 交付检查

| 检查项 | 对应 task |
|--------|-----------|
| 业务组件没有直接 import `@tauri-apps/api`。 | T1 |
| `web/public/avatar/packs/liuming/manifest.json` 和全部 action 文件存在。 | T2 |
| Avatar API client DTO 与 `src/hosts/web/routers/avatar.py` 保持一致。 | T3 |
| Pet profile 通过 AvatarManager 门户读写。 | T4 |
| `/-/xspace/pet` Web 基线 surface 可运行。 | T5 |
| 审批三态 action 只发送 `action` 合同。 | T6 |
| `/-/xspace/rail` 浏览器 fixed 模式可运行。 | T7 |
| Pet 设置 snapshot 明确 profile、hostStatus、manifest、overrides 来源。 | T8 |
| XSpace Tauri 透明 Pet window 和 rail overlay 加载 Kongming route。 | T9 |
| 浏览器 + Tauri 两种宿主 smoke 都通过。 | T10 |
