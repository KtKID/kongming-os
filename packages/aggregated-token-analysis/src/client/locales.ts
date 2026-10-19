/**
 * 聚合 Token 分析视图插件词典：侧栏面板名、面板占位与超时提示、配置表单
 * 文案（zh/en 键一致）。文案里刻意不出现默认地址与超时的字面值——C5 门禁
 * 要求这些只存在于 src/config.ts（技术设计 D06）。
 */

/** 中文文案。 */
export const zh = {
  panel: "Token 分析",
  "panel.loadingConfig": "正在读取页面地址",
  "panel.timeoutTitle": "页面可能无法打开",
  "panel.timeoutHint": "x-token 未运行或地址无效；正在尝试的地址：",

  "config.unavailable": "当前环境未提供配置读写，无法编辑。",
  "config.readOnly": "当前配置为只读，无法编辑。",
  "config.save": "保存",
  "config.saving": "保存中……",
  "config.overridden": "已覆盖",
  "config.reset": "重置",
  "config.invalidUrl": "需为合法的 http(s) 地址",
  "config.invalidNumber": "需为不小于 1 的整数",

  "config.pageUrl": "聚合 Token 分析页地址",
  "config.pageUrlHint":
    "内嵌打开的页面地址，默认指向本机 x-token 服务；不写协议时按 https 处理",
  "config.pageLoadTimeout": "页面加载超时（毫秒）",
  "config.pageLoadTimeoutHint": "超过这个时间仍未加载出来就提示可能无法打开",
} as const;

/** 英文文案。 */
export const en = {
  panel: "Token Analysis",
  "panel.loadingConfig": "Reading the page URL",
  "panel.timeoutTitle": "The page may not open here",
  "panel.timeoutHint":
    "x-token is not running or the URL is wrong; the page being tried:",

  "config.unavailable": "Configuration editing is unavailable here.",
  "config.readOnly": "Configuration is read-only here.",
  "config.save": "Save",
  "config.saving": "Saving…",
  "config.overridden": "overridden",
  "config.reset": "Reset",
  "config.invalidUrl": "a legal http(s) URL is required",
  "config.invalidNumber": "an integer of at least 1 is required",

  "config.pageUrl": "Aggregated token analysis page URL",
  "config.pageUrlHint":
    "the embedded page target, the local x-token service by default; https is assumed when no scheme is given",
  "config.pageLoadTimeout": "Page load timeout (ms)",
  "config.pageLoadTimeoutHint":
    "after this long the panel reports the page may not open",
} as const;

/** 词典键：以 zh 为准，en 必须同键。 */
export type TokenAnalysisLocaleKey = keyof typeof zh;
