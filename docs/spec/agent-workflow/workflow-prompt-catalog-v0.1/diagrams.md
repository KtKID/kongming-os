# Workflow Prompt Catalog v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/04 是文字事实源，本文件是只读视图，增减模块或实体时同步更新对应节。
>
> 查看与缩放：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](./diagrams.md#总览)
- [E2E 测试链路](./diagrams.md#e2e-测试链路)
- [核心注入顺序图](./diagrams.md#核心注入顺序图)
- [WorkflowPromptCatalogManager](./diagrams.md#workflowpromptcatalogmanager)
- [WorkflowPromptListingFormatter](./diagrams.md#workflowpromptlistingformatter)
- [InstructionAssemblyIntegration](./diagrams.md#instructionassemblyintegration)
- [PromptCacheStability](./diagrams.md#promptcachestability)
- [数据关系图](./diagrams.md#数据关系图)

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  REG["Workflow Strategy Registry<br/>全量 workflow description 来源<br/>类/函数：AgentWorkflowManager.describe_workflow_strategy()"]:::p0
  CAT["WorkflowPromptCatalogManager<br/>读取全量策略并输出 entries<br/>类/函数：snapshot_default_workflows()"]:::p0
  FMT["WorkflowPromptListingFormatter<br/>稳定短 listing 与 hash<br/>类/函数：render()"]:::p0
  ASM["InstructionAssemblyIntegration<br/>公共 system prompt 注入点<br/>类/函数：assemble_instructions()"]:::p0
  DISC["WorkflowToolDiscovery<br/>describe/run 工具发现路径<br/>类/函数：build_run_agent_workflow_tool()"]:::p1
  CACHE["PromptCacheStability<br/>hash/version/cache key 语义<br/>类/函数：WorkflowPromptCacheKey"]:::p1
  CLI["CLI Host<br/>追加 skills 和 memory<br/>类/函数：_assemble_instructions()"]:::p1
  WEB["Web Host<br/>共享 assets 与 instructions cache<br/>类/函数：_ensure_shared_assets()"]:::p1
  LLM["LLM<br/>读取 listing 选择 workflow<br/>行为：describe 后 run"]:::p0

  REG --> CAT --> FMT --> ASM
  FMT --> CACHE
  FMT --> DISC
  ASM --> CLI
  ASM --> WEB
  CLI --> LLM
  WEB --> LLM
  LLM --> DISC
```

## E2E 测试链路

```mermaid
flowchart LR
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  FIX["准备 fake strategy registry<br/>parallel + task_flow + fake_new"]:::p0
  SNAP["生成 catalog snapshot<br/>断言全量 mode"]:::p0
  RENDER["渲染 listing<br/>断言字段裁剪和 hash"]:::p0
  ASSEMBLE["组装 instructions<br/>断言 workflow_catalog 顺序"]:::p0
  HOSTS["CLI/Web 双 host 装配<br/>断言 listing 文本一致"]:::p1
  CACHE["Web cache 变更测试<br/>断言 hash/version 刷新"]:::p1
  TOOLS["describe/run 工具合同<br/>断言 schema 按需披露"]:::p0

  FIX --> SNAP --> RENDER --> ASSEMBLE --> HOSTS --> CACHE --> TOOLS
```

## 核心注入顺序图

```mermaid
sequenceDiagram
  participant Host as CLI/Web Host
  participant Catalog as WorkflowPromptCatalogManager
  participant Registry as Strategy Registry
  participant Formatter as WorkflowPromptListingFormatter
  participant Assembly as InstructionAssemblyIntegration
  participant Loader as InstructionLoader
  participant LLM as LLM

  Host->>Catalog: 请求 workflow prompt snapshot
  Catalog->>Registry: list_workflow_strategies()
  loop 每个 mode
    Catalog->>Registry: describe_workflow_strategy(mode)
    Registry-->>Catalog: WorkflowStrategyDescription
  end
  Catalog-->>Formatter: WorkflowPromptCatalogSnapshot
  Formatter-->>Assembly: WorkflowPromptListingRender
  Assembly->>Loader: 插入 workflow_catalog source
  Loader-->>Assembly: runtime -> workflow_catalog -> prompts -> extra_files -> env -> sitian
  Assembly-->>Host: rendered instructions + origins + listing hash
  Host-->>LLM: system prompt
  LLM->>LLM: 读取 mode/title/使用场景
  LLM->>Host: describe_agent_workflow_strategy(mode="xx")
  LLM->>Host: run_agent_workflow(mode, payload)
```

## WorkflowPromptCatalogManager

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph CatalogModule["WorkflowPromptCatalogManager"]
    MGR["WorkflowPromptCatalogManager<br/>P0 · catalog 边界类"]:::p0
    SRC["StrategyCatalogSource<br/>P0 · default/runtime 两类读取源"]:::p0
    NORM["EntryNormalizer<br/>P1 · trim/空项过滤/排序"]:::p1
    SNAP["WorkflowPromptCatalogSnapshot<br/>P1 · entries + source_version + hash"]:::p1
  end

  REG["AgentWorkflowManager<br/>邻居 · registry/describe 入口"]:::p0

  MGR --> SRC
  SRC --> REG
  MGR --> NORM
  NORM --> SNAP
```

## WorkflowPromptListingFormatter

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph FormatterModule["WorkflowPromptListingFormatter"]
    FMT["WorkflowPromptListingFormatter<br/>P0 · 唯一 formatter"]:::p0
    SORT["StableSort<br/>P0 · mode 升序"]:::p0
    TEMPLATE["TemplateV1<br/>P0 · 固定标题/指引/缩进"]:::p0
    HASH["ListingHash<br/>P1 · version + entries"]:::p1
    RENDER["WorkflowPromptListingRender<br/>P1 · text/origin/hash"]:::p1
  end

  SNAP["WorkflowPromptCatalogSnapshot<br/>邻居 · entries"]:::p1

  SNAP --> FMT
  FMT --> SORT
  FMT --> TEMPLATE
  FMT --> HASH
  SORT --> RENDER
  TEMPLATE --> RENDER
  HASH --> RENDER
```

## InstructionAssemblyIntegration

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph AssemblyModule["InstructionAssemblyIntegration"]
    INT["InstructionAssemblyIntegration<br/>P0 · 注入 source"]:::p0
    ORIG["OriginOrder<br/>P0 · runtime/workflow/prompts/files/env"]:::p0
    TEXT["RenderedInstructions<br/>P1 · 合成 system prompt"]:::p1
  end

  RUNTIME["runtime context<br/>现有首段"]:::p2
  WORKFLOW["workflow_catalog<br/>短 listing"]:::p0
  FILES["prompts + extra_files + env<br/>读取文件和动态来源"]:::p1
  HOST["CLI/Web host<br/>追加 skills/memory 或 cache"]:::p1

  INT --> RUNTIME
  INT --> WORKFLOW
  INT --> FILES
  RUNTIME --> ORIG
  WORKFLOW --> ORIG
  FILES --> ORIG
  ORIG --> TEXT
  TEXT --> HOST
```

## PromptCacheStability

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph CacheModule["PromptCacheStability"]
    KEY["WorkflowPromptCacheKey<br/>P0 · base_hash + template_version + listing_hash"]:::p0
    RECORD["WebInstructionCacheRecord<br/>P0 · rendered/origins/cache_key"]:::p0
    CHECK["CacheReusePolicy<br/>P1 · key 相同复用"]:::p1
    REFRESH["CacheRefreshPolicy<br/>P1 · key 改变刷新"]:::p1
  end

  BASE["Base instructions hash<br/>邻居 · assembly 基础文本"]:::p2
  LISTING["Workflow listing hash<br/>邻居 · formatter 输出"]:::p1
  WEB["Web _instructions_cache<br/>邻居 · shared assets"]:::p1

  BASE --> KEY
  LISTING --> KEY
  KEY --> CHECK
  KEY --> REFRESH
  CHECK --> RECORD
  REFRESH --> RECORD
  RECORD --> WEB
```

## 数据关系图

```mermaid
%%{init: {"theme": "base", "themeVariables": {"background": "#181A1F", "primaryColor": "#242933", "primaryTextColor": "#F5F7FA", "primaryBorderColor": "#6BA7FF", "lineColor": "#AAB4C0", "textColor": "#F5F7FA", "edgeLabelBackground": "#181A1F"}}}%%
flowchart LR
  classDef entity fill:#1F2633,stroke:#6BA7FF,color:#F5F7FA,stroke-width:1.5px
  classDef supporting fill:#191F29,stroke:#AAB4C0,color:#F5F7FA,stroke-width:1.2px

  REG["STRATEGY_REGISTRY<br/>────────<br/>PK registry_id<br/>status"]:::entity
  DESC["WORKFLOW_DESCRIPTION<br/>────────<br/>PK mode<br/>status"]:::entity
  ENTRY["PROMPT_ENTRY<br/>────────<br/>PK mode<br/>usage_scenarios"]:::entity
  SNAP["CATALOG_SNAPSHOT<br/>────────<br/>PK listing_hash<br/>status"]:::entity
  RENDER["LISTING_RENDER<br/>────────<br/>PK listing_hash<br/>template_version"]:::entity
  SOURCE["INSTRUCTION_SOURCE<br/>────────<br/>PK origin<br/>type"]:::supporting
  CACHE["WEB_CACHE_RECORD<br/>────────<br/>PK cache_key<br/>status"]:::supporting

  REG -->|contains 1:N| DESC
  DESC -->|projects 1:1| ENTRY
  ENTRY -->|belongs to 1:N| SNAP
  SNAP -->|renders 1:1| RENDER
  RENDER -->|injects 1:1| SOURCE
  SOURCE -->|cached by 0:1| CACHE
```
