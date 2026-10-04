# 核心流程

## 打开任务详情

1. 用户点击 Chat toolbar、Layout rail 或 thread 操作区中的“任务详情”入口。
2. 前端导航到 `/chat/{threadId}/task-detail`。
3. Router 保持 `ChatPage` 作为父 route 挂载，`TaskDetailOverlayPage` 通过 `Outlet` 覆盖在 Chat 内容上。
4. 覆盖页默认选中“会话内容”tab。
5. `ThreadFileBrowserManager` 请求 `GET /api/threads/{thread_id}/artifacts`。
6. 文件列表返回后，默认选中 `manifest.json`；没有 `manifest.json` 时选中第一个可读文件。
7. 右侧请求选中文件内容并渲染。

## 查看会话内容文件

1. 用户在中间文件列表点击 `thread-*.jsonl`。
2. 前端读取对应 artifact content。
3. 后端校验 thread_id 和 artifact_id，解析到 thread 根目录内相对路径。
4. JSONL 按行解析，最多返回配置上限内的 dict record 和诊断。
5. 前端按 record 展示，每条 record 先展示 role/type/action/time，再展示 Markdown 字段和 JSON 字段。
6. 用户切换到 `trace.jsonl` 时沿用同一 JSONL renderer，事件字段优先展示 `action` / `event` / `ts`。

## 查看 Workflows

1. 用户点击左侧 `Workflows` tab。
2. 前端导航到 `/chat/{threadId}/agent-workflows`。
3. `TaskDetailOverlayPage` 根据 route 选中 Workflows tab。
4. `WorkflowViewerEmbed` 复用现有 workflow store 请求列表和 thread usage。
5. 用户点击 workflow 项时导航到 `/chat/{threadId}/agent-workflows/{workflowId}`。
6. `WorkflowViewerEmbed` 加载现有 workflow detail、conversation、artifact 和 timeline。

## 关闭覆盖页

1. 用户点击关闭按钮或按 Escape。
2. 前端导航回 `/chat/{threadId}`。
3. `TaskDetailOverlayPage` 卸载，父级 `ChatPage` 保持原会话 DOM 和运行时状态。
4. 文件选择和 tab 可选保存在 URL 或轻量 store 中，关闭后不影响 Chat 消息流。

## 错误流程

| 场景 | 行为 |
|------|------|
| thread 不存在 | 后端返回 404，覆盖页展示错误态 |
| artifact_id 非法 | 后端返回 422，右侧展示错误诊断 |
| 文件缺失 | 文件列表刷新；右侧展示 missing |
| JSONL 部分行解析失败 | 其他行继续展示，失败行进入 diagnostics |
| 文件过大 | 后端截断，前端展示截断提示 |
| workflow 列表为空 | 复用现有空态 |
