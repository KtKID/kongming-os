# XSpace Mobile Login

> Kongming Web 为 XSpace APK 提供扫码登录服务器 Runtime 的协议合同：二维码由 Kongming `/login` 生成，APK 扫码后 claim 登录意图，用户在登录页密码确认，APK exchange 后打开 WebView。

## 文档导航

| 文档 | 状态 | 说明 |
|------|------|------|
| [xspace-apk-login-handoff.md](./xspace-apk-login-handoff.md) | 方案交接 | 给 XSpace 的 APK 改造说明：下线旧二维码登录页、解析新 payload、claim/exchange、保存 token、打开 WebView |

## 协议 fixture

| Fixture | 用途 |
|---|---|
| `repo:tests/fixtures/xspace_mobile_login_qr/login_qr_contract.json` | 固定 XSpace APK 需要实现的 login QR payload、claim/confirm/exchange 响应和错误响应 |

## 对应 spec

| Spec | 状态 | 说明 |
|------|------|------|
| `repo:docs/spec/xspace-mobile-login/public-qr-login-v0.1/` | 方案确认 | `/login` 扫码登录主方案，支持公网 HTTPS 域名和局域网私网 IP |
