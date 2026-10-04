# 目标与完成标准

## 需求要点

1. Kongming MCP client v0.1 已按模块化、低耦合架构落地。
2. 第一版目标是接入 MiniMax Web Search MCP，形成可复用的通用 Web Search 能力。
3. MCP 能力需要支持用户配置任意 stdio MCP server，能力模型保持通用。
4. DeepResearch 继续通过已有 ToolRegistry / ResearchSourceProvider 注入链消费通用 `web_search` 或 `deep_research_search`。
5. MCP 模块需要遵守现有架构：协议真源在 `core.contracts`，`tools` 避开 safety 依赖，运行时装配由 `runtime_assembly` / host 负责，配置由 `infrastructure.config` 负责。
6. 第一版只支持 stdio MCP server，只实现 initialize、tools/list、tools/call，只把 MCP tools 注册为 Kongming Tool。
7. 设计需要覆盖安全、审批、进程生命周期、错误诊断、E2E 验证和未来扩展到 resources/prompts/HTTP transport。

## 系统目标

MCP client v0.1 的目标是把外部 MCP server 变成 Kongming 的可审批、可观测、可关闭、可测试工具来源。第一版以 MiniMax Web Search MCP 作为真实 Web Search provider，把搜索能力标准化为通用 `web_search` 工具，并让 DeepResearch 作为首个 workflow 消费方验证真实网页来源。

## 完成目标（DoD）

- [x] DoD#1 配置一个 stdio MCP server 后，Kongming 启动时能 initialize 并 list_tools。
- [x] DoD#2 MCP tools 被注册为 Kongming Tool，工具 schema 保留 JSON Schema，调用走 tools/call。
- [x] DoD#3 MiniMax Web Search MCP 能通过通用 Web Search 层暴露 `web_search`，DeepResearch `source_provider_diagnostics` 显示 `search_tool_name=web_search`。
- [x] DoD#4 MCP server 失败、超时、缺 uvx、鉴权失败时有结构化诊断，baseline tool/runtime 保持可用。
- [x] DoD#5 runtime shutdown 会关闭 stdio MCP 子进程，无孤儿进程。
- [x] DoD#6 MCP 工具命名、metadata 和 diagnostics 已接入现有 `SafetyGatedApproval` 审批链；per-server / per-tool allowlist 属于后续细化项。
- [x] DoD#7 有 pytest 覆盖 config、JSON-RPC fake server、adapter、runtime registration、通用 Web Search 和 DeepResearch E2E smoke。

## 范围边界

**包含**：
- `mcp.servers` 独立配置段和每个 server 的 command、args、env、timeout、enabled、tool alias 配置。
- stdio transport、JSON-RPC request/response id 管理、initialize、tools/list、tools/call 和关闭流程。
- MCP tool descriptor 到 `core.contracts.Tool` 的适配，包含 canonical name、alias、description、input_schema 和 metadata。
- Web/CLI 装配将 MCP tools 注册进 `ToolRegistry`，并把 alias 加入 enabled tool 集合。
- 通用 Web Search 对外暴露 `web_search`，DeepResearch 继续通过 `WebResearchSourceProviderFactory` 探测 `deep_research_search`、`web_search`、`search_web`、`browser_search`。
- 审批命名策略、默认阻断、allowlist 配置、诊断事件和 workflow artifact 记录。
- fake MCP server 测试与真实 MiniMax MCP smoke。

**不包含**：
- MCP resources、prompts、sampling、roots 和 server notification 的完整协议支持。
- HTTP/SSE transport 与远程 MCP server 认证体系。
- 在 `src/core/runner.py` 中加入 MCP 分支。
- 在 `src/tools/` 中 import `safety.capability_policy` 或 `safety.permission_policy`。
- 把 MCP 配置塞进 DeepResearch 配置段。
- 为旧的内部试验接口增加 shim / deprecation wrapper。

## 关键约束

- 协议单一真源：只复用 `src/core/contracts/tool_runtime.py` 的 `Tool` / `ToolContext` / `ToolResult` / `ToolLookup`；除非 x-req 证明必要，v0.1 避免新增 core 协议。
- core 零 sibling 依赖：MCP client 位于 `src/infrastructure/mcp/` 与 `src/tools/mcp/`，core runner 只看 Tool。
- tool runtime 避开 safety 依赖：审批由现有 `SafetyGatedApproval` 和自动审批规则基于 tool name / metadata 决策。
- runtime 装配集中：Web 装配点是 `src/hosts/web/run.py::_make_runtime_factory` 的 shared assets 构建路径；CLI 装配沿用 `SessionEngine.build(...)` 前的 registry 构建。
- 配置由 `src/infrastructure/config` 负责：复杂 server 配置以 YAML 为主，env 只覆盖 enabled、secret env key 和少量全局开关。
- 命名约束：server_id 只允许 `[A-Za-z0-9_-]+`；tool_name 转安全标识；原始 MCP name 写入 metadata。
- 默认安全：canonical MCP tool 走 `mcp_unknown`；alias 只有在显式配置且无注册冲突时生效。

## DoD ↔ 模块追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task | 状态 |
|---------|------------|-------------|------|
| DoD#1 initialize 并 list_tools | MCP 配置模块 + MCP 基础设施模块 + Runtime 装配模块 | `mcp-config-v0.1` + `mcp-stdio-client-v0.1` + `mcp-runtime-registration-v0.1` | 已完成 |
| DoD#2 注册为 Kongming Tool 并走 tools/call | MCP 基础设施模块 + MCP Tool 适配模块 + Runtime 装配模块 | `mcp-stdio-client-v0.1` + `mcp-tool-adapter-v0.1` + `mcp-runtime-registration-v0.1` | 已完成 |
| DoD#3 MiniMax Web Search 暴露为通用 `web_search` 并被 DeepResearch 发现 | MCP 配置模块 + MCP Tool 适配模块 + 通用 Web Search 集成模块 | `mcp-tool-adapter-v0.1` + `web-search-minimax-client-v0.1` | 已完成 |
| DoD#4 失败诊断且 baseline 可用 | MCP 基础设施模块 + Runtime 装配模块 + 安全与观测模块 | `mcp-stdio-client-v0.1` + `mcp-runtime-registration-v0.1` | 已完成 |
| DoD#5 shutdown 关闭子进程 | MCP 基础设施模块 + Runtime 装配模块 | `mcp-stdio-client-v0.1` + `mcp-runtime-registration-v0.1` | 已完成 |
| DoD#6 审批策略生效 | MCP Tool 适配模块 + 安全与观测模块 | `mcp-tool-adapter-v0.1` + `mcp-runtime-registration-v0.1` | 基础完成 |
| DoD#7 pytest 覆盖关键层 | 全部模块 | 全部 task | 已完成 |
