# harness-eval-environment-v0.1 图集

> Mermaid 查看建议：用 GitHub Markdown 预览，或 VS Code Mermaid Chart / Markdown Preview Enhanced。单图控制在约 12 个节点内，必要时拆图查看。

## 目录

- [总览](./diagrams.md#总览)
- [E2E 验证链路](./diagrams.md#e2e-验证链路)
- [Runtime Profile 状态流转](./diagrams.md#runtime-profile-状态流转)
- [Approval 模式解析](./diagrams.md#approval-模式解析)
- [产物数据关系](./diagrams.md#产物数据关系)

## 总览

```mermaid
flowchart TD
  Env["Eval Environment Setup<br/>环境依赖与 preset 配置<br/>EvalEnvironmentGuide"]:::p0
  Profile["Runtime Profile Control<br/>baseline-min/full 装配<br/>EvalProfileManager"]:::p0
  Approval["Approval Control<br/>auto_allow/interactive/case<br/>EvalApprovalManager"]:::p0
  Artifact["Artifact Metadata<br/>summary/report/trajectory<br/>EvalArtifactManager"]:::p1
  Automation["Automation Recipe<br/>CI/nightly/对比命令<br/>EvalAutomationGuide"]:::p1
  ChangePlan["Business Code Change Plan<br/>脚本层不足时的最小 patch<br/>EvalChangePlanner"]:::p2

  Env --> Profile
  Env --> Approval
  Profile --> Artifact
  Approval --> Artifact
  Artifact --> Automation
  Profile -.-> ChangePlan

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```

## E2E 验证链路

```mermaid
flowchart LR
  Setup["安装依赖<br/>make install"]:::p0
  EnvFile["写入 .env<br/>preset API key"]:::p0
  Fixture["跑 fixture<br/>harness 闭环"]:::p1
  Preset["跑 preset<br/>真实 provider"]:::p1
  Compare["比较 profile<br/>score/turn/token"]:::p1
  Evidence["读取产物<br/>report/trajectory/session"]:::p0

  Setup --> EnvFile --> Fixture --> Preset --> Compare --> Evidence

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```

## Runtime Profile 状态流转

```mermaid
stateDiagram-v2
  [*] --> Parsed
  Parsed --> BaselineMin: profile=baseline-min
  Parsed --> Full: profile=full
  BaselineMin --> RuntimeBuilt: empty AgentSpec + memory session + noop compactor
  Full --> RuntimeBuilt: eval instructions + file session + config compactor
  RuntimeBuilt --> Running
  Running --> ArtifactsWritten
  ArtifactsWritten --> [*]
```

## Approval 模式解析

```mermaid
flowchart TD
  Cli["CLI --approval-mode"]:::p0
  TaskRuntime["task.runtime.approval_mode"]:::p1
  Auto["AutoAllowApproval<br/>无人值守"]:::p0
  Interactive["InteractiveApproval<br/>人工确认"]:::p1
  Safety["SafetyGatedApproval<br/>固定安全链"]:::p0
  Runner["Runner tool loop<br/>执行或拒绝"]:::p0

  Cli -->|"auto_allow"| Auto
  Cli -->|"interactive"| Interactive
  Cli -->|"case"| TaskRuntime
  TaskRuntime -->|"缺省/auto_allow"| Auto
  TaskRuntime -->|"interactive"| Interactive
  Auto --> Safety
  Interactive --> Safety
  Safety --> Runner

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```

## 产物数据关系

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#181A1F", "primaryColor": "#242933", "primaryTextColor": "#F5F7FA", "primaryBorderColor": "#6BA7FF", "lineColor": "#AAB4C0", "textColor": "#F5F7FA", "edgeLabelBackground": "#181A1F"}}}%%
flowchart LR
  Run["RUN<br/>--------<br/>PK run_id<br/>profile<br/>approval_mode"]:::entity
  Task["TASK_RESULT<br/>--------<br/>PK task_id<br/>FK run_id<br/>score"]:::entity
  Trajectory["TRAJECTORY<br/>--------<br/>FK task_id<br/>metadata<br/>events"]:::entity
  Session["SESSION_ARTIFACT<br/>--------<br/>FK run_id<br/>session_id<br/>backend"]:::supporting
  Report["REPORT<br/>--------<br/>FK run_id<br/>summary<br/>markdown"]:::supporting

  Run -->|owns 1:N| Task
  Task -->|writes 1:1| Trajectory
  Run -->|may own 0:N| Session
  Run -->|writes 1:1| Report

  classDef entity fill:#1F2633,stroke:#6BA7FF,color:#F5F7FA,stroke-width:1.5px
  classDef supporting fill:#191F29,stroke:#AAB4C0,color:#F5F7FA,stroke-width:1.2px
```
