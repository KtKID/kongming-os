# 验证策略与演进

## 验证策略

### Smoke / E2E 验收入口

- **Smoke 路径**：使用 fake stdio MCP server 启动 Kongming，完成 initialize、tools/list、ToolRegistry 注册和一次 tools/call。
- **通用 Web Search E2E 路径**：配置 MiniMax Web Search MCP 为通用 `web_search` provider，先直接调用 `web_search` 断言返回真实 URL 和 snippet，再从 Web 触发 DeepResearch，断言 `source_provider_diagnostics.search_tool_name=web_search`。
- **用户搜索工具路径**：在 MCP 关闭或无 server 时预注册普通搜索 Tool，断言 `McpRuntimeRegistrationManager` 仍能包装出 `web_search`。
- **故障 smoke 路径**：分别覆盖 command 缺失、initialize 超时、tools/call 超时、JSON-RPC error、鉴权失败样例，断言 diagnostics 存在且 runtime 仍可使用 baseline tools。
- **任务验收规则**：每个 task README 显式列出对应 DoD、pytest 路径、fake server fixture 和真实 MiniMax smoke 的执行条件。

### 单元测试

- **覆盖模块**：MCP 配置模块、MCP 基础设施模块、MCP Tool 适配模块、Runtime 装配模块、通用 Web Search 集成模块。
- **框架**：pytest。
- **重点场景**：server_id 校验、env secret 解析、JSON-RPC id 匹配、stdio timeout、descriptor schema 保真、canonical 命名、alias 冲突、ToolResult 错误映射、shutdown。

### 集成测试

- **端到端链路**：config → McpManager fake server → tools/list → ToolRegistry → `WebSearchManager` → `web_search` alias → `WebResearchSourceProviderFactory` → DeepResearch smoke。
- **环境要求**：fake MCP server 作为默认 CI 路径；真实 MiniMax MCP smoke 需要显式 API key、地区/endpoint 满足服务要求。
- **触发方式**：fake server 测试进 CI；真实 MiniMax smoke 标记为外部服务测试，可由 x-verify 手动执行。

### 手动验证

- **必须人工过的场景**：通用 `web_search` ToolResult 与 Web DeepResearch artifact 中的来源链接、snippet、诊断展示是否便于排障。
- **验收人**：执行该 spec 的开发者和发起需求的用户。

## 测试覆盖要求

| 模块 | 最低覆盖要求 | 重点文件 |
|------|-------------|---------|
| MCP 配置模块 | 配置模型、loader、schema、env secret 单测 | `src/infrastructure/config/models.py`、`loader.py`、`schema.py` |
| MCP 基础设施模块 | fake MCP server 覆盖 initialize、tools/list、tools/call、timeout、shutdown | `src/infrastructure/mcp/` |
| MCP Tool 适配模块 | namespacing、alias、schema 保留、ToolResult 映射、冲突诊断 | `src/tools/mcp/` |
| Runtime 装配模块 | Web/CLI registry 注册、enabled tools、startup diagnostics、shutdown | `src/hosts/shared/mcp_runtime_registration.py`、`src/hosts/web/run.py`、`src/hosts/cli/main.py` |
| 通用 Web Search 集成模块 | `web_search` 直接调用、source provider 发现 `web_search`、artifact diagnostics 断言 | `src/application/web_search/`、`src/hosts/web/research_source_provider.py`、DeepResearch e2e |
| 安全与观测模块 | `mcp_unknown`、allowlist、diagnostics 字段 | approval auto rules tests、workflow artifact tests |

## 分层验证清单

| 验证项 | 断言 | 对应 DoD | 状态 |
|--------|------|----------|------|
| config 单测 | YAML `mcp.servers` 能解析，server_id 非法时报错 | DoD#1 | 已覆盖 |
| fake initialize/list | fake server 收到 initialize 与 tools/list，返回 descriptor | DoD#1 | 已覆盖 |
| adapter 单测 | `mcp__minimax__web_search` 与 alias 注册计划正确 | DoD#2、DoD#3 | 已覆盖 |
| tools/call 单测 | Tool.execute 调用 `McpManager.call_tool()` 并保留 schema/data | DoD#2 | 已覆盖 |
| runtime shutdown | runtime close 后 fake server 进程退出 | DoD#5 | 已覆盖 |
| 用户搜索工具包装 | MCP 关闭或无 server 时仍可包装已有搜索 Tool 为 `web_search` | DoD#3 | 已覆盖 |
| 通用 Web Search + DeepResearch smoke | `web_search` 返回真实 URL，`source_provider_diagnostics.search_tool_name=web_search` | DoD#3 | 已覆盖 |
| 故障诊断测试 | 缺 command、超时、auth failure 均有结构化 diagnostics | DoD#4 | 已覆盖 |

## 风险与 PoC

| 风险 | 等级 | PoC / 验证建议 | 进入顺序 |
|------|------|----------------|----------|
| stdio JSON-RPC framing、初始化握手、响应 id 匹配 | 中 | 最先实现 fake MCP server，覆盖并发 request 和异常 response | 第一优先 |
| alias 冲突和审批 allowlist | 中 | 先写 adapter 冲突测试和 `mcp_unknown` 测试，再接通用 `web_search` alias | 第一优先 |
| Token Plan key、地区、endpoint、服务可用性 | 高 | fake MCP 作为稳定 E2E；真实 MiniMax smoke 作为外部服务档 | 第二优先 |
| shutdown 与 Web shared assets 生命周期 | 中 | 用 fake server sentinel 与进程 wait 断言关闭 | 第一优先 |
| tool schema 与 provider payload 兼容 | 中 | 保留 MCP inputSchema 原文，provider 层继续做现有 Tool schema 转换 | 第二优先 |

## 演进路线

### 短期（本轮 task）

- [x] `mcp-config-v0.1`：配置模型、loader、schema、单测。
- [x] `mcp-stdio-client-v0.1`：`McpManager`、JSON-RPC、stdio transport、fake MCP server 测试。
- [x] `mcp-tool-adapter-v0.1`：Tool adapter、namespacing、alias、approval 名称策略、单测。
- [x] `mcp-runtime-registration-v0.1`：CLI/Web/runtime 装配、enabled tools、shutdown、诊断事件。
- [x] `web-search-minimax-client-v0.1`：MiniMax MCP 配置示例、通用 `web_search` 直接调用、DeepResearch Web E2E、workflow artifact 验证。

### 中期（下 1-2 轮）

- [ ] MCP resources/list、resources/read 转为只读资料工具或 ResearchSource fetch 能力。
- [ ] MCP prompts/list、prompts/get 接入 prompt assembly 的可选来源。
- [ ] MCP server health 面板和 Web 诊断视图。
- [ ] 支持 per-server allowlist 和 per-tool 用户可见说明。

### 长期（方向性）

- HTTP/SSE MCP transport。
- 多 server 并发连接池和懒启动。
- MCP roots、notifications、sampling 的 host 能力设计。
- MCP tool 结果到 workflow artifact 的统一 source provenance 标准。
