# MCP 实现机制

## 一句话总结

项目通过 Effect 架构实现了一个完整的 MCP（Model Context Protocol）服务层，负责统一管理本地（stdio）和远程（HTTP/SSE）MCP 服务器的生命周期——包括配置解析、连接建立、工具发现与 AI SDK 格式转换、OAuth 认证流程、以及将 MCP 工具注入到会话 ReAct 循环中供 LLM 调用。

---

## 核心架构

整个 MCP 实现围绕 Effect Service Layer 构建，核心目录结构：

```
packages/opencode/src/
├── mcp/
│   ├── index.ts          # MCP 主服务 (Service + layer)
│   ├── auth.ts           # OAuth 凭证持久化层
│   ├── oauth-provider.ts # OAuth Client Provider (实现 MCP SDK 接口)
│   └── oauth-callback.ts # OAuth 回调 HTTP 服务器
├── config/mcp.ts         # MCP 配置 Schema 定义 & Claude Code 格式兼容
└── session/prompt.ts     # 会话层：将 MCP 工具注入 LLM 的 ReAct 循环
```

---

## 1. 配置层 (`config/mcp.ts`)

定义了两种 MCP 服务器类型，使用 Effect Schema：

- **`Local`** — stdio 本地服务器：`type: "local"`, `command` (命令行), `environment`, `timeout`, `enabled`
- **`Remote`** — HTTP 远程服务器：`type: "remote"`, `url`, `headers`, `oauth`, `timeout`, `enabled`

还包含关键工具函数：

- **`fromClaude()`** — 兼容 Claude Code 的 `mcpServers` 配置格式，自动将 `claude` 来源的本地服务器标记为 `pending` 状态（需要用户手动启用）
- **`redactString()` / `redactCommand()`** — 日志输出时脱敏敏感信息（token、密钥等）

---

## 2. 核心服务 (`mcp/index.ts`)

### 2.1 服务接口

- `status()` — 所有 MCP 服务器的连接状态
- `tools()` — 已连接服务器的工具列表 (AI SDK Tool 格式)
- `prompts()` — 已连接服务器的 prompt 列表
- `resources()` — 已连接服务器的 resource 列表
- `add()` — 动态添加 MCP 服务器
- `connect()` — 建立连接
- `disconnect()` — 断开连接
- `startAuth()` — 启动 OAuth 授权流程
- `authenticate()` — 浏览器端 OAuth 认证
- `finishAuth()` — 完成 OAuth 回调
- `removeAuth()` — 清除凭证

### 2.2 状态管理

```ts
{
  status: Record<string, Status>       // 每个服务器的连接状态
  clients: Record<string, MCPClient>   // 活跃的 MCP 客户端实例
  defs: Record<string, MCPToolDef[]>   // 每个服务器的工具定义缓存
}
```

6 种状态：`connected` | `disabled` | `pending` | `failed` | `needs_auth` | `needs_client_registration`

### 2.3 连接流程

**本地服务器 (Local)**：

```
解析 command → 创建 StdioClientTransport（注入环境变量）
    → connectTransport() → new Client() → client.connect(transport)
    → listTools() → 缓存工具定义 → 注册 ToolListChanged 监听
```

**远程服务器 (Remote)**：

```
按优先级尝试传输层：
  1. StreamableHTTP（首选）
  2. SSE（降级）

每种传输：
  → 创建 transport（注入 headers + OAuth provider）
  → connectTransport() → new Client() → client.connect(transport)

遇到 UnauthorizedError：
  → 保存 transport 到 pendingOAuthTransports
  → 状态设为 needs_auth / needs_client_registration
  → 发布 Toast 通知用户手动认证
```

### 2.4 工具发现与转换

```
遍历 connected 的 clients
  → 从缓存 defs[name] 获取 MCPToolDef[]
  → convertMcpTool(): MCPToolDef → AI SDK Tool
      - mcpTool.inputSchema → JSONSchema7（强制 type: "object"）
      - 生成 Tool ID: "{sanitized_client}_{sanitized_tool_name}"
      - execute 包装: client.callTool({name, arguments}, ...)
```

### 2.5 工具列表变更监听

```
每个 connected client 注册 ToolListChangedNotificationSchema 回调：
  → 收到通知 → 重新调用 listTools()
  → 更新 s.defs → 发布 ToolsChanged BusEvent
  → UI 层接收事件后进行实时刷新
```

---

## 3. OAuth 认证流程

### 3.1 组件协作

```
McpOAuthProvider   ← 实现 MCP SDK 的 OAuthClientProvider 接口
McpOAuthCallback   ← HTTP Server (localhost:19876) 接收回调
McpAuth            ← 凭证持久化 (JSON 文件, chmod 0o600)
```

### 3.2 完整认证流程

```
1. startAuth(mcpName)
   ├─ 启动 OAuth Callback HTTP Server (ensureRunning)
   ├─ 生成随机 oauthState（防 CSRF）
   ├─ 创建 McpOAuthProvider + StreamableHTTPClientTransport
   └─ client.connect(transport)
        ├─ 成功 → 直接 connected（无需认证）
        └─ UnauthorizedError → 返回 authorizationUrl + oauthState

2. authenticate(mcpName) — CLI/UI 触发
   ├─ 调用 startAuth()
   ├─ 打开浏览器: open(authorizationUrl)
   ├─ 等待回调: McpOAuthCallback.waitForCallback()
   │    └─ 用户在浏览器授权
   │    └─ OAuth Server redirect → localhost:19876/mcp/oauth/callback
   │    └─ 验证 state（防 CSRF）
   │    └─ resolve(code)
   └─ finishAuth(code)
        ├─ transport.finishAuth(code) → 获取 token
        ├─ McpAuth 保存 tokens
        ├─ 清理 pendingOAuthTransports
        └─ createAndStore() → 建立正式连接 + 发现工具
```

### 3.3 OAuth Callback Server (`oauth-callback.ts`)

- 监听 `http://127.0.0.1:19876/mcp/oauth/callback`
- 支持自定义 redirectUri（用户配置）
- 5 分钟超时
- CSRF 保护：验证 state 参数匹配
- 返回 HTML_SUCCESS / HTML_ERROR 页面

### 3.4 凭证存储 (`auth.ts`)

- 文件路径：`~/.mimocode/mcp-auth.json`（权限 0o600）
- 存储结构：`Record<mcpName, { tokens, clientInfo, codeVerifier, oauthState, serverUrl }>`
- 支持动态客户端注册 (RFC 7591)：`clientInfo` 中保存 `clientId`、`clientSecret`、过期时间

---

## 4. 会话集成 (`session/prompt.ts`)

在 ReAct 循环中：

```
prompt.ts 启动时:
  → yield* MCP.Service → 获取 mcp 实例
  → yield* mcp.tools() → 获取所有 MCP 工具（AI SDK Tool 格式）
  → 与原生工具混在一起注入到 LLM 的 system prompt 中

运行时:
  → LLM 调用 MCP 工具时
  → execute(args, opts) → client.callTool({name, arguments})
  → 返回工具执行结果
  → 支持 toolCallId 追踪、超时控制、权限校验
```

---

## 5. 生命周期管理

```
启动（State 初始化）:
  → 遍历 cfg.mcp 配置
  → disabled → 直接标记
  → claude 来源的 local → 标记 pending
  → 其他 → create() 连接

Shutdown（Finalizer）:
  → 遍历 s.clients
  → stdio 进程：kill 子进程树（SIGTERM）
  → 所有 client.close()
  → 清理 pendingOAuthTransports
```

---

## 6. 关键设计特点

| 特性 | 实现方式 |
|------|---------|
| **错误处理** | `.pipe(Effect.catch(() => ...))` 兜底，永不抛异常 |
| **超时控制** | `timeout` 参数控制连接和工具调用超时 |
| **依赖注入** | 全部使用 Service + Layer 依赖注入 |
| **并发启动** | `{ concurrency: "unbounded" }` 并行初始化多个服务器 |
| **传输降级** | StreamableHTTP 失败 → 自动尝试 SSE |
| **工具缓存** | `defs[name]` 缓存工具定义，`ToolListChanged` 事件驱动更新 |
| **凭证安全** | 日志脱敏、JSON 文件 0o600 权限、CSRF state 验证 |
| **Claude Code 兼容** | `fromClaude()` 自动转换配置格式 |
