# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| MobilePairingManager + MobilePairingRepository | `mobile-pairing-backend-core` | 无 | DoD#2 #3 #4 #7 | 高 | 可进入 x-req | 先定 token 形态和持久化介质 |
| MobileDeviceTokenService | `mobile-pairing-token-handoff` | `mobile-pairing-backend-core` | DoD#5 #6 #7 | 高 | 可进入 x-req | 建议 PoC opaque token + handoff 单次消费 |
| MobilePairingRouter | `mobile-pairing-api-contract` | `mobile-pairing-backend-core` + `mobile-pairing-token-handoff` | DoD#1 #2 #3 #4 #5 #6 #7 | 中 | 可进入 x-req | 包含 AuthMiddleware 精确例外和错误码 |
| MobilePairingWebPage | `mobile-pairing-web-connect-page` | `mobile-pairing-api-contract` | DoD#2 #4 | 中 | 可进入 x-req | P0 用轮询，P1 接 inbox fan-out |
| 合同 fixture | `mobile-pairing-contract-fixtures` | `mobile-pairing-api-contract` | DoD#1-#7 | 中 | 可进入 x-req | 与 XSpace Android 双侧共用样例 |
| MobilePairingManager + Router | `mobile-pairing-device-revocation` | `mobile-pairing-token-handoff` | DoD#7 | 中 | 可进入 x-req | 覆盖 list/delete + revoked token handoff |
| MobilePairingAuditSink | `mobile-pairing-audit` | `mobile-pairing-backend-core` | DoD#7 | 低 | 探索中 | P0 只留事件钩子，P1 做查询 |
| XSpace Desktop 协同 | `xspace-desktop-open-mobile-connect` | Web connect 页可用 | DoD#8 | 低 | 可进入 XSpace 侧 x-req | 由 XSpace 打开 `{instance.url}/-/xspace/mobile/connect` |

## 推荐实施顺序

1. `mobile-pairing-backend-core`
2. `mobile-pairing-token-handoff`
3. `mobile-pairing-api-contract`
4. `mobile-pairing-web-connect-page`
5. `mobile-pairing-contract-fixtures`
6. `mobile-pairing-device-revocation`
7. XSpace Android / Desktop 对接 task
8. `mobile-pairing-audit`

## 可并行项

- Web 页面静态状态和 QR 渲染可在 API 合同冻结后并行。
- 合同 fixture 可与 Router 测试同步推进。
- XSpace Desktop 打开 connect 页入口可在 Kongming Web 路径确定后并行。

## PoC 建议

| 风险 | PoC | 验收 |
|------|-----|------|
| device token 吊销 | opaque token 明文只返回一次，服务端落 hash，吊销写 `revoked_at` | 吊销后 session-handoff 返回 401 `device_revoked` |
| handoff 单次消费 | 生成 60 秒 token，consume 后写 `consumed_at` | 第二次消费返回 403 |
| pairing 原子 claim | 两个并发 claim 同一 pairing | 只有一个 claim 成功，另一个返回 409 |
| HTTPS/loopback 策略 | 生产 origin 与 loopback dev origin 分支 | HTTPS 通过，非 loopback HTTP 返回 400 |
