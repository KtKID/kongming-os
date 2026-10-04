# 目标与完成标准

## 系统目标

让用户从 Claude tab 直接发起新会话，无需弹框、无需手动选 backend/cwd。交互体验对齐 claudecodeui 的 `handleNewSession` 模式：点击 → 空白聊天 → 发消息即创建。

## 完成目标（DoD）

- [ ] DoD#1：Claude tab 展开的 project 节点下有"新建会话"按钮
- [ ] DoD#2：点击后主区域立刻切换到空白 ClaudeCodeView（无 loading、无弹框）
- [ ] DoD#3：Composer 可用，输入第一条消息后自动创建 thread + 连接 WS + 发送
- [ ] DoD#4：创建成功后 URL 从 `/chat` 无缝替换为 `/chat/{thread.id}`
- [ ] DoD#5：左栏 threads 列表同步刷新，新 thread 出现在列表中
- [ ] DoD#6：创建失败（网络错误等）toast 报错，不丢失用户输入
- [ ] DoD#7：重复点"新建会话"不创建多个 thread（仅导航到空态）

## 范围边界

**包含**：
- ClaudeProjectsTree 的 ProjectNode 加"新建会话"按钮
- Zustand store 加 `pendingNewClaudeSession` 状态
- ChatPage 在无 threadId 但有 pending state 时渲染 ClaudeCodeView
- ClaudeCodeView 支持 `threadId=undefined` 的 pending 模式
- 首条消息的 thread 创建 + WS 连接 + URL 替换 + store 刷新

**不包含**：
- 后端 API 新增/修改
- 通用 tab 的 NewThreadDialog 改动
- Codex tab 类似功能
- session 自动命名（后续可加）
- workspace shell 在 pending 状态下的行为

## 关键约束

- 后端零改动：`POST /api/threads` + `/ws/claude-code?thread_id=xxx` 已满足所有需求
- 前端改动集中在 4 个文件内
- 必须兼容 ClaudeCodeView 已有的历史加载、流式渲染、审批对话框逻辑
- thread 创建到 WS 连接之间不能丢消息

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 状态 |
|---------|------------|------|
| DoD#1 按钮 | M1 触发入口 | 待实现 |
| DoD#2 空态渲染 | M1 + M2 空态渲染 | 待实现 |
| DoD#3 延迟创建 | M3 延迟创建 | 待实现 |
| DoD#4 URL 替换 | M3 延迟创建 | 待实现 |
| DoD#5 列表刷新 | M3 延迟创建 | 待实现 |
| DoD#6 错误处理 | M3 延迟创建 | 待实现 |
| DoD#7 防重复 | M1 + M2 | 待实现 |
