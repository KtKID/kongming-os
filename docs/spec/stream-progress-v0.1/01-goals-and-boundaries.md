# 目标与完成标准

## 系统目标

消除 Web 前端用户在发送消息后的"卡死感"——当前只有一个无差别的 `disabled` placeholder "推理中，请稍候…"，无法区分模型正在思考、正在生成文本、还是正在调用工具。

基于 cc-agent-sdk 已有的 `StreamEvent`（`include_partial_messages=True` 已开启），将之前被 normalizer 丢弃的 SSE 控制帧（`message_start` / `content_block_start`）转化为有意义的状态推送。

## 完成目标（DoD）

- [ ] DoD#1：用户发送消息后，`message_start` 到达即推送 `stream_status(phase="responding")` 到前端
- [ ] DoD#2：`content_block_start(type=thinking)` 到达时前端显示"思考中"状态
- [ ] DoD#3：`content_block_start(type=text)` 到达时前端显示"生成中"状态
- [ ] DoD#4：`content_block_start(type=tool_use)` 到达时前端显示"调用工具: {tool_name}"状态
- [ ] DoD#5：`stream_delta` 帧携带 `deltaType` 字段（`text` / `thinking` / `input_json`），前端可区分渲染
- [ ] DoD#6：现有 `stream_delta` / `stream_end` 行为不变（向后兼容）
- [ ] DoD#7：单元测试覆盖 normalizer 新增分支

## 范围边界

**包含**：
- `src/web/integrations/claude_code/normalizer.py` — 新增 `stream_status` 产出逻辑
- `src/web/app_support/llm_protocol.py` — `MessageKind` 新增 `"stream_status"`；`NormalizedMessage` 新增字段
- `web/src/` 前端 — 消费 `stream_status` 帧，渲染对应状态指示器
- `stream_delta` 帧增加 `deltaType` 可选字段

**不包含**：
- 通用频道 / Codex 频道
- Task Progress Messages（TaskStartedMessage 等）
- 装饰性动画 / spinner 动词库
- 卡死检测（3s 无 delta 变红）
- `message_stop` / `message_delta` 帧的透传（当前无前端消费场景）

## 关键约束

- **向后兼容**：`stream_delta` 的 `deltaType` 是 optional 新增字段；旧前端忽略即可
- **SDK 版本锁定**：`claude-agent-sdk==0.1.72`，不升级
- **前端薄层**：后端推什么状态就显示什么，前端不自造状态
- **协议同步**：Python TypedDict 字段名 = 前端 TS interface 字段名（camelCase）

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD#1 `message_start` → `stream_status` | Normalizer 扩展 + WS 协议扩展 | task-stream-progress | 待实现 |
| DoD#2 thinking 状态 | Normalizer 扩展 + 前端状态渲染 | task-stream-progress | 待实现 |
| DoD#3 text 状态 | Normalizer 扩展 + 前端状态渲染 | task-stream-progress | 待实现 |
| DoD#4 tool_use 状态 | Normalizer 扩展 + 前端状态渲染 | task-stream-progress | 待实现 |
| DoD#5 deltaType 字段 | Normalizer 扩展 + WS 协议扩展 + 前端状态渲染 | task-stream-progress | 待实现 |
| DoD#6 向后兼容 | WS 协议扩展 | task-stream-progress | 待实现 |
| DoD#7 单元测试 | Normalizer 扩展 | task-stream-progress | 待实现 |
