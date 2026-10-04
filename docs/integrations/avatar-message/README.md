# Avatar Message

> Kongming Web 为 XSpace Avatar 提供消息注册、拉取/订阅、确认消费和后续对话边界的宿主侧协议模块。

## Spec 导航

| Spec | 状态 | 说明 |
|------|------|------|
| [xspace-avatar-channel-client-interface-v0.1](./xspace-avatar-channel-client-interface.md) | XSpace 对接文档 | 只给 XSpace 的 Avatar client 函数接口、DTO、事件回调和错误码 |
| [message-registry-v0.1](./message-registry-v0.1/) | 可进入 x-req | P0 Avatar 消息注册、SQLite 队列、REST 拉取、ack、可选 WS 通知和 AvatarAssistant 预留边界 |
| [avatar-channel-interface-v0.1](./avatar-channel-interface.md) | Kongming 内部合同 | Kongming 实现 Avatar 实时对话 channel 的 REST/WS payload、事件流、后端入口和验收任务 |

状态：探索中 / 方案确认 / 可进入 x-req / 开发中 / 已完成
