# XSpace Mobile Pairing 接入交接报告

> 日期：2026-06-14  
> Kongming 侧状态：后端核心、REST Router、Web 连接页、handoff consume、Auth/CSRF 例外已完成  
> 交接对象：XSpace Android、XSpace Desktop

## 结论

XSpace Android 扫码后走 `claim -> 等桌面批准 -> exchange -> 保存 device token -> 打开 web_session_url`。Kongming 当前已完成服务端主链路：配对状态机、SQLite 原子持久化、device token hash 落盘、handoff token 单次消费、设备吊销校验、FastAPI Router、Web 连接手机页、copy fallback 页、Auth/CSRF 精确例外和聚焦测试。

XSpace 当前可以进入真实联调准备：Android 侧补 secure storage、冷启动 session-handoff、deeplink intent 和真机扫码；Desktop 侧补“连接手机”入口，打开 `{instance.url}/-/xspace/mobile/connect`。跨 origin 访问需要在真机和生产部署里确认 CORS / WebView 网络策略。

## 已落地的 Kongming 服务端能力

代码入口：

- `src/hosts/web/xspace_mobile/manager.py`
- `src/hosts/web/xspace_mobile/repository.py`
- `src/hosts/web/xspace_mobile/token_service.py`
- `src/hosts/web/xspace_mobile/models.py`
- `src/hosts/web/xspace_mobile/errors.py`
- `src/hosts/web/routers/xspace_mobile.py`
- `src/hosts/web/auth/middleware.py`
- `src/hosts/web/app.py`

核心门户和接入点：

| 门户 | 职责 |
|---|---|
| `MobilePairingManager` | create / claim / approve / deny / exchange / revoke 的业务状态机 |
| `MobilePairingRepository` | SQLite schema、pairing/claim/device/handoff 读写、原子状态更新 |
| `MobileDeviceTokenService` | device token 签发、hash 校验、handoff token 签发和消费 |
| `hosts.web.routers.xspace_mobile` | `/api/xspace/mobile/*`、`/-/xspace/mobile/*` HTTP/Web 接入 |
| `AuthMiddleware` / `CSRFMiddleware` | claim / exchange / session-handoff 的匿名协议例外和 Web 路径保护 |

已暴露接口：

| 路径 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `/api/xspace/mobile/capabilities` | GET | 能力探测 | public |
| `/api/xspace/mobile/pairing-sessions` | POST | Web 创建 pairing session | Web cookie + CSRF |
| `/api/xspace/mobile/pairing-sessions/{pairing_id}` | GET | Web 轮询 pairing / claim 状态 | Web cookie |
| `/api/xspace/mobile/pairing-sessions/{pairing_id}/claim` | POST | Android 匿名 claim | pairing_id + nonce |
| `/api/xspace/mobile/pairing-sessions/{pairing_id}/approve` | POST | Web 批准或拒绝 claim | Web cookie + CSRF |
| `/api/xspace/mobile/pairing-sessions/{pairing_id}/exchange` | POST | Android 轮询并兑换 device token | pairing_id + nonce + device_id |
| `/api/xspace/mobile/session-handoff` | POST | Android 用 device token 换新 WebView URL | `Authorization: Bearer kgm_dt_...` |
| `/api/xspace/mobile/devices` | GET | Web 列出已授权设备 | Web cookie |
| `/api/xspace/mobile/devices/{device_id}` | DELETE | Web 吊销设备 | Web cookie + CSRF |
| `/-/xspace/mobile/connect` | GET | Web 连接手机页面 | Web cookie |
| `/-/xspace/mobile/pair` | GET | 系统相机 / copy URL fallback 页 | public |
| `/-/xspace/mobile/session/consume` | GET | 消费 handoff token、设置 `kongming_session`、302 `/` | handoff token |

最终验证：

- Mobile pairing focused tests：`47 passed`
- Ruff：`All checks passed!`
- QA Gate：R1 / R2 / R3 全部 PASS
- QA 报告：`dev-pipeline/tasks/mobile-pairing-backend-core/reports/qa/qa-gate-report-20260614-010211.md`
- HTTP/Web 任务报告：`dev-pipeline/tasks/mobile-pairing-api-web/dev-report.md`
- 错误合同任务报告：`dev-pipeline/tasks/mobile-pairing-http-error-contract-qdev/dev-report.md`
- 代码提交：`f839efb2 feat(mobile-pairing): expose HTTP pairing routes`
- 任务记录提交：`f9a2fce8 docs(mobile-pairing): record HTTP pairing tasks`

## XSpace Android 扫码后流程

### 1. 解析二维码

二维码格式：

```text
xspace://pair-kongming?v=1
  &server=https%3A%2F%2Fkongming.example.com
  &pairing_id=pr_...
  &nonce=base64url-random
```

复制链接格式：

```text
https://kongming.example.com/-/xspace/mobile/pair
  ?v=1
  &server=https%3A%2F%2Fkongming.example.com
  &pairing_id=pr_...
  &nonce=base64url-random
```

Android 侧解析字段：

| 字段 | 要求 |
|---|---|
| `v` | P0 固定为 `"1"` |
| `server` | Kongming origin，生产只接受 HTTPS |
| `pairing_id` | `pr_` 前缀配对会话 ID |
| `nonce` | 单次随机校验值 |

复制链接携带 `server` 参数。URL origin 仍可作为 fallback 推导来源，建议 XSpace parser 保持对 `server` query 的兼容读取。

### 2. claim 配对会话

Android 解析二维码后调用：

```http
POST {server}/api/xspace/mobile/pairing-sessions/{pairing_id}/claim
Content-Type: application/json
```

该接口由 Kongming Auth / CSRF 精确例外放行，Android 侧仍建议带 `Content-Type: application/json`。Web 侧 mutating 请求继续带 `X-Requested-With: XMLHttpRequest`。

请求：

```json
{
  "protocol_version": "1",
  "nonce": "base64url-random",
  "device": {
    "device_id": "xspace_android_9f2a...",
    "label": "Pixel 9",
    "platform": "android",
    "app_version": "0.1.0"
  },
  "capabilities": {
    "webview": true,
    "camera_scan": true,
    "push": false
  }
}
```

成功响应：

```json
{
  "pairing_id": "pr_...",
  "claim_id": "cl_...",
  "status": "pending_approval",
  "poll_after_ms": 1000
}
```

Android 行为：

- 保存临时态：`server`、`pairing_id`、`claim_id`、`nonce`、`device_id`
- 展示“等待桌面确认”
- 按 `poll_after_ms` 轮询 exchange

### 3. 等桌面批准

Kongming Web 页面展示设备信息：

- `device.label`
- `device.platform`
- `device.app_version`
- `capabilities`

桌面批准后，Kongming 后端把 session 和 claim 推到 `approved`。桌面拒绝后推到 `denied`。

### 4. exchange 换取移动端凭据

Android 轮询调用：

```http
POST {server}/api/xspace/mobile/pairing-sessions/{pairing_id}/exchange
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

等待批准响应：

```http
HTTP/1.1 202 Accepted
Content-Type: application/json
```

```json
{
  "status": "pending_approval",
  "poll_after_ms": 1000
}
```

批准后响应：

```json
{
  "status": "approved",
  "server": "https://kongming.example.com",
  "device_token": "kgm_dt_...",
  "token_type": "Bearer",
  "scopes": ["webview", "thread.read"],
  "device_id": "xspace_android_9f2a...",
  "instance": {
    "alias": "Kongming",
    "url": "https://kongming.example.com"
  },
  "web_session_url": "https://kongming.example.com/-/xspace/mobile/session/consume?handoff_token=kgm_ht_..."
}
```

Android 成功后的动作：

1. 将 `server` 写入远程实例列表。
2. 将 `device_token` 写入 Android secure storage，按 instance 绑定。
3. 保存 `auth_kind = "mobile_device_token"` 或等价本地标记。
4. 打开 `web_session_url` 进入 Kongming WebView。
5. 清理本次 pairing 临时态。

## 冷启动 handoff

App 冷启动或重新打开远程 Kongming 时，Android 使用已保存的 device token 换取新的 WebView 登录 URL：

```http
POST {server}/api/xspace/mobile/session-handoff
Authorization: Bearer kgm_dt_...
Content-Type: application/json
```

响应：

```json
{
  "web_session_url": "https://kongming.example.com/-/xspace/mobile/session/consume?handoff_token=kgm_ht_...",
  "expires_at": "2026-06-13T16:25:00Z"
}
```

Android 行为：

- 立即打开 `web_session_url`
- `handoff_token` 由 Kongming 单次消费，建议 60 秒内过期
- `device_revoked` 时删除本地 `device_token` 并提示重新扫码

## XSpace Desktop 接入点

Desktop 侧只需要增加入口，打开当前 Kongming 实例的连接手机页面：

```text
{instance.url}/-/xspace/mobile/connect
```

该页面由 Kongming Web 负责生成 QR、展示倒计时和审批待授权设备。

Desktop 入口建议放在实例操作区或当前实例菜单里。入口无需自行生成二维码，只负责打开 Kongming 页面。

## XSpace Android 本地状态建议

P0 保存：

| 状态 | 位置 | 说明 |
|---|---|---|
| instance URL / alias | `InstanceStore` | 远程 Kongming 实例 |
| `device_token` | Android secure storage | 按 instance 绑定 |
| `auth_kind` | `InstanceStore` 或派生字段 | 建议值：`mobile_device_token` |

建议结构：

```ts
type KongmingInstanceAuth = {
  auth_kind: "none" | "mobile_device_token"
  token_ref?: string
}
```

`device_token` 明文只保存在 Android secure storage。Kongming 服务端只保存 SHA-256 hash。

## 错误码处理

统一错误结构：

```json
{
  "error": {
    "code": "pairing_expired",
    "message": "pairing expired: pr_...",
    "retryable": false
  }
}
```

P0 错误码：

| code | HTTP | Android 处理 |
|---|---:|---|
| `unsupported_protocol` | 400 | 提示版本不兼容，停止配对 |
| `invalid_pairing_payload` | 400 | 提示链接或请求无效，停止配对 |
| `pairing_not_found` | 404 | 提示二维码失效，重新扫码 |
| `pairing_expired` | 410 | 提示二维码过期，重新扫码 |
| `nonce_mismatch` | 403 | 拒绝继续配对 |
| `pairing_already_claimed` | 409 | 提示二维码已被使用 |
| `approval_pending` | 202 | 按 `poll_after_ms` 继续轮询 |
| `approval_denied` | 403 | 展示“桌面已拒绝授权” |
| `device_revoked` | 401 | 删除本地 device token，引导重新扫码 |
| `token_expired` | 401 | 重新调用 session-handoff |
| `reauth_required` | 401 | 清理本地 token，引导重新扫码 |

Kongming 内部错误码会归一化后返回给 Android：

| 内部错误码 | 公开错误码 |
|---|---|
| `invalid_request` | `invalid_pairing_payload` |
| `claim_not_found` | `pairing_not_found` |
| `handoff_expired` | `token_expired` |
| `handoff_consumed` | `reauth_required` |
| `invalid_token` | `reauth_required` |

## 安全约束

- 二维码只包含短期 pairing 句柄和 nonce，不包含长期 token。
- `pairing_id` 默认 TTL 为 60 秒。
- `nonce` 服务端只保存 SHA-256 hash。
- `device_token` 明文只返回一次，Kongming 只保存 hash。
- `handoff_token` 明文只放在 `web_session_url` 中，Kongming 只保存 hash，且单次消费。
- exchange 写入 device token hash、handoff token hash、session/claim exchanged 状态使用同一个 SQLite 事务。
- Android 删除实例时同步删除 secure storage 里的 device token。
- 生产环境接受 HTTPS server；loopback HTTP 只用于开发开关。

## Kongming 侧当前联调注意点

Kongming 服务端主链路已完成，联调阶段重点确认下面几项：

| 注意点 | 说明 |
|---|---|
| CORS / WebView 网络策略 | 当前 Kongming 没有全局 CORS middleware。XSpace Android WebView 直接跨 origin `fetch` 时需要真机确认部署策略。 |
| Web connect 页面 UI | P0 页面是轻量 HTML，可用于联调；产品化样式和二维码图片化可后续补。 |
| 真实设备 smoke | 当前验证是 FastAPI TestClient + SQLite 状态机，真机相机、系统 deeplink、WebView cookie 持久化需要 XSpace 真机验证。 |
| 生产 origin | 生产建议 HTTPS；loopback HTTP 只用于开发环境。 |

## XSpace 侧当前开发项

1. Android secure token store：按 instance URL 或 instance ID 保存 `kgm_dt_...`，落 Android Keystore / secure storage。
2. Android cold start handoff：用 Bearer device token 调 `/api/xspace/mobile/session-handoff`，打开新的 `web_session_url`。
3. Android deeplink intent：注册 `xspace://pair-kongming`，支持系统相机和 fallback 页拉起 XSpace。
4. Android parser 对齐：copy URL 可从 query 读取 `server`，也可从 URL origin fallback。
5. Desktop 入口：打开 `{instance.url}/-/xspace/mobile/connect`。
6. InstanceStore 接入：实例记录增加 `auth_kind = "mobile_device_token"` 和 `token_ref` 或等价结构。
7. 错误 UI：覆盖 expired、pending、denied、revoked、nonce mismatch、reauth_required、token_expired。

## 联调验收

P0 真机 smoke：

1. Kongming Web 打开 `/-/xspace/mobile/connect`，出现 QR。
2. XSpace Android 扫码后进入等待桌面确认。
3. Kongming Web 展示待授权设备，用户批准。
4. Android exchange 成功，保存远程 instance 和 `device_token`。
5. Android 打开 `web_session_url`，WebView 进入已登录 Kongming。
6. Android 冷启动使用 `session-handoff` 重新进入 WebView。
7. Kongming Web 吊销设备后，Android 下一次 handoff 收到 `device_revoked` 并清除 token。

服务端当前可用验证命令：

```bash
uv run pytest tests/unit/web/test_xspace_mobile_pairing_manager.py tests/unit/web/test_xspace_mobile_pairing_repository.py tests/unit/web/test_xspace_mobile_token_service.py tests/unit/web/test_xspace_mobile_errors.py tests/unit/web/test_xspace_mobile_pairing_router.py -q
uv run ruff check src/hosts/web/auth/middleware.py src/hosts/web/app.py src/hosts/web/xspace_mobile src/hosts/web/routers/xspace_mobile.py tests/unit/web/test_xspace_mobile_errors.py tests/unit/web/test_xspace_mobile_pairing_router.py
```

## 参考文件

- 原始合同：`/Volumes/machub_app/proj/XSpace/docs/claude-code-runtime/07-mobile-remote-pairing-contract.md`
- Kongming spec：`docs/xspace-mobile-pairing/mobile-remote-pairing-v0.1/`
- 后端核心任务包：`dev-pipeline/tasks/mobile-pairing-backend-core/`
- HTTP/Web 接入任务包：`dev-pipeline/tasks/mobile-pairing-api-web/`
- 错误合同任务包：`dev-pipeline/tasks/mobile-pairing-http-error-contract-qdev/`
- QA 报告：`dev-pipeline/tasks/mobile-pairing-backend-core/reports/qa/qa-gate-report-20260614-010211.md`
- 最终 verify：`dev-pipeline/tasks/mobile-pairing-backend-core/reports/verify/verify-report-20260614-005730.md`
