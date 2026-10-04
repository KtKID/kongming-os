# 审批单入口与分支单调收紧图表

## D1 · 当前 provider 覆盖链

```mermaid
flowchart LR
    BUILD[SessionEngine.build] --> GLOBAL[SafetyGatedApproval]
    SPAWN[SpawnAgentRequest.approval] --> CHILD[SubAgentApprovalProvider]
    CHILD --> CELL[AgentCell.run_approval]
    CELL --> HOST[HostDispatcher]
    HOST --> RUN[SessionEngine.run approval override]
    GLOBAL -. 被 run 级参数覆盖 .-> RUN
    RUN --> RUNNER[Runner]
    RUNNER --> DECIDE[ApprovalProvider.decide]
    CHILD --> SCOPE[工具白名单与路径 scope]
    SCOPE --> FINAL[直接 approved 或 rejected]
```

问题点：Runner 的最终决策槽接收了只实现分支 scope 的 provider，全局 `SafetyGatedApproval` 因 run 级 override 离开该次调用链。

## D2 · 目标模块依赖

```mermaid
flowchart TB
    subgraph SG1["M1 核心审批合同"]
        M1[ApprovalProvider / ConsentPrompt<br/>ApprovalRunContext]
    end
    subgraph SG2["M2 安全决策"]
        M2[SafetyDecisionEngine<br/>SafetyGatedApproval]
    end
    subgraph SG3["M3 运行时装配"]
        M3[SessionEngine]
    end
    subgraph SG4["M4 Agent 授权上下文"]
        M4[AgentManager<br/>SubAgentManager]
    end
    subgraph SG5["M5 定时任务授权上下文"]
        M5[SchedulerManager]
    end
    subgraph SG6["M6 审批审计投影"]
        M6[ApprovalAuditManager]
    end
    R[Runner]
    E[EventSink implementations]

    M2 --> M1
    M3 --> M1
    M3 --> M2
    M4 --> M1
    M5 --> M1
    M6 --> M1
    M2 --> M6
    M3 --> R
    R --> M1
    M6 --> E
    M4 -->|ApprovalRunContext| M3
    M5 -->|ApprovalRunContext| M3
```

依赖方向保持 safety 对 application/scheduler 零反向依赖。分支 Manager 只构造核心合同，composition root 把 EventSink 和 consent adapter 注入 safety。

## D3 · 统一决策时序

```mermaid
sequenceDiagram
    participant Branch as 分支 Manager
    participant Engine as SessionEngine
    participant Runner
    participant Gate as SafetyGatedApproval
    participant Rules as SafetyDecisionEngine
    participant Consent as ConsentPrompt
    participant Audit as ApprovalAuditManager
    participant Tool

    Branch->>Engine: run(approval_context)
    Engine->>Runner: run(self._approval, context)
    Runner->>Gate: decide(request, context)
    Gate->>Rules: evaluate(request, context)
    Rules->>Rules: HardBlock
    Rules->>Rules: RuntimeScope
    Rules->>Rules: Boundary
    Rules->>Rules: Destructive
    Rules->>Rules: Trust
    alt 需要显式同意
        Rules-->>Gate: REQUIRE_CONSENT + evaluations
        Gate->>Consent: prompt(request, context, evaluations)
        Consent-->>Gate: allow / deny / cancel
    else 已批准或拒绝
        Rules-->>Gate: final decision + evaluations
    end
    Gate->>Audit: publish(evaluation bundle)
    Audit-->>Gate: required sinks acknowledged
    Gate-->>Runner: ApprovalDecision
    alt approved
        Runner->>Tool: execute
    else rejected or cancelled
        Runner->>Runner: append tool_result placeholder/result
    end
```

## D4 · 六阶段状态流

```mermaid
stateDiagram-v2
    [*] --> HardBlock
    HardBlock --> Rejected: deny
    HardBlock --> RuntimeScope: continue
    RuntimeScope --> Rejected: out_of_scope
    RuntimeScope --> Boundary: continue
    Boundary --> Rejected: boundary_deny
    Boundary --> Destructive: continue
    Destructive --> Rejected: destructive_deny
    Destructive --> Trust: continue
    Trust --> Approved: valid evidence or trust rule
    Trust --> Consent: require_consent
    Trust --> Rejected: trust_deny
    Consent --> Approved: allow
    Consent --> Rejected: deny or fail_closed
    Consent --> Cancelled: cancel or timeout policy
    Approved --> AuditRequired
    Rejected --> AuditRequired
    Cancelled --> AuditRequired
    AuditRequired --> Executable: approved and ack
    AuditRequired --> Closed: rejected or cancelled
    AuditRequired --> Rejected: approved audit failure
    Executable --> [*]
    Closed --> [*]
    Rejected --> [*]
```

## D5 · 迁移与发布门禁

```mermaid
flowchart LR
    T1[T1 合同与单入口]
    T2[T2 子 Agent 迁移]
    T3[T3 Scheduler 迁移]
    B1{B1 安全门禁<br/>D1-D8}
    T4[T4 审计单写点]
    B2{B2 审计门禁<br/>D9-D10}
    T5[T5 跨分支门禁与文档]
    B3{B3 完成门禁<br/>D11-D12}

    T1 --> T2
    T1 --> T3
    T1 --> B1
    T2 --> B1
    T3 --> B1
    B1 --> T4
    T4 --> B2
    B2 --> T5
    T5 --> B3
```

T1、T2、T3 在开发上可以并行切分，B1 作为不可拆分发布门禁关闭所有生产 provider override。

## 图表与正文映射

| 图表 | 对应正文 |
|---|---|
| D1 | `README.md` 问题定义、`01-goals-and-boundaries.md` 背景 |
| D2 | `02-module-breakdown.md` M1-M6 |
| D3 | `03-core-workflows.md` W1-W6 |
| D4 | `01-goals-and-boundaries.md` G2、`04-data-and-state.md` 枚举 |
| D5 | `05-validation-and-evolution.md` 迁移阶段、`90-task-map.md` 依赖与并行 |
