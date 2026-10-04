# Agent Cron Module v0.2

> 状态：v0.2 实施完成（v0.1 → v0.2 重构）
> 主入口：LLM Tool（`schedule`，类 memory_tool 风格）
> 调度内核：Hermes 风格 60s/可配 1s tick + Semaphore(8) 限流

## 设计目标

把 cron 从 v0.1 的"运维管理面"重构为 agent 一等公民工具：用户在对话中说"每天 9 点提醒喝水"，agent 自己调 schedule_tool 落地。同时支持秒级触发与自然语言调度表达式。

## v0.1 → v0.2 主要变化

| 维度 | v0.1 | v0.2 |
|---|---|---|
| 主入口 | CLI（`python -m scheduler ...`）+ Web REST | LLM Tool（`schedule_tool`，agent 调）|
| 触发精度 | 60s tick | 默认 1s tick（可配） |
| 调度表达式 | 5 字段 cron / interval=分钟 / ISO | 新增 6 字段 cron + 自然语言 `every 10s` + SECONDS 类型 |
| 并发限流 | 串行 await | asyncio.create_task + Semaphore(8) |
| 数据兼容 | - | 不兼容 v0.1：启动时 `tasks.json` schema_version != 2 → 重命名 `.v1.bak.<ts>` 清空 |
| CLI 入口 | 9 个子命令 | **删除** |
| Web REST | 8 endpoint | **删除** |

## 模块清单（最终态）

| 文件 | 职责 |
|---|---|
| `src/scheduler/domain.py` | 数据真源：8 dataclass + 8 Enum（含 SECONDS）+ SCHEMA_VERSION=2 |
| `src/scheduler/store.py` | 文件持久化（tasks.json + runs jsonl + audits jsonl + lock + schema 迁移）|
| `src/scheduler/timing.py` | grace 算法 + ISO 解析纯函数 |
| `src/scheduler/silent.py` | `[SILENT]` 检测 |
| `src/scheduler/policy.py` | concurrency / misfire 三策略 |
| `src/scheduler/safety_wrapper.py` | `ScheduleApprovalProvider` fail-closed 包装 |
| `src/scheduler/execution_bridge.py` | fresh session + 工具裁剪（schedule/cron 单字 + 前缀都裁）+ inactivity watchdog |
| `src/scheduler/ticker.py` | 后台循环：默认 1s tick + Semaphore + create_task + 优雅退出 |
| `src/scheduler/runtime_factory.py` | 装配 helper |
| `src/scheduler/schedule_parser.py` | 自然语言/cron 解析（5/6 字段 cron + every / Ns/m/h/d / ISO） |
| `src/tools/schedule_tool.py` | **LLM Tool 主入口**（参考 memory_tool）|
| `src/safety/default_rules.py` | 加 capability=`schedule` 锚点常量 |
| `src/config_loader/models.py` | `SchedulerConfig`（enabled/home/interval/max_inflight/max_task_age_seconds）+ env 覆盖 |
| `src/cli/main.py` lifespan | startup 起 ticker，shutdown 优雅退出 |
| `src/web/app.py` lifespan | 同上 |

## LLM 调用示例

```
[user] 每天上午 9 点提醒我喝水
[agent 调 schedule(action="create", name="喝水提醒", schedule="0 9 * * *",
       agent="default", input="提醒用户喝水")]
[agent] 已创建任务 task-abc123，每天 9 点触发。

[user] 我有哪些定时任务
[agent 调 schedule(action="list")]
[agent] 你有 1 个：task-abc123 喝水提醒，下次 2026-05-03 09:00。

[user] 暂停那个
[agent 调 schedule(action="pause", task_id="task-abc123")]
[agent] 已暂停。
```

## schedule 表达式格式

| 格式 | 例 | 含义 |
|---|---|---|
| 一次性 duration | `10s` / `30m` / `2h` / `1d` | N 时间后跑一次 |
| 周期 | `every 10s` / `every 30m` / `every 2h` | 每 N 时间跑 |
| 5 字段 cron | `0 9 * * *` | 标准 cron |
| 6 字段 cron | `*/30 * * * * *` | 含秒位 |
| ISO8601 | `2026-05-03T09:00:00+08:00` | 一次性时间戳 |

## 数据流

```
[user 对话]
  ↓
[agent 调 schedule_tool] ─────→ [Store.create_task] → tasks.json
                                       ↓
后台 ticker（每秒） ───────→ [Store.reserve_due_tasks] → due 列表
                                       ↓
                              [ExecutionBridge.execute] (asyncio.create_task)
                                       ↓
                              [Runner.run] fresh session
                                       ↓
                              [ScheduledRun + audit] 写回 store
```

## v0.5 演进记录

- **任务级 approval_mode**：cron 任务可声明 `trust` / `fail_closed`；trust 模式自动放行 `explicit_consent`（hard_block 仍拒绝），写双份审计证据（trace event + audit 行）
- **默认值 = `trust`**：cron 即用户预批准的自动任务，不应再次审批；HardBlock 仍兜底真高危。要严格审批显式 `mode="fail_closed"` opt-in
- **SCHEMA_VERSION 升至 5**：v4 数据加载时重置式迁移（备份 + 写空 v5）
- **详细设计**：[../scheduler-approval-task-level-v0.5/](../scheduler-approval-task-level-v0.5/)

## v0.3+ 路标

- lease + persistent waiting_approval + 续跑
- SQLite 持久化（任务量上千时）
- 外部投递（telegram/slack 等）
- pre-run script 数据采集
- wall timeout 强制
- TrustResolver 第二轮 silent_allow（修 schedule/memory 的 known gap）

## 相关文档

- [v0.1 README](/dev-pipeline/tasks/agent-cron-module-v0.1/README.md)
- [v0.2 README](/dev-pipeline/tasks/agent-cron-module-v0.2/README.md) + [plan](/dev-pipeline/tasks/agent-cron-module-v0.2/plan.md) + [dev-checklist](/dev-pipeline/tasks/agent-cron-module-v0.2/dev-checklist.md)
- [v0.1 设计](/docs/agent-cron-module-v0.1/README.md)
- [Hermes 取舍参考](/docs/agent-cron-module-v0.1/05-hermes-feature-tradeoffs.md)
