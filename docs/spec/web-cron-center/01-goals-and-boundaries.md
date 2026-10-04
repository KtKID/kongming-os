# 目标与完成标准

## 系统目标

**问题**：cron 后端能力齐全（任务、调度、执行、投递、广播），但 web 前端完全空白。用户在浏览器里：
- 看不到自己创建了哪些 cron 任务
- 看不到任务什么时候触发、跑成功了还是失败
- 不能暂停、恢复、删除、立即触发任务（必须让 AI 调 `schedule_tool`）
- 实时推送 `/ws/cron` 的 `cron.run.completed` 事件无人订阅，等于没有

**价值**：让 cron 在 web 端从"暗箱"变成"可见、可管"的一等公民功能。

## 完成目标（DoD）

- [ ] **DoD#1**：顶栏右上角出现 cron 入口按钮
- [ ] **DoD#2**：入口按钮支持未读红点 —— 会话内收到新 `cron.run.completed` 且抽屉未打开 → 显示红点；打开抽屉后清零
- [ ] **DoD#3**：点击按钮打开右抽屉；打开时若 `FileDrawer` 处于打开状态自动关闭，反之亦然（同一时间至多一个右抽屉）
- [ ] **DoD#4**：抽屉上半部显示分组任务列表：
  - 每日重复（`trigger.type ∈ {CRON, INTERVAL, SECONDS}`）
  - 今天一次性（`trigger.type = ONCE` 且 `next_run_at` 在今日本地时区 0-24 点内）
  - 暂停的（`enabled=false`）—— 在所属分组内置灰显示
- [ ] **DoD#5**：每条任务显示：状态图标（4 类：⏳待触发 / 🔄跑中 / ✅成功（含 silent）/ ❌失败）+ 时间表达式 + 任务名
- [ ] **DoD#6**：点击任务行展开内嵌区，显示该任务**最近一次** run 的结果摘要（来自 `ScheduledRun.final_message_excerpt`）
- [ ] **DoD#7**：任务行操作菜单：暂停 / 恢复 / 删除 / 立即触发（`run_now`）
- [ ] **DoD#8**：抽屉下半部显示全局运行日志（跨所有任务），按 `started_at` 倒序，每条显示：时间 + 任务名 + 状态图标 + 摘要前 80 字
- [ ] **DoD#9**：日志区滚动到底自动加载更多，每次 +50 条；服务端按 cursor 分页
- [ ] **DoD#10**：抽屉打开期间，订阅 `/ws/cron`；收到 `cron.run.completed` 后任务列表与日志同步刷新（不需要手动刷新）
- [ ] **DoD#11**：抽屉关闭时不订阅 WS（节省连接）；下次打开重新订阅

## 范围边界

**包含**：

- 前端：入口按钮、右抽屉、任务列表、运行日志、操作菜单、未读红点、抽屉互斥
- 后端：`routers/cron.py`（GET tasks/runs，POST pause/resume/delete/run_now）
- 后端：`Store.list_recent_runs(limit, cursor)` 新方法
- 状态管理：zustand cron store + 改造 workspace.ts 的 `rightDrawer` 调度字段
- 实时推送：订阅现有 `/ws/cron` broker，按 `cron.run.completed` 事件刷新前端 store

**不包含**：

- ❌ 在抽屉里**创建**新任务（用户场景：手动写 cron 表达式门槛高，让 AI 帮填更顺）
- ❌ 编辑已有任务（修改 schedule / preset 等）—— 用户要改就先删后建
- ❌ 跨设备 / 跨 session 持久化的"未读"（红点是会话内提醒，不是邮箱）
- ❌ "投递结果到 thread"那条副线的修复（属于 cron 主模块的独立任务）
- ❌ Cron 全文搜索 / 过滤 / 标签（首版不做）

## 关键约束

- **后端兼容**：`Store` API 已经是 v0.4 的稳定接口；不允许为 web 修改既有方法签名，新方法 `list_recent_runs` 独立加
- **前端组件库**：必须复用 `web/src/components/ui/sheet.tsx`（Radix Dialog），不引入新依赖
- **抽屉单例**：Radix Dialog 默认 `modal=true`，同一时间只能一个 `Sheet` 真正交互；本系统借这个特性做互斥（不是堆叠）
- **WS 复用**：必须订阅现有的 `/ws/cron`（broker 已是模块级单例），不开新连接
- **无登录态泄漏**：所有 REST 必须走现有 `auth` 中间件
- **资源约束**：单人开发，预计 3-5 个 task

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task |
|---------|-------------|---------------|
| DoD#1 入口按钮 | CronEntryButton | T3 |
| DoD#2 未读红点 | CronEntryButton + cron store + cron WS 订阅 | T3 + T6 |
| DoD#3 抽屉互斥 | CronCenterDrawer + workspace.ts 改造 + FileDrawer 改造 | T3 |
| DoD#4 分组列表 | CronTaskList + cron API client + cron router | T1 + T2 + T4 |
| DoD#5 状态图标 | CronTaskRow + 状态映射工具 | T4 |
| DoD#6 展开摘要 | CronTaskRow + ScheduledRun.final_message_excerpt | T4 |
| DoD#7 操作菜单 | CronTaskRow + cron router (POST 操作) | T1 + T4 |
| DoD#8 全局日志 | CronRunLog + list_recent_runs + cron router | T1 + T5 |
| DoD#9 滚动加载 | CronRunLog (cursor 分页) | T5 |
| DoD#10 实时刷新 | cron WS 订阅 + cron store dispatch | T2 + T6 |
| DoD#11 按需订阅 | cron store 生命周期管理 | T2 + T6 |

> 反向验证：每个模块都有 DoD 对应；每条 DoD 都有模块支撑。无 scope creep。
