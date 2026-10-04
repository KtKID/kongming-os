# Hermes 特性取舍

> 本文集中说明 v0.1 沿用的 Hermes 三条运行特性、原因和落地方式。原始实现见 `other/hermes-agent/cron/jobs.py` 与 `cron/scheduler.py`。

## 1. `[SILENT]` 静默标记

### 来源

Hermes `cron/scheduler.py:55`：

```python
SILENT_MARKER = "[SILENT]"
```

agent 在 cron run 中可以让最终回复以 `[SILENT]` 开头，表示"这次没什么可报告的"，scheduler 跳过对外投递。Output 仍然落盘审计。

### 适用场景

- 监控类周期任务（每小时检查服务器、每天巡检日志），90% 时间没异常，全发出来就是噪音
- 数据采集类（每 10 分钟拉一次指标），只在变动时才提醒用户

### v0.1 落地

- `TaskExecutionPolicy.silent_marker_enabled: bool = True`（默认开）
- Execution Bridge 拿到 `Result.final_message`，调用 `is_silent(text) = text.lstrip().upper().startswith("[SILENT]")`
- 命中 → `ScheduledRun.status = "silent"` + `silent_suppressed = True`
- 投递层跳过；`audits.jsonl` 写 `run_silent_suppressed` action

### 不引入的东西

- 不做"`[SILENT]` 内嵌在中间"的解析（必须开头）
- 不做语义级"内容是否真的没价值"判断（信任 agent 自己判断）

## 2. `ONESHOT_GRACE_SECONDS = 120`

### 来源

Hermes `cron/jobs.py:38`：

```python
ONESHOT_GRACE_SECONDS = 120
```

一次性任务的 `run_at` 已经过去了，但偏移在 120s 以内，仍然允许在下个 tick 触发一次。

### 解决的问题

- 用户在 `19:00:00.500` 创建了 `at 19:00:00` 的 one-shot 任务，scheduler 下个 tick 是 `19:00:30`，没宽限就跳过了
- gateway 进程刚好在 `run_at` 那一秒重启，错过 1-2 秒就丢任务

### v0.1 落地

- 常量定义在 `04-data-and-state.md` §9
- Store 的 `get_due_tasks` 实现里：one-shot 的 `next_run_at` 已经过去但偏移 ≤ 120s 时仍视为 due
- 一旦执行过（`last_run_at` 非空），不再触发，避免重复

### 不引入的东西

- recurring task 不享受这条 grace（它们走 `_compute_grace_seconds = period/2` 算法）
- 120s 是常量，不暴露成 per-task 配置（保持简单，等真有人吐槽再加）

## 3. inactivity timeout（卡死兜底）

### 来源

Hermes `cron/scheduler.py:739`：

```python
_cron_timeout = float(os.getenv("HERMES_CRON_TIMEOUT", 600))
```

定时任务允许跑很久（数据分析、长链路工具调用），只要还在 tool call / stream / API 调用就不算卡死；连续无活动达阈值才强制取消。

### 为什么不用 wall timeout

- wall timeout 会把"正常长跑"的任务一刀切掉（比如一个数据 ETL 任务正常跑 30 min，wall=20min 就误杀）
- inactivity 才是"卡死"的真实信号：tool 卡在 socket、API 卡在等响应、stream 中断没收到 EOF
- Hermes 跑了多年验证这个模型够用

### v0.1 落地

- `TaskExecutionPolicy.inactivity_timeout_seconds: int | None = 600`
- env 覆盖：`KONGMING_CRON_INACTIVITY_TIMEOUT`
- Execution Bridge 启动 watchdog 协程：
  - 监听 EventSink 的 `tool.start / tool.end / content.delta / reasoning.delta / turn.start` 事件，每条事件刷新 `last_activity_ts`
  - 每 5 秒轮询：`now - last_activity_ts >= inactivity_timeout_seconds` → cancel `Runner.run` 协程
- 命中后：`ScheduledRun.status = "inactivity_timeout"`，写 `audits.jsonl` 的 `run_inactivity_timeout` action

### wall timeout 怎么办

- v0.1 字段保留 (`wall_timeout_seconds`) 但运行时不强制
- v0.2 视需要补：实现思路是同一个 watchdog 加一个 wall 维度的判断
- 现在不做的原因：v0.1 主要风险是"卡死后悬挂"，wall 是次要风险

## 4. 没有沿用的 Hermes 特性

为了保持 v0.1 范围可控，下面这些 Hermes 有但本方案**暂不引入**：

| Hermes 特性 | 不引入原因 | 何时再考虑 |
|---|---|---|
| `script` 预跑数据采集 | v0.1 先验证调度闭环，预跑会引入子进程沙盒、超时、redact 一整套 | v0.2 |
| 多平台投递（telegram/discord/slack/...） | 当前仓库 web/cli 还没正式投递层 | v0.2，跟着 host 模块演进 |
| credential pool / smart routing | 当前仓库还没 fallback provider 模型 | 跟随 executors 演进 |
| `repeat.times` 计数 | one-shot 走 `state=completed` 自然终止，recurring 不限次数即可覆盖 90% 场景 | 真有需求再加 |
| `disabled_toolsets` 黑名单语义 | 走"白名单 + 装配期裁剪"路线更安全 | — |
