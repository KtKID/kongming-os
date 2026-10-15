/**
 * MadeMe 插件词典：侧栏面板名、占位面板与配置表单文案（zh/en 键一致）。
 */

/** 中文文案。 */
export const zh = {
  panel: "MadeMe",
  "panel.waitingConfig": "正在读取 MadeMe 服务地址……",
  "panel.reload": "刷新",
  "panel.openExternal": "在系统浏览器打开",
  "panel.timeoutTitle": "MadeMe 可能无法内嵌打开",
  "panel.timeoutHint":
    "请检查服务是否正在运行、地址是否正确；也可在系统浏览器中打开。",
  "config.unavailable": "当前环境未提供配置读写，无法编辑。",
  "config.readOnly": "当前配置为只读，无法编辑。",
  "config.save": "保存",
  "config.saving": "保存中……",
  "config.saveFailed": "保存未成功（配置可能已被并发修改），请重试。",
  "config.serviceUrl": "MadeMe 服务地址",
  "config.serviceUrlHint": "内嵌网页打开的目标，如 http://127.0.0.1:30000",
  "config.mcpUrl": "MCP 接入地址",
  "config.mcpUrlHint": "streamable-http 端点，如 http://127.0.0.1:30000/mcp",
  "config.mcpEnabled": "把 MadeMe 工具接入助手",
  "config.mcpEnabledHint":
    "开启后按 MCP 接入地址挂载工具（mcp__mademe__<工具名>）；关闭即卸载",
  "config.overridden": "已覆盖",
  "config.reset": "重置",
  "config.invalidUrl": "需为合法的 http(s) 地址",
  "config.testConnection": "测试连接",
  "config.testing": "测试中…",
  "config.healthOk": "可达",
  "config.healthFail": "不可达或超时",
  "config.healthInvalid": "地址格式无效，请先修正后再测试",
  "config.healthServiceLabel": "服务",
  "config.healthMcpLabel": "MCP",
} as const;

/** 英文文案。 */
export const en = {
  panel: "MadeMe",
  "panel.waitingConfig": "Reading the MadeMe service URL…",
  "panel.reload": "Reload",
  "panel.openExternal": "Open in system browser",
  "panel.timeoutTitle": "MadeMe may not be embeddable",
  "panel.timeoutHint":
    "check whether the service is running and the URL is correct; the system browser also works.",
  "config.unavailable": "Configuration editing is unavailable here.",
  "config.readOnly": "Configuration is read-only here.",
  "config.save": "Save",
  "config.saving": "Saving…",
  "config.saveFailed":
    "Save did not land (config changed concurrently); please retry.",
  "config.serviceUrl": "MadeMe service URL",
  "config.serviceUrlHint": "Embedded page target, e.g. http://127.0.0.1:30000",
  "config.mcpUrl": "MCP endpoint URL",
  "config.mcpUrlHint":
    "streamable-http endpoint, e.g. http://127.0.0.1:30000/mcp",
  "config.mcpEnabled": "Connect MadeMe tools to the assistant",
  "config.mcpEnabledHint":
    "Mounts tools (mcp__mademe__<tool>) at the MCP endpoint when on; off unmounts them",
  "config.overridden": "overridden",
  "config.reset": "Reset",
  "config.invalidUrl": "a legal http(s) URL is required",
  "config.testConnection": "Test connection",
  "config.testing": "Testing…",
  "config.healthOk": "reachable",
  "config.healthFail": "unreachable or timed out",
  "config.healthInvalid": "Invalid URL; fix it before testing",
  "config.healthServiceLabel": "Service",
  "config.healthMcpLabel": "MCP",
} as const;

/** 词典键：以 zh 为准，en 必须同键。 */
export type MadeMeLocaleKey = keyof typeof zh;
