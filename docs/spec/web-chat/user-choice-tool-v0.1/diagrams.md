# user-choice-tool-v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/03/04 是文字事实源，本文件是只读视图，增减模块或组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](./diagrams.md#总览)
- [E2E 测试链路](./diagrams.md#e2e-测试链路)
- [Choice Tool](./diagrams.md#choice-tool)
- [Choice UI](./diagrams.md#choice-ui)
- [Submit Bridge](./diagrams.md#submit-bridge)

## 总览

```mermaid
flowchart TD
  classDef module fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef support fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Tool["Choice Tool<br/>LLM 调用 present_choices 并发事件<br/>类/函数：ChoiceTool.execute()"]:::module
  Protocol["Choice Protocol<br/>定义 choice.request / choice.submit<br/>类/函数：ChoiceRequestFrame"]:::module
  UI["Choice UI<br/>composer 上方逐题选择面板<br/>类/函数：ChoiceManager.receive()"]:::module
  Bridge["Choice Submit Bridge<br/>确认结果转下一轮 user input<br/>类/函数：format_choice_submit_as_user_input()"]:::module
  Prompt["Prompt Guidance<br/>提示词说明使用场景<br/>文件：TOOLS.md"]:::support

  Prompt -.-> Tool
  Tool --> Protocol
  Protocol --> UI
  UI --> Bridge
  Bridge --> Protocol
```

## E2E 测试链路

```mermaid
flowchart LR
  classDef setup fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef action fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef assert fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  FakeLLM["准备 fake LLM<br/>返回 present_choices tool call"]:::setup
  Event["工具执行<br/>emit choice.requested"]:::action
  WS["WebSocket<br/>收到 choice.request"]:::action
  Click["用户动作<br/>选择问题并确定"]:::action
  Submit["后端处理<br/>choice.submit -> run_once"]:::action
  Assert["断言<br/>下一轮 user message 含 answers"]:::assert

  FakeLLM --> Event --> WS --> Click --> Submit --> Assert
```

## Choice Tool

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph ChoiceToolMod["Choice Tool"]
    Manager["ChoiceTool<br/>P0 · 模型工具入口"]:::p0
    Validator["ChoicePayloadValidator<br/>P1 · title/desc/questions 校验"]:::p1
    Emitter["ChoiceEventEmitter<br/>P1 · choice.requested 事件"]:::p1
  end

  Runner["Runner<br/>工具执行上下文"]:::p2
  WSSink["WSEventSink<br/>事件转 WS frame"]:::p2

  Runner --> Manager
  Manager --> Validator
  Manager --> Emitter
  Emitter --> WSSink
```

## Choice UI

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph ChoiceUIMod["Choice UI"]
    Manager["ChoiceManager<br/>P0 · UI 状态和提交帧边界"]:::p0
    Panel["ChoicePanel<br/>P0 · composer 上方选择器"]:::p0
    Stepper["QuestionStepper<br/>P1 · 题目切换"]:::p1
    OptionList["OptionList<br/>P1 · 选项和自定义输入"]:::p1
  end

  Chat["ChatPage<br/>接收 frame 并挂载面板"]:::p2
  Network["NetworkHandle<br/>发送 choice.submit"]:::p2

  Chat --> Manager
  Manager --> Panel
  Panel --> Stepper
  Panel --> OptionList
  Manager --> Network
```

### 状态流转

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> active: 收到 choice.request
  active --> active: 选择/切题/自定义输入
  active --> submitting: 点击确定
  submitting --> submitted: 发送成功
  submitting --> failed: 发送失败
  failed --> active: 保留草稿
  submitted --> idle: 清空面板
```

### 数据关系

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#181A1F", "primaryColor": "#242933", "primaryTextColor": "#F5F7FA", "primaryBorderColor": "#6BA7FF", "lineColor": "#AAB4C0", "textColor": "#F5F7FA", "edgeLabelBackground": "#181A1F"}}}%%
flowchart LR
  classDef entity fill:#1F2633,stroke:#6BA7FF,color:#F5F7FA,stroke-width:1.5px
  classDef supporting fill:#191F29,stroke:#AAB4C0,color:#F5F7FA,stroke-width:1.2px

  REQ["CHOICE_REQUEST<br/>────────<br/>PK request_id<br/>status"]:::entity
  Q["CHOICE_QUESTION<br/>────────<br/>PK question_id<br/>FK request_id"]:::entity
  OPT["CHOICE_OPTION<br/>────────<br/>PK option_id<br/>FK question_id"]:::supporting
  ANS["CHOICE_ANSWER<br/>────────<br/>FK question_id<br/>option_id"]:::entity

  REQ -->|owns 1:N| Q
  Q -->|offers 1:N| OPT
  Q -->|answered by 1:1| ANS
```

## Submit Bridge

```mermaid
sequenceDiagram
  participant User as 用户
  participant UI as ChoicePanel
  participant WS as WebSocket Route
  participant Bridge as SessionBridge
  participant Runner as Runner

  User->>UI: 点击确定
  UI->>WS: choice.submit
  WS->>WS: 校验 active run 状态
  WS->>WS: format_choice_submit_as_user_input()
  WS->>Bridge: run_once(choice_result_text)
  Bridge->>Runner: run()
  Runner-->>User: assistant 回复
```
