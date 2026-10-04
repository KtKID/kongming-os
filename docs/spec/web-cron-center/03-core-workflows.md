# 核心流程

## 1. 首次打开抽屉

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant Btn as CronEntryButton
  participant WS as workspace store
  participant CS as cron store
  participant API as cron API client
  participant R as cron router
  participant ST as scheduler_store

  U->>Btn: 点击入口按钮
  Btn->>WS: openRightDrawer('cron')
  WS->>WS: 当前是 'file'? → 关闭 FileDrawer
  WS-->>Btn: rightDrawer = 'cron'
  par 任务列表
    CS->>API: listTasks()
    API->>R: GET /api/cron/tasks
    R->>ST: store.list_tasks(include_disabled=true)
    ST-->>R: ScheduledTask[]
    R-->>API: CronTaskDTO[]
    API-->>CS: tasks 写入 store
  and 日志区首屏
    CS->>API: listRecentRuns(limit=50)
    API->>R: GET /api/cron/runs?limit=50
    R->>ST: store.list_recent_runs(limit=50)
    ST-->>R: ScheduledRun[]
    R-->>API: { runs, nextCursor }
    API-->>CS: runs 写入 store
  and WS 订阅
    CS->>WS: subscribe(/ws/cron)
  end
  CS->>CS: markAllRead() 清零未读
```

**关键点**：
- 任务列表 + 日志首屏 + WS 订阅**并行**触发（`Promise.all`），不串行等待
- 抽屉打开时立刻 `markAllRead`（红点的语义是"未看过"，看的瞬间清零）

---

## 2. 实时推送：cron 跑完了

```mermaid
sequenceDiagram
  autonumber
  participant Bridge as ExecutionBridge
  participant Disp as DeliveryDispatcher
  participant Sink as WebDeliverySink
  participant Brk as CronWSBroker
  participant FE as 前端 WS hook
  participant CS as cron store

  Bridge->>Disp: deliver(task, run, msg)
  Disp->>Sink: deliver(task, run, msg)
  Sink->>Brk: broadcast(cron.run.completed)
  Brk->>FE: WS frame
  FE->>FE: 解析 frame.kind
  alt kind == cron.run.completed
    FE->>CS: dispatch onWSEvent(frame)
    CS->>CS: 更新 task.last_run_at + next_run_at
    CS->>CS: prepend new CronRun 到 runs[]
    alt 抽屉未打开
      CS->>CS: unreadCount++
    end
  end
```

**关键点**：
- `next_run_at` 重新计算：recurring 任务（CRON/INTERVAL/SECONDS）在每次完成后变成"下一次"——前端不算，依赖后端在 `supersede_and_append_run` 里更新 task；前端拿到推送后**主动 refetch 单个 task**或者推送 frame 里**一并带上**新的 `next_run_at`
- 推荐让推送 frame 增加 `next_run_at` 字段，避免前端 N+1（这是对 `cron.run.completed` 事件 schema 的小扩展，需在 T1/T2 task 里同步落地）

---

## 3. 操作回流：暂停 / 恢复 / 删除 / 立即触发

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant Row as CronTaskRow
  participant CS as cron store
  participant API as cron API client
  participant R as cron router

  U->>Row: 点击"暂停"
  Row->>CS: pauseTask(taskId)
  CS->>CS: 乐观更新 tasks[i].enabled = false
  CS->>API: pauseTask(taskId)
  API->>R: POST /api/cron/tasks/:id/pause
  R-->>API: 200 + 更新后的 CronTaskDTO
  API-->>CS: 用服务端结果对齐
  alt 失败
    CS->>CS: 回滚乐观更新 + toast 报错
  end
```

**关键点**：
- **乐观更新**：UI 立即响应，背后异步同步；失败回滚
- 删除前必须 confirm dialog（误触代价高）
- 立即触发：UI 显示"触发中…" loading；返回后把新生成的 run prepend 到日志

---

## 4. 抽屉互斥协调

```mermaid
stateDiagram-v2
  [*] --> Closed: 初始
  Closed --> File: openFileDrawer (旧 API 转发到 openRightDrawer('file'))
  Closed --> Cron: openRightDrawer('cron')
  File --> Cron: openRightDrawer('cron')\n自动 closeFileDrawer
  Cron --> File: openRightDrawer('file')\n自动 closeCronDrawer
  File --> Closed: closeRightDrawer / Esc / 点 overlay
  Cron --> Closed: closeRightDrawer / Esc / 点 overlay
```

**关键点**：
- 真源是 `workspace.rightDrawer: 'file' | 'cron' | null` 单字段
- `openRightDrawer(kind)` 是设值动作，旧 API 转发
- 关闭抽屉走 Radix Dialog 自带 `onOpenChange(false)`，转发到 `closeRightDrawer()`

---

## 5. WS 生命周期

```mermaid
stateDiagram-v2
  [*] --> Idle: 应用启动
  Idle --> Connecting: 抽屉打开
  Connecting --> Connected: WS open
  Connecting --> Reconnecting: open 失败
  Connected --> Reconnecting: 断开
  Reconnecting --> Connected: 重连成功
  Connected --> Idle: 抽屉关闭
  Reconnecting --> Idle: 抽屉关闭
```

**关键点**：
- WS 仅在抽屉打开时占用连接（节省服务端资源）
- 关抽屉的瞬间断开 WS；下次打开重连
- 重连：复用现有 `connection.ts` 指数退避（1s → 2s → 4s → 8s 上限 30s）

---

## 6. 滚动加载日志

```mermaid
sequenceDiagram
  autonumber
  participant U as 用户
  participant Log as CronRunLog
  participant CS as cron store
  participant API as cron API client

  U->>Log: 滚动到底部 (IntersectionObserver)
  Log->>CS: fetchMoreRuns()
  alt runsCursor 非空
    CS->>API: listRecentRuns(50, runsCursor)
    API-->>CS: { runs: [...], nextCursor }
    CS->>CS: append + 更新 cursor
  else cursor 为空
    Log->>Log: 显示"已无更多"
  end
```

**关键点**：
- IntersectionObserver 监听底部 sentinel 元素
- `runsCursor=null` 表示无更多
- 防抖：拉取期间不重复触发
