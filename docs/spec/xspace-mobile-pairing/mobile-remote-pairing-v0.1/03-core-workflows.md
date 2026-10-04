# 核心流程

## P0 扫码配对链路

时序图见 [diagrams.md §P0 时序](./diagrams.md#p0-时序)。

1. 已登录用户打开 `/-/xspace/mobile/connect`。
2. 页面调用 `POST /api/xspace/mobile/pairing-sessions` 创建 pairing session。
3. 服务端生成 `pairing_id`、`nonce`、`qr_payload`、`copy_url`、`expires_at`。
4. 页面展示二维码、复制链接和倒计时。
5. Android 扫描 `xspace://pair-kongming` 或复制链接，解析 server、pairing_id、nonce。
6. Android 调用 claim API，带设备信息和能力声明。
7. 服务端把 session 从 `pending_scan` 推进到 `pending_approval`，返回 `claim_id`。
8. Web 页面通过轮询或 inbox fan-out 展示待授权设备。
9. 用户批准后，服务端把 claim 标记为 approved。
10. Android 轮询 exchange，成功后获得 `device_token`、实例信息和 `web_session_url`。
11. Android 打开 `web_session_url`，服务端消费一次性 handoff token、设置 `kongming_session` cookie、302 到 `/`。

## 冷启动 session handoff

1. Android 已保存远程实例 URL 和 secure store 中的 `device_token`。
2. App 冷启动后调用 `POST /api/xspace/mobile/session-handoff`，Header 为 `Authorization: Bearer kgm_dt_...`。
3. 服务端校验 token hash、设备状态、scope 和吊销状态。
4. 服务端生成新的 `web_session_url`，有效期建议 60 秒。
5. Android WebView 打开 URL，服务端消费 handoff token 并设置 Web session cookie。

## 设备吊销链路

1. 已登录 Web 用户打开设备列表。
2. 页面调用 `GET /api/xspace/mobile/devices` 展示设备。
3. 用户点击吊销，页面调用 `DELETE /api/xspace/mobile/devices/{device_id}`。
4. 服务端写入 `revoked_at`，后续 session-handoff 返回 `device_revoked`。
5. Android 收到 `device_revoked` 后清除本地 token，并引导重新扫码。

## 错误处理策略

| 场景 | 服务端行为 | 客户端建议 |
|------|------------|------------|
| pairing 过期 | 返回 410 `pairing_expired` | Android 展示重新扫码；Web 刷新二维码 |
| nonce 错误 | 返回 403 `nonce_mismatch` | Android 拒绝继续配对 |
| 已被 claim | 返回 409 `pairing_already_claimed` | Web 刷新二维码 |
| 等待授权 | exchange 返回 202 `approval_pending` | Android 按 `poll_after_ms` 继续轮询 |
| 用户拒绝 | exchange 返回 403 `approval_denied` | Android 展示拒绝结果 |
| 设备吊销 | handoff 返回 401 `device_revoked` | Android 清除 token |

## 鉴权与 CSRF 策略

- `pairing-sessions create`、`approve`、`devices list/delete` 使用既有 Web cookie 鉴权和 CSRF Header。
- `claim` 和 `exchange` 通过 `pairing_id + nonce + device_id` 绑定校验，允许无 Web cookie。
- `session-handoff` 使用 Bearer device token。
- `session/consume` 使用一次性 handoff token，成功后设置既有 Web session cookie。
- AuthMiddleware 需要为 `claim`、`exchange`、`session-handoff`、`session/consume` 加精确例外，router 内完成对应校验。
