# 验证和演进

## 验证重点

| 能力 | 验证点 |
|------|--------|
| 路由常驻 | 从 `/chat/{threadId}` 进入 `/task-detail` 和 `/agent-workflows` 时 ChatPage 状态保留 |
| 会话文件列表 | manifest、thread jsonl、trace jsonl 按默认顺序展示 |
| 路径安全 | artifact_id 越界、`..`、绝对路径返回 422 |
| JSONL 渲染 | content Markdown、普通换行、字段标签、object 折叠展示 |
| 解析诊断 | 单行 JSON 失败不影响其他行 |
| Workflow 嵌入 | Workflows tab 复用现有列表、详情和空态 |
| 移动端 | tab、文件列表和预览不会互相遮挡 |

## 后端测试

新增或扩展测试：

```text
repo:tests/unit/web/test_thread_artifact_viewer.py
```

覆盖用例：

- `GET /api/threads/{thread_id}/artifacts` 返回默认文件。
- `GET /api/threads/{thread_id}/artifacts/{artifact_id}` 读取 JSON。
- JSONL 读取返回 records 和 diagnostics。
- 非法 artifact_id 返回 422。
- thread 不存在返回 404。
- 大文件按上限截断。

## 前端测试

新增或扩展测试：

```text
repo:web/src/modules/task-detail/__tests__/TaskDetailOverlayPage.test.tsx
repo:web/src/modules/task-detail/__tests__/StructuredRecordRenderer.test.tsx
repo:web/src/modules/agent-workflow-viewer/__tests__/WorkflowRunViewerPage.test.tsx
repo:web/src/pages/__tests__/Chat.test.tsx
```

覆盖用例：

- 任务详情入口导航到覆盖页。
- 覆盖页打开时底层 Chat 仍可在 DOM 中查询到。
- 会话内容 tab 渲染文件列表和选中文件。
- JSONL content 字段使用 Markdown 渲染。
- 普通换行在 Markdown 字段中显示为视觉换行。
- Workflows tab 调用现有 workflow API 并展示列表。
- 直达 `/chat/{threadId}/agent-workflows/{workflowId}` 默认打开 Workflows tab。

## smoke 路径

1. 准备一个 file session thread，写入 `manifest.json`、`thread-*.jsonl`、`trace.jsonl` 和一个 workflow fixture。
2. 启动 Web。
3. 打开 `/chat/{threadId}`。
4. 点击“任务详情”，确认覆盖页打开并显示 `manifest.json`。
5. 点击 `thread-*.jsonl`，确认 Markdown 和普通换行渲染。
6. 点击 `Workflows`，确认 workflow 列表出现。
7. 点击 workflow，确认详情、子 agent conversation 和 artifact 面板可用。
8. 关闭覆盖页，确认回到原 Chat。

## 建议命令

```text
uv run pytest tests/unit/web/test_thread_artifact_viewer.py -v
cd web && npm test -- task-detail
cd web && npm test -- workflow-viewer
cd web && npm test -- Chat
./start.sh web build
```

## 演进方向

- 文件列表支持按类型过滤和搜索。
- JSONL record 支持按 role/type/action 筛选。
- trace.jsonl 增加 timeline 视图。
- 会话内容和 Workflow artifact 使用同一套 artifact renderer。
- 支持任务详情在独立窗口中打开，同时保留覆盖页入口。
