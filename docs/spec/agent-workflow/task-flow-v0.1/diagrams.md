# Task Flow v0.1 图集

> Mermaid 图在 GitHub 和支持 Mermaid 的 Markdown 预览器中查看。单图保持小规模，细节按模块拆分。

## 目录

- [总览](#总览)
- [E2E 测试链路](#e2e-测试链路)
- [执行流程](#执行流程)
- [状态机](#状态机)
- [数据关系](#数据关系)

## 总览

```mermaid
flowchart TD
  TOOL["AgentWorkflowTool<br/>策略入口和 payload 归一化<br/>类/函数：RunAgentWorkflowTool"]:::p0
  MANAGER["AgentWorkflowManager<br/>workflow 生命周期和审计<br/>类/函数：run_workflow_payload()"]:::p0
  REGISTRY["AgentWorkflowStrategyManager<br/>策略注册和分发<br/>类/函数：run_strategy()"]:::p0
  GATE["TaskFlowStartGate<br/>LLM 启动判断<br/>类/函数：build_description_rules()"]:::p0
  STRATEGY["TaskFlowStrategy<br/>计划生成和节点执行<br/>类/函数：TaskFlowStrategy.run()"]:::p0
  CONTRACTS["TaskFlowContracts<br/>payload 和状态模型<br/>类/函数：TaskFlowContractParser.parse()"]:::p1
  PROGRESS["TaskFlowProgressProjector<br/>Progress 弹窗投影<br/>类/函数：project()"]:::p1
  VIEWER["TaskFlowViewerAdapter<br/>Workflow Viewer 投影<br/>类/函数：project()"]:::p1
  ARTIFACTS["task_flow artifacts<br/>plan/nodes/progress/result<br/>文件：task_flow/*.json"]:::p1

  TOOL --> MANAGER
  TOOL --> GATE
  MANAGER --> REGISTRY
  REGISTRY --> STRATEGY
  STRATEGY --> CONTRACTS
  STRATEGY --> ARTIFACTS
  STRATEGY --> PROGRESS
  VIEWER --> ARTIFACTS

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```

## E2E 测试链路

```mermaid
flowchart LR
  FIX["准备 task_flow fixture"]:::p0
  RUN["调用 run_agent_workflow<br/>mode=task_flow"]:::p0
  PLAN["写 plan.json<br/>progress.json"]:::p0
  EXEC["执行节点<br/>写 nodes.jsonl"]:::p0
  API["Workflow Viewer API<br/>读取投影"]:::p1
  UI["前端显示任务流<br/>Progress 7/8"]:::p1
  ASSERT["断言节点状态<br/>产物和暂停状态"]:::p0

  FIX --> RUN --> PLAN --> EXEC --> API --> UI --> ASSERT

  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px
```

## 执行流程

```mermaid
sequenceDiagram
  participant User as 用户
  participant Agent as 主 agent
  participant Gate as StartGate
  participant Manager as AgentWorkflowManager
  participant Strategy as TaskFlowStrategy
  participant Progress as ProgressProjector
  participant Viewer as WorkflowViewer

  User->>Agent: 提出任务目标
  Agent->>Gate: 判断 auto / guided / choice_required
  Agent->>Manager: run_workflow_payload(task_flow)
  Manager->>Strategy: run(context, payload)
  Strategy->>Strategy: 生成 TaskFlowPlan
  Strategy->>Progress: 投影计划进度
  Strategy-->>User: 请求确认计划
  User-->>Strategy: approve_plan
  loop 每个节点
    Strategy->>Strategy: 执行节点
    Strategy->>Progress: 更新节点状态
  end
  Strategy->>Manager: 返回 AgentWorkflowResult
  Viewer->>Strategy: 读取 task_flow artifacts
```

## 状态机

```mermaid
stateDiagram-v2
  [*] --> planning
  planning --> awaiting_plan_confirmation
  planning --> running
  awaiting_plan_confirmation --> running: approve_plan
  awaiting_plan_confirmation --> planning: revise_plan
  awaiting_plan_confirmation --> cancelled: cancel_flow
  running --> needs_user_input: severe_issue
  needs_user_input --> running: continue_or_skip
  needs_user_input --> planning: revise_plan
  needs_user_input --> stopped: stop_flow
  running --> completed
  running --> failed
  completed --> [*]
  failed --> [*]
  cancelled --> [*]
  stopped --> [*]
```

## 数据关系

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#181A1F", "primaryColor": "#242933", "primaryTextColor": "#F5F7FA", "primaryBorderColor": "#6BA7FF", "lineColor": "#AAB4C0", "textColor": "#F5F7FA", "edgeLabelBackground": "#181A1F"}}}%%
flowchart LR
  WF["Workflow<br/>────────<br/>PK workflow_id<br/>mode task_flow<br/>status"]:::entity
  PLAN["TaskFlowPlan<br/>────────<br/>PK plan_id<br/>FK workflow_id<br/>status"]:::entity
  NODE["TaskFlowNode<br/>────────<br/>PK node_id<br/>FK plan_id<br/>status"]:::entity
  ART["TaskFlowArtifactRef<br/>────────<br/>PK artifact_id<br/>FK node_id<br/>kind"]:::supporting
  INT["TaskFlowInterruption<br/>────────<br/>PK interruption_id<br/>FK node_id<br/>severity"]:::supporting
  DEC["TaskFlowDecision<br/>────────<br/>PK decision_id<br/>FK interruption_id<br/>action"]:::supporting

  WF -->|owns 1:1| PLAN
  PLAN -->|contains 1:N| NODE
  NODE -->|produces 0:N| ART
  NODE -->|may pause 0:1| INT
  INT -->|resolved by 0:N| DEC

  classDef entity fill:#1F2633,stroke:#6BA7FF,color:#F5F7FA,stroke-width:1.5px
  classDef supporting fill:#191F29,stroke:#AAB4C0,color:#F5F7FA,stroke-width:1.2px
```
