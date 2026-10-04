# MCP Client v0.1 · 图集

> 本 spec 的唯一图源：所有 mermaid 图集中于此，按模块分节。02/03/04 是文字事实源，本文件是只读视图，增减模块/组件时同步更新对应节。
>
> **查看与缩放**：GitHub 渲染 mermaid 自带缩放/平移控件；VS Code 建议安装 Mermaid Chart（官方）或 Markdown Preview Enhanced 插件以支持缩放。

## 目录

- [总览](#总览)
- [MCP 配置模块](#mcp-配置模块)
- [MCP 基础设施模块](#mcp-基础设施模块)
- [MCP Tool 适配模块](#mcp-tool-适配模块)
- [Runtime 装配模块](#runtime-装配模块)
- [通用 Web Search 集成模块](#通用-web-search-集成模块)
- [安全与观测模块](#安全与观测模块)
- [数据模型](#数据模型)

图例：🔵 P0 核心/阻塞 · 🟠 P1 主要/必须 · ⚪ P2 辅助/可选

## 总览

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  Config["MCP 配置模块<br/>P0 · mcp.servers 与 secret 解析"]:::p0
  Infra["MCP 基础设施模块<br/>P0 · stdio JSON-RPC 与生命周期"]:::p0
  Adapter["MCP Tool 适配模块<br/>P0 · MCP descriptor 转 Kongming Tool"]:::p0
  Runtime["Runtime 装配模块<br/>P0 · 启动 MCP 并注册 ToolRegistry"]:::p0
  WebSearch["通用 Web Search 集成模块<br/>P1 · MiniMax search 转通用 web_search"]:::p1
  Safety["安全与观测模块<br/>P1 · 审批命名与诊断 artifact"]:::p1

  Config --> Infra
  Infra --> Adapter
  Config --> Runtime
  Infra --> Runtime
  Adapter --> Runtime
  Runtime --> WebSearch
  Adapter -.-> Safety
  Runtime -.-> Safety
```

## MCP 配置模块

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Config["MCP 配置模块"]
    Models["McpConfig / McpServerConfig<br/>P0 · 配置模型"]:::p0
    WebModels["WebSearchConfig / WebDeepResearchSourceProviderConfig<br/>P0 · 搜索配置模型"]:::p0
    Loader["Config loader 扩展<br/>P1 · YAML 与 env 覆盖"]:::p1
    Schema["schema 输出<br/>P2 · 配置文档和校验辅助"]:::p2
  end

  Runtime["Runtime 装配模块<br/>邻居，读取配置快照"]:::p2

  Loader --> Models
  Loader --> WebModels
  Schema --> Models
  Schema --> WebModels
  Runtime --> Models
  Runtime --> WebModels
```

## MCP 基础设施模块

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Infra["MCP 基础设施模块"]
    Manager["McpManager<br/>P0 · 边界类，管理 server 生命周期"]:::p0
    Process["StdioProcess<br/>P0 · 子进程 stdin/stdout/stderr"]:::p0
    Rpc["JsonRpcSession<br/>P0 · request id 与响应匹配"]:::p0
    Methods["MCP methods<br/>P1 · initialize/tools/list/tools/call"]:::p1
    Diag["Diagnostics<br/>P1 · 超时、退出、协议错误"]:::p1
  end

  Config["MCP 配置模块<br/>邻居，提供 server config"]:::p2
  Adapter["MCP Tool 适配模块<br/>邻居，调用 call_tool"]:::p2

  Config --> Manager
  Manager --> Process
  Manager --> Rpc
  Manager --> Methods
  Manager --> Diag
  Adapter --> Manager
```

### Server 生命周期

```mermaid
stateDiagram-v2
  [*] --> configured
  configured --> starting: 装配层启动
  starting --> initializing: 子进程创建成功
  starting --> failed: command 缺失或启动失败
  initializing --> listing_tools: initialize 成功
  initializing --> failed: initialize 超时或协议错误
  listing_tools --> ready: tools/list 成功
  listing_tools --> degraded: 部分 descriptor 或 alias 异常
  listing_tools --> failed: tools/list 失败
  ready --> closing: runtime shutdown
  degraded --> closing: runtime shutdown
  ready --> failed: 运行期进程退出
  closing --> closed: wait 或 kill 完成
  failed --> closing: 释放残留进程
  closed --> [*]
```

### Shutdown 流程

```mermaid
sequenceDiagram
  participant Runtime as Runtime 装配模块
  participant Manager as McpManager
  participant Proc as stdio 子进程
  participant Diag as Diagnostics

  Runtime->>Manager: aclose()
  Manager->>Proc: close stdin
  Manager->>Proc: terminate()
  Manager->>Proc: wait(timeout)
  alt 超时未退出
    Manager->>Proc: kill()
    Manager->>Diag: 记录 forced_kill
  else 正常退出
    Manager->>Diag: 记录 exit_code
  end
  Manager-->>Runtime: 关闭完成
```

## MCP Tool 适配模块

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Adapter["MCP Tool 适配模块"]
    Manager["McpToolAdapterManager<br/>P0 · 边界类，生成注册计划"]:::p0
    NamePolicy["NamePolicy<br/>P0 · mcp__server__tool 与 alias"]:::p0
    Tool["McpToolAdapter<br/>P0 · 实现 core Tool"]:::p0
    Schema["SchemaMapper<br/>P1 · 保留 inputSchema"]:::p1
    Conflict["ConflictDiagnostics<br/>P1 · alias 冲突诊断"]:::p1
  end

  Infra["MCP 基础设施模块<br/>邻居，执行 tools/call"]:::p2
  Registry["ToolRegistry<br/>邻居，按 name 注册"]:::p2

  Manager --> NamePolicy
  Manager --> Schema
  Manager --> Tool
  Manager --> Conflict
  Tool --> Infra
  Registry --> Tool
```

### Tool 注册生命周期

```mermaid
stateDiagram-v2
  [*] --> descriptor_discovered
  descriptor_discovered --> canonical_planned: 生成 canonical name
  canonical_planned --> canonical_registered: ToolRegistry.register 成功
  canonical_planned --> registration_failed: canonical 冲突
  canonical_registered --> alias_planned: 配置声明 alias
  alias_planned --> alias_registered: alias 无冲突
  alias_planned --> alias_skipped: alias 已存在或关闭
  alias_registered --> [*]
  alias_skipped --> [*]
  registration_failed --> [*]
```

### Tool 调用流程

```mermaid
sequenceDiagram
  participant Runner as Runner
  participant Approval as SafetyGatedApproval
  participant Tool as McpToolAdapter
  participant Manager as McpManager
  participant Server as MCP Server

  Runner->>Approval: decide(tool_call)
  Approval-->>Runner: allow / approval result
  Runner->>Tool: execute(args, ToolContext)
  Tool->>Manager: call_tool(server_id, mcp_tool_name, args)
  Manager->>Server: JSON-RPC tools/call
  Server-->>Manager: result 或 error
  Manager-->>Tool: McpCallResult
  Tool-->>Runner: ToolResult
```

## Runtime 装配模块

### 启动注册流程

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Runtime["Runtime 装配模块"]
    Manager["McpRuntimeRegistrationManager<br/>P0 · 边界类，启动并注册"]:::p0
    Shared["Web shared assets<br/>P1 · registry 与 diagnostics"]:::p1
    Enabled["enabled_tool_names 合并<br/>P1 · canonical 与 alias"]:::p1
    CloseHook["shutdown hook<br/>P0 · 调用 McpManager.aclose"]:::p0
  end

  Config["MCP 配置模块<br/>server configs"]:::p2
  Infra["MCP 基础设施模块<br/>McpManager"]:::p2
  Adapter["MCP Tool 适配模块<br/>Tool adapters"]:::p2
  Native["SessionEngine.build<br/>既有 runtime 装配入口"]:::p2

  Config --> Manager
  Manager --> Infra
  Manager --> Adapter
  Manager --> Shared
  Manager --> Enabled
  Enabled --> Native
  Manager --> CloseHook
```

## 通用 Web Search 集成模块

### 组件依赖

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph WebSearch["通用 Web Search 集成模块"]
    Manager["WebSearchManager<br/>P0 · 边界类，统一 provider 并暴露 web_search"]:::p0
    Provider["底层搜索 Tool<br/>P1 · MCP 或用户注册的 search tool"]:::p1
    Normalizer["WebSearchResultNormalizer<br/>P1 · 统一 URL/title/snippet/schema"]:::p1
    Diagnostics["web_search_diagnostics<br/>P1 · 记录 provider、alias 与错误"]:::p1
  end

  Registry["ToolRegistry<br/>邻居，提供 mcp__minimax__web_search"]:::p2
  Factory["WebResearchSourceProviderFactory<br/>邻居，DeepResearch 消费 web_search"]:::p2
  Agent["Agent / Workflow<br/>邻居，直接调用 web_search"]:::p2

  Registry --> Provider
  Manager --> Provider
  Manager --> Normalizer
  Manager --> Diagnostics
  Manager --> Registry
  Factory --> Manager
  Agent --> Manager
```

### MiniMax Web Search MCP 到通用 web_search 链路

```mermaid
sequenceDiagram
  participant User as 用户配置 YAML
  participant Runtime as Web Runtime 装配
  participant Registry as ToolRegistry
  participant Search as WebSearchManager
  participant Factory as WebResearchSourceProviderFactory
  participant DR as DeepResearch
  participant MCP as MiniMax MCP Server
  participant Artifact as Workflow Artifact

  User->>Runtime: mcp.servers[minimax] + web_search provider 配置
  Runtime->>Registry: register mcp__minimax__web_search
  Runtime->>Search: bind mcp__minimax__web_search
  Search->>Registry: expose web_search
  Search->>MCP: tools/call
  MCP-->>Search: URL / title / snippet
  Search-->>Registry: WebSearchResponse
  Factory->>Registry: 探测默认搜索工具名
  Registry-->>Factory: web_search
  DR->>Factory: search(query)
  Factory->>Search: 调用 web_search Tool
  Search-->>Factory: WebSearchResponse
  Factory-->>DR: ResearchSourceCandidate
  DR->>Artifact: 写入 sources + diagnostics
```

## 安全与观测模块

### 审批与诊断边界

```mermaid
flowchart TD
  classDef p0 fill:#E8F1FE,stroke:#0071E3,color:#1D1D1F,stroke-width:1.5px
  classDef p1 fill:#FFF4E5,stroke:#FF9500,color:#1D1D1F,stroke-width:1.5px
  classDef p2 fill:#F2F2F7,stroke:#8E8E93,color:#1D1D1F,stroke-width:1.5px

  subgraph Obs["安全与观测模块"]
    Diag["Diagnostics payloads<br/>P1 · 结构化诊断"]:::p1
    Naming["Tool name metadata<br/>P0 · server/tool/alias 可解释"]:::p0
    Rules["mcp_unknown / allowlist<br/>P0 · 现有审批规则"]:::p0
    Artifact["Workflow diagnostics<br/>P1 · source 与错误证据"]:::p1
  end

  Adapter["MCP Tool 适配模块<br/>提供 name 与 metadata"]:::p2
  Runtime["Runtime 装配模块<br/>提供 startup diagnostics"]:::p2
  Safety["SafetyGatedApproval<br/>既有审批链"]:::p2

  Adapter --> Naming
  Runtime --> Diag
  Naming --> Rules
  Rules --> Safety
  Diag --> Artifact
```

## 数据模型

### 实体关系

```mermaid
erDiagram
  MCP_CONFIG ||--o{ MCP_SERVER_CONFIG : contains
  MCP_SERVER_CONFIG ||--o{ MCP_TOOL_ALIAS_CONFIG : declares
  MCP_SERVER_CONFIG ||--o{ MCP_TOOL_DESCRIPTOR : lists
  MCP_TOOL_DESCRIPTOR ||--o{ MCP_TOOL_REGISTRATION : maps_to
  MCP_TOOL_REGISTRATION ||--o{ MCP_CALL_RESULT : produces
  MCP_TOOL_REGISTRATION }o--|| TOOL_REGISTRY : registers
  TOOL_REGISTRY ||--o{ WEB_SEARCH_RESPONSE : exposes
  WEB_SEARCH_RESPONSE ||--o{ WEB_SEARCH_RESULT : contains

  MCP_CONFIG {
    boolean enabled
    string servers
  }
  MCP_SERVER_CONFIG {
    string server_id
    boolean enabled
    string command
    string args
    string env
  }
  MCP_TOOL_ALIAS_CONFIG {
    string tool_name
    string alias
    boolean enabled
  }
  MCP_TOOL_DESCRIPTOR {
    string server_id
    string name
    string description
    string input_schema
  }
  MCP_TOOL_REGISTRATION {
    string kongming_tool_name
    string canonical_name
    string mcp_tool_name
    boolean is_alias
  }
  MCP_CALL_RESULT {
    boolean ok
    string content_text
    string error_message
    string diagnostics
  }
  TOOL_REGISTRY {
    string name
    string tool_protocol
  }
  WEB_SEARCH_RESPONSE {
    string query
    string diagnostics
  }
  WEB_SEARCH_RESULT {
    string url
    string title
    string snippet
    string provider_name
  }
```
