# Task Map

## 任务一览

| 模块 | 建议 task 名 | 是否创建 task | 前置依赖 | 当前状态 |
|---|---|---|---|---|
| Schedule Domain Model | `schedule-domain-model` | 是 | 无 | 可进入 x-req |
| Scheduler Store | `schedule-store-file` | 是 | Domain Model | 可进入 x-req |
| Trigger Engine | `schedule-trigger-engine` | 是 | Store | 可进入 x-req |
| Execution Bridge | `schedule-execution-bridge` | 是 | Domain Model + Store + Trigger Engine | 可进入 x-req |
| Safety and Policy Integration | `schedule-safety-policy` | 是 | Execution Bridge | 可进入 x-req |
| Management Surfaces | `schedule-management-surfaces` | 否 | 上述全部 | 探索中 |

## 推荐推进顺序

```text
批次 1（契约与存储）：
  ├─ schedule-domain-model
  └─ schedule-store-file

批次 2（调度内核）：
  └─ schedule-trigger-engine

批次 3（执行闭环）：
  └─ schedule-execution-bridge

批次 4（安全与策略）：
  └─ schedule-safety-policy

批次 5（外部接口）：
  └─ schedule-management-surfaces
```

## 各 task 的 x-req 准入条件

### `schedule-domain-model`

- ✅ `ScheduledTask / ScheduleTrigger / ScheduledRun` 三个核心实体已经收敛
- ✅ `once / interval / cron` 三类 trigger 已确定
- ✅ fresh session 作为默认执行模式已确定
- ✅ `RunStatus` 显式枚举（含 `silent / inactivity_timeout / abandoned / cancelled`），不引入 `waiting_approval`
- ✅ `RunFailureReason` 单独建模，便于查询与告警
- ⚠️ x-req 阶段需补：字段级 schema 草案与错误语义

### `schedule-store-file`

- ✅ 已确定 v0.1 用文件存储（`scheduled_tasks.json` + `runs/<task>.jsonl` + `audits.jsonl`），不上 SQLite
- ✅ 进程级 file lock（`.scheduler.lock`）防多实例抢 due
- ✅ recurring task 的 `advance_next_run` 语义已确定（在 lock 区间内推进）
- ⚠️ x-req 阶段需补：原子写入工具复用方式、stale-running 恢复策略、JSON 损坏自动修复

### `schedule-trigger-engine`

- ✅ 已确定 APScheduler `MemoryJobStore` 作为主调度内核（不使用 SQLAlchemyJobStore）
- ✅ scheduler lifecycle 绑定 app runtime 已确定
- ✅ system cron / launchd 只承担保活职责已确定
- ✅ missed-run grace 算法（period/2，clamp [120s, 7200s]）已确定
- ⚠️ x-req 阶段需补：web 生命周期接线点与任务级 reload API

### `schedule-execution-bridge`

- ✅ 已确定 due task -> fresh `Runner.run()` 的执行语义
- ✅ 已确定 schedule run 不复用旧 session
- ✅ 已确定要显式传 execution context
- ✅ inactivity timeout 监听（默认 600s）+ `[SILENT]` 投递抑制
- ✅ 装配层裁剪 schedule 管理工具，防递归
- ⚠️ x-req 阶段需补：payload 到 user_input / instruction 的映射方式、watchdog 实现细节

### `schedule-safety-policy`

- ✅ v0.1 走 fail-closed：未授权高风险动作 → 整 run `failed(needs_approval)`，不引入 lease/挂起恢复
- ✅ 接线方式：包一层 `ScheduleApprovalProvider`，不污染 `safety/types.py`
- ✅ 创建 vs 执行双层审批边界已明确
- ✅ 已确定保守快进优先于补跑风暴
- ⚠️ x-req 阶段需补：`ScheduleApprovalProvider` 接口签名、cron 上下文标记的传递路径

### `schedule-management-surfaces`

- ✅ CLI / Web / tool-facing 三类入口已识别
- ⚠️ 仍不适合进入 x-req
- ⚠️ 当前更适合等底层契约冻结后再拆

## 适合先进入 x-req 的模块

- `schedule-domain-model`
- `schedule-store-file`
- `schedule-trigger-engine`
- `schedule-execution-bridge`
- `schedule-safety-policy`

这五个模块已经有稳定目标、清晰边界和明确依赖顺序。

## 继续停留在方案层的模块

- `schedule-management-surfaces`

原因：

- 底层模型一旦调整，CLI / Web / tool 三套入口都会返工；
- 当前仓库更需要先验证调度与执行闭环；
- 用户体验层可以在底层稳定后快速补齐。
