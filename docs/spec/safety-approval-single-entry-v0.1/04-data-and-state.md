# 04 · 数据与状态

## 数据设计原则

- 跨模块审批配置和身份快照使用 frozen dataclass。
- pending consent、writer queue、撤销表和运行状态使用显式可变状态类。
- 有限取值使用 `StrEnum`。
- scope 与 evidence 使用具体联合类型。
- 事件中的扩展 metadata 保持在 Event wire 层，核心审批合同不引入开放 `Any`。

## 枚举

```python
class ApprovalRunKind(StrEnum):
    MAIN_AGENT = "main_agent"          # 主 Agent 运行
    SUBAGENT = "subagent"              # 子 Agent 运行
    SCHEDULED = "scheduled"            # 定时任务运行


class ApprovalStage(StrEnum):
    HARD_BLOCK = "hard_block"          # 永久禁止规则
    RUNTIME_SCOPE = "runtime_scope"    # 分支运行范围
    BOUNDARY = "boundary"              # 工作区与资源边界
    DESTRUCTIVE = "destructive"        # 破坏性动作级别
    TRUST = "trust"                    # 信任和授权证据
    CONSENT = "consent"                # 显式同意


class ApprovalStageOutcome(StrEnum):
    CONTINUE = "continue"              # 允许进入下一规则阶段
    APPROVE = "approve"                # 当前规则足以形成最终批准
    REJECT = "reject"                  # 当前规则形成最终拒绝
    REQUIRE_CONSENT = "require_consent"  # 进入 consent 叶子策略


class ConsentPolicy(StrEnum):
    INTERACTIVE = "interactive"        # 通过 ApprovalManager 等待用户决定
    AUTO_ALLOW = "auto_allow"          # consent 阶段自动同意
    FAIL_CLOSED = "fail_closed"        # consent 阶段直接拒绝


class ApprovalAuditFailureMode(StrEnum):
    FAIL_CLOSED = "fail_closed"        # 持久化失败阻止工具执行
    BEST_EFFORT = "best_effort"        # 投影失败只报告观测故障
```

`AUTO_ALLOW` 只影响 Consent 阶段。HardBlock、RuntimeScope、Boundary、Destructive 和 Trust 始终先执行。

## 约束值对象

```python
@dataclass(frozen=True)
class ToolConstraint:
    allowed_tool_names: frozenset[str]  # 当前上下文允许调用的工具名集合


@dataclass(frozen=True)
class PathConstraint:
    allowed_roots: tuple[Path, ...]     # 解析后的允许根目录，按宿主路径语义比较
    allow_missing_leaf: bool            # 目标叶节点尚未创建时是否允许校验父路径


@dataclass(frozen=True)
class ResourceConstraint:
    resource_kinds: frozenset[str]      # 允许访问的资源种类开放集合
    resource_ids: frozenset[str]        # 允许访问的具体资源标识开放集合


@dataclass(frozen=True)
class BudgetConstraint:
    max_tool_calls: int | None          # 当前 run 可执行的最大工具调用数
    max_cost_units: int | None          # 当前 run 可消费的抽象成本上限


@dataclass(frozen=True)
class DelegationConstraint:
    max_child_depth: int                # 当前上下文剩余的最大子 Agent 深度
    allow_further_delegation: bool      # 当前 Agent 是否可以继续派生子 Agent
```

合同中的 `ApprovalConstraint` 是以上 frozen 类型的封闭联合。新增约束类型需要同步更新 scope 求交、序列化、事件摘要和合同测试。

## ApprovalScope

```python
@dataclass(frozen=True)
class ApprovalScope:
    scope_id: str                               # scope 的稳定标识
    parent_scope_id: str | None                 # 父 scope 标识，主 Agent 为空
    constraints: tuple[ApprovalConstraint, ...] # 当前上下文的全部约束
    issued_at: datetime                         # scope 创建时间，使用 UTC
    expires_at: datetime | None                 # scope 失效时间，空值表示跟随 run 生命周期
    version: int                                # scope 合同版本
```

有效 scope 由父 scope 与子声明逐类求交产生。实现需要保留标准化后的 constraints，避免每次工具调用重新解析不可信原始配置。

## GrantEvidence

```python
@dataclass(frozen=True)
class GrantEvidence:
    evidence_id: str                    # 授权证据稳定标识
    grant_kind: str                     # 授权种类开放值，例如 subagent_grant、scheduled_task
    issuer_run_id: str                  # 签发授权的父 run 或用户授权 run
    subject_id: str                     # 被授权的 child agent 或 scheduled task 标识
    scope_id: str                       # 证据覆盖的标准化 scope
    capability_names: frozenset[str]    # 被预授权的 capability 集合
    issued_at: datetime                 # 签发时间，使用 UTC
    expires_at: datetime | None         # 失效时间
    revocation_epoch: int               # 撤销版本，用于缓存校验
    source_digest: str                  # 原授权声明的稳定摘要
```

Trust 阶段需要同时匹配 subject、scope、capability、有效期和 revocation epoch。字符串 `grant_kind` 与 capability 名称属于持续扩展集合，保留开放值。

## ApprovalRunContext

```python
@dataclass(frozen=True)
class ApprovalRunContext:
    context_id: str                         # 本次审批上下文稳定标识
    run_kind: ApprovalRunKind               # 主 Agent、子 Agent 或定时任务
    session_id: str                         # Session 标识
    run_id: str                             # Run 标识
    agent_id: str                           # 当前 Agent 标识
    parent_agent_id: str | None             # 父 Agent 标识
    workflow_run_id: str | None             # Workflow run 标识
    scheduled_task_id: str | None           # 定时任务标识
    scope: ApprovalScope                    # 标准化有效 scope
    grant_evidence: tuple[GrantEvidence, ...] # Trust 可消费的授权证据
    consent_policy: ConsentPolicy           # Consent 阶段策略
    safety_config_version: str              # 安全配置快照版本
    created_at: datetime                    # 上下文创建时间，使用 UTC
```

`ApprovalRunContext` 由各分支 Manager 构造，`SessionEngine` 负责入口校验和状态保存，Runner 只读消费。

## ApprovalEvaluation

```python
@dataclass(frozen=True)
class ApprovalEvaluation:
    stage: ApprovalStage                    # 当前规则阶段
    outcome: ApprovalStageOutcome           # continue、approve、reject 或 require_consent
    reason_code: str                        # 稳定机器可读原因码
    reason: str                             # 面向审计和调试的说明
    policy_version: str                     # 产生该判断的策略版本
    evidence_ids: tuple[str, ...]            # 本阶段消费或拒绝的证据标识
    constraint_ids: tuple[str, ...]          # 本阶段命中的约束标识
```

```python
@dataclass(frozen=True)
class ApprovalEvaluationBundle:
    request_id: str                         # ApprovalRequest 稳定标识
    context_id: str                         # ApprovalRunContext 标识
    evaluations: tuple[ApprovalEvaluation, ...] # 按实际执行顺序排列的阶段事实
    final_decision: ApprovalDecision        # 完整规则链的最终决定
```

规则函数返回 evaluation，不持有 audit writer，也不修改运行上下文。

## ConsentPrompt

```python
class ConsentPrompt(Protocol):
    async def prompt(
        self,
        request: ApprovalRequest,                   # 需要显式同意的工具请求
        context: ApprovalRunContext,                # 当前 run 的不可变审批上下文
        evaluations: tuple[ApprovalEvaluation, ...], # Consent 之前已完成的阶段事实
    ) -> ConsentResponse:                           # 用户、宿主或策略给出的 consent 响应
        ...
```

实现包括：

- `ApprovalManagerConsentPrompt`：委托现有 `ApprovalManager` 管理 pending 生命周期。
- `AutoAllowConsentPrompt`：仅在 Consent 阶段返回 allow。
- `FailClosedConsentPrompt`：仅在 Consent 阶段返回 deny。
- 宿主 adapter：把 Web/CLI 交互映射到 `ApprovalManager`。

## 终态审批事件

事件 kind 使用开放扩展值 `approval.evaluated`，payload 采用稳定字段：

```python
@dataclass(frozen=True)
class ApprovalEvaluatedPayload:
    evaluation_id: str                     # 幂等标识，由关键坐标和版本生成
    session_id: str                        # Session 标识
    run_id: str                            # Run 标识
    tool_call_id: str                      # LLM tool call 标识
    tool_name: str                         # 工具名称
    agent_id: str                          # 当前 Agent 标识
    parent_agent_id: str | None            # 父 Agent 标识
    workflow_run_id: str | None            # Workflow run 标识
    scheduled_task_id: str | None          # 定时任务标识
    context_id: str                        # 审批上下文标识
    scope_id: str                          # 有效 scope 标识
    evidence_ids: tuple[str, ...]           # 本次关联的授权证据
    stages: tuple[ApprovalEvaluation, ...]  # 实际执行的阶段事实
    decision: ApprovalDecision             # approved、rejected 或 cancelled
    audit_version: int                     # 审批事件合同版本
    decided_at: datetime                   # 最终判定时间，使用 UTC
```

wire 层通过现有 Event 载体编码该 payload。Web 需要消费该事件时，Python 与 TypeScript 协议按双侧真源规则同步。

## 状态归属

| 状态 | owner | 生命周期 | 持久化 |
|---|---|---|---|
| 全局安全配置快照 | `SessionEngine` | runtime | 配置源 + version |
| 最终 provider | `SessionEngine` | runtime | 不持久化，build 时重建 |
| ApprovalRunContext | run state | 首次/继续运行 | 随 run 状态保存 |
| scope 标准化结果 | context | run | 随 context 保存 |
| grant evidence | grant store / context snapshot | grant + run | 必达安全账本 |
| evidence 撤销 epoch | grant store | 跨 run | 持久化 |
| pending consent | `ApprovalManager` | request 到 resolve/cancel | 按现有 inbox 合同 |
| evaluation bundle | `SafetyGatedApproval` 局部值 | 单 tool call | 终态事件持久化 |
| audit sink bindings | `ApprovalAuditManager` | runtime | 配置源 |
| JSONL writer queue | sink adapter | runtime | queue 自身不持久化 |

## 数据归属判断

| 数据 | 为什么由该 owner 持有 | 判断依据 | owner 缺失或错误的后果 |
|---|---|---|---|
| `ApprovalRunContext` | run state 能覆盖首次运行、continue 和恢复 | context 与 run identity 同生共存，创建后语义稳定 | context 由 provider 或 host 临时持有时，恢复路径会丢失安全边界 |
| `ApprovalScope` | 分支 Manager 具备父级权限和本域 grant 信息 | scope 派生依赖 agent tree 或 scheduler task 语义 | safety 自行猜测分支数据会形成反向依赖和隐式权限 |
| `GrantEvidence` | grant store 管理签发、撤销和版本 | evidence 跨 tool call，并可能跨 run 生效 | 只保存在 provider 内存时无法可靠撤销和审计 |
| pending consent | `ApprovalManager` 管理 inbox 和并发等待者 | request/resolve/cancel/timeout 属于同一生命周期 | 多宿主分别持有 Future 会产生重复解决和遗留 pending |
| evaluation bundle | `SafetyGatedApproval` 在单次 decide 内聚合 | bundle 是完整规则链的瞬时结果 | 规则各自写事件会丢失统一阶段顺序和最终 identity |
| 审计 sink 等级 | `ApprovalAuditManager` 协调 required/best-effort | 工具执行前需要统一判断必达确认 | sink 自行决定失败语义会让相同决定在不同分支表现不同 |
| JSONL queue | 具体 sink adapter 管理 writer 生命周期 | 文件句柄、顺序和 flush 属于存储实现细节 | safety 持有文件队列会破坏模块边界并阻塞规则演进 |

## 一致性规则

### identity

- `evaluation_id` 对同一 `run_id + tool_call_id + audit_version` 稳定。
- required sink 重试使用相同 evaluation id。
- EventSink 投影以 evaluation id 去重。

### 时间

- 所有合同时间使用 timezone-aware UTC datetime。
- scope 与 evidence 在最终判断时校验有效期。
- continue 恢复时再次校验，不依赖首次 run 的结果缓存。

### 版本

- `ApprovalScope.version` 管理 scope 序列化合同。
- `safety_config_version` 标识规则配置快照。
- `audit_version` 管理事件 payload。
- 未知重大版本进入 fail-closed，避免静默采用缺省权限。

### 隐私与最小化

- 事件记录标准化路径摘要和命中 constraint id，安全账本按需要保留完整规范化路径。
- consent 展示文本与审计 reason 分开，reason_code 保持稳定。
- tool arguments 只记录规则判断所需字段，敏感值使用既有脱敏策略。
