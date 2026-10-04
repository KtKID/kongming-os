# 05 · 验证与演进

## Definition of Done

本表与 [目标与边界中的完成标准](./01-goals-and-boundaries.md#完成标准) 一致，补充实现级可观察字段。

| DoD | 完成条件 |
|---|---|
| D1 | 生产装配中每个 `SessionEngine` 只有一个最终 `SafetyGatedApproval`，Runner 的 `run()` / `continue_from_last_user_message()` 调用都使用该实例 |
| D2 | `SessionEngine.run(approval=...)`、`SpawnAgentRequest.approval` 和 `AgentCell.run_approval` 从合同与生产调用点移除 |
| D3 | main、subagent、scheduled 三类 context 对同一请求执行相同的六阶段顺序 |
| D4 | 子 scope 超界产生 rejected，范围内请求继续进入 Boundary、Destructive、Trust 与 Consent |
| D5 | 子 scope 始终为父 scope 子集，工具、路径、资源、预算、期限和委派深度均有收紧测试 |
| D6 | `GrantEvidence` 只由 Trust 阶段消费，HardBlock 和 RuntimeScope 始终先执行 |
| D7 | interactive、auto-allow、fail-closed 通过 `ConsentPrompt` 实现，任何 consent adapter 都无法满足最终 provider 合同 |
| D8 | `SubAgentApprovalProvider` 和 `ScheduleApprovalProvider` 的最终 wrapper 角色移除，旧 `_write_audit()` 调用移除 |
| D9 | 每个 tool call 最多产生一个 `approval.evaluated` 终态事件，事件包含 run、agent、workflow/task、scope、evidence 和阶段事实 |
| D10 | approved 动作在 required sinks 确认前保持未执行；required 故障 fail-closed；best-effort 故障只产生投影错误 |
| D11 | pytest、mypy、ruff、lint-imports 和跨分支 smoke 全部通过，协议变更具备双侧合同测试 |
| D12 | 安全、执行器、应用、定时任务模块 README 与旧 spec 的权威关系完成同步 |

## 需求追踪矩阵

| 需求 | DoD | 模块 | 任务 | 主要验证 |
|---|---|---|---|---|
| R1 | D1 | M2、M3 | T1 | 装配测试、生产调用点静态扫描 |
| R2 | D2 | M3 | T1 | mypy、SessionEngine 合同测试 |
| R3 | D2、D8 | M4 | T2 | dataclass 合同测试、调用点扫描 |
| R4 | D3 | M2、M4、M5 | T1、T2、T3 | 参数化规则顺序测试 |
| R5 | D4、D5 | M2、M4 | T2 | 子 scope 属性测试与 destructive 回归 |
| R6 | D6 | M1、M2、M4、M5 | T1、T2、T3 | 阶段顺序与 evidence 消费测试 |
| R7 | D7 | M1、M2 | T1 | mypy negative fixture、consent 单测 |
| R8 | D8、D10 | M4、M5、M6 | T2、T3、T4 | I/O 调用扫描、sink 故障测试 |
| R9 | D9 | M2、M6 | T4 | 事件幂等与一次性测试 |
| R10 | D10 | M6 | T4 | queue、磁盘错误和工具未执行测试 |
| R11 | D10 | M6 | T4 | best-effort sink 故障注入 |
| R12 | D12 | M1-M6 | T5 | 文档路径与术语审查 |
| R13 | D11 | M1-M6 | T5 | pytest、mypy、ruff、lint-imports、smoke |

## 模块反向追踪

| 模块 | 覆盖需求 | 覆盖 DoD | 交付任务 |
|---|---|---|---|
| M1 核心审批合同 | R3、R6、R7、R12、R13 | D2、D6、D7、D11、D12 | T1、T5 |
| M2 安全决策 | R1、R4、R5、R6、R7、R9、R12、R13 | D1、D3、D4、D6、D7、D9、D11、D12 | T1、T4、T5 |
| M3 运行时装配 | R1、R2、R12、R13 | D1、D2、D3、D11、D12 | T1、T5 |
| M4 Agent 授权上下文 | R3、R4、R5、R6、R8、R12、R13 | D2-D6、D8、D11、D12 | T2、T5 |
| M5 定时任务授权上下文 | R4、R6、R8、R12、R13 | D3、D6、D8、D11、D12 | T3、T5 |
| M6 审批审计投影 | R8-R13 | D8-D12 | T4、T5 |

M1-M6 的文档更新统一由 T5 验收，功能任务仍需在各自变更中同步相关测试和局部说明。

## 验证分层

### 1. 单元与属性测试

- 六阶段规则顺序和短路语义。
- scope 集合求交、路径包含、预算最小值、期限最小值和委派深度。
- `child_scope ⊆ parent_scope` 属性测试。
- grant subject、scope、capability、过期和撤销校验。
- `ConsentPrompt` 三种策略。
- evaluation id 稳定性和事件字段完整性。
- writer queue 顺序、ack、drain、满队列和故障传播。

### 2. Manager 与状态机测试

- `SubAgentManager` 成功派生、越权拒绝、父证据过期和并发 spawn。
- `AgentManager` 的 cell 状态、mailbox run 和取消清理。
- `SchedulerManager` 的 task mode、默认 mode、task 更新和运行中快照。
- `ApprovalManager` 的 request、resolve、cancel、timeout 和 shutdown。
- continue 恢复 context、未知版本、撤销 epoch 变化。

### 3. Runner 与跨模块合同测试

- main/subagent/scheduled 使用同一 fake `SafetyDecisionEngine` 记录阶段调用。
- 子 Agent 范围内的 destructive tool 仍进入 Destructive。
- trust evidence 无法放行 HardBlock。
- run 和 continue 对同一上下文保持 provider identity 与规则序列。
- required audit 失败时 fake tool 的 execute 计数保持零。

### 4. 宿主与协议测试

- CLI interactive consent 经 `ApprovalManager` 完成。
- Web approval inbox 的 request/resolve/cancel wire 保持兼容。
- 新增 `approval.evaluated` 前端消费时，Python/TS fixture 同步。
- scheduled trust 和 fail_closed 的事件字段与既有产品语义一致。

### 5. 薄 smoke/e2e

至少覆盖三条真实内部链：

1. Web generic_chat → main Agent → destructive tool → approval inbox → allow → required audit → execute。
2. parent Agent → spawn child → 范围内读取通过 → 范围外写入拒绝 → workflow ledger 可关联。
3. scheduled trust task → HardBlock 工具拒绝；允许工具 auto-allow → scheduler ledger 可关联。

外部 LLM 可以使用 fake，FastAPI 路由、Manager、EventSink、运行状态和本地 ledger 使用真实实现。

## 验证策略判断

| 验证层 | 为什么需要 | 判断依据 | 缺失后果 |
|---|---|---|---|
| 单元与属性测试 | scope 单调性和规则顺序可被穷举或生成式覆盖 | 运行时安全依赖集合求交与阶段短路 | 少量示例全过仍可能遗漏路径、预算或期限组合 |
| Manager/状态机测试 | context、pending、撤销和 run state 由 Manager 持有 | 成功、失败、回滚和并发都改变可变状态 | 纯函数单测无法证明内存、磁盘和运行状态一致 |
| Runner 合同测试 | P0 发生在真实 provider 注入与执行边界 | 单个 provider 单测无法证明生产调用链使用它 | 分支仍可能在装配层绕过完整规则链 |
| 宿主与协议测试 | consent 和事件要经过 CLI/Web/scheduler 真实入口 | 用户可见审批依赖 route、wire 和 inbox | 内核正确时宿主路径仍可能漏 resolve 或字段漂移 |
| smoke/e2e | 证明 UI/API、Manager、Runner、audit 和 tool 的先后关系 | required ack 与执行时序跨越多个模块 | 分层测试无法独立证明完整安全路径 |
| mypy/ruff/lint-imports | Protocol 分离、显式类型和依赖方向属于静态合同 | Python 运行时不会验证 override、Protocol 注入与 import 边界 | pytest 全过仍可能保留可再次利用的行为注入槽 |

## 静态与架构验证

实现任务的验证清单至少包含：

- `uv run ruff check` 覆盖修改文件。
- `uv run mypy` 覆盖合同、safety、runtime_assembly、application 和 scheduler 修改文件。
- `uv run lint-imports` 验证 core、safety 和 application 依赖方向。
- 静态扫描生产代码中的 `run_approval`、`approval=` provider 注入、`SubAgentApprovalProvider`、`ScheduleApprovalProvider` 和 `_write_audit`。
- 人工审查 `ApprovalProvider` 与 `ConsentPrompt` 的签名分离。
- 人工审查所有 final approved 路径都等待 required audit acknowledgment。

运行时测试、静态类型、架构边界和人工合同审查分别提供独立证据。

## 技术验证点

### POC-01 · 必达审计 acknowledgment

T4 开始时先在测试文件中验证单 writer queue 的确认语义：

- publish approved 后，writer 完成 flush 才 resolve acknowledgment。
- writer 抛错时 publish 抛出类型化错误。
- caller 收到错误时 tool executor 尚未启动。
- shutdown 能 drain 已接收的 required 记录。

该验证进入正式测试目录并保留为回归测试，不创建一次性脚本。

### POC-02 · 类型封口

T1 在正式 mypy 测试配置中验证 `ConsentPrompt` 实现无法传给需要 `ApprovalProvider` 的函数。此项依靠静态检查，不用运行时遍历 Protocol。

## 迁移阶段

| 阶段 | 内容 | 退出条件 |
|---|---|---|
| E1 合同与单入口 | M1-M3，切断 run 级 provider 覆盖 | D1、D2、D3、D7 |
| E2 分支上下文 | M4、M5，迁移子 Agent 和 scheduled | D4、D5、D6、D8 |
| E3 审计单写点 | M6，迁移 workflow/scheduler/trace 投影 | D9、D10 |
| E4 门禁与文档 | 全层验证、module README、旧 spec | D11、D12 |

E1 与 E2 作为同一安全发布批次交付。E1 的新入口和 E2 的全部生产调用方同时进入主线，避免形成缺少分支上下文的中间发布。

迁移图见 [图表 D5](./diagrams.md#d5-迁移与发布门禁)。

## 风险与控制

| 风险 | 影响 | 控制 |
|---|---|---|
| context 合同改动调用面大 | run、continue、spawn、scheduler 同时受影响 | 先做调用点清单；E1+E2 单批发布；mypy 封口 |
| scope 标准化与文件 wrapper 语义漂移 | 审批通过后执行层拒绝，或路径判定不一致 | 共用规范化 helper；保留 execution-time 复核；双层一致性测试 |
| required audit 增加延迟 | 高频工具调用等待持久化确认 | 单 writer queue、批量 flush 策略基准、只对安全账本 required |
| audit queue 背压 | run 延迟或内存增长 | 有界队列、明确超时、fail-closed 和容量指标 |
| continue 恢复旧 context | 规则快照和 evidence 已失效 | context version、revocation epoch、未知版本 fail-closed |
| 同一事件被多个 owner 重复写入 | workflow/scheduler 审计重复 | 唯一 evaluation id、ApprovalAuditManager 单发布、sink 幂等 |
| ApprovalManager 职责继续扩张 | pending 生命周期与规则顺序重新耦合 | 公开方法只围绕 consent lifecycle；SafetyDecisionEngine 持有规则序列 |

## 可观测指标

- `approval_decision_total{run_kind,decision,stage}`。
- `approval_decision_duration_ms{run_kind}`。
- `approval_scope_reject_total{constraint_kind}`。
- `approval_grant_invalid_total{reason_code}`。
- `approval_audit_queue_depth{sink}`。
- `approval_audit_ack_duration_ms{sink}`。
- `approval_audit_failure_total{sink,failure_mode}`。
- `approval_event_duplicate_total{sink}`。

指标名称可在 x-req 中与现有 telemetry 命名对齐，语义和标签基数约束保持以上定义。

## 演进边界

- 新运行分支通过构造 `ApprovalRunContext` 接入，无需新增最终 provider。
- 新 scope 维度通过 `ApprovalConstraint` 扩展，并同步求交和序列化合同。
- 新 consent 宿主通过 `ConsentPrompt` adapter 接入。
- 新审计消费者通过 EventSink binding 接入。
- 跨进程审批和分布式 grant store 需要独立 spec，因为它们引入一致性、身份认证和重放防护问题。
