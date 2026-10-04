# 04 Data And State

## 前端视图模型

```ts
export type SchedulerTaskVM = {
  taskId: string;
  name: string;
  enabled: boolean;
  state: "scheduled" | "paused" | "running" | "completed" | "failed";
  triggerType: "once" | "cron" | "interval" | "seconds";
  triggerExpr: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  timezone: string | null;
  presetId: string;
  createdBy: string;
};

export type SchedulerRunVM = {
  runId: string;
  taskId: string;
  taskName: string;
  scheduledFor: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: "running" | "success" | "failed" | "silent" | "cancelled";
  finalMessageExcerpt: string | null;
  deliveryStatus: string;
  deliveryError: string | null;
};
```

## 创建表单模型

```ts
export type SchedulerFormModel = {
  name: string;
  agentName: string;
  inputText: string;
  presetId: string;
  scheduleType: "once" | "cron";
  onceAt: string;
  cronExpr: string;
  timezone: string;
  concurrencyPolicy: "forbid" | "allow" | "replace";
  enabled: boolean;
};
```

## Store 结构

```ts
export type SchedulerStoreState = {
  isDrawerOpen: boolean;
  isCreateDialogOpen: boolean;
  isBootstrapped: boolean;
  isLoadingTasks: boolean;
  isLoadingRuns: boolean;
  isRefreshing: boolean;
  tasks: SchedulerTaskVM[];
  taskMap: Record<string, SchedulerTaskVM>;
  runsByTaskId: Record<string, SchedulerRunVM[]>;
  selectedTaskId: string | null;
  filter: "all" | "running" | "paused" | "completed" | "failed";
  errorMessage: string | null;
  lastFetchedAt: number | null;
};
```

## 刷新状态模型

前端不维护独立“实时事件流”。它只维护三类刷新原因：

```ts
export type SchedulerRefreshReason =
  | "drawer_open"
  | "mutation_success"
  | "window_focus";
```

约束：

- 刷新是全量对齐，不做增量事件合并
- 如果任务列表足够小，优先简单性
- 运行记录可以按选中任务补拉，避免每次全量拉所有 runs

## DTO 映射

- `CronTaskDTO` 通过 `taskMapper.ts` 归一化状态字段和时间字段
- `CronRunDTO` 通过 `runMapper.ts` 归一化状态字段、摘要字段和投递字段
- 映射层负责兼容后端未来字段扩展，UI 只消费 VM

## 数据所有权

- 服务端是任务事实源
- scheduler store 是前端单页会话内缓存
- 打开抽屉和显式刷新做全量对齐
- 任务操作成功后主动刷新，代替 WS 增量同步

## 一致性说明

- 多 tab 场景下，数据保证最终一致
- 当前 tab 是否立即变新，取决于是否发生打开抽屉、操作成功或重新聚焦
- 这套策略优先简单性和稳定性，弱化实时性
