# 核心流程

图见 [diagrams.md](./diagrams.md) 的“核心流程”和“状态流转”。

## 流程 1：用户查看当前 thread 进度

1. 用户在 Web chat 打开某个 thread。
2. 顶部工具区显示“进度”入口，入口绑定当前 `thread_id`。
3. 用户点击入口，前端打开 popover。
4. 前端请求 `GET /api/threads/{thread_id}/task-progress`。
5. 后端解析 session 目录并读取 `task_progress.json`。
6. 文件缺失或 `tasks` 为空时，前端显示空态。
7. 有任务时，前端按未完成、进行中、已完成展示列表和计数。

## 流程 2：面板打开期间刷新

1. popover 打开后启动 2 秒刷新。
2. 每次刷新重新读取当前 `thread_id` 的任务进度。
3. 用户切换 thread 时，前端停止旧 thread 刷新并读取新 thread。
4. popover 关闭或组件卸载时停止刷新。

## 流程 3：LLM 写入当前 session 任务

1. LLM 在需要展示长任务计划或更新进度时调用 `set_task_progress` 类工具。
2. 工具从 `ToolContext` 获取当前 `session_id`。
3. 工具校验任务数组、状态枚举和必填字段。
4. 工具调用 Session 进度仓储，原子写入 `<session_dir>/task_progress.json`。
5. Web 下一次刷新读取新快照并更新 popover。

## 流程 4：编排事件同步

1. `workflow_started` 或 `agent_assigned` 发生时，桥接层读取 `task_id`、`task_run_id`、`desc` 和展示顺序，写入 pending 列表。
2. 子 agent 开始执行时，对应任务标记为 `in_progress`。
3. `agent_completed` 发生时，对应任务标记为 `completed`。
4. `agent_failed` 发生时，对应任务保持 `pending`，同时写入 `source_status="failed"` 和 `error_message`。
5. `workflow_completed` 发生时，桥接层按最终 run/report 状态覆盖当前快照。
6. Web 通过轮询读取快照，映射为 compact checklist view model 并展示最新状态。

## 异常路径

| 场景 | 行为 |
|------|------|
| session 目录不存在 | GET 返回空快照，PUT/工具写入时按现有 session 校验策略决定是否创建目录 |
| JSON 文件损坏 | GET 返回可诊断错误，前端显示轻量错误态 |
| status 非法 | 写入拒绝，返回字段级错误 |
| desc 为空 | 写入拒绝，要求 LLM 或编排层提供 Web 展示文本 |
| orchestration task id / task id 缺失 | 写入拒绝，要求编排层或 LLM 工具提供稳定来源 ID |
| 并发写入 | 仓储采用最后一次原子替换结果 |
