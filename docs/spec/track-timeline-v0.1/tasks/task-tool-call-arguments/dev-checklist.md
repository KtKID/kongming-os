# task-tool-call-arguments · 开发清单

> spec: docs/spec/track-timeline-v0.1/spec.md
> 创建: 2026-09-30

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

背景：前端聊天工具卡片已渲染 `arguments`（`web/src/components/MessageList.tsx:831-834`），WSEventSink 已透传 `payload["arguments"]`（`src/hosts/web/websocket/event_sink.py:287`），唯独 runner 从未发送——本 task 只修 runner 一处，是轨迹详情入参展示（feat07 场景2）与聊天卡片入参展示（feat07 场景1）的共同数据源头。先于其余两个 task 交付。

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | runner `tool.call.start` 事件 payload 增加 `arguments: call.arguments`（`_execute_single_tool_call` 内，现 `src/core/runner.py:1843` 只发 call_id/tool_name） | feat07 场景1, 场景2 | src/core/runner.py | None | [x] 🟢 |
| T2 | unit 测试：stub LLM + 真实 ToolRegistry 跑一轮含参 tool call，内存 sink 捕获事件，断言 `tool.call.start` payload 含真实 arguments；再经真实 `WSEventSink` 转换，断言 `ToolCallStartFrame.arguments` 非空（wire 全链路） | feat07 场景1 | tests/unit/test_runner_tool_call_start_arguments.py | None | [x] 🟢 |
| T3 | 前端 `ChatRenderAdapter` 既有测试补断言：`arguments` 从 `ChatToolRecord` 透传到 tool 视图项（UI 渲染已存在，只锁投影不断裂） | feat07 场景1 | web/src/chat/__tests__/ChatRenderAdapter.test.ts | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent/
├── src/core/runner.py                                        M  # tool.call.start payload 补发 arguments
├── tests/unit/test_runner_tool_call_start_arguments.py       U  # 新增：runner emit + WSEventSink 转换全链路断言
└── web/src/chat/__tests__/ChatRenderAdapter.test.ts          M  # 补 arguments 透传断言
```
