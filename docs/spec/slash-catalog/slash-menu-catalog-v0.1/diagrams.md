# Slash Menu Catalog v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/03/04 是文字事实源，本文件是只读视图——增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](#总览)
- [provider 聚合局部图](#provider-聚合局部图)
- [前端交互流程图](#前端交互流程图)
- [conversation reference 注入流程图](#conversation-reference-注入流程图)
- [catalog item 状态流转图](#catalog-item-状态流转图)
- [Smoke 验证流程图](#smoke-验证流程图)
- [E2E 验证流程图](#e2e-验证流程图)

图例：P0 核心/阻塞 · P1 主要/必须 · P2 辅助/可选

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Frontend["SlashMenu Frontend<br/>P0 · group/item 两级交互"]:::p0
  Rest["Slash Catalog REST<br/>P0 · catalog API 与 legacy API"]:::p0
  Manager["SlashCatalogManager<br/>P0 · provider 聚合门户"]:::p0
  Providers["Catalog Providers<br/>P0 · 注册源 adapter"]:::p0
  RefContract["Conversation Reference Contract<br/>P0 · reference_template + references"]:::p0
  RichComposer["Rich Composer Reference UI<br/>P0 · chip 渲染与提交"]:::p0
  RefManager["ConversationReferenceManager<br/>P0 · 后端解析与注入"]:::p0
  Assembler["InputAssembler<br/>P0 · prompt context 注入"]:::p0
  History["Workflow History Projection<br/>P1 · completed run 只读投影"]:::p1

  Frontend --> Rest
  Frontend --> RichComposer
  Rest --> Manager
  Manager --> Providers
  Providers --> RefContract
  RichComposer --> RefContract
  RefContract --> RefManager
  RefManager --> Assembler
  Providers --> History
```

## provider 聚合局部图

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Catalog["Slash Catalog（边界 = SlashCatalogManager）"]
    Manager["SlashCatalogManager<br/>P0 · 聚合 group/items"]:::p0
    Wp["WorkflowCatalogProvider<br/>P0 · strategy + history"]:::p0
    Cp["CommandCatalogProvider<br/>P0 · Web commands"]:::p0
    Sp["SkillCatalogProvider<br/>P0 · skill specs"]:::p0
    Template["reference_template<br/>P0 · bind_reference 激活模板"]:::p0
  end

  Wsrc["AgentWorkflowManager<br/>P1 · list_workflow_strategies"]:::p1
  Csrc["CommandRegistry<br/>P1 · list_commands(web)"]:::p1
  Ssrc["Skill Loader<br/>P1 · load_skill_specs"]:::p1
  Hsrc["WorkflowRunViewerManager<br/>P1 · completed projection"]:::p1

  Manager --> Wp
  Manager --> Cp
  Manager --> Sp
  Wp --> Template
  Cp --> Template
  Sp --> Template
  Wp --> Wsrc
  Wp -.-> Hsrc
  Cp --> Csrc
  Sp --> Ssrc
```

## 前端交互流程图

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Input["Composer 输入 /<br/>P0 · 打开菜单"]:::p0
  Groups["加载 groups<br/>P0 · workflow/command/skill"]:::p0
  PickGroup["选择 group<br/>P0 · Enter 或点击"]:::p0
  Items["加载 items<br/>P0 · provider 子项"]:::p0
  PickItem["选择 item<br/>P0 · 绑定引用或动作"]:::p0
  Chip["富文本 chip<br/>P0 · Skill Creator / workflow / command"]:::p0
  Frame["UserInputFrame<br/>P0 · text + references"]:::p0
  Viewer["Workflow Viewer<br/>P2 · 打开历史 run"]:::p2

  Input --> Groups
  Groups --> PickGroup
  PickGroup --> Items
  Items --> PickItem
  PickItem --> Chip
  Chip --> Frame
  PickItem -.-> Viewer
```

## conversation reference 注入流程图

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Item["SlashCatalogItemDTO<br/>P0 · kind/id/title"]:::p0
  Template["ConversationReferenceTemplate<br/>P0 · activation + preview"]:::p0
  Chip["Composer chip<br/>P0 · @Skill Creator 可视节点"]:::p0
  Frame["UserInputFrame.references<br/>P0 · 提交结构化引用"]:::p0
  Metadata["Message.metadata<br/>P0 · conversation_references"]:::p0
  Resolver["ConversationReferenceManager<br/>P0 · skill/command/workflow resolver"]:::p0
  SkillBody["selected_skill prompt block<br/>P0 · 从 SKILL.md 解析"]:::p0
  ActionHint["command/workflow action hints<br/>P1 · execute/guide/open_viewer"]:::p1
  Assembler["InputAssembler<br/>P0 · 仅注入当前 user turn"]:::p0
  Request["LLMRequest.messages<br/>P0 · 带引用上下文"]:::p0

  Item --> Template
  Template --> Chip
  Chip --> Frame
  Frame --> Metadata
  Metadata --> Resolver
  Resolver --> SkillBody
  Resolver --> ActionHint
  SkillBody --> Assembler
  ActionHint --> Assembler
  Assembler --> Request
```

## catalog item 状态流转图

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Source["source_registered<br/>P0 · 注册源存在"]:::p0
  Projected["projected<br/>P0 · provider 转 DTO"]:::p0
  Templated["template_projected<br/>P0 · 生成引用模板"]:::p0
  Delivered["delivered<br/>P0 · route 返回前端"]:::p0
  Visible["visible<br/>P1 · 菜单可见"]:::p1
  Selected["selected<br/>P1 · 用户选择"]:::p1
  Bound["reference_bound<br/>P0 · chip 写入 Composer"]:::p0
  Injected["injected<br/>P0 · prompt context 生效"]:::p0
  Applied["action_applied<br/>P1 · 执行或打开"]:::p1
  Disabled["disabled_or_empty<br/>P2 · planned/空态/错误"]:::p2

  Source --> Projected
  Projected --> Templated
  Templated --> Delivered
  Delivered --> Visible
  Visible --> Selected
  Selected --> Bound
  Bound --> Injected
  Selected -.-> Applied
  Projected -.-> Disabled
  Delivered -.-> Disabled
```

## Smoke 验证流程图

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Pytest["pytest route smoke<br/>P0 · catalog API 契约"]:::p0
  Seed["fake app state<br/>P0 · 注册源 fixture"]:::p0
  Catalog["GET /api/slash-catalog<br/>P0 · 三组摘要"]:::p0
  Group["GET /groups/workflow<br/>P0 · 注册 mode"]:::p0
  Template["reference_template 断言<br/>P0 · activation 与 preview"]:::p0
  Resolver["reference resolver smoke<br/>P0 · fake skill/command/workflow"]:::p0
  Legacy["GET /api/slash-candidates<br/>P1 · command+skill 兼容"]:::p1
  Vitest["Vitest component smoke<br/>P0 · SlashMenu 状态机"]:::p0
  Select["选择 item<br/>P1 · chip/action 断言"]:::p1

  Pytest --> Seed
  Seed --> Catalog
  Catalog --> Group
  Catalog --> Template
  Template --> Resolver
  Catalog --> Legacy
  Vitest --> Catalog
  Vitest --> Select
```

## E2E 验证流程图

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Browser["Playwright Web UI<br/>P0 · 打开 chat thread"]:::p0
  Slash["输入 /<br/>P0 · 展示首层三组"]:::p0
  Workflow["进入 workflow<br/>P0 · 注册 mode + 历史分区"]:::p0
  Command["进入 command<br/>P1 · Web command 子项"]:::p1
  Skill["进入 skill<br/>P1 · skill 子项"]:::p1
  Pick["选择 Skill Creator<br/>P0 · 生成 chip"]:::p0
  Send["提交消息<br/>P1 · WS user.input + references"]:::p1
  Resolve["后端解析引用<br/>P0 · 注入 selected_skill"]:::p0
  Observe["观察结果<br/>P1 · 模型按 skill 语义回应或 viewer 跳转"]:::p1

  Browser --> Slash
  Slash --> Workflow
  Slash --> Command
  Slash --> Skill
  Workflow --> Pick
  Command --> Pick
  Skill --> Pick
  Pick --> Send
  Send --> Resolve
  Pick -.-> Observe
  Resolve --> Observe
```
