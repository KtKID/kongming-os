# Scheduler Frontend Spec

状态：Draft v0.2  
范围：Web 定时任务入口、右侧抽屉列表、创建弹窗、任务操作、按需刷新策略  
代码目标目录：`web/src/modules/scheduler/`

## 目标

这个 spec 定义 Web 侧定时任务模块的收敛方案：

- 顶部入口按钮打开“定时任务”抽屉
- 抽屉内展示任务列表、任务详情、最近运行记录和基础操作
- 创建、暂停、恢复、立即执行、删除等操作全部走 REST
- 前端采用“按需刷新”，不依赖全局常驻 `/ws/cron`

## 版本结论

- UI 壳层继续使用右侧抽屉，复用 `web/src/components/ui/sheet.tsx`
- 顶部按钮文案保持“定时任务”
- 抽屉底部主按钮保持“创建定时任务”
- 模块边界按 `api / store / selectors / hooks / components / adapters` 分层
- 前端事实源是 `/api/cron/*`，后端仍可保留 `/ws/cron` 能力，但不再作为前端 P0 依赖
- 刷新触发器固定为：打开抽屉、任务操作成功、窗口重新聚焦

## 文件导航

- [01-goals-and-boundaries.md](./01-goals-and-boundaries.md)
- [02-module-breakdown.md](./02-module-breakdown.md)
- [03-core-workflows.md](./03-core-workflows.md)
- [04-data-and-state.md](./04-data-and-state.md)
- [05-validation-and-evolution.md](./05-validation-and-evolution.md)
- [90-task-map.md](./90-task-map.md)
- [architecture.html](./architecture.html)

## 当前代码事实

后端已有 cron 管理基础能力：

- `GET /api/cron/tasks`
- `GET /api/cron/runs`
- `GET /api/cron/tasks/{task_id}/runs`
- `POST /api/cron/tasks/{task_id}/pause`
- `POST /api/cron/tasks/{task_id}/resume`
- `DELETE /api/cron/tasks/{task_id}`
- `POST /api/cron/tasks/{task_id}/run_now`
- `WS /ws/cron`

当前前端实现里存在全局 `/ws/cron` 连接路径。v0.2 spec 把它调整为待移除实现，目标是把刷新入口收敛到抽屉生命周期和显式用户动作。

## 第一版完成定义

达到以下条件即满足本 spec：

1. 用户可以从 Web 顶栏打开“定时任务”抽屉
2. 抽屉打开时拉取任务列表和必要详情
3. 创建和任务操作成功后自动刷新列表
4. 抽屉保持打开时，窗口重新聚焦会补一次刷新
5. 前端不在 `Layout` 全局常驻 `/ws/cron` 连接
