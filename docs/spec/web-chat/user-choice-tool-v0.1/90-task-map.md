# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| Choice Tool | `web-chat-user-choice-tool-v0.1` | 无 | 工具列表、参数校验、事件输出 | 低 | 可进入 x-req | 先做工具和事件 |
| Choice Protocol | `web-chat-user-choice-tool-v0.1` | Choice Tool | `choice.request` / `choice.submit` | 中 | 可进入 x-req | 协议漂移测试同步补 |
| Choice UI | `web-chat-user-choice-tool-v0.1` | Choice Protocol | composer 上方面板、自定义输入 | 中 | 可进入 x-req | 参考静态 HTML |
| Choice Submit Bridge | `web-chat-user-choice-tool-v0.1` | Choice Protocol | 确认后继续对话 | 中 | 可进入 x-req | 先明确 active run 拒绝策略 |
| Prompt Guidance | `web-chat-user-choice-tool-v0.1` | Choice Tool | LLM 自主调用说明 | 低 | 可进入 x-req | 更新 TOOLS 模板和测试 |

## 建议开发顺序

1. Choice Tool + 单元测试。
2. Choice Protocol + 协议漂移测试。
3. Choice UI + React 交互测试。
4. Choice Submit Bridge + WebSocket route 测试。
5. Prompt Guidance + prompt loader 测试。

## PoC 建议

优先验证 Submit Bridge：用 fake WebSocket 发送 `choice.submit`，确认它能复用 `bridge.run_once()` 并把选择结果写进下一轮 user message。该点验证通过后，UI 与工具实现风险较低。
