# Avatar 消息注册与消费通道

> 状态：可进入 x-req
> 目标：Kongming 内部模块通过 AvatarManager 注册有价值消息，XSpace Avatar 通过 REST/WS 消费并自行展示。

## 系统目标

Kongming 侧提供 Avatar 消息注册、持久化、拉取、确认消费和通知通道，让 approval、thread、task、system 等内部模块把有价值消息送到统一队列。XSpace 从 Kongming 拉取或订阅这些消息后，自行决定形象、气泡、停留时长、点击动作和视觉呈现。

v1 聚焦消息通道和安全边界。反向对话预留 AvatarAssistantManager/AvatarChat capabilities，默认返回 disabled/stub capability，后续由独立 LLM 通道接入。

## 最小可用路径

Kongming 内部模块调用 `AvatarManager.register()` 注册消息（命名可在 x-req 固定为 `register_message()`）-> Repository 按 `dedupeKey` 合并并落 SQLite -> XSpace 通过 `GET /api/avatar/v1/messages` 拉取 -> XSpace 展示后调用 `POST /api/avatar/v1/messages/{messageId}/ack` -> Kongming 幂等写入 ack/consumed 状态。

## 范围边界

**包含**：
- `AvatarManager` 作为唯一业务门户，提供 register/list/ack/stream notifications/chat capability facade。
- `AvatarMessageRepository` 用 SQLite 持久化消息、游标分页、dedupe、ack、ttl 清理。
- `AvatarMessageRouter` 暴露 REST 拉取、ack、capabilities 和可选 WS 通知。
- `AvatarMessageProducer` 把 approval/thread/task/system 事件转成 `AvatarMessageInput`，模块外只调用 Manager 或明确 EventSink/Producer 适配器。
- `AvatarAssistantManager` 预留反向对话边界，v1 capabilities 默认 `enabled=false`。
- 认证优先复用 XSpace mobile device token/scope，Web cookie 用于桌面调试。

**边界外**：
- XSpace Avatar 形象、CSS、动画、气泡 UI、停留策略和点击呈现。
- Kongming 侧视觉组件、前端 Avatar 面板和设计稿。
- v1 真实 Avatar LLM 对话模型、语音输入、TTS、长期人格配置。
- thread-status WS 承担 Avatar 消息队列职责。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| AvatarManager | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1avatarmanager) | 是 | 唯一业务门户，收口注册、查询、ack、通知、chat capability facade |
| AvatarMessageRepository | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2avatarmessagerepository) | 是 | SQLite 队列、游标分页、dedupe、ack/consumed、ttl 清理 |
| AvatarMessageRouter | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3avatarmessagerouter) | 是 | FastAPI REST/WS 合同、scope 鉴权、错误码转换 |
| AvatarMessageProducer | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4avatarmessageproducer) | 是 | approval/thread/task/system 事件适配到 AvatarMessageInput |
| AvatarAssistantManager | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-5avatarassistantmanager) | 否 | 第二阶段单独 LLM 通道门户，v1 只输出 disabled capabilities |

## 文档导航

- [图集：总览 + 各模块局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 第一组 x-req 做 `AvatarManager` + `AvatarMessageRepository` + 核心模型，先闭合稳定 ID、dedupe、TTL 和 ack 幂等。
2. 第二组 x-req 接 `AvatarMessageRouter`，覆盖 REST 合同、scope 鉴权、Web cookie 调试和错误码。
3. 第三组 x-req 接 `AvatarMessageProducer`，优先把 approval inbox payload 适配为 Avatar 消息。
4. WS 通知作为 P1 增量 task，REST list 始终是消费真源。
5. `AvatarAssistantManager` 保持方案层预留，后续单独开 Avatar chat spec。
