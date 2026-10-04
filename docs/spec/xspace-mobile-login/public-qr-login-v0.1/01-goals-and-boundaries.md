# 目标与完成标准

## 需求要点

1. 用户需要在公网域名模式和局域网 IP 模式下使用同一套扫码登录协议。
2. 公网域名模式通过 `https://<domain>` 访问服务器 Kongming Web/Runtime。
3. 局域网 IP 模式通过 `http://192.168.x.x:<port>`、`http://10.x.x.x:<port>` 或 `http://172.16-31.x.x:<port>` 访问同一局域网内的 Kongming Runtime。
4. 二维码生成入口放在已有 Web 登录页旁边，形成密码登录和扫码登录并列体验。
5. XSpace APK 是扫码客户端和 WebView 宿主；扫码后访问 QR 中的同一 `server_origin`。
6. 页面能力属于 Kongming Web：生成二维码、展示状态、过期/刷新、错误提示。
7. XSpace APK 保留扫码、解析 deeplink/copy URL、保存 device token、安全打开 `web_session_url` 的职责。
8. 登录页上的匿名 QR 只创建登录/授权意图；服务器签发 `device_token` 或 `kongming_session` 前必须完成可验证授权动作。

## 系统目标

把现有已登录移动配对能力扩展为登录入口。用户可以在公网 HTTPS 域名或局域网私网 IP 的 `/login` 页面生成短期二维码，让 XSpace APK 扫码后进入同一台 Kongming Runtime，同时保留当前密码登录链路。

## 完成目标（DoD）

- [ ] `/login` 页面展示密码登录和扫码登录两个入口，扫码入口能生成 QR 和 copy URL。
- [ ] QR payload 的 `server_origin` 指向 `ServerOriginConfig` 规范化结果，并返回 `mode`、`origin`、`scheme`、`host`。
- [ ] 公网域名模式接受 `https://<domain>`，拒绝 HTTP 公网域名。
- [ ] 局域网 IP 模式接受 RFC1918 私网 IP 的 HTTP origin，并要求 APK 与服务位于同一局域网。
- [ ] XSpace APK 扫码后能 claim 登录意图，登录页展示设备信息和待确认状态。
- [ ] 用户在 `/login` 侧用密码确认后，APK exchange 获得 `device_token` 和 `web_session_url`。
- [ ] APK 打开 `web_session_url` 后服务器设置 `kongming_session` cookie 并进入服务器 Kongming Web。
- [ ] 签发 `device_token`、`handoff_token` 或 `kongming_session` 前，QR 会话必须处于已密码确认或已绑定设备确认或已登录审批状态；P0 实现密码确认。
- [ ] QR 过期、重复使用、nonce 错误、origin 缺失、scheme 错误、loopback、HTTP 公网域名和非私网 LAN IP 时有稳定错误码和 UI 提示。
- [ ] 聚焦测试覆盖后端路由合同、状态机、前端 Login QR 交互、跨端 smoke 和协议漂移。

## 范围边界

**包含**：
- 新增 `LoginQrSession / LoginQrIntent` 概念。
- `LoginQrManager` 负责创建、claim、确认、exchange、状态查询和终态推进。
- `LoginQrAuthService` 复用密码校验、`MobileDeviceTokenService` 和 `issue_session_cookie` 相关能力。
- `/login` 页面新增扫码登录面板，支持 QR 展示、倒计时、刷新、复制链接、密码确认、轮询和错误态。
- XSpace APK 侧协议合同写入本 spec，作为跨仓接入依据。
- `ServerOriginConfig` 支持公网 HTTPS 域名和 LAN HTTP 私网 IP 两种 P0 部署模式。
- 公网模式要求 HTTPS 域名且可被 APK 访问。
- LAN 模式要求 RFC1918 私网 IP、HTTP scheme、显式端口和手机与服务同一局域网。

**排除范围**：
- APK native 扫码 UI 和 WebView 代码落地。
- 多用户权限体系。
- 已登录管理端审批的 P0 实现。
- LAN sidecar 自动探测、mDNS、端口扫描和自动网络修复。
- 长期 refresh token。

## 关键约束

- 服务器必须配置 `web.server_origin` 或等价单一真源，登录 QR 创建阶段需要解析为 `public_https` 或 `lan_ip`。
- 公网模式必须配置 `https://<domain>`，并使用 HTTPS 访问与签发 Secure cookie。
- LAN 模式必须配置 `http://<private-ip>:<port>`，并按同一私网 IP origin 签发 WebView 可用的 `kongming_session`。
- `localhost`、`127.0.0.0/8`、`0.0.0.0`、`::1`、链路本地和未指定地址均属于 loopback/本机地址，扫码登录创建阶段直接拒绝。
- 现有 mobile pairing 旧流程由已登录 Web 页面创建 pairing；本 spec 的新流程由 `/login` 发起，需要单独的 login QR intent 授权模型。
- P0 授权采用登录页密码确认，复用现有单密码系统和登录限流。
- `nonce`、`browser_token`、`device_token`、`handoff_token` 明文只在创建或签发响应中返回一次，持久化只保存 hash。
- Android claim/exchange 路径需要绕过 cookie 鉴权和浏览器 CSRF header，由 nonce、短 TTL、单次 exchange 和状态机约束保护。
- 浏览器 confirm 路径必须带 `X-Requested-With: XMLHttpRequest`，并纳入现有登录限流。
- 公网反代需要保证 `Secure` cookie、`SameSite=Lax` 和 HTTPS scheme 判定正确。
- LAN 模式的 cookie 绑定私网 IP origin，公网域名 cookie 假设只适用于 `public_https` 模式。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| `/login` 双入口、QR 和 copy URL | LoginPageQrPanel + LoginQrRouter + ServerOriginConfig | `login-page-qr-panel` + `public-login-qr-backend` | 待实现 |
| QR payload 使用双模式 server origin | ServerOriginConfig + LoginQrManager + LoginQrRouter | `server-origin-config` + `public-login-qr-backend` | 待实现 |
| APK claim 后页面展示设备和待确认状态 | LoginQrManager + LoginQrRouter + LoginPageQrPanel + XSpaceApkLoginClient | `public-login-qr-backend` + `login-page-qr-panel` + `xspace-apk-login-contract` | 待实现 |
| 密码确认后 APK 获得 token 和 WebView URL | LoginQrAuthService + LoginQrManager + LoginQrRouter + XSpaceApkLoginClient | `login-qr-auth-service` + `public-login-qr-backend` + `xspace-apk-login-contract` | 待实现 |
| WebView 打开 URL 后进入服务器 Kongming Web | LoginQrAuthService + LoginQrRouter + XSpaceApkLoginClient | `login-qr-auth-service` + `xspace-apk-login-contract` | 待实现 |
| 签发前必须完成授权确认 | LoginQrAuthService + LoginQrManager + LoginQrRouter | `login-qr-auth-service` + `public-login-qr-backend` | 待实现 |
| 过期、重复、nonce、origin 错误稳定呈现 | LoginQrManager + LoginQrRouter + LoginPageQrPanel + ServerOriginConfig | `public-login-qr-backend` + `login-page-qr-panel` + `server-origin-config` | 待实现 |
| 测试覆盖后端、状态机、前端、smoke、协议漂移 | 全部模块 | `login-qr-smoke-and-contract-tests` | 待实现 |
