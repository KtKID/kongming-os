# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| MCP 配置模块 | 定义 `mcp.servers`、server secret/env 解析和 schema 输出 | `infrastructure.config` | 已实现 | 独立于 DeepResearch 配置 |
| MCP 基础设施模块 | 管理 stdio MCP server 生命周期和 JSON-RPC 调用 | MCP 配置模块 | 已实现 | fake server 覆盖 initialize/list/call/shutdown |
| MCP Tool 适配模块 | 把 MCP tool descriptor 转成 Kongming `Tool` | MCP 基础设施模块 + `core.contracts.Tool` | 已实现 | 处理 canonical name、alias、schema、metadata |
| Runtime 装配模块 | 在 Web/CLI/runtime 构建时启动 MCP 并注册 tools | MCP 配置模块 + MCP 基础设施模块 + MCP Tool 适配模块 + `ToolRegistry` | 已实现 | 覆盖 MCP 关闭/无 server 时的 `web_search` 包装 |
| 通用 Web Search 集成模块 | 把 MiniMax Web Search MCP 等搜索 provider 统一暴露为 `web_search` | `ToolRegistry` + MCP Tool 适配模块 | 已实现 | DeepResearch 是首个消费者 |
| 安全与观测模块 | 定义 MCP tool 审批、allowlist、诊断事件和 artifact 字段 | safety auto approval + tracing/event sinks | 基础完成 | 复用现有审批链，per-tool allowlist 后续细化 |

## MCP 配置模块

**边界类**：`McpConfig` / `McpServerConfig` / `McpToolAliasConfig` / `WebSearchConfig` / `WebDeepResearchSourceProviderConfig`

**包位置**：`src/infrastructure/config`

**职责**：定义和解析 MCP 全局配置，输出运行时可消费的 server 配置快照。

**包含范围**：
- `McpConfig`、`McpServerConfig`、`McpToolAliasConfig`、`WebSearchConfig`、`WebDeepResearchSourceProviderConfig`。
- YAML 配置段 `mcp.servers`。
- env secret key 解析，例如从配置声明读取 `MINIMAX_API_KEY`。
- server_id 校验、command/args/env/timeout/enabled 校验。
- config schema 与单元测试。

**不包含范围**：
- 启动 MCP 子进程。
- 解释 MCP tool descriptor。
- 审批 allowlist 决策。

**依赖**：复用 `src/infrastructure/config/models.py`、`loader.py`、`schema.py` 的现有配置加载路径。

**复用/新建**：复用 config 模型和 loader；MCP、Web Search 和 Web DeepResearch provider 配置段已落在 `src/infrastructure/config/models.py`、`loader.py`、`schema.py`。

**数据结构/接口**：

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class McpToolAliasConfig:
    server_id: str          # MCP server 唯一标识，只允许字母、数字、下划线、短横线
    tool_name: str          # MCP 原始工具名，来自 tools/list 返回
    alias: str              # Kongming Tool alias，例如 web_search
    enabled: bool           # alias 是否启用，默认由 YAML 控制

@dataclass(frozen=True)
class McpServerConfig:
    server_id: str                         # MCP server 唯一标识，用于命名空间和诊断
    enabled: bool                          # server 是否参与启动和注册
    command: str                           # stdio server 启动命令，例如 uvx
    args: tuple[str, ...]                  # 启动参数，按原顺序传给子进程
    env: dict[str, str]                    # 传给子进程的环境变量明文值
    secret_env_keys: tuple[str, ...]       # 需要从宿主环境读取的敏感变量名
    initialize_timeout_ms: int             # initialize 超时毫秒数
    call_timeout_ms: int                   # tools/call 超时毫秒数
    aliases: tuple[McpToolAliasConfig, ...] # 该 server 暴露到 Kongming 的可选 alias

@dataclass(frozen=True)
class McpConfig:
    enabled: bool                          # MCP client 总开关
    servers: tuple[McpServerConfig, ...]   # 所有声明的 MCP server 配置快照
```

**风险等级**：低

**风险说明**：env 白名单当前显式维护，复杂 server 配置采用 YAML 为主可以降低 env 组合复杂度。

**task 建议**：
- 建议 task 名：`mcp-config-v0.1`
- 对应 DoD：DoD#1、DoD#3、DoD#7
- 状态：已完成
- 验证重点：配置边界清晰，可独立实现和测试。

## MCP 基础设施模块

**边界类**：`McpManager`

**包位置**：`src/infrastructure/mcp/`

**职责**：管理 stdio MCP server 生命周期，提供 initialize、tools/list、tools/call 和关闭能力。

**包含范围**：
- stdio 子进程启动、stdin/stdout JSON-RPC framing、stderr 捕获。
- JSON-RPC request id 分配、响应匹配、错误映射、超时控制。
- initialize、tools/list、tools/call 三个 MCP 方法。
- server 状态机、健康状态、诊断快照和 shutdown。
- fake MCP server 测试夹具。

**不包含范围**：
- Kongming Tool 注册。
- alias 决策。
- safety import 和审批逻辑。
- HTTP transport。

**依赖**：MCP 配置模块；Python async subprocess；event sink 或 diagnostics sink 由装配层注入。

**复用/新建**：全新 `src/infrastructure/mcp/`；复用现有 async-first 运行风格和事件诊断习惯。

**数据结构/接口**：

```python
from dataclasses import dataclass
from typing import Any

@dataclass(frozen=True)
class McpToolDescriptor:
    server_id: str              # 所属 MCP server 标识
    name: str                   # MCP 原始工具名
    title: str | None           # MCP 工具标题，可能为空
    description: str            # MCP 工具描述，传给 Kongming Tool
    input_schema: dict[str, Any] # MCP 工具输入 JSON Schema，原样保留

@dataclass(frozen=True)
class McpCallResult:
    server_id: str              # 所属 MCP server 标识
    tool_name: str              # MCP 原始工具名
    ok: bool                    # tools/call 是否成功
    content_text: str           # 归一化文本内容，供 ToolResult.content 使用
    data: dict[str, Any]        # 原始结构化响应，供诊断和上层 adapter 使用
    error_message: str | None   # 错误信息，成功时为空

class McpManager:
    async def start_all(self) -> None:
        """启动全部启用的 server，输出为内部状态和诊断。"""

    async def list_tools(self, server_id: str) -> tuple[McpToolDescriptor, ...]:
        """读取指定 server 的工具列表，输入 server_id，输出 MCP tool descriptors。"""

    async def call_tool(self, server_id: str, tool_name: str, args: dict[str, Any]) -> McpCallResult:
        """调用指定 MCP tool，输入 server/tool/args，输出结构化调用结果。"""

    async def aclose(self) -> None:
        """关闭全部 stdio 子进程，输出为释放后的状态。"""
```

**风险等级**：中

**风险说明**：stdio JSON-RPC framing、初始化握手和异常关闭是 v0.1 最大工程风险，需要 fake server PoC 最先落地。

**task 建议**：
- 建议 task 名：`mcp-stdio-client-v0.1`
- 对应 DoD：DoD#1、DoD#2、DoD#4、DoD#5、DoD#7
- 状态：已完成
- 验证重点：基础设施决定后续 adapter 和 runtime 装配的可验证边界。

## MCP Tool 适配模块

**边界类**：`McpToolAdapterManager`

**包位置**：`src/tools/mcp/` 或 `src/tools/mcp_tool_adapter.py`

**职责**：把 MCP tool descriptor 适配为 `core.contracts.Tool`，执行时委托 `McpManager.call_tool()`。

**包含范围**：
- canonical name 生成：`mcp__<server_id>__<tool_name>`。
- tool_name 安全标识转换和原始 name metadata 保留。
- alias 注册计划，例如业务短名；`web_search` 由通用搜索 wrapper 保留和注册。
- `input_schema` 原样传递，必要时补齐 object schema 壳。
- `execute()` 到 tools/call 的参数、结果和错误转换。
- 重名冲突处理：canonical 冲突阻断，alias 冲突跳过并诊断。

**不包含范围**：
- 启动 MCP server。
- 直接读取 config loader。
- 直接 import safety。

**依赖**：`core.contracts.Tool` / `ToolContext` / `ToolResult`；`McpManager`；`ToolRegistry` 由装配模块传入。

**复用/新建**：新建 adapter；复用 `src/core/contracts/tool_runtime.py` 和 `src/tools/runtime/registry.py`。

**数据结构/接口**：

```python
from dataclasses import dataclass
from typing import Any

@dataclass(frozen=True)
class McpToolRegistration:
    tool_name: str                    # 注册到 ToolRegistry 的 Kongming Tool 名
    server_id: str                    # 所属 MCP server 标识
    mcp_tool_name: str                # MCP 原始工具名
    is_alias: bool                    # 当前注册名是否为 alias
    input_schema: dict[str, Any]      # Kongming Tool 暴露给 LLM 的 JSON Schema
    metadata: dict[str, Any]          # 原始 MCP descriptor、server_id、canonical_name 等诊断信息

@dataclass(frozen=True)
class McpToolAdapterPlan:
    registrations: tuple[McpToolRegistration, ...] # 准备注册的工具清单
    skipped_aliases: tuple[str, ...]                # 因冲突跳过的 alias 名称
    diagnostics: dict[str, Any]                     # 命名、schema、冲突和来源诊断

class McpToolAdapterManager:
    def build_registration_plan(self, descriptors: tuple[McpToolDescriptor, ...]) -> McpToolAdapterPlan:
        """生成注册计划，输入 MCP descriptors，输出 canonical 和 alias 工具清单。"""

    def build_tool(self, registration: McpToolRegistration) -> object:
        """构造实现 Tool 协议的 adapter 实例，输入注册项，输出 Kongming Tool。"""
```

**风险等级**：中

**风险说明**：alias 冲突和审批 allowlist 需要保守默认；通用 Web Search wrapper 负责注册 `web_search`，同时要保护已有同名工具。

**task 建议**：
- 建议 task 名：`mcp-tool-adapter-v0.1`
- 对应 DoD：DoD#2、DoD#3、DoD#6、DoD#7
- 状态：已完成
- 验证重点：安全命名、alias 冲突和 schema 保真都在此模块收口。

## Runtime 装配模块

**边界类**：`McpRuntimeRegistrationManager`

**包位置**：`src/hosts/shared/mcp_runtime_registration.py`，Web 入口由 `src/hosts/web/run.py` 调用，CLI 入口由 `src/hosts/cli/main.py` 调用。

**职责**：在 runtime 构建前启动 MCP、注册 tools、更新 enabled tools，并在 runtime 关闭时释放 MCP 子进程。

**包含范围**：
- 从 Config 取 `McpConfig`。
- 构建 `McpManager`、启动 server、收集 descriptors。
- 调用 `McpToolAdapterManager` 生成 tools，并注册到 `ToolRegistry`。
- 处理 `enabled_tool_names`：canonical 受配置开关控制，alias 按显式配置加入。
- 输出 startup diagnostics，注入 Web workflow manager 可读取的诊断上下文。
- 接入 runtime shutdown，保证 `McpManager.aclose()` 被调用。

**不包含范围**：
- 修改 `Runner.run()`。
- 在 workflow strategy 内部启动 MCP 或 MiniMax 客户端。
- 静默覆盖已有同名 tool。

**依赖**：`SessionEngine.build(...)` 前的 registry 构建路径；Web `_make_runtime_factory` / `_ensure_shared_assets`；CLI registry 构建路径；`ToolRegistry.register()`。

**复用/新建**：复用 `src/tools/__init__.py::build_default_registry` 的外部 register 模式；新增装配 helper。

**数据结构/接口**：

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class McpRuntimeRegistrationResult:
    started_servers: tuple[str, ...]         # 成功启动并完成 initialize 的 server_id
    registered_tools: tuple[str, ...]        # 已注册到 ToolRegistry 的 Kongming Tool 名
    enabled_tool_names: tuple[str, ...]      # 装配后允许 runtime 暴露的 tool 名
    diagnostics: dict[str, object]           # 启动、跳过、失败、alias 冲突等结构化诊断

class McpRuntimeRegistrationManager:
    async def register(self, registry: object, enabled_tool_names: tuple[str, ...]) -> McpRuntimeRegistrationResult:
        """启动 MCP 并注册 tools，输入 registry 和 enabled 集合，输出注册结果。"""

    async def aclose(self) -> None:
        """释放 MCP manager 和子进程，输入为空，输出为关闭后的诊断状态。"""
```

**风险等级**：中

**风险说明**：runtime 生命周期与 Web shared assets 生命周期需要对齐，shutdown 测试必须覆盖正常关闭、启动失败和半启动状态。

**task 建议**：
- 建议 task 名：`mcp-runtime-registration-v0.1`
- 对应 DoD：DoD#1、DoD#2、DoD#4、DoD#5、DoD#6、DoD#7
- 状态：已完成
- 验证重点：这是 MCP 能力进入 Kongming runtime 的共享装配入口。

## 通用 Web Search 集成模块

**边界类**：`WebSearchManager`

**包位置**：`src/application/web_search/`；DeepResearch 侧继续沿用 `src/hosts/web/research_source_provider.py`

**职责**：把 MiniMax Web Search MCP、未来直连 MiniMax Token Plan Search HTTP client、用户自定义搜索 MCP 等来源统一成 Kongming 的通用 Web Search 能力，并以 `web_search` Tool / `WebSearchResult` 结果格式对外暴露。

**包含范围**：
- 从 ToolRegistry 中绑定 `mcp__minimax__web_search` 或用户配置的搜索 tool。
- 暴露稳定 `web_search` Tool alias，输出 URL、title、snippet、published_at、source provider metadata。
- 归一化 MiniMax MCP 返回、未来 HTTP client 返回和 fake search provider 返回。
- 提供 `WebSearchResult` / `WebSearchResponse` 给 workflow、agent tool 和后续 fetch/crawl 模块复用。
- 让 DeepResearch 的 `WebResearchSourceProviderFactory` 继续通过 ToolRegistry 发现 `web_search`。

**不包含范围**：
- import MCP 模块。
- 在 DeepResearch strategy 内实现搜索 provider 选择。
- 把 MiniMax provider 逻辑写进 DeepResearch。
- 实现非搜索类 MCP resources/prompts。

**依赖**：`ToolRegistry` / `ToolLookup`；MCP Tool 适配模块注册出的 canonical tool；DeepResearch contracts 作为首个下游消费者。

**复用/新建**：新建通用 Web Search manager；复用现有 `WebResearchSourceProviderFactory` 作为 DeepResearch 消费端 adapter。

**数据结构/接口**：

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class WebSearchResult:
    url: str                         # 搜索结果 URL，必须是可追溯外部来源
    title: str                       # 搜索结果标题，来自 provider 或归一化逻辑
    snippet: str                     # 搜索结果摘要，用于初筛和引用上下文
    provider_name: str               # 搜索 provider 名，例如 minimax_web_search
    provider_tool_name: str          # 底层 Kongming Tool 名，例如 mcp__minimax__web_search
    published_at: str | None         # 来源发布日期，provider 未提供时为空
    metadata: dict[str, object]      # 原始 provider 响应、rank、region、elapsed_ms 等诊断信息

@dataclass(frozen=True)
class WebSearchResponse:
    query: str                       # 用户或 workflow 发起的搜索 query
    results: tuple[WebSearchResult, ...] # 归一化后的搜索结果列表
    diagnostics: dict[str, object]   # provider、alias、错误、耗时等结构化诊断

class WebSearchManager:
    async def search(self, query: str, *, max_results: int | None = None) -> WebSearchResponse:
        """执行通用网页搜索，输入 query 和可选数量限制，输出归一化搜索响应。"""
```

**风险等级**：中

**风险说明**：MiniMax MCP 返回格式、未来 HTTP client 返回格式和用户自定义搜索工具输出需要统一 schema；第一版先以 MiniMax MCP + fake provider 固定最小字段。

**task 建议**：
- 建议 task 名：`web-search-minimax-client-v0.1`
- 对应 DoD：DoD#3、DoD#7
- 状态：已完成
- 验证重点：MiniMax Web Search 已接成通用 `web_search` 能力，DeepResearch smoke 验证 workflow 消费路径。

## 安全与观测模块

**边界类**：`McpRuntimeRegistrationResult.diagnostics` / `McpToolAdapterPlan.diagnostics` / `WebSearchResponse.diagnostics`

**包位置**：`src/hosts/shared/mcp_runtime_registration.py`、`src/tools/mcp/adapter.py`、`src/application/web_search/manager.py`；审批规则继续放现有 safety auto approval 配置。

**职责**：统一 MCP tool 命名、审批可解释信息、诊断事件和 workflow artifact 字段。

**包含范围**：
- canonical name 与 alias 的安全标签。
- startup diagnostics：server 启动、initialize、tools/list、alias 冲突、schema 异常。
- call diagnostics：timeout、JSON-RPC error、process exit、auth failure、missing command。
- Web artifact 字段：MCP server、tool、alias、elapsed_ms、error_kind。
- 审批配置建议：canonical 默认命中 `mcp_unknown`，allowlist 使用 server_id + tool_name。

**不包含范围**：
- 替代现有 `SafetyGatedApproval`。
- 在 tool adapter 内直接做权限判定。
- 存储敏感 env 明文。

**依赖**：现有 `src/hosts/web/approvals/auto/default_rules.yaml` / `src/safety/auto_approval/default_rules.yaml` 的 `mcp_unknown`；trace/event sinks；workflow artifact 写入路径。

**复用/新建**：复用现有审批链；诊断归一化分布在 runtime registration、adapter 和 Web Search manager 的边界返回值中。

**数据结构/接口**：

```python
from dataclasses import dataclass

@dataclass(frozen=True)
class McpDiagnosticEvent:
    event_type: str          # 诊断事件类型，例如 startup_failed、tool_call_timeout
    server_id: str           # MCP server 标识
    tool_name: str | None    # MCP 原始工具名，server 级事件可为空
    kongming_tool_name: str | None # Kongming Tool 名，包含 canonical 或 alias
    error_kind: str | None   # 错误类型，例如 missing_command、auth_failed、timeout
    message: str             # 面向日志和 artifact 的简短说明
    elapsed_ms: int | None   # 事件耗时毫秒数，未知时为空
```

**风险等级**：低

**风险说明**：审批语义需要与既有 `mcp_unknown` 测试保持一致；真实服务错误分类可在 smoke 后补充。

**task 建议**：
- 建议 task 名：并入 `mcp-tool-adapter-v0.1` 与 `mcp-runtime-registration-v0.1`
- 对应 DoD：DoD#4、DoD#6、DoD#7
- 状态：基础完成
- 验证重点：诊断与审批是 MCP 上线的验收条件，范围分摊到 adapter 和 runtime tasks。
