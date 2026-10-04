# 目标与边界

## 需求要点

1. 同一个 thread 入口代表一个定时任务。
2. 同一任务的不同执行时间拥有单独历史记录，包括今天、昨天和每次手动运行。
3. 点击不同执行记录时，chat timeline 切换到该次执行的消息历史。
4. 每次执行上下文独立；本期 run context 禁用 composer，防止追问写入入口 thread。
5. cron 实时帧至少带 `frame_type` 标识为 cron，并携带 `thread_id/task_id/run_id/session_id` 支持前端分流。
6. 已有实时刷新修复 `32b68d21` 与 `f400fd44` 作为基础能力，本轮建设 run session 切换。

## 系统目标

- `thread_id` 表示定时任务入口，生命周期跟 `ScheduledTask` 绑定。
- `run_id` 表示一次执行记录，生命周期跟自动触发或手动运行绑定。
- `session_id` 表示一次执行的上下文容器，chat timeline 读取它；后续追问写入该 session 是下一阶段。
- Web UI 在同一个 scheduled_task thread 页面里提供 run 选择器。
- WS 和 REST 协议使用同一组 `thread_id/task_id/run_id/session_id` 字段。

## 完成标准

| DoD | 验收条件 |
|-----|----------|
| D1 | 新 cron run 记录含 `thread_id/task_id/run_id/session_id`，同一个 task 连续运行会产生不同 `session_id` |
| D2 | `ExecutionBridge` 使用 run session 执行，而把 scheduled_task thread 保留为入口 thread |
| D3 | Web API 可按 `task_id` 列出 runs，按 `run_id` 加载 messages |
| D4 | cron 实时帧 `frame_type` 以 `cron.` 命名，并携带 `thread_id/task_id/run_id/session_id` |
| D5 | 前端切换 run 后 timeline 显示该 run session 历史，composer 在 run context 禁用 |
| D6 | 当前选中 run 收到 cron 实时消息时追加到 timeline，其他 run 只更新运行记录状态 |
| D7 | 旧共享 thread session 以 legacy 历史入口展示，新 run 进入独立 session |
| D8 | 后端、前端、协议漂移和薄 e2e 测试覆盖 run 切换与上下文隔离 |

## 范围

### 本轮交付

- scheduler domain/store 的 run session 索引字段和读写。
- `ExecutionBridge` run session 生成与 Runner 调用 session 切换。
- cron router 暴露 task 下 runs/messages 的统一入口。
- Web REST 路由复用 `SchedulerManager` / `ThreadManager` 门户能力。
- `cron.run.started`、`cron.run.finished`、`cron.message.appended` 等帧补齐 run/session 字段。
- scheduler store、chat provider 和 timeline 的 run 分流；composer 在 run context 禁用。
- legacy 运行记录和旧 thread session 的展示兼容。

### 后续演进

- run history 全文检索。
- run 对比视图。
- 跨任务运行汇总。
- run session 压缩策略。
- 数据库存储替代 jsonl。

## 关键约束

- 新增跨模块能力必须收口到 `SchedulerManager`、`ExecutionBridge`、`ThreadManager` 或前端已有 store/provider，路由和组件只调用门户。
- `src/core/` 仍保持零 sibling 依赖。
- `ExecutionBridge` 负责执行 session 的选择和审计字段，不把 run session 决策散落到 router。
- `ThreadManager` 负责 thread 入口；cron router 负责 run message 加载，不让前端直接操作本地 session 文件路径。
- 前端 scheduler store 维护 run 列表和 selected run；chat provider 只做 WS frame 到 timeline event 的归一化。
- 协议字段新增必须同步 Python DTO、TypeScript DTO 和双侧 fixture。

## 追溯矩阵

| DoD | 支撑模块 | x-req task |
|-----|----------|------------|
| D1 | M1 scheduler run index contract | T1 backend data/API |
| D2 | M2 execution bridge run session | T2 execution chain |
| D3 | M3 web thread run API | T1 backend data/API |
| D4 | M4 cron realtime protocol | T3 protocol/WS |
| D5 | M5 frontend run timeline | T4 frontend state/routing |
| D6 | M4 + M5 | T3 + T4 |
| D7 | M1 + M6 | T5 migration compatibility |
| D8 | M6 migration and validation | T6 validation/e2e |

## 风险

| 风险 | 影响 | 处理策略 |
|------|------|----------|
| run session 与 thread session 字段混用 | 历史串线 | 字段命名固定为入口 `thread_id`、执行 `session_id`，测试覆盖连续两次 run |
| WS 只广播内容，缺 run/session 字段 | 前端无法分流，当前 timeline 串入其他 run | 所有 `cron.*` 帧合同测试强制字段存在 |
| run context 继续走 thread session | 用户追问污染任务入口默认历史 | 本期禁用 run context composer；后续启用 follow-up 时必须解析 `run_id -> session_id` 后调用 Runner |
| legacy 历史处理过度 | 旧数据迁移风险和用户困惑 | 旧共享历史作为单独 legacy 入口，新数据使用独立 run session |
