# 90 Task Map

## Backend

### P0

- 确认 `/api/cron/*` 能覆盖抽屉打开、创建、pause、resume、run_now、delete
- 如果运行记录接口粒度不足，补足单任务 runs 查询

### P1

- 增加“最近刷新时间”所需字段时，保持 DTO 稳定
- 保留 `/ws/cron` 作为可选能力，不再作为前端主链路依赖

## Frontend

### P0

- 建立 `web/src/modules/scheduler/` 模块骨架
- 接入 `Layout` 顶部按钮“定时任务”
- 实现 `SchedulerDrawerHost` 和 `SchedulerDrawer`
- 实现 `SchedulerTaskList`
- 实现底部“创建定时任务”按钮
- 实现 `CreateSchedulerTaskDialog`
- 实现 `api.ts / store.ts`
- 抽屉打开时刷新任务列表
- 任务操作成功后刷新任务列表
- 窗口重新聚焦且抽屉打开时刷新任务列表

### P1

- 实现任务详情区
- 实现最近运行记录区
- 加入手动刷新按钮
- 移除 `Layout` 全局 `/ws/cron` 连接路径
- 下线 `ws.ts` / `useSchedulerRealtime.ts` 对前端主链路的占用

### P2

- 加入独立页面壳
- 加入更多筛选和排序
- 视需要评估 drawer-scoped WS

## Architecture Guardrail

### 下一版

- 增加 scheduler 模块 import boundary lint
- 在 CI 中执行 import boundary 检查
- 对违规 import 给出清晰报错

## 验收顺序

1. 后端 CRUD 与 runs 接口稳定
2. 前端模块骨架
3. 右侧抽屉可见
4. 列表可加载
5. 创建可提交
6. 任务操作可联动刷新
7. focus 回来可刷新
