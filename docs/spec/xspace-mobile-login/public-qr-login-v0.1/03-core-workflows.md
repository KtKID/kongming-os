# 核心流程

图示集中在 [diagrams.md](./diagrams.md)，本文件只描述流程事实和错误分支。

## 主链路：扫码登录 Kongming Runtime

1. 用户访问 `https://<domain>/login` 或 `http://<private-ip>:<port>/login`。
2. `LoginPageQrPanel` 调用 `POST /api/xspace/mobile/login-qr-sessions`。
3. `LoginQrRouter` 读取 `web.server_origin`，`ServerOriginConfig` 解析为 `public_https` 或 `lan_ip`。
4. `LoginQrManager` 创建 `LoginQrSession`，生成 `login_qr_id`、`nonce`、`browser_token`，持久化 hash 和过期时间。
5. 路由返回 `server_origin`、`qr_payload`、`copy_url`、`browser_token` 和 `expires_at`。
6. 登录页展示二维码、复制链接、倒计时和刷新入口。
7. XSpace APK 扫码解析 `server`、`origin_mode`、`login_qr_id`、`nonce` 和 `purpose=login`。
8. APK 调用 `POST /api/xspace/mobile/login-qr-sessions/{login_qr_id}/claim`，提交设备描述和能力。
9. `LoginQrManager` 校验 nonce、TTL 和状态，写入 `LoginQrClaim`，状态进入 `pending_confirm`。
10. 登录页轮询 status，使用 `X-Kongming-Login-Qr-Token` header 携带 `browser_token`，展示设备 label、app version、device id 和待确认提示。
11. 用户在扫码登录区域输入密码并确认该设备登录。
12. `LoginQrAuthService` 复用密码校验和登录限流，确认成功后把 session 标记为 `confirmed`。
13. APK 轮询 exchange，`LoginQrManager` 校验 session 已确认、claim 匹配、nonce 匹配和未 exchange。
14. `LoginQrAuthService` 调用 token/handoff 能力，返回 `device_token` 和 `web_session_url`。
15. APK 保存 `device_token`，打开 `web_session_url` 到 WebView。
16. 服务器 consume handoff token，设置 `kongming_session` cookie，跳转 Kongming Web。

## 登录页创建和刷新

- 初次打开 `/login` 时扫码区域处于 `idle`。
- 用户切到扫码登录或点击刷新时创建新的 `LoginQrSession`。
- 创建成功后只在浏览器内存保存 `browser_token`，status 通过私密 header 提交该 token。
- 用户刷新二维码时，前一个未终态 session 可进入 `cancelled` 或自然过期。
- 创建失败时，UI 展示稳定错误码：`server_origin_required`、`server_origin_invalid_scheme`、`server_origin_loopback`、`server_origin_not_lan_ip`、`server_origin_public_host_invalid`、`rate_limited`、`internal`。

## 公网域名创建路径

1. `ServerOriginConfig` 接收 `https://<domain>`。
2. 校验 host 为域名，scheme 为 `https`，地址解析结果用于部署提示和日志。
3. `LoginQrManager` 将 `server_origin.mode=public_https` 写入 `LoginQrSession` 和 QR payload。
4. `web_session_url` 使用同一 HTTPS origin，cookie 使用公网反代的 Secure 策略。

## 局域网 IP 创建路径

1. `ServerOriginConfig` 接收 `http://192.168.x.x:<port>`、`http://10.x.x.x:<port>` 或 `http://172.16-31.x.x:<port>`。
2. 校验 host 为 RFC1918 私网 IP，scheme 为 `http`，host 属于 loopback/本机地址时返回 `server_origin_loopback`。
3. `LoginQrManager` 将 `server_origin.mode=lan_ip` 写入 `LoginQrSession` 和 QR payload。
4. `web_session_url` 使用同一 HTTP 私网 IP origin，WebView 直接打开该 origin 并接收该 host 下的 `kongming_session`。
5. APK 请求失败时展示同一局域网访问提示，服务端创建阶段只校验地址类别。

## APK claim 和 copy URL fallback

- 推荐 QR payload 使用 `xspace://login-kongming?server=...&origin_mode=...&login_qr_id=...&nonce=...&v=1&purpose=login`。
- 若复用旧 scheme，payload 必须包含 `purpose=login` 或 `client=kongming-login`。
- `copy_url` 指向同一 `server_origin.origin` 下的 `/-/xspace/mobile/login?...`，系统相机打开后展示 deeplink 和可复制参数。
- APK 对 `server_origin.mode` 做分模式校验，并在 claim/exchange 时只访问 payload 中的同一 origin。
- `public_https` 模式要求 `https` scheme 和域名 host。
- `lan_ip` 模式要求 `http` scheme、RFC1918 私网 IP host 和同一局域网可达。

## 密码确认授权

- P0 只采用登录页密码确认。
- `confirm` 请求包含 `browser_token`、`claim_id` 和 `password`。
- `LoginQrAuthService` 使用现有 `verify_password()` 和 `LoginRateLimiter`。
- 密码错误时记录失败次数并返回 401/429。
- 密码正确时记录授权证据：`authorization_method=password`、`authorized_user_id=default`、`confirmed_at`。
- 普通密码登录和 QR 密码确认的限流 key 均来自 request client IP。

## Exchange 和 WebView handoff

- APK 在 claim 成功后轮询 exchange。
- session 仍在 `pending_confirm` 时返回 `202 approval_pending` 和 `poll_after_ms`。
- session 进入 `confirmed` 后，exchange 原子签发 device token 和 handoff token，并推进 session/claim 到 `exchanged`。
- `web_session_url` 使用同一个 `server_origin.origin`，路径可复用 `/-/xspace/mobile/session/consume`。
- consume 成功后设置 `kongming_session`，重定向到 Kongming Web 根路径或 chat 入口。

## 错误与终态

- 过期：任一读取、claim、confirm、exchange 发现 `expires_at <= now`，session 写入 `expired`，返回 410。
- nonce 错误：claim/exchange 的 nonce hash 校验失败，返回 403 `nonce_mismatch`。
- 重复 claim：已有 claim 时返回 409 `login_qr_already_claimed`。
- 重复 exchange：已 `exchanged` 的 session 返回 409 `login_qr_already_exchanged`。
- 浏览器 token 错误：status header 或 confirm body 中的 `browser_token` hash 校验失败，返回 403 `browser_token_mismatch`。
- origin 配置错误：create 阶段返回 400，UI 展示 `web.server_origin` 配置提示。
- HTTP 公网域名：返回 400 `server_origin_not_lan_ip`，UI 提示 HTTP 只支持 RFC1918 私网 IP。
- loopback/本机地址：返回 400 `server_origin_loopback`。

## 后续授权方式

P0 密码确认完成后，`LoginQrAuthService` 可以新增并列授权来源：

1. 已绑定 XSpace APK 使用已有 device token 扫码确认登录。
2. 已登录管理端会话审批登录意图。
3. 管理端设备列表展示和撤销二维码登录设备。
