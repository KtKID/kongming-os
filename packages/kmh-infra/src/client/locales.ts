/**
 * kmh-infra 插件词典：侧栏面板名、面板占位与配置表单文案（zh/en 键一致）。
 */

/** 中文文案。 */
export const zh = {
  panel: "Infra",
  "panel.loadingConfig": "正在读取面板地址",
  "panel.reload": "刷新",
  "panel.openExternal": "在系统浏览器打开",
  "panel.timeoutTitle": "面板可能无法打开",
  "panel.timeoutHint":
    "面板未运行、地址不对，或被拒绝内嵌；可以用系统浏览器打开",

  "config.unavailable": "当前环境未提供配置读写，无法编辑。",
  "config.readOnly": "当前配置为只读，无法编辑。",
  "config.save": "保存",
  "config.saving": "保存中……",
  "config.saveFailed": "保存未成功（配置可能已被并发修改），请重试。",
  "config.overridden": "已覆盖",
  "config.reset": "重置",
  "config.invalidUrl": "需为合法的 http(s) 地址",
  "config.invalidNumber": "需为不小于 1 的整数",

  "config.dashUrl": "x-dash 面板地址",
  "config.dashUrlHint":
    "内嵌打开的地址，也是服务查询的目标，如 http://127.0.0.1:60010",
  "config.tokenEnvVar": "暗号所在的环境变量名",
  "config.tokenEnvVarHint":
    "填变量名，不填暗号本身；暗号要在启动 KMH 之前设进环境，不会写入任何配置文件。填错或留空时助手会报身份校验错误",
  "config.pythonCommand": "Python 位置",
  "config.pythonCommandHint": "启动服务查询进程用的可执行文件，如 python3",
  "config.mcpModuleDir": "x-infra-mcp 所在目录",
  "config.mcpModuleDirHint":
    "服务查询进程的工作目录，指向 x-infra-mcp 的检出目录",
  "config.panelLoadTimeout": "面板加载超时（毫秒）",
  "config.panelLoadTimeoutHint": "超过这个时间仍未加载出来就提示可能无法打开",
  "config.probeTimeout": "连通性探测超时（毫秒）",
  "config.probeTimeoutHint": "测试连接等待多久算不可达",
  "config.toolCallTimeout": "单次查询等待上限（毫秒）",
  "config.toolCallTimeoutHint": "助手单次查询最多等多久",
  "config.mcpEnabled": "把服务查询能力接入助手",
  "config.mcpEnabledHint":
    "开启后助手可以查本机服务清单与单个服务详情；关闭即卸载这些能力",
  "config.testConnection": "测试连接",
  "config.testing": "测试中…",
  "config.healthOk": "可达",
  "config.healthFail": "不可达或超时",
  "config.healthInvalid": "地址格式无效，请先修正后再测试",
  "config.healthDashLabel": "面板",
} as const;

/** 英文文案。 */
export const en = {
  panel: "Infra",
  "panel.loadingConfig": "Reading the dashboard URL",
  "panel.reload": "Reload",
  "panel.openExternal": "Open in system browser",
  "panel.timeoutTitle": "The dashboard may not open here",
  "panel.timeoutHint":
    "the dashboard is not running, the URL is wrong, or it refuses embedding; the system browser also works",

  "config.unavailable": "Configuration editing is unavailable here.",
  "config.readOnly": "Configuration is read-only here.",
  "config.save": "Save",
  "config.saving": "Saving…",
  "config.saveFailed":
    "Save did not land (config changed concurrently); please retry.",
  "config.overridden": "overridden",
  "config.reset": "Reset",
  "config.invalidUrl": "a legal http(s) URL is required",
  "config.invalidNumber": "an integer of at least 1 is required",

  "config.dashUrl": "x-dash dashboard URL",
  "config.dashUrlHint":
    "Embedded page target and the service query target, e.g. http://127.0.0.1:60010",
  "config.tokenEnvVar": "Environment variable holding the shared secret",
  "config.tokenEnvVarHint":
    "the variable name, not the secret; set the secret in the environment before starting KMH, it is never written to a config file. A wrong or empty value makes the assistant report an identity check failure",
  "config.pythonCommand": "Python executable",
  "config.pythonCommandHint":
    "executable used to start the service query process, e.g. python3",
  "config.mcpModuleDir": "x-infra-mcp directory",
  "config.mcpModuleDirHint":
    "working directory of the service query process; point it at the x-infra-mcp checkout",
  "config.panelLoadTimeout": "Dashboard load timeout (ms)",
  "config.panelLoadTimeoutHint":
    "after this long the panel reports it may not open",
  "config.probeTimeout": "Reachability probe timeout (ms)",
  "config.probeTimeoutHint":
    "how long Test connection waits before reporting unreachable",
  "config.toolCallTimeout": "Per-query wait limit (ms)",
  "config.toolCallTimeoutHint":
    "how long the assistant waits for one service query",
  "config.mcpEnabled": "Connect service query tools to the assistant",
  "config.mcpEnabledHint":
    "when on, the assistant can list services and read one service's details; off unmounts them",
  "config.testConnection": "Test connection",
  "config.testing": "Testing…",
  "config.healthOk": "reachable",
  "config.healthFail": "unreachable or timed out",
  "config.healthInvalid": "Invalid URL; fix it before testing",
  "config.healthDashLabel": "Dashboard",
} as const;

/** 词典键：以 zh 为准，en 必须同键。 */
export type InfraLocaleKey = keyof typeof zh;
