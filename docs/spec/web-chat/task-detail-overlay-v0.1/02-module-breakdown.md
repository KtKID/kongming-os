# 模块拆分和接口

## 模块总览

| 模块 | 边界类 / 入口 | 位置 | 职责 | 输入 | 输出 | 风险 |
|------|--------------|------|------|------|------|------|
| Task Detail Overlay | `TaskDetailManager` + `TaskDetailOverlayPage` | `repo:web/src/modules/task-detail/` | 覆盖页 route、tab、关闭、布局和 URL 状态 | thread_id、active tab、selected file/workflow | 可见覆盖页和 tab 状态 | 高 |
| Thread File Browser | `ThreadFileBrowserManager` + `ThreadFileBrowser` | `repo:web/src/modules/task-detail/thread-files/` | 文件列表、选中文件、加载态、错误态 | ThreadFileListDTO、ThreadFileContentDTO | 三栏中的中间和右侧内容 | 中 |
| Thread Artifact Reader | `ThreadArtifactManager` | `repo:src/hosts/web/thread_artifacts/manager.py` | 只读扫描和读取 thread 目录文件 | thread_id、artifact_id、分页参数 | ThreadArtifactListDTO、ThreadArtifactContentDTO | 高 |
| Structured Record Renderer | `StructuredRecordRenderer` | `repo:web/src/modules/task-detail/renderers/` | JSON / JSONL 字段级渲染，Markdown 字段渲染 | artifact kind、content、diagnostics | 结构化 React 节点 | 中 |
| Workflow Viewer Embed | `WorkflowViewerEmbed` | `repo:web/src/modules/agent-workflow-viewer/` | 抽出现有 WorkflowRunViewerPage 主体，供 page 和 overlay 两种入口复用 | thread_id、workflow_id、embedded | workflow 列表和详情 UI | 高 |

## 复用清单

| 现有能力 | 复用方式 |
|---------|---------|
| `repo:web/src/modules/agent-workflow-viewer/api.ts` | Workflows tab 继续使用现有 API client |
| `repo:web/src/modules/agent-workflow-viewer/store.ts` | Workflows tab 继续使用现有 Zustand store |
| `repo:web/src/modules/agent-workflow-viewer/WorkflowRunViewerPage.tsx` | 抽出 `WorkflowViewerEmbed`，页面入口只包 header 和导航 |
| `repo:src/hosts/web/workflow_viewer/artifact_reader.py` | 提取或复制成通用 thread artifact reader 的读取规则 |
| `repo:src/hosts/web/routers/agent_workflows.py` | 复用 thread 校验和错误映射风格 |
| `repo:web/src/lib/markdown.tsx` | Markdown 字段渲染，补充普通换行策略 |

## 路由设计

前端路由以 ChatPage 常驻为核心：

```text
repo:web/src/lib/router.tsx
chat/:thread_id                         -> ChatPage
chat/:thread_id/task-detail             -> ChatPage + TaskDetailOverlay(tab=session)
chat/:thread_id/task-detail/files/:id   -> ChatPage + TaskDetailOverlay(tab=session, selected file)
chat/:thread_id/agent-workflows         -> ChatPage + TaskDetailOverlay(tab=workflows)
chat/:thread_id/agent-workflows/:wf_id  -> ChatPage + TaskDetailOverlay(tab=workflows, selected workflow)
```

实现上推荐把 `chat/:thread_id` 变成父 route，ChatPage 内渲染 `Outlet`，任务详情覆盖层作为 child route。这样进入 `/agent-workflows` 时底层 Chat DOM 仍在父 route 内。

## 后端 API

```text
GET /api/threads/{thread_id}/artifacts
GET /api/threads/{thread_id}/artifacts/{artifact_id}
```

### ThreadArtifactListDTO

| 字段 | 类型 | 说明 |
|------|------|------|
| `thread_id` | string | 当前 thread |
| `files` | ThreadArtifactRefDTO[] | 可展示文件列表 |
| `diagnostics` | DiagnosticDTO[] | 扫描诊断 |

### ThreadArtifactRefDTO

| 字段 | 类型 | 说明 |
|------|------|------|
| `artifact_id` | string | base64url 编码的相对路径 |
| `path` | string | thread 目录内相对路径 |
| `kind` | `json` / `jsonl` / `markdown` / `text` / `directory` | 渲染类型 |
| `title` | string | 展示名称 |
| `size_bytes` | number? | 文件大小 |
| `available` | boolean | 文件是否存在 |
| `record_count` | number? | JSONL 可选行数统计 |

### ThreadArtifactContentDTO

| 字段 | 类型 | 说明 |
|------|------|------|
| `artifact_id` | string | 文件 id |
| `path` | string | 相对路径 |
| `kind` | string | 渲染类型 |
| `title` | string | 展示名称 |
| `content` | unknown | JSON object、JSONL records、text 或目录 entries |
| `truncated` | boolean | 是否截断 |
| `diagnostics` | DiagnosticDTO[] | 读取诊断 |

## 文件选择规则

默认文件顺序：

1. `manifest.json`
2. `<thread_id>.jsonl`
3. `trace.jsonl`
4. `task_progress.json`
5. `agent-workflows/` 目录入口提示
6. 其他 `.json` / `.jsonl` / `.md` / `.txt`

文件扫描只展示 thread 根目录和明确允许的浅层目录。第一版建议读取 thread 根目录文件；`agent-workflows/` 详情由 Workflows tab 承接。

## JSONL 渲染规则

| 字段类型 | 渲染方式 |
|---------|---------|
| `content` / `message.content` / `text` / `message` 字符串 | Markdown 渲染，普通换行保留 |
| `role` / `type` / `event` / `action` / `timestamp` / `created_at` | 顶部标签或 metadata 行 |
| `tool_calls` / `usage` / `metadata` / object / array | 可折叠 JSON viewer |
| 解析失败行 | 单独错误 record，展示行号和原始片段 |

## 前端组件拆分

| 组件 | 职责 |
|------|------|
| `TaskDetailOverlayPage` | 从 route params 解析 thread、tab、workflow/file，挂载 overlay |
| `TaskDetailShell` | 左侧 tab、标题栏、关闭按钮、三栏布局容器 |
| `ThreadFileListPane` | 中间文件列表、默认文件选择、刷新 |
| `ThreadFilePreviewPane` | 右侧文件预览、诊断、截断提示 |
| `JsonlRecordList` | JSONL record 列表 |
| `StructuredRecordRenderer` | 单条 record 字段级渲染 |
| `MarkdownFieldRenderer` | Markdown 字段渲染和普通换行 |
| `WorkflowViewerEmbed` | 内嵌 workflow viewer 列表、详情和刷新 |

## 模块边界

- `TaskDetailManager` 只处理前端 task-detail route 和 tab 状态。
- `ThreadFileBrowserManager` 只处理 thread 文件 UI state。
- `ThreadArtifactManager` 是后端 thread artifact 读取唯一入口。
- `WorkflowViewerEmbed` 是 workflow viewer 面向嵌入场景的唯一入口。
- `StructuredRecordRenderer` 作为渲染边界，调用方只传 DTO 和渲染选项。
