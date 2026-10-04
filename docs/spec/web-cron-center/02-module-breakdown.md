# 模块拆分

## 模块总览

| # | 模块 | 职责 | 依赖 | 状态 | 风险 |
|---|------|------|------|------|------|
| M1 | `routers/cron.py` | REST 暴露 cron 任务/运行 + 操作 | `Store` / auth | 方案确认 | 低 |
| M2 | `Store.list_recent_runs` | 跨任务取全局最近 N 条 run | `Store` 现有文件结构 | 方案确认 | 中（性能） |
| M3 | `web/src/api/cron.ts` | 前端 REST 客户端 | M1 | 方案确认 | 低 |
| M4 | `web/src/stores/cron.ts` | zustand store：tasks / runs / unread / WS 生命周期 | M3 + M5 | 方案确认 | 低 |
| M5 | `web/src/hooks/useCronWS.ts` | 订阅 `/ws/cron`，dispatch 到 store | M4 + 现有 WS 工具 | 方案确认 | 低 |
| M6 | `CronEntryButton` | 顶栏入口 + 红点 | M4 | 方案确认 | 低 |
| M7 | `CronCenterDrawer` | 抽屉外壳 + 互斥协调 | M4 + 改造 `workspace.ts` | 方案确认 | 中（互斥改造） |
| M8 | `CronTaskList` + `CronTaskRow` | 列表 + 分组 + 操作菜单 | M3 + M4 | 方案确认 | 低 |
| M9 | `CronRunLog` | 日志区 + 滚动加载 | M3 + M4 | 方案确认 | 低 |
| M10 | `workspace.ts` 改造 | 引入 `rightDrawer: 'file' \| 'cron' \| null` 协调 | 现有 `FileDrawerState` | 方案确认 | 中（破坏性） |

## 模块详情

### M1：cron router (`src/web/routers/cron.py`)

**职责**：把 `Store` 的能力按 REST 暴露给前端。

**包含范围**：
- `GET /api/cron/tasks` — 列所有任务（含 disabled），返回 `CronTaskDTO[]`
- `GET /api/cron/runs?limit=50&cursor=<iso>` — 全局最近 N 条 run（用于日志区）
- `GET /api/cron/tasks/{task_id}/runs?limit=20` — 单任务历史（用于展开摘要）
- `POST /api/cron/tasks/{task_id}/pause` — 标记 `enabled=false`
- `POST /api/cron/tasks/{task_id}/resume` — 标记 `enabled=true` 并重算 `next_run_at`
- `DELETE /api/cron/tasks/{task_id}` — 删任务（同时归档其 runs）
- `POST /api/cron/tasks/{task_id}/run_now` — 立即触发一次（复用 `schedule_tool._do_run_now` 内部逻辑）

**不包含范围**：
- ❌ POST 创建任务（用户走 AI 调 schedule_tool）
- ❌ PATCH 修改任务（先删后建）

**依赖**：`app.state.scheduler_store`（已挂载）+ `auth` 中间件

**复用/新建**：新建文件，复用 `Store` 现有 API。

**数据结构/接口**：

```python
# pydantic DTO（schema 跟前端 TS 对齐，详见 04-data-and-state.md）
class CronTaskDTO(BaseModel):
    task_id: str
    name: str
    enabled: bool
    state: str            # SCHEDULED / PAUSED / ...
    trigger_type: str     # CRON / INTERVAL / SECONDS / ONCE
    trigger_expr: str     # 用户原始表达式
    next_run_at: str | None
    last_run_at: str | None
    preset_id: str
    created_by: str       # "agent:<thread_id>" → 前端能反查所属 thread

class CronRunDTO(BaseModel):
    run_id: str
    task_id: str
    task_name: str        # 冗余便于日志区单独展示，避免 N+1
    scheduled_for: str
    started_at: str | None
    finished_at: str | None
    status: str           # PENDING / RUNNING / COMPLETED / FAILED / SILENT / SUPERSEDED
    final_message_excerpt: str | None
    delivery_status: str
    delivery_error: str | None
```

**风险等级**：低。仅薄包装。
**task 建议**：`web-cron-router-v0.1`（T1）

---

### M2：`Store.list_recent_runs` 新方法

**职责**：跨任务全局取最近 N 条 run（按 `started_at` 倒序）。

**包含范围**：
- 输入：`limit: int`, `cursor: str | None`（cursor = ISO timestamp）
- 输出：`list[ScheduledRun]`，长度 ≤ limit
- 排序：`started_at` 倒序；`cursor` 给定时取严格早于 cursor 的

**不包含范围**：
- ❌ 任意条件过滤（仅时间游标分页，首版够用）

**依赖**：现有 `Store` 文件结构（每个 task 一个目录，runs 写在 `runs/<run_id>.json`）

**复用/新建**：在 `src/scheduler/store.py` 加新方法，不动现有 `list_runs(task_id)`。

**数据结构/接口**：

```python
def list_recent_runs(
    self,
    *,
    limit: int = 50,
    cursor: str | None = None,
) -> list[ScheduledRun]:
    """跨任务全局最近 run；started_at 倒序。"""
```

**风险等级**：中（性能）。
- **风险说明**：当前 `Store` 是文件后端，每个 task 目录下 `runs/` 是独立文件。跨任务聚合 = 遍历所有 task 目录读所有 run 文件。任务数 × 每任务 run 数大时是 O(N×M)。
- **缓解**：
  1. 首版接受 O(N×M)，加单元测试覆盖 100 task × 100 run 场景跑出耗时数据
  2. 若超过 200ms/请求，加内存索引（`task_id → started_at 列表`），lazy build + WS 投递时增量更新
  3. PoC 必要：先写一个简单脚本跑 1000+ run 看实际耗时，决定是否需要索引

**task 建议**：`scheduler-store-recent-runs-v0.1`（合并到 T1）

---

### M3：`web/src/api/cron.ts` 前端 REST 客户端

**职责**：类型化 fetch 封装，跟 M1 router 一一对应。

**包含范围**：
- `listTasks()`：`Promise<CronTask[]>`
- `listRecentRuns(limit, cursor?)`：`Promise<{ runs: CronRun[]; nextCursor: string | null }>`
- `listTaskRuns(taskId, limit?)`：`Promise<CronRun[]>`
- `pauseTask(taskId)` / `resumeTask(taskId)` / `deleteTask(taskId)` / `runNow(taskId)`

**复用/新建**：新建。复用现有 `apiFetch` 工具（如有），统一带 auth header。

**数据结构/接口**：

```typescript
export interface CronTask {
  task_id: string;
  name: string;
  enabled: boolean;
  state: TaskState;
  trigger_type: TriggerType;
  trigger_expr: string;
  next_run_at: string | null;
  last_run_at: string | null;
  preset_id: string;
  created_by: string;
}

export interface CronRun {
  run_id: string;
  task_id: string;
  task_name: string;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  status: RunStatus;
  final_message_excerpt: string | null;
  delivery_status: DeliveryStatus;
  delivery_error: string | null;
}
```

**风险等级**：低。
**task 建议**：合并到 T2。

---

### M4：`web/src/stores/cron.ts` zustand store

**职责**：前端 cron 数据中心 + 抽屉/红点状态机。

**包含范围**：
- `tasks: CronTask[]`（任务列表，按 trigger 类型 + enabled 分组）
- `runs: CronRun[]`（日志区数据，倒序）
- `runsCursor: string | null`（分页游标）
- `unreadCount: number`（未读红点）
- `wsSubscribed: boolean`（WS 生命周期开关）
- 动作：`fetchTasks` / `fetchMoreRuns` / `pauseTask` / `resumeTask` / `deleteTask` / `runNow` / `markAllRead` / `onWSEvent(frame)`

**复用/新建**：新建。参考现有 `chat.ts` / `workspace.ts` 的 zustand 模式。

**数据结构/接口**：见 `04-data-and-state.md`。

**风险等级**：低。
**task 建议**：合并到 T2。

---

### M5：`web/src/hooks/useCronWS.ts` WS 订阅 hook

**职责**：组件 mount 时连 `/ws/cron`，收到 frame 后 dispatch 到 cron store；组件 unmount 时断开。

**包含范围**：
- 订阅 `cron.run.completed` 事件
- frame 字段：`task_id`, `task_name`, `run_id`, `final_message`, `delivered_at_iso`, `scheduled_for`, `delivery_target`
- dispatch 逻辑：
  - 找到对应 task → 更新 `last_run_at` + 复刷 `next_run_at`（recurring）
  - 把 run prepend 到 `runs[]`
  - 抽屉未打开则 `unreadCount++`
- 失败重连：指数退避（参考现有 `connection.ts`）

**复用/新建**：新建 hook；复用现有 WS 工具（`web/src/lib/ws.ts` 等）。

**风险等级**：低。
**task 建议**：合并到 T2。

---

### M6：`CronEntryButton` 顶栏入口

**职责**：顶栏右上角图标按钮，带未读红点；点击触发抽屉打开。

**包含范围**：
- 图标：用 lucide `Clock` 或 `Calendar`
- 红点：`store.unreadCount > 0` 时显示（不显示数字，简洁版）
- 点击：调 `openRightDrawer('cron')`，自动关 FileDrawer
- 提示：`title="定时任务"`（hover）

**位置**：放进现有 `Layout.tsx` 顶栏右侧，与 `ConnectionIndicator` / `ThemeToggle` 同行。

**复用/新建**：新建组件，复用 `ui/button.tsx`。

**风险等级**：低。
**task 建议**：合并到 T3。

---

### M7：`CronCenterDrawer` 抽屉外壳

**职责**：右侧 Sheet 容器，内含 `CronTaskList` + `CronRunLog` 两个区域；负责互斥。

**包含范围**：
- `<Sheet open={rightDrawer === 'cron'} onOpenChange={...}>`
- 关闭抽屉时 `markAllRead()`
- 打开抽屉时启动 WS 订阅；关闭时断开（M5 配合）
- 布局：上半部任务列表（高度 50% 或 40%，竖向滚动）+ 下半部日志区（剩余高度，竖向滚动）—— 中间一条分割条

**复用/新建**：新建组件。

**风险等级**：低。
**task 建议**：合并到 T3。

---

### M8：`CronTaskList` + `CronTaskRow`

**职责**：分组显示所有任务，每条任务一行 + 可展开摘要 + 操作菜单。

**包含范围**：

`CronTaskList`：
- 按规则分组：
  - **每日重复**：`enabled && trigger.type ∈ {CRON, INTERVAL, SECONDS}`
  - **今天一次性**：`enabled && trigger.type=ONCE && next_run_at` 在今日本地时区 0-24 点
  - **历史一次性**（不在列表显示，只在日志区出现）
  - **已暂停**：`!enabled` —— 在所属类型分组里**置灰显示**（不单独成组）
- 空分组不渲染标题

`CronTaskRow`：
- 一行展示：图标 + 时间表达式 + 任务名（截断）
- 状态图标 4 类（详见 `04-data-and-state.md` 状态映射）
- 暂停态：整行降透明度 + 灰色字
- 点击行：内嵌展开 → 显示最近一次 run 的摘要（`final_message_excerpt`），按需 fetch `listTaskRuns(taskId, 1)`
- 操作菜单（右侧 `…`）：
  - 已启用：`暂停` / `立即触发` / `删除`
  - 已暂停：`恢复` / `删除`
- 删除前 confirm dialog

**复用/新建**：新建。复用 `ui/dropdown-menu.tsx`（如有）/ `ui/button.tsx`。

**风险等级**：低。
**task 建议**：合并到 T4。

---

### M9：`CronRunLog` 日志区

**职责**：抽屉下半部，全局倒序运行历史 + 滚动加载。

**包含范围**：
- 数据：`store.runs[]`
- 每条：`时间(本地) · 任务名 · 状态图标 · 摘要前 80 字`
- 失败 run 把 `delivery_error` 也展示出来（小字）
- 滚动到底部：调 `fetchMoreRuns()`（cursor 分页 50/次）
- 列表用 `overflow-y-auto` 普通滚动（**不要 Radix ScrollArea**——CLAUDE.md 已记录 truncate 失效问题）
- 空态：`暂无运行记录`

**复用/新建**：新建。

**风险等级**：低。
**task 建议**：合并到 T5。

---

### M10：`workspace.ts` 改造（右抽屉互斥）

**职责**：把当前散落的 `drawerFile` 单例升级为通用右抽屉调度。

**包含范围**：
- 新字段：`rightDrawer: 'file' | 'cron' | null`
- 新动作：`openRightDrawer(kind)` / `closeRightDrawer()`
- `openFileDrawer(...)` 内部改为调 `openRightDrawer('file')` + 设置 `drawerFile`；其他抽屉打开时自动关闭
- `closeFileDrawer()` 改为 `closeRightDrawer()`
- 兼容性：导出层保留旧 API，内部转发到新动作（不改 `FileDrawer.tsx` 的调用点）

**不包含范围**：
- ❌ 把 FileDrawer 的渲染逻辑也搬走（仍在 `FileDrawer.tsx`）

**复用/新建**：改造现有 `web/src/stores/workspace.ts`；新增 `cron` 抽屉打开逻辑写在 `cron.ts` store 里，互斥协调放 `workspace.ts`（这是右抽屉单例真源）。

**数据结构/接口**：

```typescript
// workspace.ts 新字段
interface WorkspaceState {
  // 既有
  drawerFile: FileDrawerState | null;
  // 新增
  rightDrawer: 'file' | 'cron' | null;
  openRightDrawer: (kind: 'file' | 'cron') => void;
  closeRightDrawer: () => void;
  // 既有方法保留，内部转发
  openFileDrawer: (...) => void;
  closeFileDrawer: () => void;
}
```

**风险等级**：中（破坏性改造现有 store）
- **风险说明**：`workspace.ts` 当前被 `FileDrawer` / `Chat.tsx` 直接消费；改造时若漏改调用点会破坏文件预览功能。
- **缓解**：
  1. 保留旧 API（`openFileDrawer` / `closeFileDrawer`）作为转发层
  2. 改造前先 grep 所有 `useWorkspaceStore` 调用点，列清单逐个确认
  3. 改完跑现有 FileDrawer e2e（`web/src/components/__tests__/ToolCardViewFile.test.tsx` 等）

**task 建议**：合并到 T3（必须跟抽屉壳子一起做，不能拆分）。
