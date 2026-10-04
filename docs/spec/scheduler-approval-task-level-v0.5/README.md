# Scheduler 任务级审批模式 (v0.5)

> 状态：方案确认中
> 目标：把 cron 一刀切的 fail-closed 审批改为"任务级 approval_mode"，让司天等需要执行固定脚本的定时任务能跑通，同时保留 HardBlock 兜底。

## 系统目标

cron 模块当前的 `ScheduleApprovalProvider`（`src/scheduler/safety_wrapper.py:54-88`）把所有命中 `explicit_consent` 的工具调用一律转 `rejected`，唯一白名单是 `write_file_create`。这导致：

- 司天 cron 任务需要 `run_shell` 执行 `python scripts/sitian_scan.py` → 命中 consent → 整个 run 失败标 `NEEDS_APPROVAL`
- web 端没有针对 cron 的审批弹窗推送通道，pending 也无人接收 → 用户在 UI 上看不到任何可操作入口
- 现状：cron 几乎无法跑任何"读写工作区文件 + 调本地脚本"的实质任务

本 spec 引入**任务级 approval_mode**：每个 cron task 自己声明 `trust` / `fail_closed`，未声明走全局默认（**v0.5 默认 `trust`** —— cron 即用户预批准任务，不应再次审批；要严格审批必须显式 `fail_closed` opt-in）。`trust` 模式下 `explicit_consent` 自动放行，但 `hard_block` 永远不可绕过——把"信任 cron 任务"的语义显式化、可控化、可审计。

## 最小可用路径

```
用户在 LLM 对话中 / Web 上创建 cron 任务时显式声明 approval_mode=trust
  → Store 持久化 ScheduledTask.policy.approval_mode
  → ticker 触发 due task → ExecutionBridge.execute
  → execution_bridge 解析优先级：task.policy.approval_mode > config.scheduler.approval.mode > "fail_closed"
  → 构造 ScheduleApprovalProvider(mode=trust)
  → Runner 执行 run_shell 调用 → wrapper 拿到 explicit_consent decision
  → trust 模式下转 approved，metadata 标 cron_trust_mode=true + decision_source=cron_trust
  → emit Event(kind="approval.cron.auto_allow") + audit 记录
  → 工具实际执行 + 任务正常完成
```

涉及的 4 个模块都是 P0（domain / config / wrapper / audit），缺一不可。

## 范围边界

**包含**：
- `TaskExecutionPolicy.approval_mode` 字段（domain 层）
- `SchedulerApprovalConfig.mode` 全局默认（config 层）
- `ScheduleApprovalProvider` 决策流改造（safety wrapper 层）
- `ExecutionBridge` 装配时的优先级解析（execution bridge 层）
- 审计 trace：`approval.cron.auto_allow` event + audit 行
- schema 迁移：v0.4 → v0.5 自动给老任务塞 `approval_mode=fail_closed`（兼容默认）
- schedule_tool / cron API 接受 `approval_mode` 入参
- 文档：CLAUDE.md 司天章节 + cron 模块章节同步更新

**不包含**：
- per-tool 白名单（`task.allowed_tools=["run_shell"]` 这种细粒度）——本 spec 只到 mode 二选一，per-tool 留 v0.6+
- web 端 cron 任务实时审批弹窗（cron pending 反向通道）——这是另一个 spec
- HardBlock 规则表本身的修改——HardBlock 内容由 `safety/default_rules.py` 维护，本 spec 不动
- 老 `allow_write_file_create_in_cwd` 字段的删除——保留兼容，但在 trust 模式下无意义

## 改动导航

> **本 spec 不是 4 模块系统**——是 **1 个 dataclass + 3 类零散改动**。下表按"性质"分，不按"模块"分。详细设计在 [02-module-breakdown.md](./02-module-breakdown.md)，可视化在 [architecture.html](./architecture.html)。

| 编号 | 性质 | 改的是什么 | 行数 | 文档锚 |
|------|------|-----------|------|-------|
| **③** | **类改造（唯一）** | `ScheduleApprovalProvider` dataclass 加字段 + 改 `decide()` 方法 | ~80 | [02 §③](./02-module-breakdown.md#m2) |
| ① | 数据字段 + 1 枚举 + 1 helper | `ApprovalMode` + `TaskExecutionPolicy.approval_mode` + `SchedulerApprovalConfig.mode` + schema v4→v5 迁移 | ~50 | [02 §①](./02-module-breakdown.md#m1) |
| ② | 装配点（函数内 5 行）| `ExecutionBridge._drive_runner` 解析 mode 并传 wrapper | ~10 | [02 §②](./02-module-breakdown.md#m3) |
| ④ | 调用点（各 1 行） | wrapper 内 `event_sink.emit(...)` + bridge 内 `store.append_audit(...)` | ~10 | [02 §④](./02-module-breakdown.md#m4) |

总计约 150 行实际代码 + 配套单测/e2e/文档。单 task 4-6 小时完成。

## 文档导航

- [架构图](./architecture.html)（浏览器双击打开）
- [01 目标与完成标准](./01-goals-and-boundaries.md)
- [02 模块拆分 + 接口 + 数据结构](./02-module-breakdown.md)
- [03 核心流程](./03-core-workflows.md)
- [04 数据模型与状态](./04-data-and-state.md)
- [05 验证策略与演进](./05-validation-and-evolution.md)
- [90 Task 映射](./90-task-map.md)

## 当前建议

1. **整 spec 拆 1 个 task**：`scheduler-approval-mode-per-task-v0.5`——4 个模块强耦合（domain 字段 / wrapper 逻辑 / 装配解析 / 审计），单 task 跑完更稳，估算 4-6 小时。
2. **不需要 PoC**：决策流改造是局部修改，无技术风险；HardBlock 兜底逻辑已经在 `safety/guards/hard_block.py` 验证过。
3. **优先级排前**：司天任务现在被卡，是其他链路的阻塞项；建议本 spec 进 x-req 后立刻跑。
