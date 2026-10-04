# cron-thread-preset-v0.4

> 状态：方案确认
> 基于：[cron-delivery-v0.3](../cron-delivery-v0.3/README.md)（已上线）
> 目标：cron 任务触发后投递回来源 thread + 用正确的 LLM preset 执行

## 系统目标

v0.3 解决了"跑了看得见"——cron 结果广播到 `/ws/cron` + web `/cron` 页。
但留下三个断档：

1. **投递断线**：用户在 thread 对话中创建 cron 任务，触发结果却只出现在 `/cron` 页，不回到那个 thread——用户要自己去 `/cron` 翻
2. **LLM 用错**：cron 用全局 `cfg.model`（yaml 默认值），忽略 thread 的 `preset_id`——可能用错模型
3. **零观测**：ticker 装配时 `event_sinks=[]`，cron 执行过程不落 trace

v0.4 一次性解三件事：来源追溯 + 正确选模型 + 执行可观测。

## 范围边界

**包含**：

- `ScheduledTask` 新增 `origin_thread_id: str | None` + `preset_id: str`
- `schedule_tool` 创建任务时从 `ToolContext` 继承 thread_id + preset_id
- `ExecutionBridge` 按 `task.preset_id` 查 preset_map 构建对应 LLM provider
- 投递双通道：始终广播到 `/ws/cron`（v0.3 行为保留）+ 有 `origin_thread_id` 时追加消息到来源 thread
- cron run 挂 per-run `JsonlTraceSink` 落 trace
- schema v3 → v4 迁移

**不包含**：

- 为 cron 创建新 thread（cron 不造 thread）
- 交互式 thread 的 preset 选择逻辑改动
- agent_id / AgentProfile 概念引入（v0.5 演进点）
- cron 前端 `/cron` 页 UI 改动（v0.4 只改后端数据，前端自然拿到新字段）
- 多 agent spec 路由（当前仍是单 AgentSpec）

## 最小可用路径

```
用户在 thread-abc 对话（preset=claude-sonnet）
  → agent 调 schedule_tool 创建 cron 任务
  → task 记录 origin_thread_id=thread-abc, preset_id=claude-sonnet
  → ticker 到点触发
  → bridge 按 preset_id 找到 claude-sonnet preset → 构建正确 LLM
  → runner.run() 跑完
  → ① 广播 cron.run.completed 到 /ws/cron（带 origin_thread_id）
  → ② 往 thread-abc 追加一条系统消息（cron 结果摘要）
```

## v0.3 决策修订

| v0.3 决策 | v0.4 修订 | 理由 |
|-----------|-----------|------|
| #7: target 概念取消，不绑定 thread | **恢复到 delivery 内**：`ScheduleDelivery.target` 记录投递目标 | 用户在 thread 里创建任务，结果应该回到那里；target 是 delivery 的事 |
| #1: 独立系统消息区 | **保留**：cron 区域始终展示所有 run | cron 是跨 thread 全局资源，全局视图不变 |
| 新增：LLM 由全局 cfg 决定 | **修正**：task 级 `preset_id` 决定 LLM | thread 用 claude-sonnet 创建的任务不应该用本地模型跑 |

## 模块导航

| 模块 | 状态 | 文档 | 说明 |
|------|------|------|------|
| M1 数据契约 & 迁移 | 方案确认 | [02-module-breakdown.md#m1](#) | ScheduledTask 加字段 + schema v4 |
| M2 preset LLM 构建 | 方案确认 | [02-module-breakdown.md#m2](#) | bridge 按 preset_id 构建 per-task LLM |
| M3 thread 投递 | 方案确认 | [02-module-breakdown.md#m3](#) | 有 origin_thread_id → 追加消息到 thread |
| M4 schedule_tool 上下文继承 | 方案确认 | [02-module-breakdown.md#m4](#) | 创建时继承 thread_id + preset_id |
| M5 trace 观测 | 方案确认 | [02-module-breakdown.md#m5](#) | per-run trace sink 落盘 |

## 文档导航

- [目标与边界](./01-goals-and-boundaries.md)
- [模块拆分](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据与状态](./04-data-and-state.md)
- [验证与演进](./05-validation-and-evolution.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. M1（数据契约）先行——其他模块都依赖新字段
2. M2（preset LLM）和 M4（schedule_tool）可并行
3. M3（thread 投递）依赖 M1 + M2
4. M5（trace）独立，任何时候可做
5. 总工作量预估 6-8 小时
