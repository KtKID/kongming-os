# 03 · 核心流程

## W1 · 主 Agent 工具审批

1. `SessionEngine.build()` 创建 `SafetyDecisionEngine`、`ConsentPrompt`、`ApprovalAuditManager` 和唯一 `SafetyGatedApproval`。
2. 主 Agent run 创建 `ApprovalRunContext(kind=MAIN_AGENT)`，scope 来自 workspace、capability policy 和用户配置快照。
3. Runner 收到 LLM tool call，构造 `ApprovalRequest`。
4. Runner 调用 `SafetyGatedApproval.decide(request, context)`。
5. `SafetyDecisionEngine` 按固定顺序生成每个阶段的 `ApprovalEvaluation`。
6. 规则链在某阶段 deny 时立即形成 rejected；阶段 continue 时进入下一阶段；Trust 已充分授权时形成 approved；需要用户判断时进入 Consent。
7. Consent 阶段通过 `ConsentPrompt` 请求 `ApprovalManager` 或宿主 adapter。
8. `ApprovalAuditManager` 生成一次 `approval.evaluated`，先确认 required sinks，再投影 best-effort sinks。
9. Runner 在 approved 且必达审计成功后执行工具。

对应流程图见 [图表 D3](./diagrams.md#d3-统一决策时序)。

## W2 · 子 Agent scope 派生

### 派生阶段

1. 父 Agent 发起 spawn，并提交声明式 `SubAgentGrant`。
2. `SubAgentManager` 读取父 `ApprovalRunContext`。
3. manager 对 allowed tools、路径、资源预算、有效期和委派深度分别执行收紧计算。
4. grant 超过父权限时，spawn 在派生阶段失败并记录结构化原因。
5. grant 合法时，manager 创建 `GrantEvidence` 和 frozen 子 `ApprovalRunContext(kind=SUBAGENT)`。
6. `AgentManager` 将子 context 固定到 `AgentCell`，mailbox 运行只传 context。

### 工具调用阶段

1. 子 Agent Runner 调用同一 `SafetyGatedApproval`。
2. HardBlock 先判断工具的永久禁止规则。
3. RuntimeScope 验证 tool、path、resource 和 budget 是否位于子 scope。
4. scope 超界时形成 rejected；scope 通过时继续 Boundary、Destructive 和 Trust。
5. Trust 校验 `GrantEvidence` 的目标 child、父 run、工具范围、资源范围、有效期和撤销状态。
6. evidence 覆盖当前动作时，Trust 可以给出 approved；evidence 覆盖不足时继续 Consent 或按当前策略拒绝。
7. `ApprovalAuditManager` 以 required 等级写入 workflow 安全账本。
8. 文件工具自身的 path wrapper 在 execution-time 再次校验实际解析路径。

### 关键性质

- scope 通过表达“该动作具备继续评估资格”。
- grant evidence 表达“父级或用户曾授予指定范围”。
- 最终 approved 由完整规则链产生。
- 父 context、grant 和 child context 的关联字段进入同一个终态事件。

## W3 · 定时任务审批

### trust 模式

1. `SchedulerManager` 读取 task 自身 `approval_mode=trust` 或 scheduler 默认值。
2. manager 依据 task id、任务定义摘要、允许能力和有效 run window 创建 `GrantEvidence`。
3. scheduled execution bridge 把 `ApprovalRunContext(kind=SCHEDULED)` 交给 `SessionEngine.run()`。
4. HardBlock、RuntimeScope、Boundary 和 Destructive 照常执行。
5. Trust 校验 task evidence；覆盖当前动作时产生 approved。
6. `ApprovalAuditManager` 必达写入 scheduled auto-allow 安全账本，并将相同事件投影到 trace。

### fail_closed 模式

1. manager 创建 `ConsentPolicy=FAIL_CLOSED` 的 context，不创建自动放行 evidence。
2. 全局规则运行到 Consent 阶段时，`FailClosedConsentPrompt` 返回 denied。
3. 终态事件记录 task mode、阶段 evaluations 和拒绝原因。

task 级 approval mode 的产品默认值和 HardBlock 语义保持现行合同。

## W4 · continue 与恢复

1. 首次 run 把 `ApprovalRunContext` 快照和 run identity 一起保存到运行状态。
2. continue 请求定位原 run state。
3. `SessionEngine.continue_from_last_user_message()` 校验 context 的配置版本、scope identity 和 evidence 有效期。
4. 已过期或已撤销 evidence 触发重新派生或 fail-closed。
5. continue 始终调用 `self._approval`，并向 Runner 传入校验后的原 context。
6. 新工具调用产生新的 `approval.evaluated`，事件坐标沿用原 session/run 语义。

恢复流程需要覆盖进程内 continue 和持久化 session 恢复。持久化恢复无法解析旧 context 版本时，运行进入明确的 approval-context-invalid 终态。

## W5 · Consent 生命周期

1. `SafetyDecisionEngine` 返回 `REQUIRES_CONSENT` evaluation。
2. `SafetyGatedApproval` 调用 `ConsentPrompt.prompt(...)`。
3. interactive adapter 把请求交给 `ApprovalManager`。
4. `ApprovalManager` 创建 pending approval，广播 inbox 事件并等待 resolve/cancel/timeout。
5. resolve 生成 allow 或 deny response；cancel、timeout 和 host shutdown 生成明确终态。
6. response 回到 `SafetyGatedApproval`，形成最终 decision。
7. `ApprovalAuditManager` 统一发布终态事件。

`ApprovalManager` 不重跑 HardBlock、scope、Boundary、Destructive 或 Trust。它持有 pending lifecycle 状态，规则顺序由 `SafetyDecisionEngine` 持有。

## W6 · 审批审计发布

### approved

1. `SafetyGatedApproval` 收集 evaluation bundle 和 approved decision。
2. `ApprovalAuditManager` 为事件计算稳定 identity：`session_id + run_id + tool_call_id + evaluation_version`。
3. required sinks 入队并返回持久化确认。
4. 任一 required sink 失败时，manager 抛出类型化 `ApprovalAuditError`。
5. `SafetyGatedApproval` 将该结果收敛为 rejected，Runner 不执行工具。
6. required sinks 成功后，best-effort sinks 接收同一事件；其故障产生独立 observability error。

### rejected 或 cancelled

1. manager 尝试写入 required sinks。
2. required sink 故障保留原拒绝终态，并在 Result metadata 与可用 sinks 中记录 audit failure。
3. 工具保持未执行状态。

### 串行写入

- 每个本地 ledger 使用一个有界 asyncio queue 和一个 writer task。
- writer 按入队顺序写入 JSONL，单条记录一次编码并追加。
- required 写入等待对应 acknowledgment；best-effort 写入只等待成功入队。
- shutdown 先停止接收，再 drain required 记录，最后关闭文件资源。
- queue 满、磁盘满、权限错误和 writer task 异常均转换为类型化故障事件。

## W7 · 撤销与过期

1. grant store 或 run state 标记 evidence 已撤销，或当前时间超过 `expires_at`。
2. Trust 阶段每次调用都验证当前状态，缓存必须带版本或撤销 epoch。
3. 失效 evidence 无法产生 approved，后续行为由 consent policy 决定。
4. 子 Agent 已启动的 run 保留 context identity，后续 tool call 立即感知撤销状态。
5. 撤销动作和首次受影响的审批事件都记录 evidence id。

## W8 · 错误收口

| 错误 | owner | 结果 |
|---|---|---|
| scope 派生越权 | `SubAgentManager` | spawn rejected |
| approval context 缺失或版本无效 | `SessionEngine` | 首次/继续运行 rejected |
| HardBlock 命中 | `SafetyDecisionEngine` | tool rejected |
| consent timeout/cancel | `ApprovalManager` | tool cancelled 或 rejected |
| required audit 写入失败 | `ApprovalAuditManager` | approved 转 rejected；已拒绝动作保持拒绝 |
| best-effort audit 失败 | 对应 sink + observability | 决定保持，记录投影错误 |
| execution-time path wrapper 失败 | tool adapter | tool execution rejected，并写 tool result |
