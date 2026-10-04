# Task Map

## 排序依据

先验证最大安全风险：匿名登录页创建 QR 后，服务器必须只在密码确认后签发 `device_token` 和 `web_session_url`。后端状态机、授权服务和 `ServerOriginConfig` 排在前面，前端 UI、APK 合同和公网/LAN 双模式 smoke 随后并行推进。

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| LoginQrManager | `public-login-qr-backend` | 无 | DoD#1、#2、#5、#6、#8、#9 | 高，建议先写状态机测试 | 可进入 x-req | 定义 LoginQrSession/LoginQrIntent |
| LoginQrAuthService | `login-qr-auth-service` | `public-login-qr-backend` | DoD#6、#7、#8 | 高，建议先固定密码确认和签发前置条件 | 可进入 x-req | 复用 password verify、rate limiter、MobileDeviceTokenService |
| ServerOriginConfig | `server-origin-config` | 无 | DoD#2、#3、#4、#9 | 中，建议和 backend 同 task 或前置小 task | 可进入 x-req | create 阶段支持 public_https/lan_ip，阻断 loopback 和 HTTP 公网域名 |
| LoginQrRouter | `public-login-qr-router` | LoginQrManager + LoginQrAuthService + ServerOriginConfig | DoD#1、#5、#6、#7、#8、#9 | 中 | 可进入 x-req | 固定 Auth/CSRF allowlist 和错误体 |
| LoginPageQrPanel | `login-page-qr-panel` | LoginQrRouter fixture | DoD#1、#5、#6、#9 | 中 | 可进入 x-req | 与现有密码登录并列，复用 `repo:web/src/lib/api.ts` |
| XSpaceApkLoginClient | `xspace-apk-login-contract` | LoginQrRouter fixture | DoD#2、#5、#6、#7 | 中 | 可进入 x-req | 本仓只写协议 fixture 和 handoff 报告 |
| 全链路验证 | `login-qr-public-lan-smoke-tests` | 以上 P0 task | DoD#10 | 中 | 可进入 x-req | 公网 HTTPS smoke + LAN IP smoke + FastAPI TestClient + Vitest/MSW + fake APK |

## 推荐 task 切分

### task 1：`public-login-qr-backend`

交付：
- `LoginQrSession / LoginQrClaim` 状态机。
- repository 原子 claim/confirm/exchange。
- `ServerOriginConfig` 校验。
- Manager 单元测试。

验收：
- 状态机主路径和错误分支全覆盖。
- 公网 HTTPS 域名、LAN HTTP 私网 IP 和 origin 配置错误返回稳定错误码。

### task 2：`public-login-qr-router-auth`

交付：
- login QR REST API。
- Auth/CSRF allowlist。
- 密码确认、rate limit、token/handoff 签发。
- FastAPI route contract tests。

验收：
- 密码确认前 exchange 返回 `approval_pending`。
- 密码确认后 exchange 返回 `device_token` 和 `web_session_url`。
- consume URL 设置 `kongming_session`。

### task 3：`login-page-qr-panel`

交付：
- `/login` 扫码登录区域或 tab。
- 创建 QR、倒计时、刷新、复制链接、轮询、密码确认。
- 前端 MSW 测试。

验收：
- 真实交互覆盖 pending_scan、pending_confirm、confirmed、expired、错误态。

### task 4：`xspace-apk-login-contract`

交付：
- QR payload fixture。
- claim/exchange response fixture。
- XSpace 接入说明。

验收：
- fake APK smoke 使用 fixture 跑通 claim/exchange/consume。

### task 5：`login-qr-public-lan-smoke-tests`

交付：
- 公网 HTTPS smoke fixture。
- LAN IP smoke fixture。
- HTTP 公网域名、loopback、无配置错误测试。

验收：
- `server_origin.mode=public_https` 与 `server_origin.mode=lan_ip` 的 create/claim/exchange/consume 链路均通过。
- 错误码统一使用 `server_origin_*`。

## 模块进入 x-req 建议

- `LoginQrManager`、`LoginQrAuthService`、`LoginQrRouter`、`LoginPageQrPanel`、`ServerOriginConfig` 可合并为一个 P0 x-req 包，主题为 `xspace-mobile-server-qr-login-v0.1`。
- `XSpaceApkLoginClient` 适合作为同一 x-req 的协议交付物，并在 XSpace 仓单独实现。
- 已绑定设备确认和已登录管理端审批继续停留在方案层，等待 P0 密码确认链路稳定后再拆 task。
