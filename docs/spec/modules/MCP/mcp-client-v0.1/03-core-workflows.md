# 核心流程

本文件只描述流程事实。流程图与时序图集中在 [diagrams.md](./diagrams.md)。

## 流程 1：启动并注册 MCP tools

1. Config loader 读取 YAML/env 中的 `mcp.servers`，输出 `Config.mcp` 和启用的 `McpServerConfig`。
2. Runtime 装配层创建 `McpRuntimeRegistrationManager`，传入 config、event sink、diagnostics sink 和待注册的 `ToolRegistry`。
3. `McpRuntimeRegistrationManager` 创建 `McpManager`，按 server_id 启动 stdio 子进程。
4. `McpManager` 对每个 server 发起 initialize，成功后发起 tools/list。
5. `McpToolAdapterManager` 把 descriptors 转成注册计划，生成 canonical tools 和显式 alias tools。
6. Runtime 装配层调用 `ToolRegistry.register()`，遇到 alias 冲突时跳过 alias 并记录诊断。
7. `SessionEngine.build(...)` 接收已注册的 registry 和最终 enabled tool 集合。
8. Web shared assets 记录 startup diagnostics，供 workflow manager 和排障 artifact 使用。

对应图见 [diagrams.md §Runtime 装配模块](./diagrams.md#runtime-装配模块)。

## 流程 2：MiniMax Web Search MCP 注入通用 Web Search

1. 用户配置 MiniMax MCP server，并声明其 search tool 可作为通用 Web Search provider。
2. Web runtime 启动时完成 MCP 注册，`ToolRegistry` 中存在 canonical tool `mcp__minimax__web_search`。
3. `WebSearchManager` 绑定 canonical tool，并暴露稳定的 `web_search` Tool alias。
4. agent、workflow 或 DeepResearch 调用 `web_search`，输入 query、max_results、region 等通用参数。
5. `WebSearchManager` 将调用转交给底层 MCP Tool，MCP Tool 再调用 `McpManager.call_tool(server_id="minimax", tool_name="<原始 MCP name>")`。
6. MiniMax MCP server 返回 URL、title、snippet、content_text 等结果。
7. `WebSearchManager` 将返回值归一化为 `WebSearchResponse`。
8. DeepResearch 的 `WebResearchSourceProviderFactory` 继续从 ToolRegistry 发现 `web_search`，并把 `WebSearchResponse` 转成 `ResearchSourceCandidate` / `ResearchSourceRecord`。
9. workflow artifact 写入真实网页来源、`source_provider_diagnostics.search_tool_name=web_search` 和 MCP/Web Search diagnostics。

对应图见 [diagrams.md §通用 Web Search 集成模块](./diagrams.md#通用-web-search-集成模块)。

## 流程 3：MCP tool 调用与错误诊断

1. Runner 根据 LLM tool_call 找到 Kongming Tool，现有审批链先处理 tool name。
2. 审批通过后，`McpToolAdapter.execute()` 接收 args 和 `ToolContext`。
3. adapter 根据 registration metadata 找到 server_id 与 MCP 原始 tool name。
4. `McpManager.call_tool()` 发送 tools/call JSON-RPC request，并等待匹配 id 的 response。
5. 成功响应转换为 `ToolResult(ok=True, content=..., data=...)`。
6. JSON-RPC error、timeout、进程退出、缺 command、鉴权失败等路径转换为 `ToolResult(ok=False, error_message=..., data={"mcp_diagnostics": ...})`。
7. 诊断事件进入 trace / Web artifact，baseline runtime 继续服务其他工具。

对应图见 [diagrams.md §MCP Tool 适配模块](./diagrams.md#mcp-tool-适配模块)。

## 流程 4：runtime shutdown 释放 MCP 子进程

1. Web 或 CLI runtime 进入关闭流程。
2. Runtime 装配层持有 `McpRuntimeRegistrationManager` 的生命周期引用。
3. 关闭阶段调用 `McpRuntimeRegistrationManager.aclose()`。
4. `McpManager.aclose()` 对全部已启动 server 执行 stdin close、terminate、wait 和超时 kill。
5. 关闭结果写入 diagnostics，包含 server_id、pid、exit_code、elapsed_ms 和是否强制 kill。
6. 测试通过进程句柄和 fake server sentinel 文件确认无孤儿进程。

对应图见 [diagrams.md §MCP 基础设施模块](./diagrams.md#mcp-基础设施模块)。

## 流程 5：alias 冲突处理

1. `McpToolAdapterManager` 先生成 canonical name，canonical name 冲突表示 server_id/tool_name 安全标识冲突，需要阻断该 tool 注册。
2. adapter 再处理显式 alias，例如 `web_search`。
3. 若 registry 已存在 alias，同名 alias 跳过，canonical tool 继续保留。
4. diagnostics 记录 `skipped_aliases`、冲突目标、server_id 和 MCP 原始 tool name。
5. 通用 Web Search 只会暴露已成功绑定的搜索 alias；缺 alias 时 DeepResearch diagnostics 显示 `search_tool_missing`，Web Search diagnostics 同时记录 provider_missing 或 alias_skipped。

对应图见 [diagrams.md §MCP Tool 适配模块](./diagrams.md#mcp-tool-适配模块)。

## 流程 6：用户自带搜索工具接入 `web_search`

1. 宿主或测试先把 `browser_search`、`search_web`、`deep_research_search` 等普通 Kongming Tool 注册进 `ToolRegistry`。
2. `mcp.servers=[]` 时，`McpRuntimeRegistrationManager.register()` 跳过 MCP server 启动。
3. 注册管理器仍调用 Web Search 注册逻辑，按 `web_search.search_tool_name` / `search_tool_names` 查找已有搜索工具。
4. 命中后构造 `WebSearchManager`，注册稳定 `web_search` Tool。
5. DeepResearch 的 `WebResearchSourceProviderFactory` 继续从 registry 发现 `web_search`，后续流程与 MCP 搜索来源一致。

这个流程保证 `web_search` 是通用应用能力，MCP 是 provider 来源之一。
