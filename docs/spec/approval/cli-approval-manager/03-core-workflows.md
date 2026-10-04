# 核心流程

## CLI 审批主链路

```mermaid
sequenceDiagram
  participant User as CLI 用户
  participant Bridge as SessionBridge
  participant Runner as Runner
  participant Safety as SafetyGatedApproval
  participant Prompt as manager prompt_fn
  participant Manager as ApprovalManager
  participant Rules as ApprovalRules
  participant Policy as Shared AutoApprovalPolicy
  participant Sink as CLIApprovalEventSink
  participant Tool as Tool

  User->>Bridge: 输入 prompt
  Bridge->>Runner: runtime.run()
  Runner->>Safety: approval.decide(tool_call)
  Safety->>Prompt: prompt_fn(ApprovalRequest)
  Prompt->>Manager: request(channel="cli", cwd, tool)
  Manager->>Rules: classify(channel="cli")
  Rules->>Policy: classify(tool, cwd)
  alt 自动允许
    Manager-->>Prompt: ApprovalDecision(approved)
    Prompt-->>Safety: ACCEPT_ONCE
    Safety-->>Runner: allow
    Runner->>Tool: execute()
  else 危险规则强制人审
    Manager->>Sink: emit_approval_required(pending, matched_rule)
    Sink->>User: 终端提示危险规则
    User-->>Sink: n 或超时
    Sink->>Manager: resolve(request_id, allow=false)
    Manager-->>Prompt: ApprovalDecision(rejected)
    Prompt-->>Safety: REJECT
    Safety-->>Runner: deny
  else 用户审批
    Manager->>Sink: emit_approval_required(pending)
    Sink->>User: 终端提示
    User-->>Sink: y / n
    Sink->>Manager: resolve(request_id, payload)
    Manager-->>Prompt: ApprovalDecision(...)
    Prompt-->>Safety: ApprovalAction
    Safety-->>Runner: allow 或 deny
  end
```

## 决策流程

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Start["Tool call requires approval<br/>P0 · Safety chain 进入 interactive"]:::p0
  Classify["ApprovalRules.classify<br/>P0 · channel=cli"]:::p0
  Guard["Danger rule<br/>P0 · 强制人审"]:::p0
  Allow["Auto approve<br/>P0 · 返回 approved"]:::p0
  Ask["Ask user<br/>P0 · 创建 pending"]:::p0
  Prompt["Terminal prompt<br/>P1 · y / n"]:::p1
  Resolve["manager.resolve<br/>P0 · future 完成"]:::p0
  Result["ApprovalAction<br/>P0 · 回到 SafetyGatedApproval"]:::p0

  Start --> Classify
  Classify --> Guard
  Classify --> Allow
  Classify --> Ask
  Ask --> Prompt
  Prompt --> Resolve
  Guard --> Ask
  Allow --> Result
  Resolve --> Result
```

## 装配流程

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Config["load_config<br/>P0 · CLI config"]:::p0
  SessionId["resolve session_id<br/>P0 · 复用给 prompt 和 bridge"]:::p0
  Policy["build_shared_auto_policy<br/>P0 · 共享规则"]:::p0
  Manager["ApprovalManager<br/>P0 · rules + CLI sink"]:::p0
  Prompt["make_manager_prompt_fn<br/>P0 · channel=cli"]:::p0
  Approval["build_default_approval<br/>P0 · InteractiveApproval"]:::p0
  Runtime["SessionEngine.build<br/>P0 · 原有运行时"]:::p0

  Config --> Policy
  Config --> SessionId
  Policy --> Manager
  SessionId --> Prompt
  Manager --> Prompt
  Prompt --> Approval
  Approval --> Runtime
```

## 超时与中断

- `ApprovalManager` 继续持有 timeout task。
- CLI sink 只负责展示和 resolve。
- 用户 Ctrl-C 或 EOF 映射为 reject。
- 外层 run cancel 继续由 Runner 的 cancel 分支收口。

## 失败策略

- policy 读取失败：返回 ask。
- CLI sink 输出失败：返回 reject 或等待 manager timeout。
- manager resolve 重复：返回 False，主链路保持稳定。
- CLI 不写入 session grant；Web/generic_chat 的本会话同意由 manager 规则层处理。
