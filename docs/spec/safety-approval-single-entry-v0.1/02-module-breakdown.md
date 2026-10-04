# 02 · 模块拆分

## 模块总览

| 编号 | 模块 | 来源能力 | 门户或公开边界 | 状态 | 风险 | 主要产出 |
|---|---|---|---|---|---|---|
| M1 | 核心审批合同 | C1 | `ApprovalProvider`、`ConsentPrompt` | 可进入 x-req | 高 | 最终决策协议、运行上下文、scope、evidence、evaluation |
| M2 | 安全决策 | C2、C6 | `SafetyDecisionEngine`、`SafetyGatedApproval` | 可进入 x-req | 高 | 六阶段规则链、最终决定、consent 调度 |
| M3 | 运行时装配 | C3、C7 | `SessionEngine` | 可进入 x-req | 高 | 单 provider 持有、首次/继续运行上下文入口 |
| M4 | Agent 授权上下文 | C4、C7 | `AgentManager`、`SubAgentManager` | 可进入 x-req | 高 | 父子 scope 派生、grant evidence 构造 |
| M5 | 定时任务授权上下文 | C5、C7 | `SchedulerManager` | 可进入 x-req | 中 | task approval mode 到通用上下文的映射 |
| M6 | 审批审计投影 | C6 | `ApprovalAuditManager` | 方案确认 | 高 | 终态事件单写点、必达和尽力投影 |

目标依赖图见 [图表 D2](./diagrams.md#d2-目标模块依赖)。

## 聚合与边界判断

| 模块 | 聚合依据 | 边界依据 | 缺少该边界的后果 |
|---|---|---|---|
| M1 | C1 的协议和值对象需要成为所有层共享真源 | core contracts 承担宿主无关、零 sibling 依赖的合同职责 | application/scheduler 类型进入 Runner 合同，类型封口失效 |
| M2 | C2 的规则排序与 C6 的 evaluation 生成共享同一安全语义 | safety 持有 policy，`SafetyGatedApproval` 是完整决策 facade | 分支继续按 wrapper 自行排列规则 |
| M3 | C3 与 C7 都依赖 runtime build/run 生命周期 | `SessionEngine` 已是 composition root 和 Runner 门户 | 最终 provider identity 分散到调用方 |
| M4 | C4 依赖 agent tree、grant 和 cell 生命周期 | `AgentManager`/`SubAgentManager` 是本域既有门户 | safety 反向依赖 application，scope 派生 owner 模糊 |
| M5 | C5 依赖 task 配置、默认 mode 和运行窗口 | `SchedulerManager` 是 scheduler 对外门户 | task 语义渗入 safety，scheduled 继续拥有独立 provider |
| M6 | C6 需要协调 EventSink 等级、ack 与 writer 生命周期 | 独立 `ApprovalAuditManager` 负责审批事实发布，sink 保留各域存储 owner | policy 直接 I/O，多份审计产生不同终态 |

高风险模块涉及最终授权、破坏性签名变更或必达持久化；中风险模块主要迁移既有 mode 映射。风险控制与验证见 [验证与演进](./05-validation-and-evolution.md)。

## M1 · 核心审批合同

### 职责

- 保留 Runner 唯一调用协议 `ApprovalProvider`。
- 新增叶子交互协议 `ConsentPrompt`，隔离完整安全决策与人工/自动回答。
- 定义 frozen 的 `ApprovalRunContext`、`ApprovalScope`、`ApprovalConstraint`、`GrantEvidence` 和 `ApprovalEvaluation`。
- 定义有限状态枚举，禁止分支使用裸字符串表达运行类型、决策阶段和审计等级。

### 公开边界

| 类型 | 公开方法或语义 |
|---|---|
| `ApprovalProvider` | `decide(request, context) -> ApprovalDecision`，完整最终决策 |
| `ConsentPrompt` | `prompt(request, context, evaluations) -> ConsentResponse`，只回答 Consent 阶段 |
| `ApprovalRunContext` | 描述 run kind、agent/workflow/task 身份、scope、evidence 和 consent policy |
| `ApprovalScope` | 描述允许的工具、路径、资源与预算上限 |
| `ApprovalEvaluation` | 描述单个阶段的结果、理由与证据引用 |

### 文件边界

- `repo:src/core/contracts/approval.py`：协议、请求和最终决定。
- `repo:src/core/contracts/approval_context.py`：运行上下文、scope、evidence 和枚举。
- `repo:src/core/contracts/__init__.py`：只重导出稳定公共合同。

### 允许依赖

只依赖标准库和 `core.contracts` 内部值类型。任何 safety、application、scheduler、host 类型都不能进入合同。

### 不变量

- `ConsentPrompt` 无法赋值给 `ApprovalProvider`。
- `ApprovalRunContext` 创建后不可变。
- scope 与 evidence 使用显式联合类型，开放 wire payload 保留在宿主协议层。

## M2 · 安全决策

### 职责

- `SafetyDecisionEngine` 维护唯一规则顺序。
- `SafetyGatedApproval` 实现 `ApprovalProvider`，驱动规则、consent 和审计。
- `RuntimeScopeGuard` 计算父 scope 与当前 scope 的有效交集。
- Trust 阶段校验 grant evidence 的签发者、目标、工具、资源、期限和父授权关联。

### 公开边界

| 类型 | 公开方法或语义 |
|---|---|
| `SafetyDecisionEngine` | `evaluate(request, context) -> ApprovalEvaluationBundle`，纯计算规则链 |
| `SafetyGatedApproval` | `decide(request, context) -> ApprovalDecision`，最终 provider |
| `RuntimeScopeGuard` | `evaluate(request, effective_scope) -> ApprovalEvaluation`，只能 continue 或 deny |

### 内部实现

- HardBlock、Boundary、Destructive、Trust 继续作为 safety 内部规则。
- Consent adapter 通过 `ConsentPrompt` 注入。
- `ApprovalEvaluationBundle` 收集阶段事实，供最终事件和测试断言。
- `SafetyGatedApproval` 在 approved 工具返回前等待必达审计确认。

### 文件边界

- `repo:src/safety/approval/decision_engine.py`：纯规则编排。
- `repo:src/safety/approval/chain.py`：最终 provider facade。
- `repo:src/safety/approval/scope_guard.py`：scope 求交与判断。
- `repo:src/safety/approval/consent.py`：`ConsentPrompt` adapters。
- `repo:src/safety/approval/grant_evidence.py`：evidence 校验。

### 依赖方向

M2 只依赖 M1 合同和 safety 模块内部实现。M2 通过构造参数接收 `ConsentPrompt`、EventSink 与 `ApprovalAuditManager`，不导入 application 或 scheduler。

## M3 · 运行时装配

### 职责

- `SessionEngine.build()` 创建唯一 `SafetyGatedApproval`。
- `SessionEngine.run()` 接收 frozen `ApprovalRunContext`，调用 Runner 时传入自身 provider。
- continue 路径恢复原 run context，并复用自身 provider。
- 阻止 application 和 scheduler 把任意 provider 注入 Runner。

### 公开边界

| 方法 | 新合同 |
|---|---|
| `SessionEngine.run(...)` | 增加必需或显式默认的 `approval_context: ApprovalRunContext`，删除 `approval` |
| `SessionEngine.continue_from_last_user_message(...)` | 从运行状态取得或校验 `ApprovalRunContext`，复用 `self._approval` |
| `Runner.run(...)` | 接受最终 provider 和本次 context；provider 来源固定为 SessionEngine |

### 状态归属

- `SessionEngine._approval`：当前 runtime 的唯一最终 provider。
- run state：保存 `ApprovalRunContext` 的不可变快照或可验证引用。
- Runner：只消费，不拥有或修改审批配置。

### 文件边界

- `repo:src/runtime_assembly/session_engine.py`
- `repo:src/core/runner.py`
- run state 所在的既有 session/application 状态文件。

### 验收边界

生产代码中不再出现 `runtime.run(..., approval=...)`。首次 run 和 continue 对同一请求生成相同阶段序列。

## M4 · Agent 授权上下文

### 职责

- `SubAgentManager` 根据父 `ApprovalRunContext` 和 `SubAgentGrant` 构造子 context。
- `AgentManager` 将子 context 固定到 `AgentCell` 的 run state。
- spawn 请求传递声明式 grant/scope，不传行为对象。
- 文件工具 wrapper 保留执行前路径复核，形成纵深防御。

### 公开边界

| 门户 | 公开方法或语义 |
|---|---|
| `SubAgentManager` | `derive_approval_context(parent, grant, child_identity) -> ApprovalRunContext` |
| `AgentManager` | spawn 和 mailbox 运行时只读取 cell 的 context |
| `SpawnAgentRequest` | 携带 `SubAgentGrant` 或已派生 context，不含 provider |
| `AgentCell` | 持有 `approval_context`，不持有 `run_approval` |

### scope 派生规则

- 工具集合：`child = parent ∩ grant.allowed_tools`。
- 路径集合：子根目录必须位于父允许根目录内。
- 资源预算：子上限取父剩余额度与 grant 上限的较小值。
- 时间：子 evidence 过期时间不能晚于父 evidence。
- 委派深度：子深度上限小于父剩余深度。

### 文件边界

- `repo:src/application/subagents/manager.py`
- `repo:src/application/subagents/permissions.py`
- `repo:src/application/agents/subagent_tools.py`
- `repo:src/application/agents/cell.py`
- `repo:src/application/agents/manager.py`
- `repo:src/hosts/shared/host_dispatcher.py`

### 移除项

- `SubAgentApprovalProvider`。
- `SpawnAgentRequest.approval`。
- `AgentCell.run_approval`。
- `SubAgentApprovalProvider._write_audit()`。

## M5 · 定时任务授权上下文

### 职责

- `SchedulerManager` 将 task 级 `approval_mode` 转为通用 consent policy 和 grant evidence。
- scheduled run 复用 M2 全局规则。
- trust 模式表达“用户预批准该任务范围”，仍执行 HardBlock、scope、Boundary 与 Destructive。
- fail_closed 模式在 Consent 阶段缺少交互通道时拒绝。

### 公开边界

| 门户 | 公开方法或语义 |
|---|---|
| `SchedulerManager` | `build_approval_context(task, run_identity) -> ApprovalRunContext` |
| scheduled execution bridge | 只把 context 交给 runtime，不构造 provider |

### 文件边界

- `repo:src/scheduler/manager.py`
- `repo:src/scheduler/safety_wrapper.py`
- `repo:src/application/scheduled_runs/execution_bridge.py`

### 移除项

- `ScheduleApprovalProvider` 的最终 wrapper 角色。
- scheduled execution bridge 对 provider 的选择和注入。
- wrapper 内部直接 audit 写入。

现有 task 级 `trust` / `fail_closed` 产品语义保持稳定，内部实现迁移到通用上下文。

## M6 · 审批审计投影

### 职责

- `ApprovalAuditManager` 接收完整 evaluation bundle 和 final decision。
- 构造唯一 `approval.evaluated` 事件。
- 先等待 required sinks 的持久化确认，再向 best-effort sinks 投影。
- 对本地 JSONL 使用单 writer 队列，保证同一 ledger 内记录串行。
- 规则类、scope guard 和 consent adapter 不直接写文件。

### 公开边界

| 类型 | 公开方法或语义 |
|---|---|
| `ApprovalAuditManager` | `publish(evaluation, decision) -> None` |
| `ApprovalAuditSinkBinding` | 将既有 EventSink 与 `REQUIRED` 或 `BEST_EFFORT` 等级绑定 |
| `ApprovalAuditFailureMode` | `FAIL_CLOSED`、`BEST_EFFORT` |

### 持久化策略

- 子 Agent grant 账本和 scheduled auto-allow 账本：`FAIL_CLOSED`。
- 通用 trace、UI 广播和调试副本：`BEST_EFFORT`。
- rejected/cancelled 的 required sink 失败会返回原拒绝终态并附加审计故障；approved 的 required sink 失败会转为 rejected，工具不执行。

### 文件边界

- `repo:src/safety/approval/audit_manager.py`
- `repo:src/application/agent_workflows/manager.py` 的 workflow EventSink 投影。
- `repo:src/application/scheduled_runs/` 的 scheduler EventSink 投影。
- `repo:src/infrastructure/tracing/` 的 best-effort 投影。

### 依赖方向

M6 依赖 M1 合同和 EventSink 合同。application 与 scheduler 提供 EventSink adapter 并由 composition root 注入；safety 不反向 import 它们。

## 跨模块 import 规则

| 调用方 | 允许依赖 | 禁止依赖 |
|---|---|---|
| core | core contracts | safety、application、scheduler、runtime_assembly |
| safety | core contracts、safety 内部 | application、scheduler、hosts |
| runtime_assembly | core contracts、safety 门户 | application 内部 helper |
| application agents/subagents | core contracts、本域 Manager | safety 内部 rule、scheduler 内部实现 |
| scheduler | core contracts、SchedulerManager 内部 | safety 内部 rule |
| audit sinks | EventSink、各自模块状态门户 | safety 内部 evaluation helper |

## 模块验收同步项

实现阶段需要同步更新：

- `repo:docs/modules/安全/README.md`：三个 owner 与六阶段顺序。
- `repo:docs/modules/执行器/README.md`：SessionEngine 单 provider 和 run context。
- `repo:docs/modules/应用/README.md`：子 Agent scope 派生和 provider 移除。
- `repo:docs/modules/定时任务/README.md`：approval mode 到 context 的映射。
- `repo:docs/architecture/approval.md`：权威导航和事件流。
