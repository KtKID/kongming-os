# 任务映射

## 开发任务

| Task | 模块 | 内容 | 依赖 | 风险 | 状态 |
|------|------|------|------|------|------|
| task-1 | Task Detail Overlay | 调整 chat 路由为父 route，新增覆盖页外壳、tab、关闭行为和入口文案 | 无 | 高 | 待进入 x-req |
| task-2 | Thread Artifact Reader | 新增后端 Manager、DTO、router 和安全读取测试 | task-1 可并行 | 高 | 待进入 x-req |
| task-3 | Thread File Browser + Structured Record Renderer | 新增文件列表、预览、JSON/JSONL/Markdown/text 渲染和前端测试 | task-2 | 中 | 待进入 x-req |
| task-4 | Workflow Viewer Embed | 从现有 WorkflowRunViewerPage 抽出可嵌入主体，接入 Workflows tab 和直达 URL | task-1 | 高 | 待进入 x-req |
| task-5 | E2E / smoke | 覆盖 Chat -> task detail -> session files -> workflows -> close 路径 | task-1..4 | 中 | 待进入 x-req |

## 排序依据

1. task-1 先验证最关键约束：覆盖页打开时 ChatPage 保持挂载。
2. task-2 与 task-1 可并行，后端 API 是会话内容 tab 的数据前提。
3. task-3 在 API DTO 稳定后实现渲染细节。
4. task-4 独立处理 workflow viewer 抽组件风险。
5. task-5 在主链路完成后执行。

## PoC 建议

task-1 应先做一个最小 route PoC：

- ChatPage 内加入 `Outlet`。
- `/chat/:thread_id/agent-workflows` 作为 child route 打开一个临时 overlay。
- 测试确认 Chat 消息列表 DOM 在 route 切换后仍存在。

task-4 应先做组件抽取 PoC：

- 将 `WorkflowRunViewerPage` 的 header 与主体分离。
- 新增 `WorkflowViewerEmbed` 接收 `threadId`、`workflowId`、`onWorkflowSelect`。
- 原页面入口继续用 `WorkflowViewerEmbed`，测试保持通过。

## 可进入 x-req 的模块

- Task Detail Overlay
- Thread Artifact Reader
- Thread File Browser
- Structured Record Renderer
- Workflow Viewer Embed

## 留在方案层的内容

- trace.jsonl timeline 专属视图。
- 独立窗口任务详情。
- 跨 thread 搜索和筛选。
