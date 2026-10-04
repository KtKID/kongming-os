# 目标与完成标准

## 需求要点

1. 左侧 thread 列表保持现状。
2. 顶部新增一个按钮组或入口，仅对应当前 thread。
3. 点击入口弹出当前 session 的任务进度；无任务时显示空态。
4. 提供接口让 LLM 填写当前任务列表。
5. 任务列表保存到 session 同目录。
6. 任务状态包含未完成、进行中、已完成。
7. 任务展示需要有对应 view model 数据结构，方便前端组件测试构造 fixture。
8. 数据来源暂定读取编排任务信息：`task_id` 是原始任务 ID，`task_run_id` 是一次运行的稳定 ID，`desc` 是 Web 展示文本；LLM 写入路径使用 `workflow_id + step_id`，后端派生展示 key。
9. Web 根据文件状态更新，MVP 采用 2 秒轮询；workflow 事件发生时写入最新状态。

## 系统目标

让用户在当前对话现场看到长任务推进状态，减少对 agent 是否仍在推进、推进到哪一步的猜测。让 workflow 事件转化为可持久化、可展示的 session 级进度文件，形成 UI、后端、LLM 工具共享的一份任务进度事实源。

## 完成目标（DoD）

- [ ] 当前 thread 顶部存在“进度”入口，并且入口作用域绑定当前 thread。
- [ ] 点击入口展示 popover；无进度文件或任务数组为空时显示空态。
- [ ] 后端 `GET /api/threads/{thread_id}/task-progress` 能读取当前 session 同目录进度文件。
- [ ] 后端或工具写入接口能原子更新当前 session 的任务列表。
- [ ] LLM 工具可以在当前 session 写入 pending / in_progress / completed 三种状态。
- [ ] Web 在 popover 打开时按 2 秒周期刷新，并在切换 thread 后读取新 thread 的进度。
- [ ] workflow started / assigned / running / completed / failed 事件具备明确调用点，能把当前任务状态写入同一文件。

## 范围边界

**包含**：
- 当前 thread 顶部进度入口与 popover。
- session 目录下 `task_progress.json` 文件。
- REST 读取接口与受控写入接口。
- LLM/编排写入能力。
- 状态枚举、空态、错误态、更新时间展示。
- compact checklist 展示数据结构。
- 编排 task id 到展示项的映射。
- workflow 事件到三态进度的映射。
- 轮询刷新策略。

**不包含**：
- 左侧 thread 列表视觉或信息结构调整。
- 多 session 汇总视图。
- 多用户协作冲突解决。
- 任务耗时估算、优先级、负责人。
- 外部项目管理系统同步。
- 对旧格式进度文件的兼容迁移。

## 关键约束

- 进度只绑定当前 `thread_id` / `session_id`，避免全局状态串线。
- 文件必须保存到 session 同目录，唯一解析口径是 `SessionTaskProgressRepository` 调用 `resolve_kongming_path(config.session.file_store_path)`，API、LLM 工具和 workflow 桥接都调用该仓储。
- 第一版任务来源读取编排 `task_id` 和 `task_run_id`；任务展示文本使用 `desc`；workflow 桥接生成 `<workflow_id>:<task_run_id>`，LLM 工具生成 `<workflow_id>:<step_id>`，两者都写入 `id/orchestration_task_id` 作为内部稳定 key。
- 任务状态后端使用稳定枚举，前端展示中文标签。
- 前端展示由稳定 view model 驱动，测试使用同一结构构造 fixture。
- 写入必须原子替换，避免 Web 读到半截 JSON。
- 轮询只在当前 thread 或 popover 可见时启用，控制后台请求量。
- LLM 工具只允许写当前 session 的进度文件。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| 顶部存在当前 thread 入口 | 进度入口与面板 | task-1 | 待实现 |
| popover 空态与列表展示 | 进度入口与面板、进度读写 API | task-1 | 待实现 |
| GET 读取进度文件 | 进度读写 API、Session 进度仓储 | task-1 | 待实现 |
| 原子写入任务列表 | Session 进度仓储、进度读写 API | task-1 | 待实现 |
| LLM 写当前 session 进度 | LLM 进度写入工具、Session 进度仓储 | task-1 | 待实现 |
| 展示 view model 可测试 | 进度入口与面板 | task-1 | 待实现 |
| 编排 task id 映射 | 编排进度桥接、Session 进度仓储 | task-1 | 待实现 |
| session 路径唯一解析 | Session 进度仓储、进度读写 API、编排进度桥接 | task-1 | 待实现 |
| 2 秒刷新与 thread 切换 | 进度入口与面板 | task-1 | 待实现 |
| workflow 事件写入 | 编排进度桥接、Session 进度仓储 | task-1 | 待实现 |
