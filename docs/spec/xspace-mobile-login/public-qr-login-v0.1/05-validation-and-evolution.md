# 验证策略与演进

## 验证策略

### Smoke / E2E 验收入口

- **公网 HTTPS smoke**：配置 `web.server_origin=https://kongming.example.com` → 打开 `/login` → 创建登录 QR → fake APK claim → 登录页密码确认 → fake APK exchange → consume `web_session_url` → 断言 `kongming_session` cookie 和 `server_origin.mode=public_https`。
- **LAN IP smoke**：配置 `web.server_origin=http://192.168.1.20:8765` → 打开 `/login` → 创建登录 QR → fake APK 使用同一 LAN origin claim/exchange → consume `web_session_url` → 断言 `kongming_session` cookie 和 `server_origin.mode=lan_ip`。
- **E2E 路径**：真实浏览器打开 `/login`，真实 HTTP API 模拟 APK，覆盖 QR 展示、copy URL、状态轮询、密码确认、exchange 和 WebView handoff。
- **进入 x-req 的规则**：x-req README 显式展开后端 router 用例、前端 Login QR 交互用例和一条跨端 smoke；所有外部 APK 行为可用 fake client 固定协议。

### 单元测试

- **覆盖模块**：LoginQrManager、LoginQrAuthService、ServerOriginConfig、LoginQrRepository 内部状态机。
- **框架**：pytest。
- **重点场景**：TTL 过期、nonce hash、browser token hash、重复 claim、重复 exchange、密码错误、429 限流、origin 校验、SQLite 原子 exchange。

### 集成测试

- **端到端链路**：FastAPI `TestClient` 装配真实 app、真实 auth middleware、真实 SQLite repository、真实 token service。
- **环境要求**：临时 `kongming_home`、seed password、配置 `web.server_origin`。
- **触发方式**：聚焦运行 `repo:tests/unit/web/test_xspace_mobile_login_qr_router.py`。

### 前端真实交互测试

- **覆盖模块**：LoginPageQrPanel、`repo:web/src/features/login-qr/LoginQrManager.ts`、`repo:web/src/pages/Login.tsx`。
- **框架**：Vitest + Testing Library + MSW。
- **重点场景**：创建成功、倒计时、刷新、copy URL、claim 后展示设备、密码确认、401/429、410 过期、origin 配置错误、网络失败。

### 跨前后端 smoke

- **最低链路**：`/login` 创建 QR → APK fake claim → UI status 变成待确认 → 用户输入密码 confirm → APK fake exchange → consume 设置 cookie。
- **断言重点**：前端 API client 路径与后端 router path 完全一致；错误结构能被 `repo:web/src/lib/api.ts` 正确解析；`web_session_url` origin 等于 `server_origin.origin`。

### 协议漂移测试

- **后端 fixture**：create/status/claim/confirm/exchange 成功响应与错误响应。
- **前端 fixture**：TypeScript DTO 与后端 JSON 字段同步。
- **APK fixture**：`xspace://login-kongming` 和 fallback copy URL 的 query 字段固定。

## 测试覆盖要求

| 模块 | 最低覆盖 | 重点文件 |
|------|----------|---------|
| LoginQrManager | 状态机分支全覆盖 | `repo:src/hosts/web/xspace_mobile/login_qr_manager.py` |
| LoginQrAuthService | 授权与签发分支全覆盖 | `repo:src/hosts/web/xspace_mobile/login_qr_auth_service.py` |
| LoginQrRouter | 路由合同和 Auth/CSRF 边界全覆盖 | `repo:tests/unit/web/test_xspace_mobile_login_qr_router.py` |
| LoginPageQrPanel | 主要 UI 阶段和错误态全覆盖 | `repo:web/src/pages/Login.tsx`、`repo:web/src/features/login-qr/` |
| XSpaceApkLoginClient | 协议 fixture 全覆盖 | `repo:tests/fixtures/xspace_login_qr/` |
| ServerOriginConfig | 公网 HTTPS、LAN HTTP 私网 IP、HTTP 公网域名、loopback、无配置分支全覆盖 | `repo:src/hosts/web/xspace_mobile/server_origin.py` |

## 必测用例清单

### 后端 Router 合同

- 匿名浏览器带 CSRF header 可以创建 login QR。
- 匿名浏览器缺 CSRF header 创建 login QR 返回 403。
- 匿名 APK 可以 claim/exchange，claim/exchange 路径豁免 CSRF header。
- 匿名 APK 在密码确认前 exchange 返回 202 `approval_pending`。
- 登录页密码确认成功后 APK exchange 返回 `device_token` 和同 origin `web_session_url`。
- consume `web_session_url` 后返回 302 并设置 `kongming_session` cookie。
- 缺少 `web.server_origin`、HTTP 公网域名、loopback origin 返回稳定错误。
- 公网 HTTPS 域名返回 `server_origin.mode=public_https`。
- LAN HTTP 私网 IP 返回 `server_origin.mode=lan_ip`。
- nonce 错误返回 403，过期返回 410，重复 exchange 返回 409。

### Manager / 状态机

- `pending_scan -> pending_confirm -> confirmed -> exchanged` 主路径。
- `pending_scan -> expired`。
- `pending_confirm -> expired`。
- 刷新 QR 时旧 session 进入 `cancelled` 或自然过期。
- `browser_token` 错误阻止 status/confirm。
- password confirm 只更新匹配 claim。
- exchange 事务同时 upsert device、insert handoff、推进 session/claim。

### 前端交互

- `/login` 初始展示密码登录与扫码登录入口。
- 扫码登录创建成功后展示 QR、copy URL 和倒计时。
- status 返回 claim 后展示设备信息和密码确认输入。
- 密码错误展示“密码错误”，429 展示倒计时。
- confirm 成功后展示等待 APK 完成。
- expired 返回后展示刷新入口。
- origin 配置错误展示部署提示。

### 跨端 smoke

- fake APK 解析 QR payload 字段，校验 `purpose=login` 和 `origin_mode`。
- fake APK claim 使用 payload `server` 发请求。
- fake APK exchange 获得 `web_session_url`，断言同 origin。
- fake APK 打开 URL 后进入已认证状态。

### Origin 配置测试

- `https://kongming.example.com` → `mode=public_https`、`scheme=https`、`host=kongming.example.com`。
- `http://192.168.1.20:8765` → `mode=lan_ip`、`scheme=http`、`host=192.168.1.20`。
- `http://10.0.0.5:8765` → `mode=lan_ip`。
- `http://172.16.0.10:8765` 和 `http://172.31.255.10:8765` → `mode=lan_ip`。
- `http://example.com` → `server_origin_not_lan_ip`。
- `http://127.0.0.1:8765`、`http://localhost:8765`、`http://0.0.0.0:8765` → `server_origin_loopback`。
- 空配置 → `server_origin_required`。

## 演进路线

### 短期（本轮 task）

- [ ] 落地 P0 密码确认扫码登录链路。
- [ ] 固定 login QR API、状态机和错误码。
- [ ] 完成 `/login` 扫码面板和测试。
- [ ] 输出 XSpace APK 接入合同 fixture。

### 中期（下 1-2 轮）

- [ ] 支持已绑定 XSpace APK 用已有 device token 扫码确认登录。
- [ ] 支持已登录管理端审批 login QR intent。
- [ ] 增加移动设备列表中的最近登录来源和吊销入口。
- [ ] 统一 mobile pairing 与 login QR 的错误体到前端可直接消费结构。

### 长期（方向性）

- 多用户账号体系接入后，`authorized_user_id` 从 `default` 扩展为真实用户 ID。
- 支持设备信任等级、登录地审计、设备命名和安全提醒。
- 支持企业反代部署的 Secure cookie 强制开关和健康检查提示。
