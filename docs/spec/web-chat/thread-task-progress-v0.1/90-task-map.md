# Task 映射

## 推荐 task 包

| task | 范围 | 优先级 | 是否阻塞 MVP | 说明 |
|------|------|--------|--------------|------|
| `web-chat-thread-task-progress-v0.1` | 仓储、REST API、LLM 工具、workflow 事件桥接、顶部 UI、展示 view model、轮询刷新 | P0 | 是 | 单 task 足够覆盖当前用户诉求 |
| `agent-workflow-task-progress-bridge-v0.1` | workflow 事件到 task progress 的自动同步 | P1 | 否 | 已纳入 P0 task 的薄桥接，复杂时拆出 |
| `thread-task-progress-push-v0.2` | WebSocket / thread-status 推送 | P2 | 否 | 替代 2 秒轮询的后续增强 |

## task-1：web-chat-thread-task-progress-v0.1

**目标**：实现当前 thread 的任务进度查看与写入闭环。

**包含组件**：
- Session 进度仓储。
- `GET /api/threads/{thread_id}/task-progress`。
- `PUT /api/threads/{thread_id}/task-progress`。
- LLM 写入工具。
- workflow 事件桥接，读取 `task_id` / `task_run_id` / `desc`。
- 顶部进度入口与 popover。
- compact checklist view model 与测试 fixture。
- 编排 task id 到进度项的映射。
- 2 秒刷新。
- 单元测试和前端组件测试。

**验收点**：
- 打开任意 thread 能看到顶部“进度”入口。
- 无任务时 popover 显示空态。
- 写入 `task_progress.json` 后，popover 2 秒内显示任务。
- LLM 工具能写当前 session 的任务列表。
- 每条任务保留 `task_id` / `task_run_id` / `desc`，并生成内部 progress key；workflow bridge 使用 `<workflow_id>:<task_run_id>`，LLM tool 使用 `<workflow_id>:<step_id>`；前端用派生 key 作为稳定 key，用 `desc` 作为展示文本。
- 前端可用固定 view model fixture 渲染截图中的任务样式。
- API、LLM 工具、workflow 桥接都通过同一个 repository 解析 session 目录。
- 非法状态写入失败。
- 前端切换 thread 后展示对应 session 进度。

**建议开发顺序**：
1. 实现 Session 进度仓储和 schema 校验。
2. 实现 Web REST API 与后端测试。
3. 实现 LLM 工具与安全策略测试。
4. 实现前端 API helper、hook、popover 和组件测试。
5. 接入顶部工具区与移动端工具入口。
6. 增加 workflow 事件桥接，覆盖 assigned / running / completed / failed。

## task-2：agent-workflow-task-progress-bridge-v0.1

**目标**：把 agent workflow 的事件状态同步到当前 session 进度文件。

**进入条件**：
- task-1 已提供稳定仓储与 schema。
- `task_id` / `task_run_id` / `workflow_id` 映射已确认。

**验收点**：
- workflow 创建时写入任务列表。
- 子 agent 开始运行时更新当前任务状态。
- workflow 完成时所有已执行任务标记为已完成。
- workflow 失败时保留未完成任务说明和 `error_message`。

## task-3：thread-task-progress-push-v0.2

**目标**：把轮询升级为事件推送。

**进入条件**：
- v0.1 运行稳定。
- thread-status 或 WebSocket 事件已具备可靠广播路径。

**验收点**：
- 进度写入后 Web 无需等待轮询即可刷新。
- 网络断开或事件失败时回退轮询。
- 推送路径不增加跨 thread 串线风险。

## 当前建议

下一步走 x-req，创建 `dev-pipeline/tasks/web-chat-thread-task-progress-v0.1/`。第一版把 task-1 作为完整闭环，包含 workflow 事件桥接；task-3 留到 v0.2。
