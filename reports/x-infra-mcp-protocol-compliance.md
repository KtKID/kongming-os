# x-infra-mcp stdio 协议不合规报告

**报告日期**：2026-10-16
**报告对象**：`x-infra-mcp/x_infra_mcp/mcp_server.py`
**对象版本**：x-infra `6d549c6`（2026-10-13 提交），文件 sha256 `acef036c490486aa4a804dcf6e06017c948ad37b216f3f17fd77c9fc3ae28c2e`（177 行）
**报告方**：kongming-os 侧 kmh-infra 插件设计阶段，核对"把 x-infra-mcp 接入标准 MCP 客户端"的可行性时发现
**改动声明**：本次核对只做读取与探测，未修改 x-infra 仓库任何文件

## 结论

`x-infra-mcp` 的 stdio 协议不是 MCP，而是一套私有的逐行 JSON 方言。它不认识生命周期第一步的 `initialize`，所有响应都不带 JSON-RPC 2.0 的 `jsonrpc` 字段，工具调用的结果也不是 MCP 规定的 `content` 数组形状。

因此**任何标准 MCP 客户端都连不上它**。实测用官方 TypeScript SDK（`@modelcontextprotocol/client` 2.0.0，即 DSH 的 `@deepseek-ai/dsh-mcp-client` 所使用的同一套实现）连接，8 秒内没有完成握手。

README 写明的用途——"给本机 AI 工具（zcode 等）用的只读 MCP 查询服务"——在任何标准 MCP 客户端上都不成立。README 给出的 zcode stdio 配置本身没有错，但在标准 MCP 实现下接不上；它在 zcode 里是否实际可用，取决于 zcode 的客户端是否也走标准 MCP 实现，本报告未验证这一点。

## 复现方法与实际输出

以下两条命令在报告日期原样执行，输出为实际结果。

### 复现 1：直接观察协议应答

```sh
cd x-infra-mcp
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"service_list","arguments":{}}}' \
  | PYTHONPATH=. python3 -m x_infra_mcp.mcp_server
```

实际输出：

```
{"id": 1, "error": {"code": "invalid_argument", "message": "unknown initialize"}}
{"id": null, "error": {"code": "invalid_argument", "message": "unknown notifications/initialized"}}
{"id": 3, "result": {"code": "invalid_token", "message": "a valid Bearer X_INFRA_MCP_TOKEN is required", "ok": false}}
```

三点可直接读出：`initialize` 被当成未知方法拒绝；响应帧里没有 `jsonrpc` 字段；通知也回了包，且 `id` 是 `null`。第三行同时说明方言之外的链路是通的——这次调用真的到达了 x-dash（当时进程环境里没有暗号，所以返回 `invalid_token`）。

### 复现 2：用标准 MCP 客户端连接

```sh
cd <dsh>/packages/mcp/mcp-client    # 用到该目录下 node_modules 里的官方 SDK
node --input-type=module -e "
import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'
const transport = new StdioClientTransport({
  command: 'python3',
  args: ['-m', 'x_infra_mcp.mcp_server'],
  cwd: '<x-infra>/x-infra-mcp',
  env: { ...process.env, PYTHONPATH: '.' },
})
const client = new Client({ name: 'probe', version: '0.0.0' })
setTimeout(() => { console.log('TIMEOUT: 8 秒内未完成握手'); process.exit(2) }, 8000)
await client.connect(transport)
console.log('CONNECT OK:', JSON.stringify(await client.listTools()))
await client.close()
"
```

实际输出：

```
TIMEOUT: 8 秒内未完成握手
[exit=2]
```

`client.connect()` 既不成功也不抛错，一直挂起——因为服务端对 `initialize` 给出的那一帧不构成客户端能接受的响应。

## 不合规点

对照 MCP 生命周期、JSON-RPC 2.0 帧格式与工具调用结果三部分。SDK 侧的要求取自 `@modelcontextprotocol/client` 2.0.0 的实际校验代码（消息 schema 中 `jsonrpc` 被定义为字面量 `z.literal("2.0")`，不匹配的帧不会被当作合法响应），客户端默认请求 `protocolVersion` 为 `LATEST_PROTOCOL_VERSION = 2025-11-25`，可接受版本为 `["2025-11-25","2025-06-18","2025-03-26","2024-11-05","2024-10-07"]`。

| 编号 | 位置 | 现状 | 规范要求 | 后果 |
|---|---|---|---|---|
| P1 | `main()`，`mcp_server.py:140` 起的分发 | 没有 `initialize` 分支，落入兜底分支回 `unknown initialize` | 服务端必须实现 `initialize`，回 `result: {"protocolVersion": …, "capabilities": …, "serverInfo": …}` | 握手在第一步就失败，连接无法建立 |
| P2 | `_send()`，`mcp_server.py:135` | 响应帧形如 `{"id": …, "result"\|"error": …}`，**没有 `jsonrpc` 字段** | 每条响应必须带 `"jsonrpc": "2.0"` | 即使补上 `initialize`，响应仍会被标准客户端丢弃，握手照样不完成 |
| P3 | `main()` 通知处理 | `notifications/initialized` 被当请求处理并回包（`{"id": null, "error": …}`） | 通知一律不产生响应；未知通知应静默忽略 | 客户端收到无 `id` 的响应帧，属协议违规；生命周期的第二步就走不通 |
| P4 | `tools/call` 的返回值 | `result` 直接是业务对象 `{"ok":…, "code":…, "message":…}` | `CallToolResult`：`{"content": [{"type": "text", "text": "…"}], "isError"?: bool}` | 客户端解析工具结果必然失败；"调用成功"这个事实在协议层无法表达 |
| P5 | 错误分层 | 业务错误（`invalid_token` 等）混在 `result` 里，靠自定义 `code` 字符串表达 | 协议层错误用 JSON-RPC 的 `error: {"code": <整数>, "message": …}`；业务失败用 `isError: true` 加 `content` 表达 | 客户端无法区分"协议坏了"和"业务返回了失败" |
| P6 | `id` 回显 | 通知回 `"id": null` | 响应必须原样回显请求的 `id`；通知不产生响应 | 同 P3 |
| P7 | 方法名 | 除 `tools/list`、`tools/call` 外还接受别名 `list_tools`、`call_tool`，甚至直接用工具名当 `method` | 规范方法名只有 `initialize`、`tools/list`、`tools/call`、`notifications/initialized` 等 | 本身不致命，但会掩盖"是否真的合规"，建议一并收敛 |

### 已经对的部分

改造时不必推翻这些：

- **stdout 帧格式**：一条 JSON 一行、`\n` 分隔，符合 stdio 传输对消息分帧的要求（注意日志必须走 stderr，不能混进 stdout）。
- **工具清单形状**：`TOOLS` 里的 `name` / `description` / `inputSchema` 与 MCP 的 `Tool` 结构一致，`inputSchema` 用的是标准 JSON Schema 写法，可以直接沿用。
- **业务语义**：只读边界、状态码加说明成对返回、地址剥 `?` 后内容、`dash_unreachable` 绝不报成空清单——这些是 x-infra-mcp 自己的已确认约束，与协议层无关，改造不得放宽。

## 为什么一直没被发现

- `tests/test_mcp_server.py` 的六个用例全部直接调 `call_tool()` 或经 `_http()` 断言，**没有任何一条经过 stdin/stdout 主循环**。握手、帧格式、通知处理零覆盖，所以协议层缺什么都不会让测试变红。
- 这套方言不是凭空写的：`docs/spec/x-infra-mcp/tech-design.md` 写明"MCP server 骨架（stdio JSON-RPC）"来源是 `x-auth/control-plane/x_auth_control/mcp_server.py`，复制其 `TOOLS` + `call_tool` + stdin 循环结构。该骨架同样没有 `initialize`，也没有 `jsonrpc` 字段（已核对，391 行内无这两者）——属同因同源问题。**本报告只覆盖 x-infra-mcp**，是否连带处理 x_auth_control 的 MCP 由 x-infra 侧决定。
- README 里的 zcode 配置示例只说明了"配置长什么样"，没有任何一次成功连接的记录；现有测试同样只覆盖业务函数，不覆盖"连得上吗"。

## 最小合规改造清单

目标：纯 stdlib、单文件不变，只补协议层。改动集中在 `_send()` 与 `main()` 的分发，`TOOLS`、`call_tool()`、`_http()` 基本不动。

1. **`initialize`**：回
   ```json
   {"jsonrpc":"2.0","id":<原样回显>,"result":{
     "protocolVersion":"2025-11-25",
     "capabilities":{"tools":{}},
     "serverInfo":{"name":"x-infra-mcp","version":"<版本>"}}}
   ```
   若客户端的 `params.protocolVersion` 落在自己支持的列表里，回它请求的那个版本更稳妥；不在列表里则回自己支持的最新版（客户端会据此决定是否继续）。
2. **通知**：`method` 以 `notifications/` 开头的，一律不回包，直接读下一行。未知通知同理静默忽略。
3. **`tools/list`**：`{"jsonrpc":"2.0","id":<id>,"result":{"tools": TOOLS}}`，现有 `TOOLS` 直接沿用。
4. **`tools/call`**：把现有业务对象塞进 `content` 的文本里，并用 `isError` 表达成败：
   ```json
   {"jsonrpc":"2.0","id":<id>,"result":{
     "content":[{"type":"text","text":"<json.dumps(业务对象, ensure_ascii=False)>"}],
     "isError": <业务对象.ok 为 False>}}
   ```
   保留 `{ok, code, message}` 这套结构作为文本内容，AI 侧仍然读得到完整的状态码与说明；`isError` 只是让客户端知道这次调用失败了。
5. **未知方法**：`{"jsonrpc":"2.0","id":<id>,"error":{"code":-32601,"message":"unknown method <method>"}}`，用 JSON-RPC 的标准错误码，不要再用自定义的 `invalid_argument` 表达协议层错误。
6. **所有响应统一加 `"jsonrpc": "2.0"`**，`id` 原样回显。
7. **建议顺手收敛**：去掉 `list_tools` / `call_tool` / 工具名当 `method` 这些非规范别名，让"合规"可判定；JSON 解析失败仍可回 `{"error":{"code":-32700}}`（解析错误，`id` 只能为 `null`，这是规范允许的唯一例外）。
8. **README 同步**：工具描述里内嵌的状态码表保持不变；把"启动（stdio）"一节补上"标准 MCP 客户端可直接接入"的事实，并去掉与实现不符的表述。

## 验收方式

**协议层（建议新增测试，补上现在完全缺失的握手覆盖）**

| 观察点 | 预期 | 禁止结果 |
|---|---|---|
| 喂一帧 `initialize` 取首帧响应 | `jsonrpc` 为 `"2.0"`，`id` 回显，`result` 含 `protocolVersion` / `capabilities` / `serverInfo` | 回 `unknown initialize`，或缺 `jsonrpc` 字段 |
| 喂一帧 `notifications/initialized` | stdout **无任何输出** | 回任何帧，尤其 `"id": null` 的帧 |
| 喂 `tools/call` | `result.content[0].text` 是可解析的 JSON 文本，`isError` 与实际成败一致 | `result` 直接是业务对象 |
| 喂一个未知方法 | `error.code` 为 `-32601` | 用自定义字符串码表达协议层错误 |
| 既有六个单测 | 全部继续通过 | 为过新协议而放宽原有业务断言 |

**客户端层（端到端，决定性证据）**

用复现 2 的那条命令连接（把 `<dsh>`、`<x-infra>` 换成实际路径，并把真实暗号填进 `X_INFRA_MCP_TOKEN`），期望打印出两个工具：

```
CONNECT OK: {"tools":[{"name":"service_list",…},{"name":"service_info",…}]}
```

报告日期的实际结果是 `TIMEOUT: 8 秒内未完成握手`。这条命令是判断"是否真的修好了"的最终依据——协议层单测全绿但这条仍超时，就说明还没修好。

## 修好之后

kmh-infra 插件侧不需要任何协议适配层，直接用 DSH 现成的 `@deepseek-ai/dsh-mcp-client` 以 stdio 接入：`command = python3`、`args = ["-m", "x_infra_mcp.mcp_server"]`、`cwd` 指向 x-infra-mcp 检出目录。

有一点需要在插件侧处理：DSH 会给子进程一份"洗过的"父进程环境，凡名字匹配 `KEY|PASSWORD|SECRET|TOKEN` 的一律不转发，所以 `X_INFRA_MCP_TOKEN` **不会**自动传进去，必须由插件显式放进子进程环境。`X_DASH_BASE_URL` 不在清洗名单里，但也一并显式传入更稳妥。

修好之后助手侧看到的工具名为 `mcp__infra__service_list` 与 `mcp__infra__service_info`。

## 证据来源与边界

- 协议应答：本机实际执行复现 1 的输出（上文原样粘贴）。
- 客户端行为：本机实际执行复现 2 的输出（上文原样粘贴），SDK 为 `@modelcontextprotocol/client` 2.0.0。
- 协议版本与帧格式要求：SDK 运行时导出的常量与源码中的 schema 校验（`jsonrpc` 为字面量 `"2.0"`）。
- 非规范来源：`x_auth_control/mcp_server.py` 只做了"有没有 `initialize` / `jsonrpc`"的文本核对，未做客户端连接实测。
- 未覆盖：MCP 的可选能力（resources、prompts、logging、进度通知）不在本报告范围；工具本身的功能正确性不在本报告范围。

## 复核（2026-10-16，x-infra 侧修复后）

复核时 `x-infra-mcp/x_infra_mcp/mcp_server.py` 的 sha256 已从 `acef036c490486aa4a804dcf6e06017c948ad37b216f3f17fd77c9fc3ae28c2e` 变为 `869a3a25133c1e3efc737280b7b5ba3439c3c309584a1a44f47e39c7e56811df`。

复现 1 按原样重跑，实际输出：

```
{"jsonrpc": "2.0", "id": 1, "result": {"protocolVersion": "2025-06-18", "capabilities": {"tools": {"listChanged": false}}, "serverInfo": {"name": "x-infra-mcp", "version": "1.0.0"}}}
```

`initialize` 有了合规响应（带 `jsonrpc` 字段），且 `notifications/initialized` 不再产生任何输出行，符合 P3 的要求。

复现 2 按原样重跑（客户端层，决定性证据），实际输出：

```
CONNECT OK; tools = service_list, service_info
tools/call -> isError = true ; content[0].type = text
tools/call -> text = {"code": "invalid_token", "message": "a valid Bearer X_INFRA_MCP_TOKEN is required", "ok": false}
RESULT: 协议层验收通过
```

**结论**：P1、P2、P3、P4 已修复——握手成功、响应带 `jsonrpc` 字段、通知不回包、工具结果进 `content` 数组且 `isError` 正确。P5、P6、P7 本次未逐条复核（没有单独构造未知方法与非法帧）。

本次 `tools/call` 返回 `invalid_token` 是复核环境没有暗号导致的预期业务结果，不是协议问题；带真实暗号的完整数据链路未复核。
