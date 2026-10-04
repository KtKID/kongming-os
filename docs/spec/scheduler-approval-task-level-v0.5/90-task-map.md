# Task Map

## 主 task

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| M1 + M2 + M3 + M4 | `scheduler-approval-mode-per-task-v0.5` | 无 | DoD#1～#10 全部 | 中（安全语义改动）| 可进入 x-req | 4 模块强耦合，单 task 跑完更稳；预估 4-6 小时 |

## 为什么不拆 4 个子 task

1. **强耦合**：M1 的字段 + M2 的决策 + M3 的装配 + M4 的审计，任意 3 个先合都会破现有契约（如 M1 + M2 没有 M3 时，wrapper 拿不到正确 mode；M2 + M3 没有 M4 时，trust 模式无审计违反 DoD#5）
2. **小工作量**：4 模块加起来约 200-300 行实际代码改动，单 task 完全可控
3. **测试整合**：单测 8 组合 + e2e 链路需要 4 模块齐活才能跑——分 task 反而增加 mock 成本
4. **回滚原子性**：出问题时 1 个 commit / 1 个 PR 回滚比 4 个干净

## task 内部 sub-checklist 建议

进入 x-req 后，dev-checklist 按这个顺序展开：

### 阶段 A：domain & config（M1，约 1 小时）

1. `src/scheduler/domain.py`：加 `ApprovalMode` enum + `TaskExecutionPolicy.approval_mode` 字段 + `resolve_effective_mode` helper
2. `src/config_loader/models.py`：扩 `SchedulerApprovalConfig.mode` 字段 + env 覆盖映射
3. `src/scheduler/store.py`：把 SCHEMA_VERSION 改 5；加 v4→v5 迁移分支（备份 + 字段补全）
4. 单测：`tests/unit/scheduler/test_domain_approval_mode.py` + `tests/unit/scheduler/test_store_schema_v5_migration.py` + `tests/unit/config_loader/test_scheduler_approval_mode.py`

### 阶段 B：wrapper 决策流（M2，约 1.5 小时）

5. `src/scheduler/safety_wrapper.py`：`ScheduleApprovalProvider` 加 `mode` + `event_sink` 字段；改造 `decide()` 按 mode 分流
6. 单测：`tests/unit/scheduler/test_safety_wrapper_modes.py`（11 用例，覆盖 mode × decision_class 全组合）

### 阶段 C：execution_bridge 装配（M3，约 1 小时）

7. `src/scheduler/execution_bridge.py`：`_drive_runner` 改造为按优先级解析 mode 并传 wrapper
8. 单测：`tests/unit/scheduler/test_execution_bridge_approval_mode.py`（5 用例覆盖优先级矩阵）

### 阶段 D：审计 trace（M4，约 1 小时）

9. `src/scheduler/safety_wrapper.py`：trust 自动放行时 emit event（M2 已铺垫，这里补 event payload）
10. `src/scheduler/execution_bridge.py`：监听 trust event 后写 audit 行（或：M2 emit 后由 audit sink 单独写）
11. 单测：补强 M2 的 U11 用例 + bridge 写 audit 的集成断言

### 阶段 E：schedule_tool 入参 + e2e（约 1 小时）

12. `src/tools/schedule_tool.py`：`create` action 接受 `approval_mode` 入参；list/detail 输出含 approval_mode
13. 单测：`tests/unit/tools/test_schedule_tool_approval_mode.py`
14. e2e：`tests/e2e/scheduler/test_trust_mode_e2e.py` + `tests/e2e/scheduler/test_hard_block_in_trust_mode.py`
15. 司天集成验证（手动跑一次司天 cron 任务，确认 DoD#6）

### 阶段 F：文档（约 30 分钟）

16. CLAUDE.md：约束章节加一行"cron 任务支持 task 级 approval_mode（trust / fail_closed），默认 fail_closed"
17. `docs/modules/定时任务/README.md`：加一节链接到本 spec
18. `docs/agent-cron-module-v0.2/README.md`：v0.5 演进记录补一行

## 不在本 task 范围

- per-tool 白名单（留 v0.6）
- web 端 cron 审批弹窗（独立 spec，复杂度高）
- HardBlock 规则修订
- `allow_write_file_create_in_cwd` 字段删除（保留兼容，仅在 fail_closed 下有意义）

## 后续 task（潜在）

| task 名 | 触发条件 | 预估 |
|--------|---------|------|
| `scheduler-approval-per-tool-whitelist-v0.6` | 用户反馈"trust 太粗，要 per-tool 精细控制" | 4-6 小时 |
| `web-cron-approval-bridge-v0.6` | 用户希望 fail_closed 模式下 web 能弹审批 | 1-2 天（需要 cron pending 反向通道）|
| `safety-cron-behavior-audit-v0.7` | trust 上线 1-2 月后，根据 audit 数据生成"信任行为画像" | 1 天 |
