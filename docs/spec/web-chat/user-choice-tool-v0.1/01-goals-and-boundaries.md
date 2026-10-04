# 目标与完成标准

## 需求要点

1. 做一个独立模块，把“让用户选择 A/B/C 方案”抽成 LLM 可调用工具。
2. LLM 自己决定问题数量和选项数量，工具只提供通用参数 schema。
3. 工具需要有 title 和 desc，desc 描述功能与使用场景，便于 LLM 判断何时调用。
4. Web 在输入框上方展示 `n` 个问题 × `m` 个选项，用户选完第一个问题再选下一个。
5. 用户可以通过 step 来回切换问题，修改前面已选答案。
6. 除 LLM 提供的选项外，每个问题固定新增“自己输入”选项。
7. 用户点击确定后，把结构化选择结果回传给对话，让 LLM 继续执行。

## 系统目标

给 Web chat 增加一个标准化的“选择请求”能力。LLM 在需要用户做方案、范围、偏好、下一步动作选择时调用工具，用户在当前输入框区域完成选择，系统把结果作为下一轮用户输入交回同一 thread。

## 完成目标（DoD）

- [ ] LLM 工具列表中出现 `present_choices`，并带 title、description 和参数 schema。
- [ ] `present_choices` 接收 title、description、questions，并拒绝空问题、空选项、重复 id。
- [ ] 工具调用成功后，WebSocket 向当前 thread 推送 `choice.request`。
- [ ] Web 在 composer 上方展示选择面板，支持逐题切换、返回修改、已答状态标记。
- [ ] 每个问题固定包含“自己输入”选项，自定义文本为空时无法进入下一题或确认。
- [ ] 用户确认后发送 `choice.submit`，后端把 answers 转成当前 session 的下一轮 user input。
- [ ] 后端和前端测试覆盖 tool schema、协议帧、UI 交互和确认链路。

## 范围边界

**包含**：
- Web generic chat 首版。
- 单选题流程。
- 当前 thread 内临时选择请求。
- 确认后继续对话的桥接。
- workflow/TOOLS 提示词中的使用说明。

**不包含**：
- 多选、排序、打分等题型。
- 请求持久化、重连恢复。
- 选择请求全局 inbox。
- CLI 展示。
- 选择结果作为独立数据库实体长期存储。

## 关键约束

- 模块门户使用 `Manager` 命名：前端为 `ChoiceManager.ts`，后端 Web 侧为 `choice_manager.py`。
- 跨模块共享 wire 协议放在现有 Web protocol 层，代码路径写为 `repo:src/hosts/web/protocol/ws_frames.py`。
- 工具层不能 import Web 内部模块；工具只 emit Event。
- Web UI 使用现有 ChatManager / NetworkManager / Composer 布局，不新建聊天运行时。
- 验证代码必须进入 tests，不用一次性脚本验证。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| 工具出现在 LLM 工具列表 | Choice Tool + Prompt Guidance | `web-chat-user-choice-tool-v0.1` | 待实现 |
| 工具参数校验完整 | Choice Tool | `web-chat-user-choice-tool-v0.1` | 待实现 |
| WebSocket 推送 `choice.request` | Choice Tool + Choice Protocol | `web-chat-user-choice-tool-v0.1` | 待实现 |
| composer 上方展示选择面板 | Choice UI + Choice Protocol | `web-chat-user-choice-tool-v0.1` | 待实现 |
| 自定义选项可填写并校验 | Choice UI | `web-chat-user-choice-tool-v0.1` | 待实现 |
| 确认后继续当前对话 | Choice Submit Bridge + Choice Protocol | `web-chat-user-choice-tool-v0.1` | 待实现 |
| 测试覆盖工具、协议、UI、链路 | 全部模块 | `web-chat-user-choice-tool-v0.1` | 待实现 |
