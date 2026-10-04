# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| 公共输入结构 | `chat-input-contract` | 无 | `common + provider` 发送结构稳定 | 低 | 可进入 x-req | 先固定 `SendRequest`、`HistoryLoadRequest`、`InterruptRequest` |
| provider 适配层 | `chat-provider-contract` | `chat-input-contract` | `ChatManager` 统一对外能力 | 中 | 可进入 x-req | 先补 contract test，再迁移 Claude / Codex / Generic |
| 聊天总管理器 | `chat-manager-runtime` | `chat-provider-contract` | `ChatManager` 统一对外能力、创建时机兼容 | 高 | 可进入 x-req | 建议先做 PoC 验证首发创建和重连恢复 |
| 时间线状态机 | `chat-timeline-store` | `chat-provider-contract` | 历史与流式统一时间线 | 中 | 可进入 x-req | 先覆盖 user / assistant / tool 三类事件 |
| 渲染适配层 | `chat-render-adapter` | `chat-timeline-store` | 视图只消费 adapter 输出 | 低 | 可进入 x-req | 当前 UI 版本先跑通，再为 Streamdown 扩字段 |
| 频道视图迁移 | `chat-view-migration` | `chat-manager-runtime` + `chat-render-adapter` | 视图只消费 adapter 输出 | 中 | 可进入 x-req | `ClaudeCodeView`、`CodexView`、Generic View 同步薄化 |
| 多频道连接收编 | `network-manager-generic-channel-v0.2` | `chat-provider-contract` | `ChatManager` 统一对外能力 | 中 | 已进入 x-req | 先收编 generic；codex / thread-status / scheduler / shell 作为后续 remaining task |
