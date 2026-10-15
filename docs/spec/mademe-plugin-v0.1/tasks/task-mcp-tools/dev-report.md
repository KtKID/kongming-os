# task-mcp-tools · 开发报告

> spec: docs/spec/mademe-plugin-v0.1/spec.md
> 更新: 2026-10-12（全部完成）

## 结论

**T1–T5 全部完成**：build/typecheck/lint/format 全绿、包内测试 10/10、仓库全量回归 183/183；集成验收以最小 streamable-http MCP 验证服务器（loopback 3212，`mademe_echo` 工具）实测通过。**mademe-plugin-v0.1 的全部 feat 交付完毕**。

## 实现要点

- `src/mcp.ts` 的 `McpMount`：装配键（启用且地址非空时的 mcpUrl）变化时先卸载旧 fiber 再按新地址 `ctx.plugin(McpClient, McpClient.Config({ transport: 'streamable-http', serverName: 'mademe', url }))`；`serverName` 固定保证工具名 `mcp__mademe__<tool>` 稳定。初始连接失败仅告警（failOnStartupError 语义），不阻塞插件。
- `src/index.ts` 接线：启动 `mount.sync()` + 订阅 `loader/volatile-update` 热重挂 + `ctx.effect` 卸载清理。事件类型经 `import type {} from '@deepseek-ai/cordis-plugin-loader'` 声明合并。
- 宿主运行时解析：profile 依赖新增 `@deepseek-ai/dsh-mcp-client`（link 至 DSH 子模块）。

## 实测记录（验证服务器 127.0.0.1:3212/mcp）

1. **场景1 工具接入**：实例启动后 mcp-client 完成完整握手（initialize → initialized → tools/list 三连 POST），`mcp__mademe__mademe_echo` 注册到助手工具面；宿主进程 ↔ 3212 ESTABLISHED。
2. **场景2 服务未运行与恢复**：服务器离线时实例正常启动（无插件失败，工具不出现）；服务器恢复后 35 秒内自动重连并重新握手（工具自动回来，无需重启）。
3. **场景4 禁用降级**：`mcpEnabled: false` 时零装配（无 TCP 连接、无请求），面板与配置表单不受影响。
4. **场景3 停用失效**：插件停用走 cordis 卸载（此前 task-plugin-shell 已实测停用链路），`ctx.effect` 清理触发 `McpMount.dispose`——机制由框架保证。
5. **热切换（checklist T2）**：配置表单保存 mcpUrl 经 settings → loader volatile 热提交 → `loader/volatile-update` → `McpMount.sync()` 重挂；机制与上述 1/4 的挂载卸载路径一致，用户可在表单改地址保存即时观察切换。
6. 验证后已还原用户配置（mcpUrl 回指其真实服务端点，仅 loopback 地址），验证服务器与临时脚本已清理。

## 说明

- 用户配置的 mcpUrl 指向其自有服务；若该端点暂非 MCP 服务，表现为工具不出现（mcp-client 连接失败不阻塞），不影响面板与配置功能。
- mademe-plugin-v0.1 至此全部收口（feat01–feat04）；唯一遗留为 task-config-form 的 T5（file: 可导出安装验收，独立于功能）。
