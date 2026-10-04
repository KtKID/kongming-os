# Claude Session 延迟创建

> 状态：方案确认中
> 目标：Claude tab 点"新建会话"后直接进入空白聊天，发送第一条消息时才创建 thread + 连接 WebSocket

## 系统目标

当前 Claude tab 只能浏览和导入已有的 `~/.claude/projects/` 下 SDK session。用户无法直接从 Claude tab 发起一个全新会话——必须切到通用 tab 的 NewThreadDialog 手动选 backend_kind=claude_code 再填 cwd。

本方案让用户在 Claude tab 的 project 节点下点"新建会话"，立刻进入空白聊天界面，发第一条消息时自动创建 thread、连 WS、发送消息。**零对话框、零等待**——参考 claudecodeui 的 `handleNewSession` 模式。

## 最小可用路径

用户展开 Claude tab 的某个 project → 点击 `+ 新建会话` → 主区域变成空白 ClaudeCodeView + Composer → 用户输入第一条消息 → 后端创建 thread（POST /api/threads）→ 前端连 WS → 消息发出 → URL 更新为 `/chat/{thread.id}`

这条链路涉及的 3 个模块都是 P0。

## 范围边界

**包含**：
- Claude tab project 节点下的"新建会话"按钮
- "待创建"状态管理（cwd + 项目名，尚无 thread）
- ChatPage 空态渲染（无 threadId 时展示 pending ClaudeCodeView）
- ClaudeCodeView pending 模式（空消息列表 + 可用 Composer）
- 首条消息触发 thread 创建 + WS 连接 + URL 替换

**不包含**：
- 后端 API 改动（已有 `POST /api/threads` 完全够用）
- Codex tab 的类似功能（后续独立做）
- 通用 tab NewThreadDialog 的改动
- 项目级 Claude session 自动发现/文件监听

## 模块导航

| 模块 | 状态 | 优先级 | 是否可进 task | 说明 |
|------|------|--------|---------------|------|
| M1 触发入口 | 可进入 x-req | P0 | 是 | Claude tab 按钮 + pending state |
| M2 空态渲染 | 可进入 x-req | P0 | 是 | ChatPage + ClaudeCodeView pending mode |
| M3 延迟创建 | 可进入 x-req | P0 | 是 | 首条消息 → thread + WS + navigate |

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 三个模块无前后依赖、可合并为一个 task（改动总量约 150 行前端代码，0 行后端）
2. 建议直接进入 x-req 产出 dev-checklist 然后开发
3. 后端零改动——复用 `POST /api/threads`（backend_kind=claude_code, cwd=项目路径）
