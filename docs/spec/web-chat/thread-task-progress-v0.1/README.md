# thread-task-progress-v0.1

> 状态：历史方案；当前实现以 `docs/spec/workflow-task-progress-single-owner-v3/spec.md` 为准
> 目标：为当前 thread 提供顶部进度入口，让用户能查看当前 session 的任务列表与状态，并让 LLM/编排流程在确定时机写入进度文件。

## 系统目标

当前 Web chat 需要一个轻量的“当前任务进度”表面：用户留在当前 thread 时，可以从顶部入口看到本 session 的任务推进状态；workflow 事件发生时，可以把最新任务列表写入 session 同目录，由 Web 读取并刷新。

## 最小可用路径

用户打开某个 thread → 顶部看到“进度”按钮 → 点击弹出当前 session 的任务进度面板 → Web 读取 `<session_dir>/task_progress.json` → 无任务显示空态，有任务按 compact checklist 展示 → 每条任务包含 `task_id` 和 `desc`，Web 展示 `desc`，并以派生 progress key 作为稳定展示 ID → LLM 只提交 `workflow_id + step_id + desc + status`，编排桥接保留 `task_run_id` 来源 → 后端统一写入同一文件 → 面板 2 秒内刷新。

## 范围边界

**包含**：
- 保持左侧 thread 列表现状。
- 顶部新增仅作用于当前 thread 的进度入口。
- 点击入口显示 popover，不新开独立页面。
- 后端提供当前 thread 进度读写接口。
- LLM/编排提供写入当前 session 任务列表的接口。
- 任务状态固定为未完成、进行中、已完成。
- 提供任务展示 view model，方便前端组件测试直接喂 fixture。
- 数据来源暂定读取编排 task id，任务展示项与编排任务保持稳定映射。
- MVP 使用 2 秒轮询读取文件状态。

**不包含**：
- 全局多 thread 进度看板。
- 左侧 thread 列表改造。
- 任务依赖 DAG、甘特图、耗时统计。
- 跨设备实时协同编辑。
- 历史快照回放。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|------|------|------|---------------|------|
| 进度入口与面板 | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-1进度入口与面板) | 是 | 放在当前 chat/thread 顶部工具区，负责展示和轮询 |
| 进度读写 API | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-2进度读写-api) | 是 | 读取和写入当前 session 同目录进度文件 |
| Session 进度仓储 | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-3session-进度仓储) | 是 | 统一路径解析、校验、原子写入 |
| LLM 进度写入工具 | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-4llm-进度写入工具) | 是 | 让当前 session 的 LLM 填充任务列表 |
| 编排进度桥接 | 可进入 x-req | [模块拆分](./02-module-breakdown.md#模块-5编排进度桥接) | 是 | 在 agent workflow 事件发生时写入状态 |

## 文档导航

- [图集：总览 + 局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

先进入 x-req 产出一个单 task 包，覆盖后端仓储/API、LLM 写入工具、顶部进度 UI。编排桥接作为同一 task 的薄集成点处理，若现有 workflow 状态映射复杂，再拆为第二个 task。
