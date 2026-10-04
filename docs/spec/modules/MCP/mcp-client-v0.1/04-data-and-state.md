# 数据模型与状态

## 核心实体

```python
from dataclasses import dataclass
from typing import Any

@dataclass(frozen=True)
class McpConfig:
    enabled: bool                          # MCP client 总开关
    servers: tuple["McpServerConfig", ...] # 用户声明的 MCP server 配置列表

@dataclass(frozen=True)
class McpServerConfig:
    server_id: str                         # MCP server 唯一标识，用于命名空间、审批和诊断
    enabled: bool                          # 当前 server 是否启用
    command: str                           # stdio server 启动命令，例如 uvx
    args: tuple[str, ...]                  # stdio server 启动参数
    env: dict[str, str]                    # 传给子进程的环境变量明文值
    secret_env_keys: tuple[str, ...]       # 从宿主环境读取并传递的敏感变量名
    initialize_timeout_ms: int             # initialize 请求超时毫秒数
    call_timeout_ms: int                   # tools/call 请求超时毫秒数
    aliases: tuple["McpToolAliasConfig", ...] # MCP tool 到 Kongming alias 的显式映射

@dataclass(frozen=True)
class McpToolAliasConfig:
    tool_name: str                         # MCP 原始工具名
    alias: str                             # Kongming Tool alias，例如 web_search
    enabled: bool                          # alias 是否启用

@dataclass(frozen=True)
class McpToolDescriptor:
    server_id: str                         # 所属 MCP server 标识
    name: str                              # MCP 原始工具名
    title: str | None                      # MCP 工具标题
    description: str                       # MCP 工具描述
    input_schema: dict[str, Any]           # MCP 工具输入 JSON Schema
    raw_descriptor: dict[str, Any]         # tools/list 返回的原始 descriptor

@dataclass(frozen=True)
class McpToolRegistration:
    kongming_tool_name: str                # 注册进 ToolRegistry 的工具名
    canonical_name: str                    # namespaced canonical name
    server_id: str                         # 所属 MCP server 标识
    mcp_tool_name: str                     # MCP 原始工具名
    is_alias: bool                         # 当前工具名是否来自 alias
    input_schema: dict[str, Any]           # 暴露给 LLM 的输入 schema
    metadata: dict[str, Any]               # 原始 MCP name、server_id、canonical name 等诊断信息

@dataclass(frozen=True)
class McpCallResult:
    ok: bool                               # MCP tools/call 是否成功
    content_text: str                      # 转给 ToolResult.content 的文本内容
    data: dict[str, Any]                   # 原始 MCP 响应和结构化结果
    error_message: str | None              # 错误信息，成功时为空
    diagnostics: dict[str, Any]            # 调用耗时、错误类型、server 状态等诊断

@dataclass(frozen=True)
class WebSearchResult:
    url: str                               # 搜索结果 URL，必须可作为来源追溯
    title: str                             # 搜索结果标题
    snippet: str                           # 搜索结果摘要
    provider_name: str                     # 搜索 provider 名，例如 minimax_web_search
    provider_tool_name: str                # 底层 Kongming Tool 名
    published_at: str | None               # 来源发布日期，未知时为空
    metadata: dict[str, Any]               # provider 原始响应、rank、region、耗时等诊断

@dataclass(frozen=True)
class WebSearchResponse:
    query: str                             # 搜索 query
    results: tuple[WebSearchResult, ...]   # 归一化搜索结果
    diagnostics: dict[str, Any]            # provider、alias、错误和耗时诊断
```

## 实体关系

`McpConfig` 持有多个 `McpServerConfig`。每个 server initialize 后产出多个 `McpToolDescriptor`。`McpToolAdapterManager` 把 descriptor 和 alias 配置合成 `McpToolRegistration`，runtime 装配把 registration 对应的 Tool 注册到 `ToolRegistry`。调用阶段 `McpToolRegistration` 指向 `McpManager.call_tool()` 所需的 server_id 和 MCP 原始 tool name。通用 `WebSearchManager` 消费搜索类 registration，输出 `WebSearchResponse`，DeepResearch 再把搜索结果映射为 workflow 来源记录。

实体关系图见 [diagrams.md §数据模型](./diagrams.md#数据模型)。

## 状态流转

### Server 生命周期

```text
configured → starting → initializing → listing_tools → ready
                ↓             ↓              ↓
              failed        failed         degraded

ready → closing → closed
ready → failed
```

状态说明：

| 状态 | 含义 | 进入条件 | 退出条件 |
|------|------|----------|----------|
| configured | 已解析配置，尚未启动 | config loader 完成 | 装配层开始启动 |
| starting | 子进程启动中 | `asyncio.create_subprocess_exec` 调用开始 | 进程句柄创建成功或启动失败 |
| initializing | initialize 握手中 | stdio 可写入 | initialize 成功或失败 |
| listing_tools | tools/list 获取中 | initialize 成功 | tools/list 成功或失败 |
| ready | server 可接受 tools/call | tools/list 成功 | shutdown 或运行期错误 |
| degraded | server 启动成功但部分 tool/alias 注册失败 | tools/list 成功且注册出现可恢复问题 | shutdown 或重新装配 |
| failed | server 无法提供 tools/call | 启动、握手、list 或运行期失败 | 重新启动 |
| closing | 正在释放子进程 | runtime shutdown | closed |
| closed | 子进程已退出 | wait 完成或 kill 完成 | 重新启动 |

状态图见 [diagrams.md §MCP 基础设施模块](./diagrams.md#mcp-基础设施模块)。

### Tool 注册生命周期

```text
descriptor_discovered → canonical_planned → canonical_registered
                              ↓
                         alias_planned → alias_registered
                              ↓
                         alias_skipped
```

注册状态由 runtime diagnostics 保存，ToolRegistry 本身保持现有 name 主键语义。

状态图见 [diagrams.md §MCP Tool 适配模块](./diagrams.md#mcp-tool-适配模块)。

## 持久化方案

| 数据 | 存储方式 | 位置 | 备注 |
|------|---------|------|------|
| MCP server 配置 | YAML + 少量 env | Kongming config 文件 + 宿主环境 | secret 值只从 env 注入，诊断避免明文 |
| runtime server 状态 | 内存 | `McpManager` | 进程句柄、request id、pending calls |
| tool 注册计划 | 内存 | `McpToolAdapterManager` / runtime registration result | 可写入 startup diagnostics |
| startup diagnostics | 内存 + trace/event + Web artifact | event sinks / workflow artifact | 用于排障和 E2E 断言 |
| tools/call diagnostics | ToolResult.data + trace/event | session history / trace / artifact | 失败路径必须结构化 |
| 通用 Web Search 结果 | 内存 + ToolResult.data + workflow artifact | ToolResult / DeepResearch artifact 目录 | 保存 URL、title、snippet、provider_name、diagnostics |

## 共享数据结构

跨模块共享协议继续使用 `core.contracts.Tool`、`ToolContext`、`ToolResult`、`ToolLookup`。MCP 专用结构保留在 `infrastructure.mcp` 和 `tools.mcp` 内部，由边界类方法返回，不提升到 `core.contracts`。

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class McpToolNameParts:
    server_id: str              # MCP server 标识
    safe_tool_name: str         # 转换后的安全工具名
    original_tool_name: str     # MCP 原始工具名
    canonical_name: str         # Kongming canonical name，格式 mcp__server__tool

@dataclass(frozen=True)
class McpStartupDiagnostics:
    enabled: bool                       # MCP 总开关是否启用
    started_servers: tuple[str, ...]    # 成功启动的 server_id
    failed_servers: tuple[str, ...]     # 启动或握手失败的 server_id
    registered_tools: tuple[str, ...]   # 成功注册的 Kongming Tool 名
    skipped_aliases: tuple[str, ...]    # 因冲突或配置关闭跳过的 alias
    messages: tuple[str, ...]           # 面向排障的简短诊断信息
```
