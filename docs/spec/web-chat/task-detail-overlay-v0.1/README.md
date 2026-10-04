# Task Detail Overlay v0.1

> 目标：在 Web Chat 中新增任务详情覆盖页，保留当前 Chat DOM，提供 thread 文件浏览和现有 Workflow Viewer 的嵌入式入口。

输入已足够具体，跳过追问。本 spec 聚焦任务详情外壳、会话文件浏览器、JSONL 字段级渲染和 Workflow Viewer 复用。

## 最小可用路径

用户在当前 thread 点击任务详情入口，ChatPage 保持挂载，覆盖页打开；左侧选择“会话内容”时，中间展示 thread 文件列表，右侧渲染选中文件；左侧选择“Workflows”时，同一覆盖页内复用现有 Agent Workflow Viewer 列表与详情。

## 需求要点

- 任务详情以覆盖页形式出现在当前 Chat 上方，底层 Chat DOM 保留。
- 左侧 tab 包含“会话内容”和“Workflows”。
- “会话内容”使用三栏布局：左侧 tab，中间文件列表，右侧文件渲染。
- 文件列表覆盖 `manifest.json`、`thread-*.jsonl`、`trace.jsonl` 等 thread 目录文件。
- JSONL 采用字段级渲染，`content` / `message` / `text` 字段按 Markdown 渲染并保留普通换行。
- “Workflows”复用现有 Agent Workflow Viewer，URL 继续支持 `/chat/{threadId}/agent-workflows` 形态。
- 新增外壳层承接导航与布局，现有 workflow viewer 业务视图保持可复用。

## 组件导航

| 组件 | 状态 | 说明 | 可进入 x-req |
|------|------|------|-------------|
| Task Detail Overlay | 可进入 x-req | 常驻 Chat 父路由上的覆盖页外壳、tab、关闭和布局状态 | 是 |
| Thread File Browser | 可进入 x-req | thread 文件清单、选中文件、加载态和空态 | 是 |
| Thread Artifact Reader | 可进入 x-req | 后端只读读取 thread 根目录允许文件，复用 workflow artifact 读取模型 | 是 |
| Structured Record Renderer | 可进入 x-req | JSON / JSONL 字段级渲染，Markdown 字段独立渲染 | 是 |
| Workflow Viewer Embed | 可进入 x-req | 从现有 WorkflowRunViewerPage 抽出可嵌入主体，供覆盖页 Workflows tab 调用 | 是 |

## 文档导航

- [目标、边界和完成标准](./01-goals-and-boundaries.md)
- [模块拆分和接口](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据和状态](./04-data-and-state.md)
- [验证和演进](./05-validation-and-evolution.md)
- [任务映射](./90-task-map.md)
- [图集](./diagrams.md)

## 当前建议

本 spec 状态为方案确认，所有模块可进入 x-req。开发顺序建议先做路由常驻与覆盖页外壳，再做 thread 文件 API 和渲染器，最后抽出 Workflow Viewer 可嵌入主体并接入 Workflows tab。
