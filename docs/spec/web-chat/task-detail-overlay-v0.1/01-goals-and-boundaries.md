# 目标、边界和完成标准

## 需求要点

- 用户要在当前 Chat 页面上打开“任务详情”覆盖页。
- 覆盖页打开时，当前 Chat 内容、输入框、上下文面板等 DOM 保持挂载。
- “会话内容”以文件浏览方式呈现，中间是 thread 文件列表，右边是选中文件内容。
- JSONL 文件按记录和字段渲染，重点字段支持 Markdown 和普通换行。
- “Workflows”页签承载现有 Workflow Viewer 能力，沿用 `/chat/{threadId}/agent-workflows` 访问心智。
- 实现以新增外壳和复用现有 viewer 为主，避免重写 workflow viewer 业务视图。

## 系统目标

1. 提供 thread 级任务详情入口，让用户在当前对话上下文中查看会话文件和 workflow 产物。
2. 通过嵌套 route / outlet 或等价常驻方案，让 ChatPage 作为父页面保持挂载。
3. 将 thread 根目录文件读取收口到后端 Manager，前端只消费 DTO。
4. 让 JSONL 的结构信息、Markdown 内容和普通换行都可读。
5. 将现有 `repo:web/src/modules/agent-workflow-viewer` 改造成页面和嵌入两种使用形态。

## 包含范围

- Chat 中任务详情入口和覆盖页打开 / 关闭行为。
- 覆盖页左侧 tab、会话内容三栏布局、移动端降级布局。
- thread 文件列表 API 和选中文件内容 API。
- `manifest.json`、`thread-*.jsonl`、`trace.jsonl` 的默认展示顺序。
- JSON、JSONL、Markdown、text 的前端渲染。
- Workflow Viewer 嵌入覆盖页，并保留现有直达 URL。
- 后端路径约束、文件大小限制、JSONL 行数限制和错误诊断。

## 不包含范围

- workflow 执行、写入、重跑和产物 schema 变更。
- thread 文件编辑、删除、上传和写回。
- 跨 thread 聚合搜索。
- 新增第三方 Markdown 渲染库。
- 对历史 workflow viewer API 做破坏性改名。

## 关键约束

- 跨模块入口使用 Manager；后端新能力收口在 `ThreadArtifactManager` 或同级门户。
- thread 文件读取必须限定在 `config.session.file_store_path/<thread_id>/` 内。
- 前端 Markdown 渲染优先复用 `repo:web/src/lib/markdown.tsx`。
- Workflow Viewer 复用现有 store、api 和 DTO；新增组件提取服务嵌入场景。
- `/chat/:thread_id/agent-workflows` 进入 Workflows tab 时，ChatPage 仍是父路由。

## 完成标准

- [ ] 点击任务详情入口后，ChatPage 仍保持挂载，覆盖页显示在当前内容上方。
- [ ] “会话内容”tab 中间列展示 thread 文件列表，右侧展示选中文件。
- [ ] JSONL 每行作为一个 record 展示，字段级渲染可区分 role/type/event/timestamp/content。
- [ ] `content` / `message` / `text` 字段支持 Markdown 渲染，普通换行有视觉换行。
- [ ] `manifest.json` 和普通 JSON 使用结构化 JSON viewer 展示。
- [ ] `trace.jsonl` 可按事件字段浏览，解析失败行有明确诊断。
- [ ] “Workflows”tab 复用现有 workflow viewer 列表、详情、conversation、artifact 能力。
- [ ] 直达 `/chat/{threadId}/agent-workflows` 时展示任务详情覆盖页并默认选中 Workflows。
- [ ] 后端拒绝越界 artifact_id、目录穿越和未知 thread。
- [ ] 单元测试、路由测试和前端交互测试覆盖主链路。

## 追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task |
|---------|-------------|---------------|
| ChatPage 保持挂载 | Task Detail Overlay | task-1 |
| 会话内容三栏浏览 | Task Detail Overlay + Thread File Browser | task-1 + task-3 |
| thread 文件 API | Thread Artifact Reader | task-2 |
| JSONL 字段级渲染 | Structured Record Renderer | task-3 |
| Markdown 内容和普通换行 | Structured Record Renderer | task-3 |
| Workflows tab 复用 viewer | Workflow Viewer Embed + Task Detail Overlay | task-4 |
| 直达 URL 默认打开 Workflows | Task Detail Overlay + Workflow Viewer Embed | task-1 + task-4 |
| 路径安全和错误诊断 | Thread Artifact Reader | task-2 |
| 测试覆盖 | 全部模块 | task-5 |

## 风险

- 路由调整会影响当前 `/chat/:thread_id/agent-workflows` 页面挂载方式，是最高风险。
- `WorkflowRunViewerPage.tsx` 当前页面逻辑和局部组件耦合较高，抽嵌入组件时需要保持测试稳定。
- JSONL 可能包含多种消息结构，字段渲染规则需要以宽松结构适配。
