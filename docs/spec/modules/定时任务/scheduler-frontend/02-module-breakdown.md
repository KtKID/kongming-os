# 02 Module Breakdown

## 目录结构

```text
web/src/modules/scheduler/
  index.ts
  types.ts
  api.ts
  store.ts
  selectors.ts
  adapters/
    taskMapper.ts
    runMapper.ts
  hooks/
    useSchedulerBootstrap.ts
    useSchedulerRefresh.ts
    useSchedulerWindowFocusRefresh.ts
  components/
    SchedulerEntryButton.tsx
    SchedulerDrawerHost.tsx
    SchedulerDrawer.tsx
    SchedulerTaskList.tsx
    SchedulerTaskRow.tsx
    SchedulerTaskDetail.tsx
    SchedulerRunsPanel.tsx
    SchedulerStatusBadge.tsx
    CreateSchedulerTaskDialog.tsx
```

## 分层职责

### public entry

- `index.ts`
- 公开导出 `SchedulerEntryButton`、`SchedulerDrawerHost`、必要类型
- 这是外部模块的唯一导入入口

### domain types

- `types.ts`
- 定义前端 VM、表单模型、筛选模型
- 这里不放 fetch、WS、UI 逻辑

### transport

- `api.ts`
- 只封装 `/api/cron/*`
- 对外暴露纯函数：`listTasks`、`listTaskRuns`、`createTask`、`pauseTask`、`resumeTask`、`runTaskNow`、`deleteTask`

说明：

- `/ws/cron` 仍可保留在后端作为可选能力
- 前端 P0 方案不再依赖 `ws.ts`
- 现有 `ws.ts`、`useSchedulerRealtime.ts` 属于待迁出路径

### state

- `store.ts`
- 单独持有 scheduler 模块状态
- 不读取其他业务 store

- `selectors.ts`
- 派生统计、列表过滤、当前任务详情选择器

### adapters

- `adapters/taskMapper.ts`
- REST DTO -> `SchedulerTaskVM`

- `adapters/runMapper.ts`
- REST DTO -> `SchedulerRunVM`

### hooks

- `useSchedulerBootstrap.ts`
- 抽屉首次打开时拉任务列表和初始详情

- `useSchedulerRefresh.ts`
- 封装“操作成功后刷新”和“选中任务详情刷新”

- `useSchedulerWindowFocusRefresh.ts`
- 抽屉打开且窗口重新聚焦时补一次刷新

### components

- `SchedulerEntryButton.tsx`
  顶部按钮，文案“定时任务”
- `SchedulerDrawerHost.tsx`
  抽屉宿主，负责 open state 与 host-level wiring
- `SchedulerDrawer.tsx`
  右侧抽屉壳层，使用 `Sheet`
- `SchedulerTaskList.tsx`
  列表区域容器
- `SchedulerTaskRow.tsx`
  单任务卡片或单行项
- `SchedulerTaskDetail.tsx`
  当前选中任务详情
- `SchedulerRunsPanel.tsx`
  最近运行记录区域
- `CreateSchedulerTaskDialog.tsx`
  创建任务表单和校验

## 宿主集成点

### Layout 集成

- `web/src/components/Layout.tsx` 导入 `SchedulerEntryButton` 和 `SchedulerDrawerHost`
- Layout 不接触 scheduler store 细节
- Layout 不负责建立 cron WS

### 路由扩展

本版主入口是抽屉。未来独立页面可以新增 `SchedulerPage`，由 router 引用模块公开入口。

## 后端接口依赖

前端依赖 `/api/cron/*` 作为事实源。

- 打开抽屉：`GET /api/cron/tasks`
- 选中任务：`GET /api/cron/tasks/{task_id}/runs` 或等价详情接口
- 创建任务：`POST /api/cron/tasks`
- 操作任务：pause / resume / run_now / delete

前端不再把“接上 `/ws/cron`”作为功能完成的必要条件。
