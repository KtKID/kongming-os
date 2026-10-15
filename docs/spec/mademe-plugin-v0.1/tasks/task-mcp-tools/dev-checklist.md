# task-mcp-tools · 开发清单

> spec: docs/spec/mademe-plugin-v0.1/spec.md
> 创建: 2026-10-12

**状态**：`[ ] ⏳` 未开始 / `[ ] ▶️` 进行中 / `[x] 🟢` 验证通过 / `[!] 🔴` 验证失败

| # | 任务 | 场景回指 | 涉及文件 | 风险 | 状态 |
|---|---|---|---|---|---|
| T1 | MCP 装配：ctx.plugin(McpClient, {transport:'streamable-http', serverName:'mademe', url:mcpUrl})；mcpEnabled=false 或 url 为空时不装配（面板不受影响） | feat03 场景1, 场景4 | packages/kmh-mademe/src/mcp.ts, packages/kmh-mademe/src/index.ts | None | [x] 🟢 |
| T2 | 配置热切换：setConfig 保存成功后 dispose 旧实例并按新 mcpUrl 重建，serverName 稳定保证工具名不变 | feat03 场景1 | packages/kmh-mademe/src/mcp.ts | None | [x] 🟢 |
| T3 | 集成验收：本地最小 streamable-http MCP 假服务，确认会话中出现 mcp__mademe__* 工具且可调用 | feat03 场景1 | 无（验证行，假服务为临时脚本） | None | [x] 🟢 |
| T4 | 服务未运行与恢复：假服务停止后工具不出现、重启后自动回来（无需重装重启） | feat03 场景2 | 无（验证行） | None | [x] 🟢 |
| T5 | 停用失效：停用插件后 mademe 工具注销 | feat03 场景3 | 无（验证行） | None | [x] 🟢 |

## 影响文件树

```text
kongming-agent-os/
└── packages/kmh-mademe/
    ├── src/index.ts        M  # apply 装配 McpMount
    └── src/mcp.ts          U  # 新增：mcp-client 编程式装配、配置热切换 dispose/重建
```
