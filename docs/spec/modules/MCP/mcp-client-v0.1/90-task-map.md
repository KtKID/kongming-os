# Task Map

| 模块 | 建议 task 名 | 前置依赖 | 对应 DoD | 风险 | 状态 | 备注 |
|------|--------------|---------|---------|------|------|------|
| MCP 配置模块 | `mcp-config-v0.1` | 无 | DoD#1、DoD#3、DoD#7 | 低 | 已完成 | 已固定 `mcp.servers` YAML、server_id 校验和 env secret 规则 |
| MCP 基础设施模块 | `mcp-stdio-client-v0.1` | `mcp-config-v0.1` 的配置草案 | DoD#1、DoD#2、DoD#4、DoD#5、DoD#7 | 中 | 已完成 | fake MCP server 覆盖 initialize/list/call/shutdown |
| MCP Tool 适配模块 | `mcp-tool-adapter-v0.1` | `mcp-stdio-client-v0.1` 的 descriptor/call 接口 | DoD#2、DoD#3、DoD#6、DoD#7 | 中 | 已完成 | 固定 canonical name、alias 冲突和 schema 保真 |
| Runtime 装配模块 | `mcp-runtime-registration-v0.1` | `mcp-config-v0.1` + `mcp-stdio-client-v0.1` + `mcp-tool-adapter-v0.1` | DoD#1、DoD#2、DoD#4、DoD#5、DoD#6、DoD#7 | 中 | 已完成 | Web `_make_runtime_factory` 和 CLI registry 构建路径已接入 |
| 通用 Web Search 集成模块 | `web-search-minimax-client-v0.1` | `mcp-runtime-registration-v0.1` | DoD#3、DoD#7 | 高，来自外部 MiniMax 服务 | 已完成 | fake Web Search E2E 进 CI，真实 MiniMax smoke 手动跑，DeepResearch 作为首个消费者 |
| 安全与观测模块 | 并入 `mcp-tool-adapter-v0.1` + `mcp-runtime-registration-v0.1` | adapter 命名策略和 runtime diagnostics | DoD#4、DoD#6、DoD#7 | 中 | 基础完成 | 复用现有审批链，后续补 per-tool allowlist |

## 推荐执行顺序

1. `mcp-config-v0.1`
2. `mcp-stdio-client-v0.1`
3. `mcp-tool-adapter-v0.1`
4. `mcp-runtime-registration-v0.1`
5. `web-search-minimax-client-v0.1`

## task 拆分依据

- `mcp-stdio-client-v0.1` 提前执行，因为 stdio JSON-RPC 和 lifecycle 是最大工程风险。
- `mcp-tool-adapter-v0.1` 与 `mcp-runtime-registration-v0.1` 需要共享 canonical name、alias 和 diagnostics 约定。
- 通用 Web Search smoke 放在基础能力之后，因为它需要 MCP runtime 和 adapter 成熟；DeepResearch smoke 作为首个 workflow 消费者验证 artifact。
- 安全与观测贯穿 adapter 和 runtime；审批策略由现有 safety 链执行，MCP 模块提供可解释名称和 metadata。

## DoD 覆盖闭环

| DoD | 覆盖 task | 验证入口 |
|-----|-----------|----------|
| DoD#1 | `mcp-config-v0.1` + `mcp-stdio-client-v0.1` + `mcp-runtime-registration-v0.1` | fake MCP initialize/list pytest |
| DoD#2 | `mcp-stdio-client-v0.1` + `mcp-tool-adapter-v0.1` + `mcp-runtime-registration-v0.1` | adapter execute pytest |
| DoD#3 | `mcp-tool-adapter-v0.1` + `web-search-minimax-client-v0.1` | `web_search` 直接调用 + Web DeepResearch smoke |
| DoD#4 | `mcp-stdio-client-v0.1` + `mcp-runtime-registration-v0.1` | failure diagnostics pytest |
| DoD#5 | `mcp-stdio-client-v0.1` + `mcp-runtime-registration-v0.1` | shutdown pytest |
| DoD#6 | `mcp-tool-adapter-v0.1` + `mcp-runtime-registration-v0.1` | approval auto rules pytest |
| DoD#7 | 全部 task | pytest + E2E smoke |
