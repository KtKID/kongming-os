# 验证策略与演进

## 验证策略

### 单元测试

#### 1. `tests/unit/scheduler/test_safety_wrapper_modes.py`（新增）

覆盖 wrapper 决策矩阵（**核心**：DoD#8）。

| 用例 | 输入 mode | inner decision_class | inner decision_source | 期望 outcome | 期望 metadata 标记 |
|------|----------|---------------------|----------------------|------------|-------------------|
| U1 | fail_closed | hard_block | - | rejected | （inner 原 metadata 透传） |
| U2 | fail_closed | silent_allow | - | approved | 透传 |
| U3 | fail_closed | standard_allow | - | approved | 透传 |
| U4 | fail_closed | explicit_consent | standard | rejected | cron_fail_closed=true |
| U5 | fail_closed | explicit_consent | standard + write_file create 命中白名单 | approved | cron_whitelist=write_file_create |
| U6 | trust | hard_block | - | rejected | （透传，不带 cron_trust_mode）|
| U7 | trust | silent_allow | - | approved | 透传 |
| U8 | trust | standard_allow | - | approved | 透传 |
| U9 | trust | explicit_consent | standard | approved | cron_trust_mode=true, decision_source=cron_trust |
| U10 | trust | explicit_consent | elevated | approved | cron_trust_mode=true, decision_source=cron_trust |
| U11 | trust | explicit_consent | standard | approved | event_sink 收到 1 个 approval.cron.auto_allow event |

**禁止用一次性脚本验证**：所有用例必须写成 pytest 文件，可重复跑（CLAUDE.md 约束 13）。

#### 2. `tests/unit/scheduler/test_execution_bridge_approval_mode.py`（新增）

覆盖优先级解析（DoD#4）。

| 用例 | task.policy.approval_mode | config.scheduler.approval.mode | 期望 effective_mode |
|------|--------------------------|-------------------------------|-------------------|
| P1 | None | fail_closed | fail_closed |
| P2 | None | trust | trust |
| P3 | TRUST | fail_closed | trust（task 优先）|
| P4 | FAIL_CLOSED | trust | fail_closed（task 优先）|
| P5 | None | (config 为 None，CLI 默认装配缺失) | fail_closed |

#### 3. `tests/unit/scheduler/test_store_schema_v5_migration.py`（新增）

覆盖 schema 迁移（DoD#1）。

- M1：v4 tasks.json 加载 → 自动写 `.bak.<ts>` + 字段补全 + schema_version=5
- M2：v5 tasks.json 加载 → 不迁移、不备份
- M3：v3 / v2 tasks.json 加载 → 沿用原 v0.2 重置式迁移（清空 + 写空 v5）
- M4：迁移后老 task 的 `policy.approval_mode is None` 且其他字段不变

#### 4. `tests/unit/scheduler/test_domain_approval_mode.py`（新增）

- D1：`ApprovalMode` 枚举值为字符串
- D2：`TaskExecutionPolicy(approval_mode=None)` 合法
- D3：`TaskExecutionPolicy(approval_mode=ApprovalMode.TRUST)` 合法
- D4：`resolve_effective_mode(None, ApprovalMode.FAIL_CLOSED) == FAIL_CLOSED`
- D5：`resolve_effective_mode(ApprovalMode.TRUST, ApprovalMode.FAIL_CLOSED) == TRUST`

#### 5. `tests/unit/config_loader/test_scheduler_approval_mode.py`（扩展现有）

- C1：yaml `scheduler.approval.mode: "trust"` 解析正常
- C2：`mode: "invalid"` 触发 pydantic ValidationError
- C3：env `KONGMING_SCHEDULER_APPROVAL_MODE=trust` 覆盖 yaml 默认
- C4：未配置 `mode` 时默认 `fail_closed`

#### 6. `tests/unit/tools/test_schedule_tool_approval_mode.py`（扩展现有）

- T1：`schedule(action="create", ..., approval_mode="trust")` 落盘 task.policy.approval_mode == TRUST
- T2：缺省 approval_mode → 落盘 None
- T3：非法字符串 → tool 返回 validation error

### 集成测试

#### `tests/e2e/scheduler/test_trust_mode_e2e.py`（新增；DoD#9）

端到端链路：
1. 启动一个最小 cron runtime（in-memory store + mock LLM + 真实 SafetyGatedApproval）
2. 创建任务 A：`approval_mode=trust`，input 让 LLM 调 `run_shell` 跑 `echo hello`
3. 创建任务 B：`approval_mode=fail_closed`，同样的 input
4. 触发两个任务的 due reservation
5. 断言：
   - 任务 A：status=COMPLETED，audit 含 `run_approval_auto_allow` 行，trace 含 `approval.cron.auto_allow` event
   - 任务 B：status=FAILED，failure_reason=NEEDS_APPROVAL（保留现有行为）

#### `tests/e2e/scheduler/test_hard_block_in_trust_mode.py`（新增）

trust 模式下 hard_block 不被绕过：
1. 创建任务：`approval_mode=trust`，input 让 LLM 调 `run_shell` 跑 `rm -rf /tmp/xxx`（命中 hard_block）
2. 触发
3. 断言：status=FAILED，failure_reason=NEEDS_APPROVAL，trace 中**不**含 `approval.cron.auto_allow`

#### 司天集成验证（DoD#6）

1. 在 `.kongming/cron/tasks.json` 写一条司天扫描任务（手动 / via schedule_tool），`approval_mode=trust`
2. 运行 `./sitian.sh scan` 或等 cron tick 触发
3. 验证：任务 status=COMPLETED，且 `audit.jsonl` 含 `run_approval_auto_allow` 行
4. 验证：司天报告产物正常生成在 `.kongming/sitian/`

### 手动验证

- **必须人工过**：
  - schedule_tool 创建 task 时 web UI / CLI 输出能看到 `approval_mode` 字段
  - `.kongming/trace.jsonl` 中能看到 `approval.cron.auto_allow` event（人眼检查 payload 完整性）
  - 把一条 fail_closed 老任务切到 trust 后第一次触发，行为符合预期
- **验收人**：项目所有者（用户）

## 测试覆盖要求

| 模块 | 最低覆盖率 | 重点文件 |
|------|-----------|---------|
| scheduler/safety_wrapper.py | 95%（核心安全逻辑）| 全部分支 |
| scheduler/domain.py（新增枚举）| 100% | ApprovalMode + resolve_effective_mode |
| scheduler/execution_bridge.py 改动部分 | 90% | _drive_runner 中 wrapper 装配代码 |
| scheduler/store.py 迁移代码 | 90% | v4→v5 迁移分支 |
| config_loader/models.py 改动部分 | 90% | SchedulerApprovalConfig.mode 校验 |

**全 8 种 mode × decision_class 组合必须有用例**（DoD#8 硬要求）。

## 演进路线

### 短期（本 spec / 本 task）

- [ ] M1 domain & config + schema 迁移
- [ ] M2 wrapper 决策流改造 + 全 8 组合单测
- [ ] M3 execution_bridge 优先级解析 + 4 组合单测
- [ ] M4 trust 自动放行 trace event + audit 行
- [ ] schedule_tool 入参扩展
- [ ] 司天端集成验证（DoD#6）
- [ ] CLAUDE.md + docs/modules/定时任务/README.md 同步

### 中期（v0.6 候选）

- [ ] **per-tool 白名单**：`task.allowed_tools=["run_shell:python scripts/.*"]`，更细粒度
- [ ] **per-rule whitelist**：trust 模式下允许 task 显式排除某些规则（如"trust 但不放写 .ssh"）
- [ ] **web 端 cron 审批反向通道**：fail_closed 模式下命中 consent 时弹 web 弹窗，用户在 UI 上批准/拒绝后 runner 继续（独立 spec，复杂度 ⭐⭐⭐）

### 长期（方向性）

- **审批级别策略表**：把 ApprovalMode 二元模式扩展到"按 severity 分级"——standard 自动放、elevated 仍需 web 弹窗、hard_block 永远拒
- **task 信任度评分**：根据 task 历史成功率 / 错误密度自动调整 mode（高信任度任务自动 upgrade 到 trust）
- **跨 task / cross-run 行为审计**：在 evolution 模块里加 reviewer，把"trust 模式下的所有 auto_allow"形成"信任行为画像"，异常波动时 emit 警告

## 失败回滚预案

如果 trust 模式上线后出问题（如 cron 任务被恶意 input 利用、HardBlock 列表有遗漏），回滚流程：

1. **配置回滚**：把 `config.scheduler.approval.mode` 改回 `fail_closed`（不需要重启即可，下次 ticker 触发的 task 重新读 config）
2. **task 级回滚**：把出问题的 task 的 `policy.approval_mode` 改成 `fail_closed`（store.update_task 即可）
3. **代码回滚**：本 spec 改动隔离在 4 个文件，git revert 即可；schema_version 留在 5（不回滚到 4，否则又要迁移）

## 风险监控

上线 1 周内，每日检查：
- `.kongming/cron/audit.jsonl` 中 `run_approval_auto_allow` 数量与分布——异常激增 = 可能被滥用
- `.kongming/trace.jsonl` 中 `approval.cron.auto_allow` 的 `tool_name` 分布——出现意外工具就报警
- 司天任务执行成功率从 ≤1% 拉到 ≥95%（DoD#6 验收基线）
