# public-qr-login-v0.1

> 状态：方案确认
> 目标：让 XSpace APK 通过公网 HTTPS 域名或局域网私网 IP 扫码登录 Kongming Web，并进入对应 Kongming Runtime。

## 系统目标

Kongming Web/Runtime 可以部署在公网 HTTPS 域名，也可以部署在同一局域网内的私网 IP。这个 spec 将现有 `/login` 扩展为密码登录和扫码登录并列入口：Web 按 `ServerOriginConfig` 生成短期二维码登录意图，XSpace APK 扫码 claim，用户在同一登录页输入密码确认授权，APK 获得 `device_token` 和 `web_session_url` 后在 WebView 中进入对应 Kongming。

## 最小可用路径

用户打开 `https://<domain>/login` 或 `http://<private-ip>:<port>/login` → 点击扫码登录生成 QR → XSpace APK 扫码 claim 登录意图 → 登录页展示设备和待确认状态 → 用户在登录页输入密码确认该 QR 登录意图 → APK exchange 获得 `device_token` 和 `web_session_url` → APK 打开同 origin 的 `web_session_url` → 服务器设置 `kongming_session` cookie 并进入 Kongming Web。

## 范围边界

**包含**：
- `/login` 页面增加扫码登录区域或 tab，与现有密码登录并列。
- Kongming Web 生成短期 QR 登录会话，展示 QR 状态、倒计时、刷新、复制链接和错误提示。
- QR payload 的 `server_origin` 使用 `config.web.server_origin`，支持 `mode=public_https` 和 `mode=lan_ip`。
- 公网域名模式使用 `https://<domain>`。
- 局域网 IP 模式使用 `http://192.168.x.x:<port>`、`http://10.x.x.x:<port>` 或 `http://172.16-31.x.x:<port>`。
- XSpace APK 作为扫码客户端和 WebView 宿主，扫码后访问服务器 Kongming Runtime。
- P0 授权模型采用“扫码 + 登录页密码确认”，签发 `device_token` 或 `kongming_session` 前必须通过密码校验。
- 复用现有 XSpace mobile pairing 的 token/handoff 能力和稳定错误语义。
- 覆盖后端路由合同、状态机、前端交互、跨端 smoke 和协议漂移测试。

**排除范围**：
- XSpace APK 原生实现。
- 自动发现局域网 IP、mDNS、端口探测与打包 sidecar 场景。
- 已登录管理端审批作为首版主路径。
- 第三方 OAuth、短信验证码、多用户账号体系。
- 长期离线登录和跨服务器设备迁移。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| LoginQrManager | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1loginqrmanager) | 是 | QR 登录会话状态机和业务门户 |
| LoginQrAuthService | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2loginqrauthservice) | 是 | 密码确认、token 签发、cookie handoff 授权 |
| LoginQrRouter | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3loginqrrouter) | 是 | 公开 login QR API 和 Auth/CSRF 边界 |
| LoginPageQrPanel | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4loginpageqrpanel) | 是 | `/login` 扫码区域、轮询和密码确认交互 |
| XSpaceApkLoginClient | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-5xspaceapkloginclient) | 是 | APK 扫码、deeplink/copy URL、device token 保存和 WebView 打开合同 |
| ServerOriginConfig | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-6serveroriginconfig) | 是 | 公网 HTTPS 域名与 LAN 私网 IP origin 校验和部署提示 |

## 文档导航

- [图集：总览 + 各模块局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 路径规则

- 本包内文档链接只使用 `./...`
- 代码文件只写 `repo:<path>` 形式
- 图统一维护在 [diagrams.md](./diagrams.md)

## 当前建议

先进入 x-req，拆一个 P0 主链路 task：`xspace-mobile-server-qr-login-v0.1`。首版完成 `LoginQrManager`、`LoginQrAuthService`、`LoginQrRouter`、`LoginPageQrPanel`、APK 协议合同、`server-origin-config` 和公网/LAN 双模式 smoke，后续再拆已绑定设备确认和已登录管理端审批。
