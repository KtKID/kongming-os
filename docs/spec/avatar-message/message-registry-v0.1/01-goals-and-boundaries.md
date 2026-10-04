# 目标与完成标准

## 需求要点

1. Kongming 侧只支持 Avatar 消息注册和消费通道，XSpace Avatar 负责形象、CSS、动画和气泡 UI。
2. Kongming 内部模块可以注册有价值消息给 Avatar，XSpace 从 Kongming 拉取或订阅这些消息后自行消费和展示。
3. 该能力必须模块化，新增能力通过 Manager 门户收口，避免散装函数跨模块调用。
4. 消息模型需要支持 priority/level、source、threadId/runId/requestId、action、dedupeKey、expiresAt、ack/consumed 状态。
5. v1 要提供 REST 拉取、ack、可选 WS 通知；消息展示策略、气泡时长、点击呈现由 XSpace 决定。
6. 将来 Avatar 侧可反向发消息，通过 Kongming 侧单独 LLM 通道处理；v1 预留 AvatarAssistant/AvatarChat 边界和 capabilities，默认使用 disabled/stub capability。
7. 认证优先复用 XSpace mobile device token/scope：消费消息需要 thread/avatar read scope，反向发送需要 avatar.chat scope；Web cookie 可用于桌面调试。

## 系统目标

Avatar message registry 为 Kongming 内部事件提供统一消息出口，把审批、线程状态、任务进展和系统提醒归一成 XSpace Avatar 可消费的消息队列。Kongming 保持宿主侧职责：注册消息、持久化、查询、ack、通知和认证；XSpace 保持体验侧职责：展示策略、视觉表现和用户交互。

该 spec 让 Avatar 消息能力具备清晰模块边界、稳定 DTO、可复跑测试和后续对话通道扩展点，可直接进入 x-req 拆任务。

## 完成目标（DoD）

- [ ] DoD#1：内部模块可通过 `AvatarManager.register()` 或明确 EventSink/Producer 适配器注册 `AvatarMessageInput`，字段覆盖 `priority/level/source/threadId/runId/requestId/action/dedupeKey/expiresAt`。
- [ ] DoD#2：Repository 使用 `<kongming_home>/web/avatar_messages.db` 持久化消息，支持稳定 `messageId`、`dedupeKey` 合并、游标分页、TTL 过期清理。
- [ ] DoD#3：XSpace 可通过 REST list 按 `cursor/limit/since/level/source/threadId` 拉取消息，REST list 是断线补齐真源。
- [ ] DoD#4：XSpace 可幂等 ack 单条或批量消息，并写入 `ackedAt/consumedAt/status`。
- [ ] DoD#5：可选 WS 只推送轻量通知或轻量消息，客户端断线重连后通过 REST list 补齐。
- [ ] DoD#6：认证覆盖 device token scope 与 Web cookie 调试路径，list/stream 需要 `avatar.read` 或 `thread.read`，ack 需要 `avatar.ack`，chat 需要 `avatar.chat`。
- [ ] DoD#7：`AvatarAssistantManager` 暴露 capabilities/chat facade，v1 capabilities 默认 `enabled=false`，chat 路径默认返回稳定 capability-disabled 错误。
- [ ] DoD#8：`core/` 依赖方向保持纯净，Avatar 模块位于 Web host 边界内，跨模块调用只依赖 Manager、Protocol 或 EventSink 适配器。

## 范围边界

**包含**：
- Avatar 消息注册、持久化、过滤查询、ack/consumed、TTL 和 dedupe。
- REST API：capabilities、message list、message ack、batch ack。
- 可选 WS API：message notification、message changed、heartbeat/error。
- XSpace mobile token scope 复用和 avatar 专用 scope 规划。
- approval inbox payload 到 Avatar message 的首个 producer adapter 设计。
- AvatarAssistant/AvatarChat 的 disabled capabilities 和接口边界。

**边界外**：
- XSpace Avatar 展示策略和视觉实现。
- Kongming Web 侧 Avatar UI 面板。
- v1 真实反向 LLM 对话、语音输入、TTS、多轮人格记忆。
- thread-status WS 作为 Avatar 消息队列。
- 跨进程分布式队列、云推送和多租户账号体系。

## 关键约束

- 模块门户统一使用 `AvatarManager`，其他模块注册消息只调用 Manager，或通过明确 EventSink/Producer 适配器进入 Manager。
- `src/core/` 保持宿主无关，不能依赖 `hosts/web/avatar`。
- REST list 是消费真源，WS 只负责通知和轻量推送。
- `messageId` 稳定，`dedupeKey` 只用于同一事实更新或合并。
- `ack` 幂等，重复 ack 返回同一消息最终状态。
- SQLite v1 数据库路径固定为 `<kongming_home>/web/avatar_messages.db`。
- Web cookie 仅覆盖桌面调试和本机 Web 控制台，XSpace 设备侧优先使用 device token。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD#1 注册完整消息字段 | AvatarManager + AvatarMessageProducer | `avatar-message-backend-core` + `avatar-message-producer-adapters` | 可进入 x-req |
| DoD#2 SQLite、稳定 ID、dedupe、TTL | AvatarMessageRepository + AvatarManager | `avatar-message-backend-core` | 可进入 x-req |
| DoD#3 REST list 过滤和游标 | AvatarMessageRouter + AvatarMessageRepository | `avatar-message-api-contract` | 可进入 x-req |
| DoD#4 ack 幂等和 consumed 状态 | AvatarManager + AvatarMessageRepository + AvatarMessageRouter | `avatar-message-backend-core` + `avatar-message-api-contract` | 可进入 x-req |
| DoD#5 WS 通知和 REST 补齐 | AvatarMessageRouter + AvatarManager | `avatar-message-ws-notification` | 可进入 x-req |
| DoD#6 scope 鉴权 | AvatarMessageRouter + AvatarAssistantManager | `avatar-message-api-contract` + `avatar-assistant-boundary` | 可进入 x-req |
| DoD#7 AvatarAssistant disabled capabilities | AvatarAssistantManager + AvatarMessageRouter | `avatar-assistant-boundary` | 方案确认 |
| DoD#8 依赖方向和门户收口 | AvatarManager + AvatarMessageProducer + AvatarMessageRouter | 所有 task | 可进入 x-req |
