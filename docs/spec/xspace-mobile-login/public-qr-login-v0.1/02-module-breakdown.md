# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| LoginQrManager | 创建、claim、确认、exchange、状态查询和终态推进 | LoginQrAuthService、ServerOriginConfig、LoginQrRepository 内部实现 | 可进入 x-req | P0 状态机门户 |
| LoginQrAuthService | 密码确认、授权判定、device token 和 handoff URL 签发 | auth secrets、rate limiter、MobileDeviceTokenService | 可进入 x-req | P0 安全边界 |
| LoginQrRouter | 暴露匿名 login QR REST/API 和 fallback 页面 | FastAPI、AuthMiddleware、CSRFMiddleware、LoginQrManager | 可进入 x-req | P0 协议边界 |
| LoginPageQrPanel | `/login` 扫码登录 UI、轮询、密码确认和错误态 | repo:web/src/stores/auth.ts、repo:web/src/lib/api.ts、repo:web/src/pages/Login.tsx | 可进入 x-req | P0 前端体验 |
| XSpaceApkLoginClient | APK 扫码、claim/exchange、保存 device token、打开 WebView | XSpace APK | 方案确认 | 跨仓合同 |
| ServerOriginConfig | 公网 HTTPS 域名与 LAN HTTP 私网 IP origin 读取、校验和部署提示 | config.web.server_origin、run options | 可进入 x-req | P0 部署安全 |

## 现有资源调研

可复用清单：
- `repo:src/hosts/web/xspace_mobile/manager.py` 已有 `MobilePairingManager.create_pairing_session()`、`claim_session()`、`approve_claim()`、`exchange_pairing()` 主链路。
- `repo:src/hosts/web/xspace_mobile/repository.py` 已有 SQLite 短连接、`BEGIN IMMEDIATE`、pairing/claim/device/handoff 四类表和原子 exchange 经验。
- `repo:src/hosts/web/xspace_mobile/token_service.py` 已有 `MobileDeviceTokenService.issue_exchange_tokens()`、`issue_handoff_for_device_token()`、`consume_handoff_token()`。
- `repo:src/hosts/web/routers/xspace_mobile.py` 已有 `xspace://pair-kongming`、copy URL、现有 origin 拼装、session consume 和 cookie 设置路径。
- `repo:web/src/pages/Login.tsx` 已有密码登录和忘记密码重置页面，是新增扫码面板的直接入口。
- `repo:web/src/stores/auth.ts` 和 `repo:web/src/lib/api.ts` 已有登录状态、CSRF header、错误解析和 401 处理。
- `repo:tests/unit/web/test_xspace_mobile_pairing_router.py` 已有真实 FastAPI `TestClient` 主链路和 origin 测试，可作为 login QR router 测试模板。

需要新增或扩展：
- 新增 `LoginQrSession / LoginQrIntent` 业务对象，和已登录设备配对对象分开计数、分开状态。
- 新增 login QR API allowlist，明确哪些路径放行 cookie 鉴权，哪些路径放行 CSRF。
- 新增 browser-only `browser_token`，登录页轮询和密码确认使用 hash 校验，避免仅凭 `login_qr_id` 操作意图。
- 新增 origin 校验错误码，登录二维码接受 `public_https` 公网域名和 `lan_ip` 私网 IP 两种 origin。

## 模块详情

### 模块 1：LoginQrManager

**职责**：作为二维码登录业务门户，维护 `LoginQrSession` 状态机，统一创建、状态查询、APK claim、登录页密码确认、APK exchange 和终态推进。

**包含范围**：
- 创建短期登录 QR 会话。
- 生成 `xspace://login-kongming` payload，或在复用 `xspace://pair-kongming` 时写入 `purpose=login` 与 `client=kongming-login`。
- 校验 `nonce`、`browser_token`、TTL、状态迁移和单次 exchange。
- 管理 APK claim 设备信息与登录页 status view。
- 调用 `LoginQrAuthService` 完成密码确认和 token/handoff 签发。

**排除范围**：
- 密码 hash 细节。
- HTTP request/response DTO 转换。
- React UI 状态。
- APK native 扫码实现。

**依赖**：`LoginQrAuthService`、`ServerOriginConfig`、内部 `LoginQrRepository`、现有 `MobileDeviceTokenService`。

**复用/新建**：建议在 `repo:src/hosts/web/xspace_mobile/` 内新增登录 QR 子域，复用现有 token/handoff 能力和错误模型；新增 repository 表或在现有 schema 上扩展 purpose 字段时必须保持登录意图和设备配对意图可区分。

**数据结构/接口**：

```python
class LoginQrManager:
    """二维码登录业务门户。"""

    def create_login_intent(
        self,
        *,
        server_origin: LoginQrOriginView, # 规范化 server origin，写入 QR payload 的 server_origin 字段
        requested_scopes: list[str], # APK 获得 device token 后可用的 scope 列表
        ttl_seconds: int,          # QR 会话有效期，单位秒，P0 默认 60
    ) -> LoginQrCreateResult: ...

    def get_status(
        self,
        *,
        login_qr_id: str,          # 登录 QR 会话 ID，URL 安全字符串
        browser_token: str,        # 登录页持有的私密查询 token，用于防枚举
    ) -> LoginQrStatusView: ...

    def claim_from_device(
        self,
        *,
        login_qr_id: str,          # 登录 QR 会话 ID
        nonce: str,                # QR payload 中的 nonce 明文
        device: MobileDeviceDescriptor, # APK 设备描述
        capabilities: dict[str, bool],  # APK 能力声明，如 camera_scan/webview
    ) -> LoginQrClaimResult: ...

    def confirm_with_password(
        self,
        *,
        login_qr_id: str,          # 登录 QR 会话 ID
        browser_token: str,        # 登录页私密 token
        claim_id: str,             # 当前已 claim 的设备 claim ID
        password: str,             # 用户在登录页输入的单用户密码
        client_ip: str,            # 登录限流使用的客户端 IP
    ) -> LoginQrConfirmResult: ...

    def exchange_from_device(
        self,
        *,
        login_qr_id: str,          # 登录 QR 会话 ID
        claim_id: str,             # APK claim ID
        nonce: str,                # QR payload nonce 明文
        device_id: str,            # claim 时登记的设备 ID
    ) -> LoginQrExchangeResult: ...
```

**风险等级**：高

**风险说明**：匿名 `/login` 可创建 QR 登录意图，状态机必须保证 exchange 只在密码确认后签发 token。建议先做 Manager + Repository 状态机测试，再接 UI。

**task 建议**：
- 建议 task 名：`public-login-qr-backend`
- 对应 DoD：QR 生成、claim、status、confirm、exchange、错误码
- 是否进入 x-req：是
- 原因：P0 主链路字段和状态已经明确

### 模块 2：LoginQrAuthService

**职责**：封装二维码登录的授权确认与签发能力。P0 只实现登录页密码确认；后续扩展已绑定设备确认和已登录管理端审批时保持同一授权判定入口。

**包含范围**：
- 复用现有单密码校验逻辑。
- 复用登录限流 `LoginRateLimiter`。
- 在确认成功后记录授权证据到 `LoginQrSession`。
- 调用 `MobileDeviceTokenService.issue_exchange_tokens()` 或等价原子签发方法。
- 生成 `web_session_url`，复用现有 handoff consume cookie 设置路径。

**排除范围**：
- QR payload 生成。
- UI 输入框与倒计时。
- APK token 安全存储实现。

**依赖**：`repo:src/hosts/web/routers/auth.py`、`repo:src/hosts/web/auth/secrets.py`、`repo:src/hosts/web/auth/middleware.py`、`repo:src/hosts/web/xspace_mobile/token_service.py`。

**复用/新建**：新增 `LoginQrAuthService`，内部调用 `verify_password()`、`LoginRateLimiter`、`MobileDeviceTokenService` 和 `issue_session_cookie()` 相关能力；保持密码确认和普通 `/api/auth/login` 的限流语义一致。

**数据结构/接口**：

```python
class LoginQrAuthService:
    """登录 QR 授权与签发服务。"""

    async def confirm_password(
        self,
        *,
        password: str,             # 用户输入的单用户密码
        client_ip: str,            # 登录限流 key
    ) -> LoginQrAuthorization: ...

    def issue_exchange(
        self,
        *,
        session: LoginQrSessionRecord, # 已确认登录 QR 会话
        claim: LoginQrClaimRecord,     # 已 claim 的 APK 设备记录
    ) -> LoginQrExchangeResult: ...

class LoginQrAuthorization(BaseModel):
    method: Literal["password"]     # 授权方式，P0 固定为 password
    user_id: str                    # 会话用户 ID，单用户系统默认 default
    confirmed_at: datetime          # 授权确认时间，UTC
```

**风险等级**：高

**风险说明**：密码确认端点位于匿名 `/login` 页面，但会产生移动端登录能力。所有签发方法必须只接受已确认 session。

**task 建议**：
- 建议 task 名：`login-qr-auth-service`
- 对应 DoD：签发前授权确认、密码限流、handoff URL
- 是否进入 x-req：是
- 原因：可直接基于现有 auth/token 能力实现

### 模块 3：LoginQrRouter

**职责**：提供 Kongming Web 的匿名 login QR API，负责 DTO 转换、Auth/CSRF 边界、错误响应和 fallback 页面。

**包含范围**：
- `POST /api/xspace/mobile/login-qr-sessions`：登录页创建 QR 意图。
- `GET /api/xspace/mobile/login-qr-sessions/{login_qr_id}`：登录页轮询状态，要求 `X-Kongming-Login-Qr-Token` header。
- `POST /api/xspace/mobile/login-qr-sessions/{login_qr_id}/claim`：APK 匿名 claim。
- `POST /api/xspace/mobile/login-qr-sessions/{login_qr_id}/confirm`：登录页密码确认，要求 `browser_token` 和 CSRF header。
- `POST /api/xspace/mobile/login-qr-sessions/{login_qr_id}/exchange`：APK 匿名 exchange。
- `GET /-/xspace/mobile/login`：系统相机 fallback 页面，展示 deeplink 和 copy URL。

**排除范围**：
- 业务状态迁移。
- 密码 hash 细节。
- React 页面布局。

**依赖**：`LoginQrManager`、`ServerOriginConfig`、FastAPI app.state、AuthMiddleware/CSRFMiddleware allowlist。

**复用/新建**：建议复用 `repo:src/hosts/web/routers/xspace_mobile.py` 的 `_server_origin()`、`_web_session_url()`、`_mobile_error()` 模式；实现时把现有公网 origin 拼装收口到 `ServerOriginConfig`，新登录 QR 路径可在同一 router 中新增，或拆到 `repo:src/hosts/web/routers/login_qr.py` 并由 Web app 装配。

**数据结构/接口**：

```typescript
interface CreateLoginQrSessionResponse {
  login_qr_id: string;       // 登录 QR 会话 ID，给登录页和 APK API 使用
  browser_token: string;     // 只返回给登录页的私密 token，用于 status/confirm
  status: "pending_scan";    // 创建后的初始状态
  expires_at: string;        // ISO 8601 过期时间，登录页倒计时使用
  server_origin: LoginQrOriginView; // 规范化 origin，包含 mode/origin/scheme/host
  server: string;            // 与 server_origin.origin 相同，给旧 payload 拼装和 copy URL 使用
  qr_payload: string;        // xspace deeplink，二维码内容
  copy_url: string;          // 系统相机 fallback URL
}

interface ConfirmLoginQrRequest {
  browser_token: string;     // 创建响应中的私密 token
  claim_id: string;          // 当前待确认设备 claim ID
  password: string;          // 用户输入的单用户密码
}
```

**风险等级**：中

**风险说明**：AuthMiddleware 需要放行新路径，CSRFMiddleware 只放行 APK claim/exchange，浏览器 create/confirm 仍需 CSRF header；status 使用私密 header 传递 `browser_token`，避免 token 进入 URL 日志。

**task 建议**：
- 建议 task 名：`public-login-qr-router`
- 对应 DoD：API 合同、Auth/CSRF、稳定错误体
- 是否进入 x-req：是
- 原因：路由清单可直接测试

### 模块 4：LoginPageQrPanel

**职责**：在现有 `/login` 页面展示扫码登录区域，管理创建 QR、轮询状态、展示设备、密码确认、刷新和错误提示。

**包含范围**：
- 在 `repo:web/src/pages/Login.tsx` 增加密码登录与扫码登录并列布局。
- 新增 `repo:web/src/features/login-qr/LoginQrManager.ts` 或 `LoginQrPanel` 内部状态管理，收口 API 调用。
- 展示 QR 文本/图形、copy URL、倒计时、刷新按钮。
- 状态轮询：等待扫码、待密码确认、已确认、已完成、已过期、错误。
- 密码确认输入使用现有登录页视觉模式，错误显示复用 `ApiError`/`RateLimitedError`。

**排除范围**：
- XSpace APK 原生扫码 UI。
- 已登录布局内移动设备管理页。
- 多个同时 QR 会话队列。

**依赖**：`repo:web/src/pages/Login.tsx`、`repo:web/src/stores/auth.ts`、`repo:web/src/lib/api.ts`。

**复用/新建**：复用现有 Login 页面、Button/Input/Dialog 组件和 API 封装。建议新增 `repo:web/src/features/login-qr/LoginQrManager.ts` 作为前端边界类，`repo:web/src/features/login-qr/LoginQrPanel.tsx` 只负责渲染。

**数据结构/接口**：

```typescript
interface LoginQrViewState {
  phase: "idle" | "creating" | "pending_scan" | "pending_confirm" | "confirming" | "confirmed" | "exchanged" | "expired" | "failed"; // UI 阶段
  loginQrId: string | null;      // 当前登录 QR 会话 ID
  browserToken: string | null;   // 登录页私密 token，只留在内存
  qrPayload: string | null;      // 二维码内容，展示为 QR 或可复制文本
  copyUrl: string | null;        // fallback URL，供复制到 APK 或系统浏览器
  expiresAt: string | null;      // ISO 8601 过期时间
  deviceLabel: string | null;    // 已扫码设备展示名
  deviceId: string | null;       // 已扫码设备 ID
  claimId: string | null;        // 待确认 claim ID
  errorCode: string | null;      // 稳定错误码，用于 UI 文案映射
  errorMessage: string | null;   // 后端错误说明或网络错误说明
}
```

**风险等级**：中

**风险说明**：登录页已有忘记密码和 rate limit 状态，新增扫码面板时需要保持移动端布局稳定，并避免两个登录动作互相覆盖错误状态。

**task 建议**：
- 建议 task 名：`login-page-qr-panel`
- 对应 DoD：双入口、QR 展示、状态轮询、密码确认、错误态
- 是否进入 x-req：是
- 原因：UI 状态和 API 合同已明确

### 模块 5：XSpaceApkLoginClient

**职责**：定义 XSpace APK 需要实现的扫码登录客户端合同。此模块是跨仓协议，不在本仓落地原生代码。

**包含范围**：
- 扫码解析 `xspace://login-kongming` 或 `xspace://pair-kongming?purpose=login`。
- 按 `origin_mode` 校验 `server`：`public_https` 要求 HTTPS 域名，`lan_ip` 要求 HTTP 私网 IP。
- 调用 claim/exchange API。
- 处理 `approval_pending` 轮询。
- 保存 `device_token`。
- 安全打开 `web_session_url` 到同一 `server` 的 WebView。

**排除范围**：
- Android 相机权限实现。
- 安全存储具体库选择。
- APK 发布流水线。

**依赖**：Kongming LoginQrRouter API、XSpace APK WebView 宿主能力。

**复用/新建**：沿用 mobile pairing 的 `device_token` 和 `web_session_url` 返回结构；新增 `purpose=login` 或新 deeplink path 避免和设备配对混淆。

**数据结构/接口**：

```typescript
interface XSpaceLoginQrPayload {
  scheme: "xspace";             // deeplink scheme
  action: "login-kongming" | "pair-kongming"; // 推荐 login-kongming；复用 pair 时必须 purpose=login
  purpose: "login";             // 标识扫码登录用途
  origin_mode: "public_https" | "lan_ip"; // server origin 模式
  server: string;               // Kongming Web origin，等于 server_origin.origin
  login_qr_id: string;          // 登录 QR 会话 ID
  nonce: string;                // APK claim/exchange 校验用 nonce 明文
  v: "1";                       // 协议版本
}

interface XSpaceLoginExchangeResponse {
  status: "approved";           // exchange 成功后的状态
  server_origin: LoginQrOriginView; // 与 payload 一致的规范化 origin
  server: string;               // 与 payload server 一致的 origin
  device_token: string;         // APK 持久化保存的 Bearer token
  token_type: "Bearer";         // Authorization header 类型
  scopes: string[];             // 设备被授予的 scope
  device_id: string;            // 当前 APK 设备 ID
  web_session_url: string;      // APK WebView 打开的登录 URL
}
```

**风险等级**：中

**风险说明**：复用 `xspace://pair-kongming` 会让旧 APK 和新登录场景混淆。推荐 P0 新增 `xspace://login-kongming`，兼容 fallback URL 时保留 `purpose=login`。

**task 建议**：
- 建议 task 名：`xspace-apk-login-contract`
- 对应 DoD：payload、claim、exchange、token 保存、WebView URL
- 是否进入 x-req：是
- 原因：合同可先在本仓测试中固定，再给 XSpace 接入

### 模块 6：ServerOriginConfig

**职责**：保证登录 QR 使用可被 APK 访问的服务器 origin，并给配置错误提供稳定错误和可操作提示。

**包含范围**：
- 读取 `config.web.server_origin`。
- 解析 `public_https` 和 `lan_ip` 两种模式。
- 公网模式校验 scheme 为 `https` 且 host 为域名。
- LAN 模式校验 scheme 为 `http` 且 host 为 RFC1918 私网 IP。
- 拒绝 loopback、本机地址、链路本地地址和未指定地址。
- 在 create login QR 时返回稳定错误码。
- 登录页把 origin 错误显示为部署提示。

**排除范围**：
- 自动申请证书。
- 自动配置反代。
- 自动发现局域网 IP、mDNS 和端口探测。

**依赖**：`repo:src/hosts/web/run.py`、`repo:src/infrastructure/config/models.py`、`repo:src/hosts/web/routers/xspace_mobile.py`。

**复用/新建**：将现有公网 origin 配置使用点重命名或扩展为 `web.server_origin`；新增 `ServerOriginConfig.require_login_qr_origin()` 或同等 Manager 方法。

**数据结构/接口**：

```python
class ServerOriginConfig:
    """扫码登录 server origin 校验边界。"""

    def require_login_qr_origin(self, raw_origin: str | None) -> LoginQrOriginView:
        """返回可用于登录 QR 的规范化 origin。"""

class LoginQrOriginView(BaseModel):
    mode: Literal["public_https", "lan_ip"] # origin 模式
    origin: str                 # 规范化后的 origin，包含 scheme/host/port
    scheme: Literal["https", "http"] # public_https 使用 https，lan_ip 使用 http
    host: str                   # 公网域名或 RFC1918 私网 IP
    port: int | None            # 显式端口；默认端口可为空
```

**风险等级**：中

**风险说明**：反代部署下 `request.url.scheme` 可能仍是 HTTP，P0 必须以 `web.server_origin` 为二维码真源；公网模式验证 Secure cookie，LAN 模式验证私网 IP origin cookie。

**task 建议**：
- 建议 task 名：`server-origin-config`
- 对应 DoD：公网 HTTPS 域名、LAN HTTP 私网 IP、loopback/HTTP 公网域名稳定错误、UI 提示
- 是否进入 x-req：是
- 原因：配置判定规则清晰
