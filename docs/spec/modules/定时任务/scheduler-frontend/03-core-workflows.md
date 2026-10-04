# 03 Core Workflows

## Workflow A: 打开定时任务抽屉

1. 用户点击顶部按钮“定时任务”
2. `SchedulerDrawerHost` 打开右侧抽屉
3. `useSchedulerBootstrap` 拉取任务列表
4. 列表加载完成后展示任务概况
5. 用户点击任一任务，详情区展示最近运行记录和基础操作

## Workflow B: 创建任务

1. 用户点击抽屉底部“创建定时任务”
2. 打开 `CreateSchedulerTaskDialog`
3. 用户填写基础信息、调度方式、时区、任务内容
4. 前端本地校验表单
5. `api.createTask()` 调 `POST /api/cron/tasks`
6. 创建成功后关闭弹窗、刷新列表，并将新任务选中

## Workflow C: 任务操作后刷新

1. 用户触发暂停、恢复、立即执行或删除
2. 前端发对应 REST 请求
3. 请求成功后执行一次 `refreshTasks()`
4. 如果当前任务仍存在，补拉该任务最近运行记录
5. 列表与详情重渲染

## Workflow D: 窗口重新聚焦刷新

1. 抽屉处于打开状态
2. 用户切走 tab 或窗口后再回来
3. 浏览器触发 `visibilitychange` 或 `focus`
4. 前端补一次 `refreshTasks()`
5. 当前抽屉内数据与后端重新对齐

## Workflow E: 后续替换为全局浮动面板

1. 保留 `api.ts`、`store.ts`、`selectors.ts`
2. 新增 `FloatingSchedulerPanel.tsx`
3. 复用同一组列表、详情和创建弹窗组件
4. 替换 `SchedulerDrawerHost` 的容器实现

## Mermaid

```mermaid
flowchart TD
  A[Header 按钮 定时任务] --> B[SchedulerDrawerHost]
  B --> C[SchedulerDrawer]
  B --> D[useSchedulerBootstrap]
  B --> E[useSchedulerWindowFocusRefresh]
  C --> F[SchedulerTaskList]
  C --> G[SchedulerTaskDetail]
  C --> H[CreateSchedulerTaskDialog]
  F --> I[store.ts]
  G --> I
  H --> I
  D --> J[api.ts]
  E --> J
  J --> K[/api/cron/tasks]
```
