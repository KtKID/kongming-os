# MCP Client v0.1

> 状态：已实现
> 目标：让 Kongming 通过通用 stdio MCP client 接入外部 MCP tools，第一版接入 MiniMax Web Search MCP，形成可复用的通用 `web_search` 能力。

## 系统目标

本 spec 定义 Kongming MCP client v0.1 的模块化方案。核心目标是把任意用户配置的 stdio MCP server 装配进现有 ToolRegistry，并把 MiniMax Web Search MCP 首先标准化为通用 `web_search` 工具；DeepResearch 沿用 `ResearchSourceProvider` 注入链消费该工具，同时保持 core、tools、safety、runtime_assembly、host 和 config 的现有边界。

## 最小可用路径

用户在 YAML 配置 MiniMax MCP server → Web/CLI 装配启动 `McpManager` → initialize + tools/list 发现 MiniMax search tool → `McpToolAdapterManager` 注册 `mcp__minimax__web_search` → `WebSearchManager` 暴露通用 `web_search` alias / client → DeepResearch 的 `WebResearchSourceProviderFactory` 发现 `web_search` → 搜索阶段调用通用 Web Search → workflow artifact 写入真实 URL、snippet 和 diagnostics。

## 范围边界

**包含**：
- stdio MCP server 配置、启动、握手、tools/list、tools/call 和关闭。
- MCP tool descriptor 到 Kongming `Tool` 协议的适配。
- canonical tool name `mcp__<server_id>__<tool_name>` 与可选 alias。
- Web/CLI/runtime 装配点和 shutdown 释放。
- 通用 Web Search 通过 ToolRegistry 暴露 `web_search`，DeepResearch 作为首个 workflow 消费方。
- 安全审批、错误诊断、fake MCP server 测试和 MiniMax Web Search smoke。

**不包含**：
- MCP resources、prompts、sampling、roots、notifications 的完整实现。
- HTTP/SSE transport。
- DeepResearch 内部直接 import MCP 模块或 MiniMax 客户端模块。
- 在 core runner 中加入 MCP 专用逻辑。
- 把 MiniMax 或 Web Search 写成 MCP client 的固定能力。

## 模块导航

| 模块 | 状态 | 文档 | task 状态 | 说明 |
|------|------|------|---------------|------|
| MCP 配置模块 | 已实现 | [模块拆分](./02-module-breakdown.md#mcp-配置模块) | 已完成 | 配置模型、YAML 解析、secret env 映射和 schema 输出 |
| MCP 基础设施模块 | 已实现 | [模块拆分](./02-module-breakdown.md#mcp-基础设施模块) | 已完成 | stdio 生命周期、JSON-RPC、initialize、tools/list、tools/call |
| MCP Tool 适配模块 | 已实现 | [模块拆分](./02-module-breakdown.md#mcp-tool-适配模块) | 已完成 | MCP descriptor 转 Kongming Tool，处理命名、alias、schema 和执行 |
| Runtime 装配模块 | 已实现 | [模块拆分](./02-module-breakdown.md#runtime-装配模块) | 已完成 | Web/CLI 装配、enabled tools、关闭钩子和诊断注入 |
| 通用 Web Search 集成模块 | 已实现 | [模块拆分](./02-module-breakdown.md#通用-web-search-集成模块) | 已完成 | 首个 provider 接 MiniMax Web Search MCP，统一暴露 `web_search` |
| 安全与观测模块 | 已实现基础诊断 | [模块拆分](./02-module-breakdown.md#安全与观测模块) | 基础完成 | 复用现有审批链，MCP / Web Search diagnostics 写入 ToolResult、trace 和 workflow artifact |

## 文档导航

- [图集：总览 + 各模块局部图](./diagrams.md)
- [目标与完成标准](./01-goals-and-boundaries.md)
- [模块设计 + 接口 + 数据结构](./02-module-breakdown.md)
- [核心流程](./03-core-workflows.md)
- [数据模型与状态](./04-data-and-state.md)
- [验证策略与演进](./05-validation-and-evolution.md)
- [MCP 接入方式](./06-integration-guide.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. 新接一个 MCP server 时先使用 [MCP 接入方式](./06-integration-guide.md) 的 canonical tool 路径验证 initialize、tools/list 和 tools/call。
2. 搜索类 MCP server 优先接入通用 `web_search`，再让 DeepResearch 通过 `WebResearchSourceProviderFactory` 消费。
3. 长正文调研场景补 `fetch_tool_name`，search-only 模式只保证 `fetched/weak` 摘要来源。
