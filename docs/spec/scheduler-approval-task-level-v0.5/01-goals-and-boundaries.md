# 目标与完成标准

## 系统目标

让 cron 定时任务（典型场景：司天扫描器、定期备份、批量数据处理）能够顺利执行需要 `explicit_consent` 的工具调用（如 `run_shell` 执行固定脚本、`write_file` 写工作区文件），同时不破坏 HardBlock 的不可逆危险动作兜底。**核心权衡：cron 任务的"用户身份"就是创建者本人；只要 HardBlock 的真正高危动作仍然拒绝，其他需要人工 consent 的工具应该自动放行。**

## 完成目标（DoD）

- [ ] **DoD#1**：`ScheduledTask.policy.approval_mode` 字段存在且持久化；schema 升至 v5；老 v4 数据加载时自动迁移为 `fail_closed`
- [ ] **DoD#2**：`SchedulerApprovalConfig.mode` 全局字段存在；**默认值 `trust`**（v0.5 调整：cron 即用户预批准任务，不应再次审批）；可通过 `KONGMING_SCHEDULER_APPROVAL_MODE=fail_closed` env 显式 opt-in 严格模式
- [ ] **DoD#3**：`ScheduleApprovalProvider` 实现 trust 模式：`hard_block` 透传 rejected，`silent_allow` / `standard_allow` 透传 approved，`explicit_consent` 转 approved（不论 standard / elevated），metadata 标 `cron_trust_mode=true`
- [ ] **DoD#4**：`ExecutionBridge._drive_runner` 装配 wrapper 时按 `task.policy.approval_mode > config.scheduler.approval.mode > fail_closed` 优先级解析
- [ ] **DoD#5**：trust 模式下每次自动批准都 emit `Event(kind="approval.cron.auto_allow")` 写入 trace；同时写 `audit_action="run_approval_auto_allow"` 一行
- [ ] **DoD#6**：司天扫描 cron 任务实际跑通——执行 `python scripts/sitian_scan.py` 不再失败 `NEEDS_APPROVAL`
- [ ] **DoD#7**：`schedule_tool` 接受 `approval_mode` 入参（可选，默认沿用全局）
- [ ] **DoD#8**：单测覆盖 wrapper 的 4 类 decision_class 在 trust / fail_closed 两模式下的全 8 种组合
- [ ] **DoD#9**：e2e 测试：创建 trust 模式任务 → 触发 → 验证 audit 写了 `run_approval_auto_allow` 行
- [ ] **DoD#10**：CLAUDE.md 第 8 条约束补一行说明 cron 任务级审批模式；`docs/modules/定时任务/README.md` 同步指向本 spec

## 范围边界

**包含**：
- domain & config 字段定义 + schema 迁移
- wrapper 决策流改造
- execution_bridge 装配解析
- 审计 trace 与 audit 行
- schedule_tool / scheduler API 入参扩展
- 单元 + e2e 测试
- 文档同步

**不包含**：
- per-tool 白名单（v0.6+）
- web 端实时审批弹窗反向通道（独立 spec）
- HardBlock 规则修订（不在本 spec 范围）
- 老字段 `allow_write_file_create_in_cwd` 的删除——本 spec 不删，但在 trust 模式下其优先级低于 trust 整体放行（trust 命中时该字段无效）

## 关键约束

- **决策类不变性**：`hard_block` 在任何模式下都必须 rejected——这是用户拍板的核心安全边界
- **默认 trust（v0.5 调整后）**：cron 即用户预批准任务，HardBlock 兜底真高危——默认 trust 才符合 cron 语义本意。旧约束"保持向后兼容默认 fail_closed"已被用户审视后推翻；想要严格审批必须 yaml/env 显式 opt-in `fail_closed`
- **无新 Protocol**：本 spec 不引入 `ApprovalProvider` 之外的新协议；只在 `ScheduleApprovalProvider` 内部增加分支
- **trace 必写**：trust 模式下每次自动放行都必须留下审计证据，方便事后追责
- **schema 不向后兼容**：v0.5 schema_version 升到 5，启动时检测到 v4 自动迁移（按 v0.2 / v0.3 / v0.4 已有迁移模式，参考 `scheduler/store.py` 的 schema 重置 / 字段补全）

## 安全边界讨论

**Q1：trust 模式下，elevated severity 的工具调用也放开吗？**

是。理由：
- `elevated` severity 在当前 `safety/default_rules.py` 里指"需要双重确认的潜在风险"（如写敏感目录、删非 trash 文件等），但不包括"不可逆系统级危险"——后者全在 HardBlock 里
- 如果 elevated 在 trust 下不放开，等于 cron 还是无法跑 99% 的实际工作；trust 模式就退化成"放开几个无关紧要的工具"
- 用户可控：不放心的 elevated 操作，用户自己别在 cron 任务里写就行；要放就显式 `approval_mode=trust` 签字

**Q2：HardBlock 兜底够用吗？**

够。HardBlock 当前覆盖（来自 `safety/default_rules.py` + `safety/guards/hard_block.py`）：
- `rm -rf /` / `rm -rf ~` / 删根
- `chmod 777 /` / 系统目录改权限
- 写 `~/.ssh/` / `~/.aws/` / `/etc/passwd` / sudoers 等敏感凭据
- 系统级 `shutdown` / `reboot` / `mkfs` 等不可逆操作

这些场景在 trust 模式下仍然 rejected。其他能造成破坏但**可恢复**的操作（删工作区文件、改业务数据、调外部 API），让 cron 用户自己负责——这是合理的信任边界。

**Q3：trust 模式被滥用风险？**

防线 4 层：
1. **显式签字**：必须用户主动写 `approval_mode=trust`，未声明走 fail_closed
2. **审计留痕**：每次自动放行都 emit event + 写 audit，事后可查
3. **HardBlock 不可绕**：真高危永远拦
4. **per-task 隔离**：trust 是任务级而非全局，单个任务出问题不污染其他

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD#1 | M1 domain & config | `scheduler-approval-mode-per-task-v0.5` | 待实现 |
| DoD#2 | M1 domain & config | 同上 | 待实现 |
| DoD#3 | M2 safety_wrapper | 同上 | 待实现 |
| DoD#4 | M3 execution_bridge | 同上 | 待实现 |
| DoD#5 | M4 审计 trace | 同上 | 待实现 |
| DoD#6 | M1 + M2 + M3 + M4 + 司天 task 创建脚本调整 | 同上 + 司天端集成 | 待实现 |
| DoD#7 | M1 + tools/schedule_tool.py | 同上 | 待实现 |
| DoD#8 | M2 单测 | 同上 | 待实现 |
| DoD#9 | M1+M2+M3+M4 e2e | 同上 | 待实现 |
| DoD#10 | 文档同步 | 同上 | 待实现 |

> 4 个模块全部对应到至少 1 条 DoD，无 scope creep；DoD#6 是端到端验收锚点，强制 4 模块组合跑通。
