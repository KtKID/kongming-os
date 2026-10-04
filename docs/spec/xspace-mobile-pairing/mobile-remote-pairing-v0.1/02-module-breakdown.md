# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| MobilePairingManager | 配对业务唯一入口，编排创建、claim、approve、exchange、吊销 | Repository + TokenService + AuditSink | 可进入 x-req | P0 阻塞模块 |
| MobilePairingRepository | 读写 pairing session、claim、device、token、handoff 状态 | `<kongming_home>/web` 存储 | 可进入 x-req | 介质待定，P0 推荐 JSONL/SQLite 二选一 |
| MobileDeviceTokenService | 生成、校验、轮换 device token 和 handoff token | Repository + auth serializer | 可进入 x-req | P0 推荐 opaque token + hash 落盘 |
| MobilePairingRouter | FastAPI REST/页面端点和错误码翻译 | Manager + auth middleware | 可进入 x-req | 新增 `src/hosts/web/routers/xspace_mobile.py` |
| MobilePairingWebPage | 桌面连接手机页、fallback 页、QR/复制/待授权 UI | Router + 前端 AuthGuard/Layout | 可进入 x-req | 新增 `web/src/modules/xspace-mobile-pairing/` |
| MobilePairingAuditSink | 记录授权、拒绝、handoff、吊销审计 | Manager + Repository | 探索中 | P1，可先留接口 |

## 模块详情

### 模块 1：MobilePairingManager

**职责**：提供移动配对业务门户，维护 pairing session 状态机和设备授权不变量。

**包含范围**：
- 创建 pairing session、生成 QR payload 和 copy URL。
- claim session，校验 `protocol_version`、`nonce`、过期时间、单次 claim。
- approve / deny claim。
- exchange device token 与 handoff URL。
- 设备列表和吊销。

**范围外**：
- HTTP 状态码翻译和 FastAPI Request/Response 细节。
- React 页面状态和二维码渲染。
- Android secure store。

**依赖**：MobilePairingRepository、MobileDeviceTokenService、MobilePairingAuditSink。

**复用/新建**：新建 `src/hosts/web/xspace_mobile/manager.py`。复用 `src/hosts/web/auth/middleware.py` 的 cookie 签发能力和 `request.app.state.kongming_home`。

**数据结构/接口**：

```python
class PairingSessionCreateInput(BaseModel):
    protocol_version: str  # 协议版本，P0 固定为 "1"
    client: str  # 创建方标识，P0 为 "kongming-web"
    requested_scopes: list[str]  # 手机希望获得的权限范围，如 webview/thread.read/approval.resolve
    server_origin: str  # Kongming HTTPS origin，用于生成 QR payload 和 copy URL

class PairingSessionCreateResult(BaseModel):
    pairing_id: str  # 配对会话 ID，pr_ 前缀，URL 友好
    expires_at: datetime  # 会话过期时间，UTC
    qr_payload: str  # xspace://pair-kongming deeplink，包含 server/pairing_id/nonce
    copy_url: str  # https fallback URL，供复制和系统相机打开
    status: Literal["pending_scan"]  # 初始状态，等待手机扫描
```

**风险等级**：高
**风险说明**：状态机、nonce、token 和 cookie handoff 同时涉及安全边界。建议第一组 task 先做纯后端 Manager 单测和合同 fixture。

**task 建议**：
- 建议 task 名：`mobile-pairing-backend-core`
- 对应 DoD：创建 pairing、claim、approve、exchange、吊销
- 是否进入 x-req：是
- 原因：合同足够明确，风险集中在实现和测试。

### 模块 2：MobilePairingRepository

**职责**：提供移动配对数据持久化边界，隐藏文件/SQLite 介质。

**包含范围**：
- PairingSession、PairingClaim、MobileDevice、DeviceToken、HandoffToken 的 CRUD。
- 原子状态更新和过期清理。
- device token hash 查询。

**范围外**：
- token 明文生成。
- 业务状态迁移判断。
- HTTP 错误映射。

**依赖**：`<kongming_home>/web` 目录、原子写入工具。

**复用/新建**：新建 `src/hosts/web/xspace_mobile/repository.py`。可参考 `src/hosts/web/auth/secrets.py` 的 `<home>/web` 安全文件落盘和 0600 权限写入方式。

**数据结构/接口**：

```python
class PairingSessionRecord(BaseModel):
    pairing_id: str  # 配对会话 ID，主键
    nonce_hash: str  # nonce 的哈希值，避免明文长期落盘
    server_origin: str  # 创建时的 Kongming origin
    requested_scopes: list[str]  # 本次请求的 scope
    status: str  # pending_scan/pending_approval/approved/denied/expired/exchanged
    expires_at: datetime  # 会话过期时间，UTC
    created_at: datetime  # 创建时间，UTC

class MobileDeviceRecord(BaseModel):
    device_id: str  # Android 设备 ID，XSpace 生成
    label: str  # 设备展示名，如 Pixel 9
    platform: Literal["android"]  # 平台，P0 只接受 android
    app_version: str  # XSpace Android 版本
    scopes: list[str]  # 已授权 scope
    revoked_at: datetime | None  # 吊销时间；空值表示可用
    created_at: datetime  # 首次授权时间，UTC
    last_seen_at: datetime | None  # 最近 handoff 或 exchange 时间，UTC
```

**风险等级**：中
**风险说明**：当前 Web 已有文件态和 SQLite 混用。P0 若追求最短路径可用 JSON 文件 + 文件锁；若要并发稳态建议直接 SQLite。

**task 建议**：
- 建议 task 名：`mobile-pairing-storage`
- 对应 DoD：所有后端状态和吊销
- 是否进入 x-req：是
- 原因：实现边界清晰，介质需要定稿。

### 模块 3：MobileDeviceTokenService

**职责**：签发和校验移动设备 token、一次性 handoff token，并把 WebView handoff 转成既有 Web session cookie。

**包含范围**：
- 生成 `kgm_dt_...` device token 明文，落盘 hash。
- 校验 Bearer token，返回 device 记录或 `device_revoked`。
- 生成 `handoff_token`，绑定 device、scope、过期时间。
- 消费 handoff token 后调用既有 `issue_session_cookie()` 设置 `kongming_session`。

**范围外**：
- Android 本地 token 保存。
- 前端 WebView 打开行为。

**依赖**：MobilePairingRepository、`hosts.web.auth.middleware.issue_session_cookie`、app serializer。

**复用/新建**：新建 `src/hosts/web/xspace_mobile/token_service.py`。复用既有 cookie 签发和 session secret。

**数据结构/接口**：

```python
class HandoffIssueResult(BaseModel):
    web_session_url: str  # 一次性登录 URL，Android WebView 打开
    expires_at: datetime  # handoff token 过期时间，UTC

class DeviceTokenValidationResult(BaseModel):
    device_id: str  # 已校验设备 ID
    scopes: list[str]  # 设备已授权 scope
    revoked: bool  # 是否已吊销
```

**风险等级**：高
**风险说明**：device token 一旦泄漏可换取 Web session。P0 建议 opaque 随机 token + SHA-256 hash 落盘 + 可吊销，避免 JWT 吊销复杂度。

**task 建议**：
- 建议 task 名：`mobile-pairing-token-handoff`
- 对应 DoD：exchange、session-handoff、consume URL
- 是否进入 x-req：是
- 原因：安全边界明确，需合同测试约束。

### 模块 4：MobilePairingRouter

**职责**：暴露 XSpace mobile pairing REST API、fallback 页面端点和错误码。

**包含范围**：
- `GET /api/xspace/mobile/capabilities`
- `POST /api/xspace/mobile/pairing-sessions`
- `POST /api/xspace/mobile/pairing-sessions/{pairing_id}/claim`
- `POST /api/xspace/mobile/pairing-sessions/{pairing_id}/approve`
- `POST /api/xspace/mobile/pairing-sessions/{pairing_id}/exchange`
- `POST /api/xspace/mobile/session-handoff`
- `GET /api/xspace/mobile/devices`
- `DELETE /api/xspace/mobile/devices/{device_id}`
- `GET /-/xspace/mobile/session/consume`

**范围外**：
- React 页面渲染。
- Android deeplink 解析。

**依赖**：MobilePairingManager、AuthMiddleware、CSRFMiddleware、FastAPI exception handler。

**复用/新建**：新建 `src/hosts/web/routers/xspace_mobile.py`，在 `src/hosts/web/app.py` 注册 router。错误结构沿用现有 `KongmingWebError` 或新增 mobile 专用异常映射。

**数据结构/接口**：

```typescript
type MobilePairingErrorCode =
  | "unsupported_protocol" // v 或 protocol_version 超出服务端支持范围
  | "invalid_pairing_payload" // URL 或请求字段缺失、格式错误
  | "pairing_not_found" // pairing_id 无记录
  | "pairing_expired" // 配对会话已过期
  | "nonce_mismatch" // nonce 校验失败
  | "pairing_already_claimed" // 会话已被其它设备 claim
  | "approval_pending" // 等待桌面确认
  | "approval_denied" // 桌面拒绝授权
  | "device_revoked"; // 设备 token 已吊销
```

**风险等级**：中
**风险说明**：AuthMiddleware 默认保护所有 `/api/*`，claim/exchange/session-handoff 需要清晰的 auth 例外或 router 内校验。推荐在 AuthMiddleware 增加精确移动配对白名单，同时 router 内执行 nonce/Bearer 校验。

**task 建议**：
- 建议 task 名：`mobile-pairing-api-contract`
- 对应 DoD：全部 API 合同和错误码
- 是否进入 x-req：是
- 原因：接口合同已由 XSpace 文档给出。

### 模块 5：MobilePairingWebPage

**职责**：提供桌面用户连接手机入口和系统相机 fallback 页。

**包含范围**：
- `/-/xspace/mobile/connect`：创建配对会话、展示 QR、复制链接、过期倒计时、待授权设备。
- `/-/xspace/mobile/pair`：展示打开 XSpace 按钮、复制 deeplink、展示 server/pairing_id 状态。
- 批准/拒绝待授权设备。
- 过期后刷新二维码。

**范围外**：
- Android deeplink handler。
- XSpace desktop 菜单入口。

**依赖**：MobilePairingRouter、AuthGuard/Layout、现有 `apiGet/apiPost` 客户端工具、全局 approval inbox 的 WebSocket fan-out 模式。

**复用/新建**：新建 `web/src/modules/xspace-mobile-pairing/`。QR 渲染可引入前端二维码库，或后端返回 QR SVG/PNG；P0 建议前端用库渲染 `qr_payload`，便于复制链接和重新生成。

**数据结构/接口**：

```typescript
type PairingPageState = {
  pairingId: string; // 当前配对会话 ID
  qrPayload: string; // 二维码内容
  copyUrl: string; // 可复制 fallback URL
  expiresAt: string; // ISO 时间，页面倒计时使用
  pendingClaim?: PendingClaimView; // 待授权手机设备，空值表示等待扫码
};

type PendingClaimView = {
  claimId: string; // claim ID
  deviceId: string; // 手机设备 ID
  label: string; // 展示名
  platform: "android"; // 平台
  appVersion: string; // XSpace Android 版本
};
```

**风险等级**：中
**风险说明**：`/-/xspace/mobile/pair` 属于公开 fallback 页面，既要可被系统相机打开，也要避免暴露长期凭据。P0 页面只展示 deeplink 和复制内容，所有敏感动作走 API 校验。

**task 建议**：
- 建议 task 名：`mobile-pairing-web-connect-page`
- 对应 DoD：二维码、复制链接、授权确认
- 是否进入 x-req：是
- 原因：页面状态和 API 合同清晰。

### 模块 6：MobilePairingAuditSink

**职责**：记录移动配对安全事件，支撑后续问题追踪和用户可见授权历史。

**包含范围**：
- pairing 创建、claim、approve、deny、exchange、handoff consume、device revoke。
- 记录 device_id、label、client IP、user agent、状态、时间。

**范围外**：
- 审计 UI。
- 外部 SIEM 或云端日志。

**依赖**：MobilePairingManager、`<kongming_home>/web/mobile_pairing_audit.jsonl`。

**复用/新建**：新建 `src/hosts/web/xspace_mobile/audit.py`，可参考 auto approval audit 的 JSONL 形态。

**数据结构/接口**：

```python
class MobilePairingAuditEvent(BaseModel):
    event_type: str  # 事件类型，如 pairing.created/device.revoked
    pairing_id: str | None  # 相关 pairing ID
    device_id: str | None  # 相关设备 ID
    outcome: str  # success/denied/expired/error
    created_at: datetime  # 事件时间，UTC
```

**风险等级**：低
**风险说明**：P0 可只落最小安全事件，审计查询 UI 放到后续。

**task 建议**：
- 建议 task 名：`mobile-pairing-audit`
- 对应 DoD：设备吊销和安全可追踪
- 是否进入 x-req：否
- 原因：P0 主链路可先通过日志钩子覆盖。

## 待确认项

| 项 | 推荐 | 影响 |
|----|------|------|
| device token 形态 | opaque 随机 token + hash 落盘 | 吊销直接查表，泄漏面更小 |
| 持久化介质 | SQLite | 并发 claim/exchange 原子性更强 |
| `/-/xspace/mobile/pair` 承载方式 | FastAPI 轻量 HTML fallback + SPA 主 connect 页 | 系统相机打开无需前端登录态 |
| pending claim 推送 | P0 页面轮询，P1 接全局 inbox fan-out | 先降低 WebSocket 协议变更 |
| Android push 能力 | P0 返回 `push=false` | 合同已允许能力协商 |
