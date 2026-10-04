# 目标与完成标准

## 需求要点

1. Kongming Web 生成 XSpace Android 可扫码的配对二维码和复制链接。
2. XSpace Android 扫码后能 claim 远程 Kongming 实例，并等待桌面 Web 用户确认。
3. Kongming Web 展示待授权手机设备，用户能批准或拒绝本次配对。
4. 批准后 Android 能换取 `device_token` 和一次性 `web_session_url`，打开 WebView 后进入已登录态。
5. Kongming Server 负责设备授权表、token 签发、handoff token 校验、设备吊销。
6. macOS / Windows 本地 packaged Kongming 的启动和 WebView 体验保持现有路径。
7. P0 验收要覆盖二维码、扫码 claim、桌面授权、token handoff、吊销后拒绝 handoff。

## 系统目标

该能力让移动端 XSpace 连接远程 Kongming 时沿用 Kongming 自身的用户身份和授权边界。长期 token、设备生命周期和审计由 Kongming Server 统一维护，Android 只保存实例地址和移动设备凭据。桌面用户在当前 Kongming Web 中完成授权，降低误扫和远程暴露风险。

## 完成目标（DoD）

- [ ] `GET /api/xspace/mobile/capabilities` 返回协议版本和能力开关。
- [ ] 已登录 Web 用户可创建 pairing session，响应包含 `qr_payload`、`copy_url`、`expires_at`。
- [ ] Android 可用 `pairing_id + nonce + device` claim session，服务端进入 `pending_approval`。
- [ ] Web 页面能看到待授权设备，并通过 approve API 批准或拒绝 claim。
- [ ] Android 在批准后 exchange 获得 `device_token`、实例信息和 `web_session_url`。
- [ ] `web_session_url` 消费一次后设置 `kongming_session` cookie，并跳转首页。
- [ ] 设备吊销后，使用原 `device_token` 请求 session handoff 返回 `device_revoked`。
- [ ] XSpace packaged Kongming 的现有启动、health、ready JSON 和 WebView URL 路径保持可用。

## 范围边界

**包含**：
- 后端配对会话、claim、approve、exchange、session handoff、devices list/delete。
- Web 连接手机页面和复制链接 fallback 页面。
- QR payload 和 copy URL 的合同生成。
- device token 与 handoff token 的签发、校验、过期、吊销。
- API 错误码和 XSpace Android 合同 fixture。

**范围外**：
- Android 相机权限、扫码识别、secure store 具体代码。
- push 通知和离线通知。
- 多账号、多租户、组织管理。
- 公开云部署域名、反代证书和账号注册流程。

## 关键约束

- 生产环境 `server` 只接受 HTTPS origin；开发环境只通过明确开关接受 HTTP loopback。
- `pairing_id` 建议 60 秒过期，最大 300 秒；`nonce` 至少 128 bit 随机。
- 二维码只包含配对句柄和 nonce，长期凭据只在 exchange 后返回给 claim 设备。
- handoff token 单次使用，建议 60 秒过期。
- Web session cookie 使用既有 `kongming_session`，并保持 `Secure`、`HttpOnly`、`SameSite=Lax` 策略。
- 创建、批准、设备列表、设备吊销属于已登录 Web 用户操作；claim/exchange 使用 `pairing_id + nonce + device_id` 校验；session-handoff 使用 `Authorization: Bearer <device_token>`。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| capabilities 返回协议版本和能力开关 | MobilePairingRouter | `mobile-pairing-api-contract` | 待实现 |
| 创建 pairing session 并返回 QR/copy URL | MobilePairingManager + MobilePairingRepository + MobilePairingRouter | `mobile-pairing-backend-core` + `mobile-pairing-api-contract` | 待实现 |
| Android claim 后进入 pending_approval | MobilePairingManager + MobilePairingRepository + MobilePairingRouter | `mobile-pairing-backend-core` + `mobile-pairing-api-contract` | 待实现 |
| Web 页面展示并批准/拒绝设备 | MobilePairingWebPage + MobilePairingRouter + MobilePairingManager | `mobile-pairing-web-connect-page` | 待实现 |
| Android exchange 获得 device token 和 handoff URL | MobilePairingManager + MobileDeviceTokenService + MobilePairingRepository | `mobile-pairing-token-handoff` | 待实现 |
| handoff URL 设置 cookie 并跳转首页 | MobileDeviceTokenService + MobilePairingRouter | `mobile-pairing-token-handoff` | 待实现 |
| 吊销后 handoff 返回 device_revoked | MobilePairingManager + MobilePairingRepository + MobileDeviceTokenService + MobilePairingRouter | `mobile-pairing-device-revocation` | 待实现 |
| packaged Kongming 现有路径保持可用 | MobilePairingRouter + MobilePairingWebPage | `mobile-pairing-cross-host-smoke` | 待实现 |
