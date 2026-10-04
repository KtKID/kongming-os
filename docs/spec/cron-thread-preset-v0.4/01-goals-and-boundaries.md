# 目标与边界

## 系统目标

让 cron 定时任务：
1. 触发结果投递回来源 thread（如有），用户不用去 `/cron` 页翻
2. 用创建时所在 thread 的 LLM preset 执行，不用全局 yaml 默认配置
3. 执行过程可观测（trace 落盘）

## 完成标准（DoD）

| # | 条目 | 覆盖模块 |
|---|------|---------|
| D1 | 从 thread 创建的 cron 任务携带 `delivery.target` + `preset_id` | M1, M4 |
| D2 | cron 触发时按 `preset_id` 用正确的 LLM 跑 | M2 |
| D3 | 有 `delivery.target` 时，run 结果投递到对应目标（thread 追加消息） | M3 |
| D4 | `/ws/cron` 始终广播所有 run 结果（v0.3 行为保留） | — (不改) |
| D5 | cron run 有 per-run trace jsonl 落盘 | M5 |
| D6 | 老 v3 数据启动时重置式迁移到 v4 | M1 |
| D7 | `make lint && make typecheck && make test-unit` 全过 | 全部 |

## 包含范围

- `ScheduleDelivery` 新增 `target: str | None = None`（投递目标，如 `"thread:thread-abc"`）
- `ScheduledTask` 新增 `preset_id: str = ""`（用哪个 LLM）
- `schedule_tool._do_create` 自动填充 `delivery.target`（从 `ctx.session_id` 推导）+ `preset_id`（从构造参数继承）
- `ExecutionBridge` 持有 `preset_map`，每次 execute 按 `task.preset_id` 构建正确 LLM
- `WebDeliverySink` 双通道：cron 广播 + thread 追加
- `app.py` / `runtime_factory.py` 装配层传递 preset_map + home
- `store.py` schema v3 → v4 迁移
- per-run `JsonlTraceSink` 落 trace

## 不包含范围

- 为 cron run 创建新 thread（cron 不造 thread，只往已有 thread 追加消息）
- agent_id / AgentProfile 一等公民概念（留 v0.5）
- 前端 `/cron` 页 UI 改动（后端改完，前端 `cron.run.completed` 事件自然多出 `origin_thread_id` 字段）
- 多 AgentSpec 路由（当前单 AgentSpec 不变）
- CLI 路径的 thread 投递（CLI 无 thread 概念）
- cron run 对话历史的 Web UI 回看（需要未来额外设计，v0.4 只保证 trace 落盘）

## 关键约束

| 约束 | 说明 |
|------|------|
| core 零 sibling 依赖 | bridge/factory 不能直接 import `web.*`；thread 投递走注入的 sink |
| Tool Runtime 不直连 policy | schedule_tool 不能 import `safety.*` |
| 装配与执行分离 | LLM provider 构建在 factory/bridge 装配阶段，不在 runner.run 内 |
| schema 破坏性变更直接做 | v3→v4 不保留 backward compat；老数据迁移，新代码只读 v4 |
| frozen dataclass | 所有 domain 对象保持 `frozen=True` |
