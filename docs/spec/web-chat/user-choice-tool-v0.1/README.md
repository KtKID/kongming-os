# user-choice-tool-v0.1

> 状态：方案确认
> 目标：提供一个 LLM 可调用的用户选择工具，在 Web chat 输入框上方展示多问题选项列表，让用户逐题选择并确认后继续对话。

## 系统目标

当前对话中，LLM 经常需要用户在 A/B/C 方案、范围、偏好、执行策略之间做选择。`present_choices` 工具把这类选择收口成标准协议：LLM 提供 title、desc 和 questions，Web 在 composer 上方渲染逐题选择面板，用户确认后生成结构化选择结果回到当前 thread。

## 最小可用路径

LLM 调用 `present_choices` → 工具校验 title/desc/questions 并 emit `choice.requested` → WebSocket 下发 `choice.request` → Chat 页在输入框上方展示选择面板 → 用户逐题选择或填写自定义选项 → 点击确定 → 前端发送 `choice.submit` → 后端把选择结果转为当前 session 的下一轮 user input → Runner 继续执行。

## 范围边界

**包含**：
- 一个模型可见工具：`present_choices`。
- tool descriptor 含 `title` 和 `description`，description 同时描述功能与使用场景。
- 工具参数支持 N 个问题，每题 M 个 LLM 选项。
- 每个问题固定附加一个“自己输入”选项。
- Web UI 固定展示在 composer 上方。
- 用户按问题顺序选择，可点击 step 来回切换。
- 最终确认后回传结构化选择结果。
- 保留静态原型：`repo:docs/choice-list-prototype.html`。

**不包含**：
- 多选题、排序题、打分题。
- 跨 thread 共享选择请求。
- 选择请求持久化恢复。
- CLI/TUI 选择界面。
- 让工具阻塞等待用户输入。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| Choice Tool | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1choice-tool) | 是 | LLM 调用入口和参数 schema |
| Choice Protocol | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2choice-protocol) | 是 | Event 与 WebSocket 帧合同 |
| Choice UI | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3choice-ui) | 是 | composer 上方选择面板 |
| Choice Submit Bridge | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-4choice-submit-bridge) | 是 | 用户确认后继续当前 run 链路 |
| Prompt Guidance | 方案确认 | [模块拆分](./02-module-breakdown.md#模块-5prompt-guidance) | 是 | workflow/TOOLS 提示词引导 LLM 使用 |

## 文档导航

- [图集：总览 + 各模块局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

先进入 x-req，拆一个 task：`web-chat-user-choice-tool-v0.1`。首版完成 `present_choices` 工具、`choice.request` / `choice.submit` 协议、composer 上方面板和回传链路。
