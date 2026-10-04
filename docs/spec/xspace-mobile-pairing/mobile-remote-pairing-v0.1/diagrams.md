# XSpace Android 远程扫码配对 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/03/04 是文字事实源，本文件是只读视图，增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](#总览)
- [Kongming Mobile Pairing](#kongming-mobile-pairing)
- [P0 时序](#p0-时序)
- [状态流转](#状态流转)
- [数据模型](#数据模型)

图例：P0 核心/阻塞 · P1 主要/必须 · P2 辅助/可选

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  XAndroid["XSpace Android<br/>P0 · 扫码 claim 与 WebView"]:::p0
  KWeb["Kongming Web<br/>P0 · QR 页面与桌面授权"]:::p0
  KServer["Kongming Server<br/>P0 · 配对和设备授权"]:::p0
  XDesktop["XSpace Desktop<br/>P1 · 打开当前实例配对页"]:::p1
  Packaged["Packaged Kongming<br/>P1 · 现有本地运行路径"]:::p1

  KWeb --> KServer
  XAndroid --> KServer
  XDesktop -.-> KWeb
  Packaged -.-> KWeb
```

## Kongming Mobile Pairing

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph MobilePairing["Kongming Mobile Pairing"]
    Manager["MobilePairingManager<br/>P0 · 业务门户"]:::p0
    Repo["MobilePairingRepository<br/>P0 · 状态持久化"]:::p0
    Token["MobileDeviceTokenService<br/>P0 · device/handoff token"]:::p0
    Router["MobilePairingRouter<br/>P1 · REST 与错误码"]:::p1
    Page["MobilePairingWebPage<br/>P1 · QR 与授权 UI"]:::p1
    Audit["MobilePairingAuditSink<br/>P2 · 安全审计"]:::p2
  end

  Auth["Web Auth<br/>既有 cookie/CSRF"]:::p1
  Inbox["Approval Inbox<br/>可选 fan-out"]:::p2

  Page --> Router
  Router --> Manager
  Manager --> Repo
  Manager --> Token
  Manager -.-> Audit
  Token --> Repo
  Router --> Auth
  Page -.-> Inbox
```

## P0 时序

```mermaid
sequenceDiagram
  participant Web as Kongming Web
  participant API as MobilePairingRouter
  participant Manager as MobilePairingManager
  participant Android as XSpace Android
  participant Cookie as Web Session Cookie

  Web->>API: POST /api/xspace/mobile/pairing-sessions
  API->>Manager: create_pairing_session()
  Manager-->>API: qr_payload + copy_url
  API-->>Web: pending_scan
  Android->>API: POST /claim(pairing_id, nonce, device)
  API->>Manager: claim_session()
  Manager-->>API: claim_id pending_approval
  API-->>Android: 202/pending_approval
  Web->>API: POST /approve(claim_id, approved=true)
  API->>Manager: approve_claim()
  Android->>API: POST /exchange(claim_id, nonce, device_id)
  API->>Manager: exchange()
  Manager-->>API: device_token + web_session_url
  API-->>Android: approved
  Android->>API: GET /-/xspace/mobile/session/consume
  API->>Cookie: issue kongming_session
  API-->>Android: 302 /
```

## 状态流转

```mermaid
stateDiagram-v2
  [*] --> pending_scan
  pending_scan --> pending_approval: claim
  pending_scan --> expired: ttl
  pending_approval --> approved: approve
  pending_approval --> denied: deny
  pending_approval --> expired: ttl
  approved --> exchanged: exchange
  exchanged --> revoked: device revoke
  denied --> [*]
  expired --> [*]
  revoked --> [*]
```

## 数据模型

```mermaid
erDiagram
  PAIRING_SESSION ||--o| PAIRING_CLAIM : owns
  PAIRING_CLAIM ||--o| MOBILE_DEVICE : approves
  MOBILE_DEVICE ||--o{ HANDOFF_TOKEN : issues
  MOBILE_DEVICE ||--o{ AUDIT_EVENT : records

  PAIRING_SESSION {
    string pairing_id
    string nonce_hash
    string status
    datetime expires_at
  }
  PAIRING_CLAIM {
    string claim_id
    string pairing_id
    string device_id
    string status
  }
  MOBILE_DEVICE {
    string device_id
    string token_hash
    string platform
    datetime revoked_at
  }
  HANDOFF_TOKEN {
    string handoff_id
    string token_hash
    datetime expires_at
    datetime consumed_at
  }
  AUDIT_EVENT {
    string event_type
    string outcome
    datetime created_at
  }
```
