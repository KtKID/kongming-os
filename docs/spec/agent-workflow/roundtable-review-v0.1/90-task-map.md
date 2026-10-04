# Task 映射

## 开发顺序

| Task | 组件 | 内容 | 依赖 | 风险 | 状态 |
|------|------|------|------|------|------|
| task-1 | Strategy Entry | 注册 `RoundtableReviewStrategy`，补 tool schema，保持 manager 解耦 | 无 | 低 | spike 已有，待按 spec 审核 |
| task-2 | Contracts | 定义 payload、reviewer、limits、claim/comment schema | task-1 | 中 | spike 已有，需加强校验 |
| task-3 | ReviewBoard | 写六件套、输入物化、短路径策略 | task-2 | 中 | spike 已有，需补 validation event |
| task-4 | Prompt Contracts | 固化主 agent、独立评审、质询、arbiter prompt | task-2 | 中 | 待对齐 |
| task-5 | Budget Controller | 输入快照和输出估算纳入 50K 总预算，轮次封顶 6 | task-3 | 高 | 待重做 |
| task-6 | Arbiter | 真子 agent 仲裁和 deterministic fallback | task-3/task-4 | 中 | spike 已有，需对齐报告契约 |
| task-7 | Validation | 单测、相邻 workflow 回归、Windows 长路径测试 | task-1..6 | 中 | 部分完成 |
| task-8 | `/review` 入口 | slash command 展开为 roundtable workflow prompt 或 action | task-1..7 | 中 | 待设计 |

## PoC 建议

优先 PoC `task-5 Budget Controller`。预算语义会决定输入裁剪、prompt 快照大小、rebuttal 轮次停止和 arbiter 是否启动，这是当前 spike 最大不确定点。

## 可进入 x-req 的任务

- task-1 Strategy Entry
- task-2 Contracts
- task-3 ReviewBoard
- task-4 Prompt Contracts
- task-6 Arbiter
- task-7 Validation

## 停留在方案层的任务

- task-5 Budget Controller：先确认预算是否需要真实 provider usage。
- task-8 `/review` 入口：先确认 slash command 采用 prompt command 还是 action command。

## 当前 spike 处理建议

保留为参考实现，按本 spec 做二次整理。二次整理时先补 contract validation 和预算控制，再决定 slash command 入口。
