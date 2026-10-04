# XSpace APK 扫码登录改造交接文档

> 日期：2026-06-19  
> Kongming 侧状态：已落地后端 API、`/login` QR 面板、协议 fixture 和聚焦测试  
> 交接对象：XSpace Android / APK、XSpace Desktop / Runtime 启动配置

## 结论

XSpace 需要下线原本由 XSpace 承担的二维码登录页，把二维码生成、状态展示、密码确认和错误提示交给 Kongming Web 的 `/login` 页面。APK 保留扫码客户端职责：扫描 Kongming `/login` 生成的二维码，解析 `server_origin` 和 `login_qr_id`，调用 claim/exchange，保存 `device_token`，打开 `web_session_url` 进入同一个 Kongming Runtime。

这次改造支持两种部署模式：

| 模式 | `server_origin.origin` 示例 | APK 要求 |
|---|---|---|
| `public_https` | `https://kongming.example.com` | 只接受 HTTPS 域名 |
| `lan_ip` | `http://192.168.1.20:8765` | 只接受 RFC1918 私网 IP，手机和服务在同一局域网 |

## XSpace 需要删除或隐藏的旧入口

XSpace 侧原本的“二维码登录页”作为登录入口需要删除或隐藏。后续登录入口统一打开 Kongming Web：

```text
{server_origin}/login
```

XSpace 不再在 APK 内自行生成 Kongming 登录二维码，也不再把旧的手机连接页当作登录页使用。旧的设备配对入口仍可保留给“已登录桌面 Web 连接手机”场景；远程服务器登录使用本文件的新 login QR 协议。

建议处理：

| 旧行为 | 新行为 |
|---|---|
| APK 或 XSpace 页面生成登录二维码 | Kongming `/login` 页面生成登录二维码 |
| APK 扫 `xspace://pair-kongming` 进入桌面批准配对 | APK 扫 `xspace://login-kongming` 或 `purpose=login` 进入登录 claim |
| 等待已登录桌面页面 approve | 等待 `/login` 页面密码确认 |
| 只按公网 HTTPS 处理 server | 按 `server_origin.mode` 分公网 HTTPS 与 LAN IP |
| 旧二维码登录页展示状态 | Kongming `/login` 展示 pending、设备信息、密码确认、过期和错误 |

## 新扫码登录主流程

```text
用户打开 Kongming /login
  -> Kongming /login 生成 QR
  -> XSpace APK 扫码
  -> APK claim login QR intent
  -> /login 展示已扫码设备
  -> 用户在 /login 输入密码确认
  -> APK exchange 获得 device_token + web_session_url
  -> APK 保存 device_token
  -> APK 打开 web_session_url
  -> Kongming 设置 kongming_session 并进入 Runtime
```

关键差异：

- 旧 pairing 流程的授权动作是已登录 Web 页面 approve。
- 新 login QR 流程的 P0 授权动作是 `/login` 页面密码确认。
- APK exchange 返回前，服务端必须看到登录 QR intent 已确认。
- APK 打开的 `web_session_url` 必须和 QR payload 中的 `server_origin.origin` 同 origin。

## QR payload

推荐新 scheme：

```text
xspace://login-kongming?v=1
  &purpose=login
  &server=https%3A%2F%2Fkongming.example.com
  &origin_mode=public_https
  &login_qr_id=lq_...
  &nonce=base64url-random
```

LAN 示例：

```text
xspace://login-kongming?v=1
  &purpose=login
  &server=http%3A%2F%2F192.168.1.20%3A8765
  &origin_mode=lan_ip
  &login_qr_id=lq_...
  &nonce=base64url-random
```

兼容旧 scheme 时，必须带 `purpose=login`：

```text
xspace://pair-kongming?v=1
  &purpose=login
  &server=http%3A%2F%2F192.168.1.20%3A8765
  &origin_mode=lan_ip
  &login_qr_id=lq_...
  &nonce=base64url-random
```

copy URL fallback：

```text
{server}/-/xspace/mobile/login
  ?v=1
  &purpose=login
  &server={urlencoded server}
  &origin_mode={public_https|lan_ip}
  &login_qr_id=lq_...
  &nonce=base64url-random
```

APK 解析字段：

| 字段 | 要求 |
|---|---|
| `v` | P0 固定 `"1"` |
| `purpose` | 固定 `"login"` |
| `server` | Kongming origin，等于 `server_origin.origin` |
| `origin_mode` | `public_https` 或 `lan_ip` |
| `login_qr_id` | `lq_...` 登录 QR 会话 ID |
| `nonce` | 单次随机校验值，claim/exchange 都要提交 |

## APK origin 校验

APK 在发 claim 前先做本地校验，减少误连：

| `origin_mode` | 允许 | 拒绝 |
|---|---|---|
| `public_https` | `https://<domain>` | HTTP、公网 IP、localhost、loopback、私网 IP |
| `lan_ip` | `http://192.168.x.x:<port>`、`http://10.x.x.x:<port>`、`http://172.16-31.x.x:<port>` | HTTPS 域名、HTTP 公网域名、localhost、127.0.0.1、0.0.0.0、::1、链路本地 |

LAN 模式还需要 APK 在网络失败时提示用户确认手机和 Kongming Runtime 在同一局域网。服务端只能校验地址类别，无法证明手机一定可达。

## claim 登录意图

APK 扫码后调用：

```http
POST {server}/api/xspace/mobile/login-qr-sessions/{login_qr_id}/claim
Content-Type: application/json
```

请求：

```json
{
  "protocol_version": "1",
  "nonce": "base64url-random",
  "origin_mode": "public_https",
  "device": {
    "device_id": "xspace_android_9f2a...",
    "label": "Pixel 9",
    "platform": "android",
    "app_version": "0.1.0"
  },
  "capabilities": {
    "webview": true,
    "camera_scan": true,
    "secure_storage": true
  }
}
```

成功响应：

```json
{
  "login_qr_id": "lq_...",
  "claim_id": "cl_...",
  "status": "pending_confirm",
  "poll_after_ms": 1000
}
```

APK 行为：

1. 保存临时态：`server`、`origin_mode`、`login_qr_id`、`claim_id`、`nonce`、`device_id`。
2. 展示“等待登录页确认”。
3. 按 `poll_after_ms` 轮询 exchange。
4. claim 失败时清理临时态并展示错误。

## 登录页密码确认

这一步由 Kongming `/login` 页面完成。APK 无需处理密码，也不保存密码。

Kongming `/login` 会展示：

- 设备名称：`device.label`
- 平台：`device.platform`
- 版本：`device.app_version`
- 能力：`capabilities`
- 密码确认输入
- 过期、刷新和错误提示

密码确认成功后，服务端把 login QR session 推进到 `confirmed`。APK 下一次 exchange 可以换取 token。

## exchange 换取凭据

APK 轮询调用：

```http
POST {server}/api/xspace/mobile/login-qr-sessions/{login_qr_id}/exchange
Content-Type: application/json
```

请求：

```json
{
  "protocol_version": "1",
  "claim_id": "cl_...",
  "nonce": "base64url-random",
  "device_id": "xspace_android_9f2a..."
}
```

等待确认响应：

```http
HTTP/1.1 202 Accepted
Content-Type: application/json
```

```json
{
  "status": "approval_pending",
  "poll_after_ms": 1000
}
```

确认后响应：

```json
{
  "status": "approved",
  "server_origin": {
    "mode": "lan_ip",
    "origin": "http://192.168.1.20:8765",
    "scheme": "http",
    "host": "192.168.1.20",
    "port": 8765
  },
  "server": "http://192.168.1.20:8765",
  "device_token": "kgm_dt_...",
  "token_type": "Bearer",
  "scopes": ["webview", "thread.read", "approval.resolve"],
  "device_id": "xspace_android_9f2a...",
  "instance": {
    "alias": "Kongming",
    "url": "http://192.168.1.20:8765"
  },
  "web_session_url": "http://192.168.1.20:8765/-/xspace/mobile/session/consume?handoff_token=kgm_ht_..."
}
```

APK 成功后的动作：

1. 校验响应里的 `server_origin.origin` 等于扫码 payload 的 `server`。
2. 校验响应里的 `server_origin.mode` 等于扫码 payload 的 `origin_mode`。
3. 将 `instance.url` 写入远程实例列表。
4. 将 `device_token` 写入 Android secure storage，按 instance 绑定。
5. 保存 `auth_kind = "mobile_device_token"` 或等价本地标记。
6. 打开 `web_session_url` 进入 Kongming WebView。
7. 清理本次 login QR 临时态。

## 冷启动 handoff

APK 保存 `device_token` 后，后续打开同一 Kongming 实例时继续复用现有 handoff 模式：

```http
POST {server}/api/xspace/mobile/session-handoff
Authorization: Bearer kgm_dt_...
Content-Type: application/json
```

响应：

```json
{
  "web_session_url": "http://192.168.1.20:8765/-/xspace/mobile/session/consume?handoff_token=kgm_ht_...",
  "expires_at": "2026-06-19T16:25:00Z"
}
```

APK 行为：

- 立即打开 `web_session_url`。
- `handoff_token` 由 Kongming 单次消费。
- `device_revoked`、`reauth_required`、`token_expired` 时清理本地 token 并引导重新扫码。

## XSpace Desktop / Runtime 配置变化

XSpace 启动 Kongming sidecar 或登记远程 Kongming 实例时，需要给 Kongming 一个可被 APK 访问的 `server_origin`。Kongming Web 侧统一使用 `web.server_origin` / `--server-origin`。

公网部署：

```text
web.server_origin=https://kongming.example.com
```

局域网部署：

```text
web.server_origin=http://192.168.1.20:8765
```

XSpace Desktop 需要调整：

| 场景 | XSpace 行为 |
|---|---|
| 本机 sidecar 给手机扫 | 选择本机在局域网内可访问的私网 IP，写入 `web.server_origin=http://<private-ip>:<port>` |
| 远程服务器实例 | 保存用户输入的 `https://<domain>`，写入实例的 `server_origin` |
| 打开登录入口 | 打开 `{server_origin}/login` |
| 打开旧设备配对入口 | 继续打开 `{server_origin}/-/xspace/mobile/connect` |

局域网 IP 建议由 XSpace 显式选择或让用户确认。自动发现局域网 IP、mDNS、端口探测属于后续增强，P0 只要求传入明确的私网 IP origin。

## 本地状态改造

建议 XSpace APK 保存：

| 状态 | 位置 | 说明 |
|---|---|---|
| instance URL / alias | `InstanceStore` | 远程 Kongming 实例，URL 来自 exchange 响应 |
| origin mode | `InstanceStore` | `public_https` 或 `lan_ip`，用于网络错误文案和调试 |
| `device_token` | Android secure storage | 按 instance 绑定，明文只存 secure storage |
| `auth_kind` | `InstanceStore` 或派生字段 | 建议值：`mobile_device_token` |
| last login source | 可选 | `login_qr`，用于调试和埋点 |

建议结构：

```ts
type KongmingServerOriginMode = "public_https" | "lan_ip"

type KongmingInstanceAuth = {
  auth_kind: "none" | "mobile_device_token"
  token_ref?: string
  origin_mode?: KongmingServerOriginMode
}
```

## XSpace APK 需要改的代码点

| 模块 | 改造 |
|---|---|
| QR scanner / deeplink parser | 新增 `xspace://login-kongming`；旧 `xspace://pair-kongming` 只在 `purpose=login` 时走登录协议 |
| old QR login page | 删除或隐藏旧页面入口；登录 QR 页面由 Kongming `/login` 提供 |
| API client | 新增 login QR claim/exchange 路径，保留 pairing 路径给设备配对 |
| origin validation | 增加 `public_https` / `lan_ip` 分模式校验 |
| secure storage | 保存 login QR exchange 返回的 `device_token` |
| InstanceStore | 写入 `instance.url`、`origin_mode`、`auth_kind` |
| WebView launcher | exchange 成功后打开 `web_session_url`，后续冷启动用 session-handoff 获取新 URL |
| error UI | 覆盖 `server_origin_*`、过期、nonce、等待确认、密码确认失败后的 pending |

## 错误码处理

统一错误结构：

```json
{
  "error": {
    "code": "login_qr_expired",
    "message": "login QR expired: lq_...",
    "retryable": false
  }
}
```

P0 错误码：

| code | HTTP | APK 处理 |
|---|---:|---|
| `server_origin_required` | 400 | 提示服务端缺少扫码登录 origin 配置 |
| `server_origin_invalid_scheme` | 400 | 停止登录，提示 origin scheme 无效 |
| `server_origin_loopback` | 400 | 停止登录，提示不能使用 localhost/127.0.0.1 |
| `server_origin_not_lan_ip` | 400 | 停止登录，提示 HTTP 只支持局域网私网 IP |
| `server_origin_public_host_invalid` | 400 | 停止登录，提示公网模式使用 HTTPS 域名 |
| `login_qr_not_found` | 404 | 提示二维码失效，重新扫码 |
| `login_qr_expired` | 410 | 提示二维码过期，重新扫码 |
| `browser_token_mismatch` | 403 | APK 通常不会收到；服务端登录页刷新 QR |
| `nonce_mismatch` | 403 | 拒绝继续登录，清理临时态 |
| `login_qr_already_claimed` | 409 | 提示二维码已被使用 |
| `approval_pending` | 202 | 按 `poll_after_ms` 继续轮询 |
| `approval_denied` | 403 | 提示登录已取消 |
| `login_qr_already_exchanged` | 409 | 使用已保存 token 或重新扫码 |
| `device_revoked` | 401 | 删除本地 device token，引导重新扫码 |
| `token_expired` | 401 | 重新调用 session-handoff |
| `reauth_required` | 401 | 清理本地 token，引导重新扫码 |

## 安全约束

- 二维码只包含短期 `login_qr_id` 和 `nonce`，不包含长期 token。
- `nonce`、`browser_token`、`device_token`、`handoff_token` 在 Kongming 服务端只保存 hash。
- `device_token` 明文只在 exchange 成功响应返回一次。
- `handoff_token` 只放在 `web_session_url` 中，且单次消费。
- APK 不接触用户密码；密码只在 Kongming `/login` 页面提交。
- exchange 必须在服务端确认 session 已通过密码确认后才返回 token。
- LAN 模式只代表同一局域网访问，不提供公网安全边界。

## 联调验收

### 公网 HTTPS smoke

1. Kongming 配置 `web.server_origin=https://kongming.example.com`。
2. 浏览器打开 `https://kongming.example.com/login`。
3. 用户点击扫码登录生成 QR。
4. XSpace APK 扫码并 claim。
5. `/login` 展示 APK 设备信息。
6. 用户在 `/login` 输入密码确认。
7. APK exchange 成功，保存 `device_token`。
8. APK 打开 `web_session_url`，WebView 进入已登录 Kongming。
9. APK 冷启动用 `session-handoff` 重新进入同一实例。

### LAN IP smoke

1. Kongming 配置 `web.server_origin=http://192.168.1.20:8765`。
2. 手机与 Kongming 服务在同一局域网。
3. 浏览器打开 `http://192.168.1.20:8765/login`。
4. XSpace APK 扫码 claim。
5. 用户在 `/login` 输入密码确认。
6. APK exchange 返回 `server_origin.mode=lan_ip`。
7. APK 打开 LAN `web_session_url`，WebView 进入已登录 Kongming。
8. 断开 Wi-Fi 或切换网络时，APK 展示同一局域网访问提示。

## XSpace 交付清单

1. 删除或隐藏旧二维码登录页入口。
2. 新增 `xspace://login-kongming` deeplink intent/parser。
3. 保留 `xspace://pair-kongming?purpose=login` 作为兼容入口。
4. 新增 login QR claim/exchange API client。
5. 新增 `public_https` / `lan_ip` origin 校验。
6. exchange 成功后保存 `device_token` 和 `origin_mode`。
7. WebView 打开 `web_session_url`。
8. 冷启动继续用 existing session-handoff。
9. 补公网 HTTPS 和 LAN IP 两条真机 smoke。
10. 错误 UI 覆盖 `server_origin_*` 和 login QR 状态错误。

## Kongming 侧参考

- 方案包：`repo:docs/spec/xspace-mobile-login/public-qr-login-v0.1/`
- 协议 fixture：`repo:tests/fixtures/xspace_mobile_login_qr/login_qr_contract.json`
- 现有 mobile pairing handoff：`repo:docs/integrations/xspace-mobile-pairing/xspace-integration-handoff-20260614.md`
- 现有 token/handoff 服务：`repo:src/hosts/web/xspace_mobile/token_service.py`
- 现有 session consume route：`repo:src/hosts/web/routers/xspace_mobile.py`

## 后续演进 TODO

1. 已绑定设备确认：APK 持有效 `device_token` 时可扫码确认新的 WebView 登录，服务端在 `LoginQrAuthService` 增加 `device_token` 授权来源。
2. 已登录管理端审批：浏览器已有 `kongming_session` 时可用管理端会话确认登录意图，服务端在同一授权服务增加 `admin_session` 授权来源。
3. 设备列表管理：在 Kongming Web 展示 login QR 授权设备、最近使用时间和撤销入口，复用现有 `mobile_devices` / revoke 能力。
4. 审计日志：记录 login QR create/claim/confirm/exchange 的 origin、设备摘要、授权方式和结果，避免记录 nonce/token 明文。
