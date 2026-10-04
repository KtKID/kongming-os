# 验证策略与演进

## 验证策略

### Smoke / E2E 验收入口

- **Smoke 路径**：启动 Kongming Web → 登录 → 打开 `/-/xspace/mobile/connect` → 创建二维码 → 用测试 client 调 claim/approve/exchange → 打开 `web_session_url` → 断言 cookie 和跳转。
- **E2E 路径**：Web UI 创建二维码和批准设备，API client 模拟 Android 完整扫码链路，最后验证吊销后的 `device_revoked`。
- **进入 x-req 的规则**：x-req README 必须列出合同 fixture、TestClient 路由测试、React 页面测试和一条跨前后端 smoke。

### 单元测试

- **覆盖模块**：MobilePairingManager、MobilePairingRepository、MobileDeviceTokenService。
- **框架**：pytest。
- **重点场景**：过期、nonce mismatch、重复 claim、拒绝授权、exchange 前等待、handoff 单次消费、吊销后 token 失效。

### 集成测试

- **端到端链路**：FastAPI `TestClient` 真实命中全部 `/api/xspace/mobile/*` 端点和 `/-/xspace/mobile/session/consume`。
- **环境要求**：tmp `kongming_home`、测试 serializer、假 ThreadManager。
- **触发方式**：`uv run pytest tests/unit/web/test_xspace_mobile_pairing_router.py -v`，跨模块 smoke 可放 `tests/integration/web/test_xspace_mobile_pairing_e2e.py`。

### 前端真实交互测试

- `MobilePairingConnectPage` 展示二维码、复制链接、过期状态、待授权设备、批准/拒绝按钮。
- API 返回空 claim、过期、已 claim、拒绝授权时页面状态可见。
- fallback pair 页面能展示 server、pairing_id、打开 XSpace 按钮和复制内容。

### 手动验证

- 用浏览器打开 connect 页，确认二维码可被 Android 测试工具识别。
- 用真实 Android XSpace 扫码，完成 claim、桌面批准、WebView 登录、吊销后重连失败。
- packaged XSpace 启动本地 Kongming 后打开 `{instance.url}/-/xspace/mobile/connect`，确认当前本地运行路径可用。

## 测试覆盖要求

| 模块 | 最低覆盖 | 重点文件 |
|------|---------|---------|
| MobilePairingManager | 状态机全分支 | `tests/unit/web/test_xspace_mobile_pairing_manager.py` |
| MobilePairingRepository | 持久化与并发边界 | `tests/unit/web/test_xspace_mobile_pairing_repository.py` |
| MobileDeviceTokenService | token/handoff 安全边界 | `tests/unit/web/test_xspace_mobile_token_service.py` |
| MobilePairingRouter | REST 合同和错误码 | `tests/unit/web/test_xspace_mobile_pairing_router.py` |
| MobilePairingWebPage | 用户可见状态 | `web/src/modules/xspace-mobile-pairing/__tests__/*.test.tsx` |

## 协议漂移测试

- 建立 `tests/fixtures/xspace_mobile_pairing/`，保存 capabilities/create/claim/approve/exchange/session-handoff/devices 的 JSON fixture。
- 前端 TS 类型测试或 vitest fixture 校验读取同一组字段。
- DTO 字段增删必须同时更新 XSpace 合同和 Kongming fixture。
- 错误码表必须覆盖 HTTP status、`error.code`、`retryable`。

## 演进路线

### 短期（本轮 task）

- [ ] 后端 Manager + Repository + TokenService。
- [ ] REST router + 错误码 + TestClient 合同测试。
- [ ] Web connect/pair 页面 + 前端测试。
- [ ] P0 API client smoke 模拟 Android。

### 中期（下 1-2 轮）

- [ ] 全局 inbox fan-out 推送 pending claim，替代页面轮询。
- [ ] 设备管理页展示授权历史和吊销入口。
- [ ] 审计日志查询和导出。

### 长期（方向性）

- [ ] 移动端处理审批的 scope 收敛和安全策略。
- [ ] 多设备命名、最近使用、风险提示。
- [ ] 多用户/远程部署账号体系接入。
