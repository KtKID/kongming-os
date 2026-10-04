# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| AvatarManager + AvatarMessageRepository | `avatar-message-backend-core` | 无 | DoD#1、DoD#2、DoD#4、DoD#8 | 中，先锁定 dedupe/cursor/ack 状态机 | 已完成 | 已产出 models/manager/repository、SQLite 测试和 dev-report |
| AvatarMessageRouter | `avatar-message-api-contract` | `avatar-message-backend-core` | DoD#3、DoD#4、DoD#6、DoD#7 | 中，scope 矩阵需要合同测试 | REST 核心已完成 | REST list/ack/capabilities/chat disabled 合同已随 backend core 落地，WS 仍归后续 task |
| AvatarMessageProducer | `avatar-message-producer-adapters` | `avatar-message-backend-core` | DoD#1、DoD#8 | 中，敏感字段裁剪和 UI 边界需要审查 | 可进入 x-req | 先做 approval pending adapter，再扩展 thread/task/system |
| AvatarMessageRouter | `avatar-message-ws-notification` | `avatar-message-api-contract` | DoD#5 | 低，WS 只做通知，REST 补齐兜底 | 可进入 x-req | P1 可选能力，独立于 REST 真源 |
| AvatarAssistantManager | `avatar-assistant-boundary` | `avatar-message-api-contract` | DoD#6、DoD#7 | 低，v1 disabled capability | v1 stub 已完成 | 真实 LLM 对话单独开 spec |

## 排序依据

1. `avatar-message-backend-core` 先做：消息 ID、dedupe、cursor、TTL 和 ack 是所有消费通道的状态基础。
2. `avatar-message-api-contract` 第二：XSpace 需要稳定 REST 和 scope 合同才能对接。
3. `avatar-message-producer-adapters` 第三：approval payload 已有，可形成第一条真实价值链路。
4. `avatar-message-ws-notification` 第四：WS 提升实时性，REST 已提供补齐真源。
5. `avatar-assistant-boundary` 保持轻量：v1 只落 disabled capabilities，真实 chat 后续 spec。

## PoC 建议

- Repository PoC：使用临时 SQLite 跑 1000 条 register + dedupe update + ack，确认 sequence/cursor 和唯一索引行为。
- Auth PoC：复用 xspace mobile device token service 生成含 `avatar.read/avatar.ack` scope 的 token，TestClient 覆盖 list/ack。
- WS PoC：注册消息时向内存 subscriber 推一帧 notification，断线期间消息通过 REST `since` 补齐。
