# 数据模型与状态

## 核心实体

### LoginQrOriginView

```typescript
interface LoginQrOriginView {
  mode: "public_https" | "lan_ip";  // origin 模式：公网 HTTPS 域名或 LAN 私网 IP
  origin: string;                   // 规范化 origin，包含 scheme、host 和可选 port
  scheme: "https" | "http";         // public_https 使用 https，lan_ip 使用 http
  host: string;                     // 公网域名或 RFC1918 私网 IP
  port: number | null;              // 端口；默认端口可为空
}
```

### LoginQrSession

```typescript
interface LoginQrSession {
  login_qr_id: string;              // 登录 QR 会话 ID，URL 安全字符串，主键
  purpose: "login";                 // 会话用途，固定为扫码登录
  protocol_version: "1";            // 移动登录协议版本
  origin_mode: "public_https" | "lan_ip"; // server origin 模式
  server_origin: string;            // 规范化 origin，来自 web.server_origin
  origin_scheme: "https" | "http";  // origin scheme
  origin_host: string;              // origin host，公网域名或 RFC1918 私网 IP
  nonce_hash: string;               // QR nonce 的 SHA-256 hash，APK claim/exchange 校验
  browser_token_hash: string;       // 登录页私密 token 的 SHA-256 hash，status/confirm 校验
  requested_scopes: string[];       // device token 授权 scope 列表
  status: LoginQrSessionStatus;     // 会话状态机取值
  claim_id: string | null;          // 当前 APK claim ID，未扫码时为空
  authorization_method: "password" | "device_token" | "admin_session" | null; // 授权方式，P0 使用 password
  authorized_user_id: string | null; // 授权用户，单用户系统默认 default
  expires_at: string;               // ISO 8601 过期时间
  created_at: string;               // ISO 8601 创建时间
  claimed_at: string | null;        // APK claim 时间
  confirmed_at: string | null;      // 授权确认时间
  exchanged_at: string | null;      // exchange 完成时间
}
```

### LoginQrClaim

```typescript
interface LoginQrClaim {
  claim_id: string;                 // APK claim ID，主键
  login_qr_id: string;              // 所属 LoginQrSession 外键
  device_id: string;                // APK 设备稳定 ID
  label: string;                    // APK 展示名，如 Pixel 9
  platform: "android";              // 设备平台，P0 固定 android
  app_version: string;              // XSpace APK 版本
  capabilities: Record<string, boolean>; // APK 能力声明，如 camera_scan/webview
  status: LoginQrClaimStatus;       // claim 状态机取值
  created_at: string;               // ISO 8601 claim 创建时间
}
```

### MobileDevice

```typescript
interface MobileDevice {
  device_id: string;                // APK 设备稳定 ID，主键
  label: string;                    // 设备展示名
  platform: "android";              // 设备平台
  app_version: string;              // 最近一次授权的 APK 版本
  scopes: string[];                 // device token scope
  token_hash: string;               // device token SHA-256 hash
  created_at: string;               // 首次授权时间
  last_seen_at: string | null;      // 最近一次 token 使用时间
  revoked_at: string | null;        // 吊销时间，空表示可用
}
```

### HandoffToken

```typescript
interface HandoffToken {
  handoff_id: string;               // handoff token 记录 ID，主键
  token_hash: string;               // handoff token SHA-256 hash
  device_id: string;                // 关联 APK 设备 ID
  scopes: string[];                 // handoff 继承的 scope
  user_id: string;                  // cookie session 用户 ID，单用户默认 default
  expires_at: string;               // handoff 过期时间
  consumed_at: string | null;       // 消费时间，空表示可消费
  created_at: string;               // 签发时间
}
```

## 实体关系

实体关系图写入 [diagrams.md](./diagrams.md#数据关系)。关系规则：

- 一个 `LoginQrSession` 最多绑定一个 `LoginQrClaim`。
- 一个 `LoginQrSession` 保存一次 `ServerOriginConfig` 解析结果，包括 `origin_mode`、`server_origin`、`origin_scheme` 和 `origin_host`。
- 一个 `LoginQrClaim` exchange 成功后 upsert 一个 `MobileDevice`。
- 一个 exchange 成功会签发一个短期 `HandoffToken`。
- `HandoffToken` 被 WebView consume 后生成 `kongming_session` cookie。

## 状态流转

### LoginQrSessionStatus

```typescript
type LoginQrSessionStatus =
  | "pending_scan"     // 已创建 QR，等待 APK 扫码
  | "pending_confirm"  // APK 已 claim，等待登录页密码确认
  | "confirmed"        // 密码确认成功，等待 APK exchange
  | "exchanged"        // APK 已 exchange，device token 和 handoff token 已签发
  | "expired"          // TTL 到期
  | "cancelled";       // 登录页刷新或用户取消
```

状态流转简记：

```text
pending_scan -> pending_confirm -> confirmed -> exchanged
pending_scan -> cancelled
pending_scan | pending_confirm | confirmed -> expired
```

状态图写入 [diagrams.md](./diagrams.md#loginqrmanager)。

### LoginQrClaimStatus

```typescript
type LoginQrClaimStatus =
  | "pending_confirm"  // 已 claim，等待登录页确认
  | "approved"         // 登录页确认成功，等待 exchange
  | "denied"           // 后续管理端拒绝或取消路径使用
  | "exchanged";       // 已完成 exchange
```

## 持久化方案

| 数据 | 存储方式 | 位置 | 备注 |
|------|---------|------|------|
| LoginQrSession | SQLite | 复用 XSpace mobile pairing 数据库或新增同库表 | 保存 hash、状态、时间和授权证据 |
| LoginQrClaim | SQLite | 同上 | 保存扫码设备信息和 claim 状态 |
| MobileDevice | SQLite | 复用 `mobile_devices` 表 | 保存 device token hash 与吊销状态 |
| HandoffToken | SQLite | 复用 `handoff_tokens` 表 | 保存一次性 WebView 登录 token hash |
| LoginQrViewState | React memory | `/login` 页面组件内存 | `browser_token` 只保留在浏览器内存 |

## 共享数据结构

### 创建登录 QR

```typescript
interface CreateLoginQrSessionRequest {
  protocol_version?: "1";           // 协议版本，默认 1
  client?: "kongming-login";        // 创建方标识，默认 kongming-login
  requested_scopes?: string[];      // 请求授权 scope，默认 webview/thread.read/approval.resolve
}

interface CreateLoginQrSessionResponse {
  login_qr_id: string;              // 登录 QR 会话 ID
  browser_token: string;            // 登录页私密 token，只返回一次
  status: "pending_scan";           // 初始状态
  expires_at: string;               // ISO 8601 过期时间
  server_origin: LoginQrOriginView;  // 规范化 server origin，含 mode/origin/scheme/host
  server: string;                   // 等于 server_origin.origin，供 deeplink/copy URL 使用
  qr_payload: string;               // 二维码 deeplink 内容
  copy_url: string;                 // fallback URL
}
```

### 状态查询

```typescript
interface LoginQrStatusResponse {
  login_qr_id: string;              // 登录 QR 会话 ID
  status: LoginQrSessionStatus;     // 当前会话状态
  expires_at: string;               // ISO 8601 过期时间
  claim: LoginQrClaimView | null;   // 已扫码设备信息，未扫码为空
}

interface LoginQrClaimView {
  claim_id: string;                 // APK claim ID
  device_id: string;                // APK 设备 ID
  label: string;                    // 设备展示名
  platform: "android";              // 平台
  app_version: string;              // APK 版本
  capabilities: Record<string, boolean>; // APK 能力声明
  status: LoginQrClaimStatus;       // claim 状态
  created_at: string;               // ISO 8601 claim 时间
}
```

状态查询请求使用 `X-Kongming-Login-Qr-Token` header 传递 `browser_token`，响应体不回显该 token。

### 确认与 exchange

```typescript
interface ConfirmLoginQrRequest {
  browser_token: string;            // 登录页私密 token
  claim_id: string;                 // 待确认 claim ID
  password: string;                 // 用户输入密码
}

interface ConfirmLoginQrResponse {
  status: "confirmed";              // 确认成功状态
  poll_after_ms: number;            // APK 继续轮询建议间隔
}

interface ExchangeLoginQrResponse {
  status: "approved";               // exchange 成功状态
  server_origin: LoginQrOriginView;  // 与 payload 一致的规范化 server origin
  server: string;                   // 等于 server_origin.origin
  device_token: string;             // APK 保存的 Bearer token
  token_type: "Bearer";             // token 类型
  scopes: string[];                 // 已授权 scope
  device_id: string;                // 当前 APK 设备 ID
  instance: { alias: string; url: string }; // APK 展示的 Kongming 实例信息
  web_session_url: string;          // APK WebView 打开的登录 URL
}
```

## 错误码

| 错误码 | HTTP | 触发场景 | UI/客户端行为 |
|--------|------|----------|---------------|
| `server_origin_required` | 400 | 缺少 `web.server_origin` 或等价配置 | 登录页展示配置提示 |
| `server_origin_invalid_scheme` | 400 | scheme 属于 `http`/`https` 之外的值 | 登录页提示配置 HTTPS 公网域名或 HTTP 私网 IP |
| `server_origin_loopback` | 400 | host 为 localhost、127.0.0.0/8、0.0.0.0、::1、链路本地或未指定地址 | 登录页提示换成公网域名或 LAN 私网 IP |
| `server_origin_not_lan_ip` | 400 | HTTP origin 的 host 处于 RFC1918 范围之外 | 登录页提示 HTTP 只支持同一局域网私网 IP |
| `server_origin_public_host_invalid` | 400 | HTTPS origin 的 host 为 IP、localhost 或无法作为域名处理 | 登录页提示公网模式使用 HTTPS 域名 |
| `login_qr_not_found` | 404 | 会话缺失 | 登录页刷新 QR |
| `login_qr_expired` | 410 | TTL 到期 | 登录页展示过期并提供刷新 |
| `browser_token_mismatch` | 403 | status/confirm 私密 token 错误 | 登录页刷新 QR |
| `nonce_mismatch` | 403 | APK nonce 校验失败 | APK 终止该 QR |
| `login_qr_already_claimed` | 409 | 重复 claim | 登录页展示当前设备或刷新 |
| `approval_pending` | 202 | APK exchange 时等待密码确认 | APK 按 `poll_after_ms` 轮询 |
| `approval_denied` | 403 | 会话取消或后续拒绝 | APK 回到扫码页 |
| `login_qr_already_exchanged` | 409 | 重复 exchange | APK 使用已保存 token 或重新扫码 |
