# public-qr-login-v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/03/04 是文字事实源，本文件是只读视图，增减模块或组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](./diagrams.md#总览)
- [E2E 测试链路](./diagrams.md#e2e-测试链路)
- [LoginQrManager](./diagrams.md#loginqrmanager)
- [LoginQrRouter](./diagrams.md#loginqrrouter)
- [LoginPageQrPanel](./diagrams.md#loginpageqrpanel)
- [XSpaceApkLoginClient](./diagrams.md#xspaceapkloginclient)
- [数据关系](./diagrams.md#数据关系)

图例：P0 为核心能力，P1 为主要能力，P2 为辅助能力。

## 总览

```mermaid
flowchart TD
  classDef module fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef support fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
  classDef client fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px

  Origin["ServerOriginConfig<br/>校验公网 HTTPS 与 LAN IP origin<br/>类/函数：require_login_qr_origin()"]:::support
  Router["LoginQrRouter<br/>公开 login QR API 和边界<br/>类/函数：create_login_qr_session()"]:::module
  Manager["LoginQrManager<br/>二维码登录状态机门户<br/>类/函数：exchange_from_device()"]:::module
  Auth["LoginQrAuthService<br/>密码确认和 token 签发<br/>类/函数：confirm_password()"]:::module
  UI["LoginPageQrPanel<br/>/login 扫码登录面板<br/>类/函数：LoginQrManager.create()"]:::module
  APK["XSpaceApkLoginClient<br/>扫码 claim exchange 和 WebView<br/>类/函数：claimLoginQr()"]:::client
  Token["MobileDeviceTokenService<br/>device token 与 handoff 真源<br/>类/函数：issue_exchange_tokens()"]:::support

  UI --> Router
  APK --> Router
  Router --> Origin
  Router --> Manager
  Manager --> Auth
  Auth --> Token
  Manager --> Token
```

## E2E 测试链路

```mermaid
flowchart LR
  classDef setup fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef action fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef assert fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Seed["准备测试数据<br/>seed password<br/>server_origin=public 或 lan"]:::setup
  Create["登录页动作<br/>POST login-qr-sessions"]:::action
  Claim["fake APK<br/>claim login_qr_id + nonce"]:::action
  Confirm["登录页确认<br/>password + browser_token"]:::action
  Exchange["fake APK<br/>exchange 获取 token 和 URL"]:::action
  Consume["WebView<br/>GET web_session_url"]:::action
  Assert["断言<br/>Set-Cookie kongming_session<br/>origin mode 正确"]:::assert

  Seed --> Create --> Claim --> Confirm --> Exchange --> Consume --> Assert
```

## LoginQrManager

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph LoginQrDomain["Login QR Domain"]
    Manager["LoginQrManager<br/>P0 · 状态机门户"]:::p0
    Repo["LoginQrRepository<br/>P0 · session/claim 原子读写"]:::p0
    Nonce["LoginQrTokenHasher<br/>P1 · nonce/browser token hash"]:::p1
    Status["LoginQrStatusProjector<br/>P1 · 登录页状态视图"]:::p1
  end

  Auth["LoginQrAuthService<br/>授权和签发"]:::p0
  Origin["ServerOriginConfig<br/>origin 校验"]:::p2

  Manager --> Repo
  Manager --> Nonce
  Manager --> Status
  Manager --> Auth
  Manager --> Origin
```

### 状态流转

```mermaid
stateDiagram-v2
  [*] --> pending_scan
  pending_scan --> pending_confirm: APK claim
  pending_confirm --> confirmed: 登录页密码确认
  confirmed --> exchanged: APK exchange
  pending_scan --> expired: TTL 到期
  pending_confirm --> expired: TTL 到期
  confirmed --> expired: TTL 到期
  pending_scan --> cancelled: 登录页刷新
  exchanged --> [*]
  expired --> [*]
  cancelled --> [*]
```

## LoginQrRouter

### 主链路时序

```mermaid
sequenceDiagram
  participant Login as LoginPageQrPanel
  participant Router as LoginQrRouter
  participant Manager as LoginQrManager
  participant APK as XSpaceApkLoginClient
  participant Auth as LoginQrAuthService
  participant Token as MobileDeviceTokenService

  Login->>Router: POST /api/xspace/mobile/login-qr-sessions
  Router->>Manager: create_login_intent()
  Manager-->>Login: qr_payload + browser_token
  APK->>Router: POST /claim
  Router->>Manager: claim_from_device()
  Login->>Router: GET status + X-Kongming-Login-Qr-Token
  Router-->>Login: pending_confirm + device
  Login->>Router: POST /confirm password
  Router->>Auth: confirm_password()
  Auth-->>Manager: authorization password
  APK->>Router: POST /exchange
  Router->>Manager: exchange_from_device()
  Manager->>Token: issue_exchange_tokens()
  Token-->>APK: device_token + web_session_url
```

### Auth/CSRF 边界

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph RouterMod["LoginQrRouter"]
    Create["create<br/>P0 · 匿名浏览器 + CSRF"]:::p0
    Status["status<br/>P0 · browser_token"]:::p0
    Confirm["confirm<br/>P0 · browser_token + password + CSRF"]:::p0
    Claim["claim<br/>P0 · APK nonce"]:::p0
    Exchange["exchange<br/>P0 · APK nonce + confirmed"]:::p0
  end

  AuthMW["AuthMiddleware<br/>放行 login QR public API"]:::p1
  CSRFMw["CSRFMiddleware<br/>claim/exchange 放行<br/>create/confirm 校验"]:::p1

  AuthMW --> Create
  AuthMW --> Status
  AuthMW --> Confirm
  AuthMW --> Claim
  AuthMW --> Exchange
  CSRFMw --> Create
  CSRFMw --> Confirm
```

## LoginPageQrPanel

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph LoginPageMod["Login Page QR UI"]
    ManagerTs["LoginQrManager<br/>P0 · API 和 UI 状态边界"]:::p0
    Panel["LoginQrPanel<br/>P0 · QR 与确认面板"]:::p0
    Timer["QrCountdown<br/>P1 · 过期倒计时"]:::p1
    Device["ClaimedDeviceView<br/>P1 · 设备信息"]:::p1
    Error["LoginQrErrorBanner<br/>P1 · 稳定错误文案"]:::p1
  end

  LoginPage["LoginPage<br/>密码登录并列入口"]:::p2
  Api["ApiClient<br/>CSRF 与错误解析"]:::p2

  LoginPage --> ManagerTs
  ManagerTs --> Panel
  Panel --> Timer
  Panel --> Device
  Panel --> Error
  ManagerTs --> Api
```

### UI 状态

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> creating: 点击扫码登录
  creating --> pending_scan: 创建成功
  pending_scan --> pending_confirm: status 返回 claim
  pending_confirm --> confirming: 输入密码确认
  confirming --> confirmed: confirm 成功
  confirmed --> exchanged: status 完成
  pending_scan --> expired: 410
  pending_confirm --> expired: 410
  creating --> failed: API 错误
  confirming --> pending_confirm: 密码错误或 429
  failed --> creating: 刷新
  expired --> creating: 刷新
```

## XSpaceApkLoginClient

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph ApkMod["XSpace APK Login Client"]
    Scan["QrScanner<br/>P0 · 扫码读取 payload"]:::p0
    Parse["LoginQrPayloadParser<br/>P0 · server/login_qr_id/nonce"]:::p0
    Api["KongmingLoginQrClient<br/>P0 · claim/exchange"]:::p0
    Store["DeviceTokenStore<br/>P1 · 保存 device token"]:::p1
    WebView["KongmingWebView<br/>P0 · 打开 web_session_url"]:::p0
  end

  Server["Kongming Server<br/>公网域名或 LAN IP Runtime"]:::p2

  Scan --> Parse --> Api --> Store
  Api --> WebView
  Api --> Server
  WebView --> Server
```

## 数据关系

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#181A1F", "primaryColor": "#242933", "primaryTextColor": "#F5F7FA", "primaryBorderColor": "#6BA7FF", "lineColor": "#AAB4C0", "textColor": "#F5F7FA", "edgeLabelBackground": "#181A1F"}}}%%
flowchart LR
  classDef entity fill:#1F2633,stroke:#6BA7FF,color:#F5F7FA,stroke-width:1.5px
  classDef supporting fill:#191F29,stroke:#AAB4C0,color:#F5F7FA,stroke-width:1.2px

  SESSION["LOGIN_QR_SESSION<br/>────────<br/>PK login_qr_id<br/>status"]:::entity
  ORIGIN["LOGIN_QR_ORIGIN<br/>────────<br/>mode<br/>host"]:::supporting
  CLAIM["LOGIN_QR_CLAIM<br/>────────<br/>PK claim_id<br/>FK login_qr_id"]:::entity
  DEVICE["MOBILE_DEVICE<br/>────────<br/>PK device_id<br/>token_hash"]:::supporting
  HANDOFF["HANDOFF_TOKEN<br/>────────<br/>PK handoff_id<br/>FK device_id"]:::supporting
  COOKIE["KONGMING_SESSION<br/>────────<br/>user_id<br/>iat"]:::supporting

  ORIGIN -->|configures 1:N| SESSION
  SESSION -->|has 0:1| CLAIM
  CLAIM -->|authorizes 1:1| DEVICE
  DEVICE -->|issues 1:N| HANDOFF
  HANDOFF -->|consumes 1:1| COOKIE
```
