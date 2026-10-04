# MCP 接入方式

本文件说明当前 MCP 架构如何接入不同 server、搜索工具和 DeepResearch 来源能力。

## 架构分层

| 层 | 门户 | 输入 | 输出 | 设计边界 |
|----|------|------|------|----------|
| 配置层 | `infrastructure.config` | `mcp` / `web_search` / `web.deep_research_source_provider` | pydantic config snapshot | 只解析配置，不启动进程。 |
| MCP 基础设施层 | `McpManager` | `McpServerConfig` | `McpToolDescriptor` / `McpCallResult` | 只管 stdio、JSON-RPC 和生命周期。 |
| Tool 适配层 | `McpToolAdapterManager` | MCP descriptors + alias 配置 | Kongming `Tool` | 只做命名、schema、ToolResult 映射。 |
| Runtime 装配层 | `McpRuntimeRegistrationManager` | Config + `ToolRegistry` | 注册结果 + diagnostics | Web/CLI 共享启动、注册、关闭。 |
| 搜索应用层 | `WebSearchManager` | 任意搜索 Tool | `web_search` Tool | 归一化 URL/title/snippet/provider。 |
| DeepResearch 来源层 | `WebResearchSourceProviderFactory` | 搜索/抓取 Tool | `ResearchSourceProvider` | workflow 只看来源协议，不看 MCP。 |

## 接入方式 1：任意 MCP tool 作为 canonical tool

适合：只想让模型直接调用某个外部 MCP tool，不需要业务 alias。

```yaml
mcp:
  enabled: true
  servers:
  - server_id: example
    command: uvx
    args:
    - example-mcp-server
    - "--stdio"
    initialize_timeout_ms: 30000
    call_timeout_ms: 60000
```

启动后，MCP tools/list 返回的每个 tool 都会注册为：

```text
mcp__example__<safe_tool_name>
```

命名规则：

| 输入 | 输出规则 |
|------|----------|
| `server_id` | 来自配置，只允许 `[A-Za-z0-9_-]+`。 |
| MCP 原始 tool name | 非字母数字下划线字符转 `_`，转小写，去首尾 `_`。 |
| canonical tool name | `mcp__<safe_server_id>__<safe_tool_name>`。 |

## 接入方式 2：给 MCP tool 配显式 alias

适合：某个 MCP tool 是稳定业务能力，希望 LLM 看到短名字。

```yaml
mcp:
  enabled: true
  servers:
  - server_id: docs
    command: uvx
    args:
    - docs-mcp
    aliases:
    - tool_name: search_docs
      alias: docs_search
      enabled: true
```

运行时行为：

| 情况 | 行为 |
|------|------|
| canonical 名未冲突 | 注册 `mcp__docs__search_docs`。 |
| alias 名未冲突 | 额外注册 `docs_search`。 |
| alias 已被占用 | 跳过 alias，保留 canonical，并写入 `skipped_aliases` diagnostics。 |
| alias 为 `web_search` 且 `web_search.enabled=true` | 由通用 Web Search wrapper 保留，alias 不直接注册。 |

## 接入方式 3：接入通用 `web_search`

适合：外部 MCP server 或用户工具提供搜索能力，DeepResearch、普通 agent 和未来功能都通过统一 `web_search` 使用。

```yaml
web_search:
  enabled: true
  provider_name: minimax_web_search
  search_tool_name: mcp__minimax__web_search
  search_tool_names:
  - mcp__minimax__web_search
  - browser_search
  - search_web
  max_results: 5
```

`WebSearchManager` 支持的 provider 返回形态：

| 字段 | 说明 |
|------|------|
| `results` / `items` / `web_results` / `sources` / `hits` | 常见搜索结果数组。 |
| `organic` / `organic_results` | MiniMax Web Search MCP 形态。 |
| `data` / `result` | 包裹层，递归抽取内部结果。 |
| `url` / `link` / `href` / `source_url` | 单条结果 URL 字段。 |
| `title` / `name` / `headline` | 标题字段。 |
| `snippet` / `summary` / `description` / `content` / `text` | 摘要字段。 |

错误语义：

| provider 返回 | `web_search` 行为 |
|---------------|-------------------|
| `ToolResult(ok=False)` | `web_search` 返回 `ok=false` 并透传 `error_message`。 |
| 文本以 `Failed to perform search:` 或 `API Error:` 开头 | 标记 `ok=false`，写入 diagnostics。 |
| `raw_result.isError=true` | 标记 `ok=false`。 |
| 无 URL 结果 | `ok` 保持底层状态，`result_count=0`。 |

## 接入方式 4：MiniMax Web Search MCP

当前默认配置使用 MiniMax Token Plan MCP：

```yaml
mcp:
  enabled: true
  servers:
  - server_id: minimax
    command: uvx
    args:
    - minimax-coding-plan-mcp
    - "-y"
    env:
      MINIMAX_API_HOST: https://api.minimax.io
    secret_env_keys:
    - MINIMAX_API_KEY
    initialize_timeout_ms: 30000
    call_timeout_ms: 60000

web_search:
  enabled: true
  provider_name: minimax_web_search
  search_tool_name: mcp__minimax__web_search
```

部署要点：

| 项 | 说明 |
|----|------|
| `MINIMAX_API_KEY` | 通过 `.env` 或进程环境提供，配置文件只声明 `secret_env_keys`。 |
| `MINIMAX_API_HOST` | 配置中可给默认值；进程环境同名变量优先。Mainland key 通常需要 `https://api.minimaxi.com`。 |
| `uvx` | 当前通过 `command: uvx` 拉起 stdio server；缺命令会进入 `missing_command` diagnostics。 |

## 接入方式 5：DeepResearch search-only provider

适合：搜索工具只返回 URL、title、snippet，暂无正文抓取工具。

```yaml
web:
  deep_research_source_provider:
    enabled: true
    provider_name: web_user_tool_research_source
    search_tool_names:
    - web_search
    - search_web
    - browser_search
```

运行时行为：

| 搜索结果字段 | DeepResearch 来源记录 |
|--------------|----------------------|
| `url` / `link` / `href` | `ResearchSourceCandidate.url` |
| `title` / `name` | `ResearchSourceCandidate.title` |
| `snippet` / `summary` / `description` | `ResearchSourceRecord.content_text` |
| 无 fetch tool 且有摘要 | `status=fetched`、`tier=weak` |
| 无 fetch tool 且无摘要 | `status=candidate`、`tier=weak`、`error_code=fetch_tool_unavailable` |

该模式适合低成本 smoke 和搜索摘要可用的轻量调研；正式长报告应接 fetch 工具。

## 接入方式 6：DeepResearch search + fetch provider

适合：搜索工具返回 URL，另一个工具负责抓取网页正文。

```yaml
web:
  deep_research_source_provider:
    enabled: true
    search_tool_name: web_search
    fetch_tool_name: web_fetch
```

fetch tool 输入：

| 参数 | 来源 |
|------|------|
| `url` | 候选 URL。 |
| `canonical_url` | 去重后的规范 URL。 |
| `source_id` | 稳定来源 ID。 |
| `title` | 搜索结果标题。 |
| `candidate` | 完整候选 dict。 |

fetch tool 输出字段：

| 字段 | 说明 |
|------|------|
| `content_text` / `content` / `text` / `markdown` | 正文内容，命中后写 `status=fetched`、`tier=strong`。 |
| `source` / `result` / `data` / `page` | 可作为正文 payload 包裹层。 |

## 接入方式 7：用户自带搜索工具，无 MCP server

适合：宿主已经注册了 `browser_search`、`search_web` 或自定义搜索 Tool，MCP 作为可选来源。

```yaml
web_search:
  enabled: true
  provider_name: user_search
  search_tool_names:
  - browser_search
  - search_web
```

`McpRuntimeRegistrationManager.register()` 在 `mcp.servers=[]` 时，仍会尝试从现有 `ToolRegistry` 找搜索工具并包装为 `web_search`。这保证 Web Search 是通用应用层能力，MCP 是其中一种来源。

## 扩展方式：新增 HTTP/SSE transport

当前 `McpManager` 只实现 stdio。未来新增 HTTP/SSE 时应保持上层接口不变：

| 需要保持 | 原因 |
|----------|------|
| `list_tools(server_id) -> tuple[McpToolDescriptor, ...]` | Tool adapter 不感知 transport。 |
| `call_tool(server_id, tool_name, args) -> McpCallResult` | `McpToolAdapter` 不感知 HTTP/SSE。 |
| `aclose()` | Runtime 关闭流程不分 transport。 |
| diagnostics shape | Web/trace/workflow artifact 可复用。 |

推荐演进路径：

1. 抽出 transport client protocol，保留 `McpManager` 作为生命周期门面。
2. stdio 和 HTTP/SSE 分别实现 transport 内部细节。
3. `McpRuntimeRegistrationManager` 只按 server config 选择 transport，不改 Tool adapter。

## 排障入口

| 症状 | 优先检查 |
|------|----------|
| 没有 MCP tool | `McpRuntimeRegistrationResult.diagnostics.started_servers`、`descriptor_count`。 |
| `web_search` 不存在 | `web_search.enabled`、`search_tool_name`、`candidate_tool_names`。 |
| DeepResearch 还是 fallback | `source_provider_diagnostics.search_tool_name`、`web.deep_research_source_provider.enabled`。 |
| 搜索 0 结果 | `web_search` ToolResult 的 `diagnostics`、provider 原始 `content`。 |
| invalid api key | `MINIMAX_API_KEY` 与 `MINIMAX_API_HOST` 是否匹配。 |
| 事件循环错误 | MCP server 是否在长期 runtime loop 内启动；避免在临时 `asyncio.run()` 里预热启动。 |
