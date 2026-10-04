# web-cron-center

> 状态：方案确认中
> 目标：补齐 cron 在 web 前端的展示与管理能力，让用户能看到所有定时任务和运行结果

## 系统目标

cron 模块（`src/scheduler/`）后端能力齐全：任务调度、执行桥、投递路由、运行历史持久化、`/ws/cron` 实时广播都已就绪。但 **web 前端 0 实现**：用户在浏览器里看不到自己创建了哪些 cron、什么时候跑过、跑成功还是失败。

本系统是 cron 模块的 **web 子模块**，负责：

- 把后端已有的 `Store.list_tasks()` / `list_runs()` 通过 REST 暴露
- 在 web 前端加一个**入口按钮 + 右抽屉**，让用户能在不离开当前对话的前提下查看 / 管理所有 cron
- 实时订阅 `/ws/cron` 让用户当场看到 cron 跑完的结果

## 最小可用路径

```
用户点击顶栏 cron 按钮（带未读红点）
  → 右抽屉打开（自动关掉 FileDrawer 互斥）
    → 抽屉上半部：任务列表（每日重复 / 今天一次性 / 暂停置灰内置）
    → 抽屉下半部：全局运行日志（时间倒序 + 滚动加载 50 条/次）
    → /ws/cron 推送 cron.run.completed → 列表与日志实时刷新
  → 点击单条任务 → 展开摘要 + 操作（暂停 / 恢复 / 删除 / 立即触发）
```

P0 链路：入口按钮 → REST 拉数据 → 抽屉展示。其余（红点 / 实时推送 / 操作回流）是 P1 增强。

## 范围边界

**包含**：
- 前端入口按钮（顶栏）
- 右抽屉（任务列表 + 运行日志）
- REST 客户端 + WS 订阅 + zustand store
- 后端 `routers/cron.py`（list / pause / resume / delete / run_now）
- 抽屉互斥协调（与 `FileDrawer` 同时只显示一个）
- 入口未读红点（会话期内有效，不持久化）

**不包含**：
- 在抽屉里**创建**新任务（仍然走 AI 调 `schedule_tool`）
- 跨设备 / 跨 session 的红点同步
- cron 任务编辑（修改 schedule / preset 等）
- 投递管道修复（属于 cron 主模块的另一个子任务，详见 `00-investigation-cron-delivery.md` 待立）

## 模块导航

| 模块 | 状态 | 是否可进 task | 说明 |
|------|------|--------------|------|
| 后端 cron router | 方案确认 | ✅ 是 | 全新 router，复用现有 `Store` API |
| 后端 list_recent_runs | 方案确认 | ✅ 是 | `Store` 新增方法，跨任务聚合最近 N 条 |
| 前端 cron API client | 方案确认 | ✅ 是 | 类型化 fetch 封装 |
| 前端 cron store (zustand) | 方案确认 | ✅ 是 | 任务/运行/未读/抽屉协调 |
| 前端 cron WS 订阅 | 方案确认 | ✅ 是 | 订阅 `/ws/cron`、dispatch 到 store |
| 前端 CronEntryButton | 方案确认 | ✅ 是 | 顶栏按钮 + 红点 |
| 前端 CronCenterDrawer | 方案确认 | ✅ 是 | 抽屉容器 + 互斥协调 |
| 前端 CronTaskList + Row | 方案确认 | ✅ 是 | 任务列表 + 分组 + 操作菜单 |
| 前端 CronRunLog | 方案确认 | ✅ 是 | 日志区 + 滚动加载 |
| 右抽屉互斥协调 | 方案确认 | ✅ 是 | 改造 `workspace.ts` 引入 `rightDrawer` 字段 |

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. **先做后端 router + list_recent_runs**（T1）—— 独立、可单测、给前端解锁数据来源
2. **数据层先于 UI**（T2 = API client + store + WS）—— UI 之前先把数据流跑通
3. **入口 + 抽屉壳子**（T3）+ **任务列表**（T4）+ **日志区**（T5）可并行
4. **实时推送 + 红点**（T6）放最后（依赖前面所有数据通路）
5. **抽屉互斥**作为 T3 子任务，需要小心改 `workspace.ts`（已经被 FileDrawer 用），加 `rightDrawer: 'file' | 'cron' | null` 字段统一调度

## 与 cron 主模块投递修复的关系

本子模块**只负责"看得见 + 能管理"**。"投递结果丢失"那条修复链（`run.py` 缺 `target_sink`、`append_cron_message` cell 未 boot 兜底、前端识别 `cron.message.appended`）属于另一个 task，**两条线独立可发**：

- 本系统做完 = 用户能在专门的 cron 中心看到结果，但 thread 内部不会自动追加
- 投递修复做完 = thread 内部自动追加 cron 结果消息，但全局视角缺失
- 两者都做 = 完整体验
