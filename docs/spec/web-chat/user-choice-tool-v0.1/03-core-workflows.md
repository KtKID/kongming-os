# 核心流程

## 流程 1：LLM 发起选择请求

1. LLM 判断当前任务需要用户在多个方案、范围或偏好之间做明确选择。
2. LLM 调用 `present_choices`，传入 `title`、`description`、`questions`。
3. Choice Tool 校验请求，使用 `ToolContext.call_id` 生成 `request_id`。
4. Choice Tool emit `choice.requested`。
5. `WSEventSink` 将事件翻译为 `choice.request`。
6. 前端收到帧后交给 `ChoiceManager.receive()`。
7. Chat 页在 composer 上方渲染 `ChoicePanel`。

## 流程 2：用户逐题选择

1. `ChoicePanel` 展示第 1 个问题。
2. 用户选择 LLM 选项，或选择“自己输入”并填写自定义文本。
3. 当前问题有效后，“下一步”可点击。
4. 用户进入下一题。
5. 用户可点击 step 回到前面问题修改答案。
6. 全部问题有效后，“确定”可点击。

## 流程 3：确认并继续对话

1. 用户点击确定。
2. `ChoiceManager.buildSubmitFrame()` 生成 `choice.submit`。
3. 前端通过当前 generic channel 发送 frame。
4. 后端 WebSocket route 校验 `request_id` 和 `answers`。
5. 后端把 answers 格式化为 user input 文本。
6. 后端调用当前 cell 的 `bridge.run_once()`。
7. Runner 把选择结果作为普通用户消息写入 session。
8. LLM 基于选择结果继续执行。

## 并发规则

- 当前 thread 有 active run 时，`choice.submit` 返回 error 帧。
- 前端收到 error 后保留选择面板，让用户稍后重新确认。
- 首版只保留一个 active choice request。新 `choice.request` 到达时覆盖旧面板，并 toast 提示。

## 选择结果文本格式

```text
用户已完成选择：
request_id: choice-call-123

1. question_id=direction
问题：你希望优先采用哪类方案？
选择：a / A 方案：快速上线
说明：先打通主链路，保留后续扩展空间。

2. question_id=scope
问题：这次实现范围控制到哪里？
选择：__custom__ / 自己输入
自定义：先只做 Web，不做 CLI。
```
