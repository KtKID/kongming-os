# 90 · 任务地图

## 任务总览

| 任务 | 名称 | 覆盖模块 | 状态 | 依赖 | 发布批次 |
|---|---|---|---|---|---|
| T1 | 审批合同与运行时单入口 | M1、M2、M3 | 可进入 x-req | 无 | B1 |
| T2 | 子 Agent scope/evidence 迁移 | M4、M2 | 可进入 x-req | T1 合同 | B1 |
| T3 | 定时任务 approval context 迁移 | M5、M2 | 可进入 x-req | T1 合同 | B1 |
| T4 | 审批审计单写点与可靠投影 | M6、M2 | 方案确认 | T1、T2、T3 | B2 |
| T5 | 跨分支质量门禁与文档同步 | M1-M6 | 方案确认 | T1-T4 | B3 |

B1 是不可拆分的安全发布批次。T1、T2、T3 可以分工作项开发，进入主线时需要同时满足 D1-D8。

B1 的 task 级需求包已收敛为 `repo:dev-pipeline/tasks/safety-approval-single-entry-b1-v0.1/`。该 task 把 T1-T3 作为同一 x-dev 输入，避免破坏性协议切换与生产调用方迁移形成可发布中间态。

## T1 · 审批合同与运行时单入口

### 目标

建立最终 provider、consent seam 和运行上下文的类型边界，让 `SessionEngine` 成为最终 provider 的唯一装配 owner。

### 范围

- 修改 `ApprovalProvider` 最终决策合同。
- 新增 `ConsentPrompt`、枚举、scope、evidence、context 和 evaluation 类型。
- 将 `ApprovalManager` 适配为 `ConsentPrompt` 生命周期实现。
- 固定 `SafetyDecisionEngine` 六阶段顺序。
- 修改 `SafetyGatedApproval` 接收 context 并协调最终决定。
- 修改 `SessionEngine.run()` / `continue_from_last_user_message()` 和 Runner 同名入口参数。
- 删除 run 级 provider override。
- 为 T2/T3 提供明确的 context builder 输入合同。

### 排除

- 子 Agent 具体 scope 派生实现。
- scheduler task mode 映射实现。
- JSONL writer queue 和全部审计 sink 迁移。

### 验收

- D1、D2、D3、D6、D7。
- mypy 能阻止 `ConsentPrompt` 注入最终 provider 位置。
- main Agent 运行链完整通过。
- T2/T3 的生产调用点在 B1 集成分支完成迁移后方可发布。

### 主要测试

- core contracts 类型检查。
- SafetyDecisionEngine 阶段顺序与短路单测。
- SessionEngine build、`run()`、`continue_from_last_user_message()` 合同测试。
- Runner approved/rejected/cancelled 测试。
- import-linter。

### 文档同步

- `repo:docs/modules/安全/README.md`
- `repo:docs/modules/执行器/README.md`
- `repo:docs/architecture/approval.md`

## T2 · 子 Agent scope/evidence 迁移

### 目标

把子 Agent 权限表达从行为对象改成不可变 scope 与 evidence，确保相对父上下文单调收紧。

### 范围

- 为 `SubAgentManager` 增加 context 派生入口。
- 定义 `SubAgentGrant` 到 `ApprovalScope`/`GrantEvidence` 的转换。
- 修改 `SpawnAgentRequest`、`AgentCell`、`AgentManager` 和 `HostDispatcher`。
- 删除 `SubAgentApprovalProvider` 与 `_write_audit()`。
- 保留文件工具 wrapper 作为 execution-time 纵深防御。
- 覆盖撤销、过期、预算和委派深度。

### 排除

- task scheduler approval mode。
- approval audit sink 的最终队列实现。

### 验收

- D2、D4、D5、D6、D8。
- 范围内 destructive 调用仍经过全局 Destructive 与 Trust。
- 范围外调用在 RuntimeScope 拒绝。
- spawn grant 超过父 scope 时，child 不创建。

### 主要测试

- `SubAgentManager` 派生和失败状态机测试。
- scope 收紧属性测试。
- AgentCell/mailbox/HostDispatcher 集成测试。
- child 读写路径与 symlink/缺失叶节点边界测试。
- parent cancel、grant revoke 和 continue 测试。

### 文档同步

- `repo:docs/modules/应用/README.md`
- `repo:docs/spec/agent-workflow/subagent-scoped-permissions-v0.1/`

## T3 · 定时任务 approval context 迁移

### 目标

把 scheduled run 的 trust/fail_closed 语义映射到通用 context，移除分支最终 provider wrapper。

### 范围

- `SchedulerManager` 构造 scheduled context。
- trust task 创建限定 task/scope/window 的 `GrantEvidence`。
- fail_closed task 配置 `ConsentPolicy.FAIL_CLOSED`。
- scheduled execution bridge 只传 context。
- 删除 `ScheduleApprovalProvider` 的最终 wrapper 角色和内部直接 audit。
- 保持 HardBlock 绝对优先级和现有 task 默认语义。

### 排除

- scheduler UI 和 task schema 产品改版。
- 分布式 scheduler 和远程审批。

### 验收

- D3、D6、D8。
- trust 无法放行 HardBlock。
- fail_closed 缺少 consent 时稳定拒绝。
- task 自身 mode 优先于 scheduler 默认值。

### 主要测试

- SchedulerManager mode 映射测试。
- execution bridge 真实状态测试。
- task 更新、禁用、并发触发和恢复测试。
- trust/fail_closed 薄 smoke。

### 文档同步

- `repo:docs/modules/定时任务/README.md`
- `repo:docs/spec/scheduler-approval-task-level-v0.5/`

## T4 · 审批审计单写点与可靠投影

### 目标

让审批规则只产出结构化事实，由 `ApprovalAuditManager` 统一发布一次终态事件，并为安全账本提供可验证的必达语义。

### 范围

- 新增 `ApprovalAuditManager` 和 sink binding。
- 新增 `approval.evaluated` payload 与 evaluation id。
- 迁移 workflow、scheduler 和 trace 审计。
- 实现 required/best-effort 两种等级。
- 实现本地 JSONL 有界队列、单 writer、ack、drain 和故障传播。
- 移除 policy/provider 直接文件 I/O。
- 增加审批队列和失败指标。

### 技术验证

先完成 POC-01 的正式回归测试，验证 required acknowledgment 与工具执行的先后关系。验证通过后进入 sink 全量迁移。

### 验收

- D8、D9、D10。
- 每个 tool call 最多一个终态事件。
- approved 在 required ack 前不执行。
- sink 重试不会产生逻辑重复记录。

### 主要测试

- queue 顺序、背压、超时、磁盘满、权限错误和 shutdown drain。
- workflow/scheduler ledger 真实文件测试。
- best-effort sink 故障注入。
- evaluation id 幂等测试。
- 工具 execute 计数与 audit ack 时序测试。

### 文档同步

- `repo:docs/modules/观测/README.md`
- `repo:docs/modules/安全/README.md`
- workflow 与 scheduler 运维说明。

## T5 · 跨分支质量门禁与文档同步

### 目标

用跨模块证据确认单入口安全不变量，并清除旧文档中“分支 provider 包装最终审批”的描述。

### 范围

- main/subagent/scheduled 参数化合同测试。
- Web main approval、child scope、scheduled trust 三条薄 smoke/e2e。
- Python/TS wire fixture 同步；仅在 Web 消费新事件时触发。
- 全量相关 mypy、ruff、lint-imports。
- 静态扫描旧 provider 注入和直接 audit I/O。
- 更新 module README、architecture approval 导航和相关旧 spec。

### 验收

- D11、D12。
- R1-R13 均有自动或人工证据。
- B1-B3 发布说明包含回滚触发器、审计队列指标和 context 版本策略。

## 依赖与并行

- T1 先冻结合同。
- T2 与 T3 在 T1 合同冻结后并行开发。
- T1、T2、T3 在同一 B1 集成门禁合流。
- T4 使用 B1 的统一 evaluation/context，避免同时兼容旧 provider 事件。
- T5 在 T4 后完成最终门禁。

## x-req 建议

B1 x-req 已创建于 `repo:dev-pipeline/tasks/safety-approval-single-entry-b1-v0.1/`，统一覆盖 T1-T3。下一步直接用 x-dev 执行该 task，逻辑工作项仍按 T1 合同、T2 子 Agent、T3 scheduler 的依赖顺序推进。

T4 在 x-req 开头保留 POC-01 验证节点。POC 结果只决定 writer 的队列/flush 实现，required fail-closed 和单写点属于已确认需求。

## 完成判定

本 spec 在 T1-T5 全部完成、D1-D12 证据齐全、相关模块文档已同步后进入“已完成”。B1 完成后 P0 的 provider 绕过面关闭；B2 完成后审计 owner 和持久化语义收敛；B3 完成后文档与质量证据闭环。
