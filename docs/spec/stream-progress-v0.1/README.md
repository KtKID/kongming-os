# Stream Progress — Agent 进度状态展示

> 状态：方案确认中
> 目标：Web 前端在 LLM 回复第一个字前就显示当前 agent 状态，消除"卡死感"

## 系统目标

用户发送消息后、第一个文本 token 到达前，前端应根据 SDK StreamEvent 的真实事件显示对应状态（如 thinking / responding / tool calling），而非一个无差别的"推理中"。

## 最小可用路径

用户发送消息 → 后端收到 `message_start` → 推 `stream_status` 帧 → 前端显示"响应中"  
→ 后端收到 `content_block_start(thinking)` → 推 `stream_status` 帧 → 前端切"思考中"  
→ 后端收到第一个 `content_block_delta(text_delta)` → 推 `stream_delta` → 前端切流式文本

这条链路涉及的 3 个模块都是 P0。

## 范围边界

**包含**：
- Claude 频道 StreamEvent 中 `message_start` / `content_block_start` 的状态透传
- WS 协议新增 `stream_status` 帧类型
- 前端状态指示器组件（薄层：后端推什么显示什么）
- `stream_delta` 增加 `deltaType` 字段区分 text / thinking / tool_input

**不包含**：
- 通用频道 / Codex 频道的进度状态（后续单独接）
- TaskStartedMessage / TaskProgressMessage / TaskNotificationMessage（scope creep，v0.4 再看）
- 装饰性 spinner 动词 / 卡死检测变红（锦上添花，不在本轮）
- 修改已有 `stream_delta` / `stream_end` 的现有行为（只扩展不破坏）

## 模块导航

| 模块 | 状态 | 优先级 | 是否可进 task | 说明 |
|------|------|--------|---------------|------|
| Normalizer 扩展 | 可进入 x-req | P0 | 是 | 把丢弃的 SSE 控制帧转成 `stream_status` |
| WS 协议扩展 | 可进入 x-req | P0 | 是 | `llm_protocol.py` + 前端 TS 类型同步 |
| 前端状态渲染 | 可进入 x-req | P0 | 是 | 按 `stream_status.phase` 切状态 UI |

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 三个模块无依赖循环，可合并为一个 task 一起做（改动小）
2. 建议从 normalizer 开始，加完后 WS 协议自然跟着扩展，最后前端消费
3. 不需要 PoC——技术风险为零（SDK 事件已有，只是之前被丢弃）
