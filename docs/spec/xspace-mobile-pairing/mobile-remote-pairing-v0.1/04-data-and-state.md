# 数据模型与状态

## 核心实体

```python
class PairingSession(BaseModel):
    pairing_id: str  # 配对会话 ID，pr_ 前缀
    nonce_hash: str  # nonce 哈希值，用于 claim/exchange 校验
    server_origin: str  # 创建二维码时使用的 Kongming origin
    requested_scopes: list[str]  # 手机请求授权的 scope
    status: str  # pending_scan/pending_approval/approved/denied/expired/exchanged
    expires_at: datetime  # pairing 过期时间，UTC
    created_at: datetime  # 创建时间，UTC
    approved_at: datetime | None  # 用户批准时间，UTC
    denied_at: datetime | None  # 用户拒绝时间，UTC

class PairingClaim(BaseModel):
    claim_id: str  # claim ID，cl_ 前缀
    pairing_id: str  # 所属 pairing session
    device_id: str  # Android 设备 ID
    label: str  # 设备展示名
    platform: str  # 平台，P0 为 android
    app_version: str  # XSpace Android 版本
    capabilities: dict[str, bool]  # Android 声明能力，如 webview/camera_scan/push
    status: str  # pending_approval/approved/denied/exchanged
    created_at: datetime  # claim 时间，UTC

class MobileDevice(BaseModel):
    device_id: str  # Android 设备 ID
    label: str  # 用户可识别设备名
    platform: str  # 平台
    app_version: str  # 最近授权时的 App 版本
    scopes: list[str]  # 已授权 scope
    token_hash: str  # device token 哈希
    created_at: datetime  # 授权创建时间，UTC
    last_seen_at: datetime | None  # 最近使用时间，UTC
    revoked_at: datetime | None  # 吊销时间，空值表示可用

class HandoffToken(BaseModel):
    handoff_id: str  # handoff 记录 ID
    token_hash: str  # handoff token 哈希
    device_id: str  # 绑定设备 ID
    expires_at: datetime  # handoff token 过期时间，UTC
    consumed_at: datetime | None  # 消费时间，空值表示可消费
    created_at: datetime  # 创建时间，UTC
```

## 实体关系

PairingSession 是一次扫码会话，最多绑定一个 PairingClaim。PairingClaim 批准后生成或更新一个 MobileDevice，并签发一个 DeviceToken。DeviceToken 后续可重复换取一次性 HandoffToken。ER 图见 [diagrams.md §数据模型](./diagrams.md#数据模型)。

## 状态流转

PairingSession 主状态：

```text
pending_scan -> pending_approval -> approved -> exchanged
pending_scan -> expired
pending_approval -> denied
pending_approval -> expired
exchanged -> revoked
```

完整状态图见 [diagrams.md §状态流转](./diagrams.md#状态流转)。

## 持久化方案

| 数据 | 存储方式 | 位置 | 备注 |
|------|---------|------|------|
| PairingSession | SQLite 或 JSON 文件 | `<kongming_home>/web/mobile_pairing.*` | P0 推荐 SQLite，便于原子 claim |
| PairingClaim | SQLite 或 JSON 文件 | `<kongming_home>/web/mobile_pairing.*` | 与 PairingSession 同库 |
| MobileDevice | SQLite 或 JSON 文件 | `<kongming_home>/web/mobile_devices.*` | 存 token hash 和 revoked_at |
| HandoffToken | SQLite 或 JSON 文件 | `<kongming_home>/web/mobile_handoff.*` | 单次消费，短 TTL |
| AuditEvent | JSONL | `<kongming_home>/web/mobile_pairing_audit.jsonl` | P1 可查询 |

## 共享数据结构

```typescript
type MobilePairingStatus =
  | "pending_scan" // 等待手机扫码
  | "pending_approval" // 等待桌面确认
  | "approved" // 已批准，等待 exchange
  | "denied" // 已拒绝
  | "expired" // 已过期
  | "exchanged" // 已换取 device token
  | "revoked"; // 设备已吊销

type MobilePairingScope =
  | "webview" // 允许换取 WebView 登录 handoff URL
  | "thread.read" // 允许读取线程基础数据，P0 可先保留 scope
  | "approval.resolve"; // 允许移动端处理审批，P0 可先保留 scope
```

## 数据保留与清理

- PairingSession 和 PairingClaim 过期后可保留 24 小时用于审计，再由启动清理或定期清理删除。
- HandoffToken 过期后可立即清理。
- MobileDevice 保留到用户主动吊销；吊销记录保留 `revoked_at`，token hash 可同时删除或标记失效。
- AuditEvent 建议滚动写入，P0 只追加关键安全事件。
