/**
 * kmh-infra 插件配置 schema。八个字段全部 volatile：经插件详情页表单修改后，
 * loader 把新值热提交进运行中的配置引用（apply 收到的 config 即活引用），
 * 持久化由 settings + config-editor 走当前 profile 的 Cordis patch。
 *
 * 字段一律用原生 Schema.string()/number()/boolean()——transform 节点的序列化
 * 产物会被 settings 的 client 链路丢弃，导致配置页看不到本命名空间（MadeMe
 * 实测结论）。地址的格式校验与规范化由配置表单的 parse 层承担
 * （normalizeHttpUrl），宿主 schema 只收原始字符串。
 *
 * 暗号本身的取值不在这里：本文件只声明"暗号所在的环境变量名"，暗号从 KMH
 * 进程环境读取，不落任何配置文件。
 */
import type { Volatile } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";

/** 主机名合法字符：域名、IPv4、IPv6 字面量（端口已由 URL 解析剥离）。 */
const HOST_PATTERN = /^\[?[A-Za-z0-9._~-]+\]?$/u;

/** 地址长度上限。这是输入校验的安全边界，不是可配置的功能性阈值。 */
const MAX_URL_LENGTH = 2048;

/** 数值配置项的取值边界：Schemastery 的安全整数护栏，不是功能性阈值。 */
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/**
 * 规范化一个 http(s) 地址：无 scheme 补 https；仅接受 http/https；拒绝带
 * 内嵌凭据、空主机、非法主机名与超长输入。主机名显式校验是防线——部分
 * WebKit 系 webview 的 URL 构造对非法 host 不抛错（与 Node 不一致）。
 * @param input - 用户或配置层的原始地址。
 * @returns 规范化后的绝对 URL；无法规范化时返回 undefined。
 */
export function normalizeHttpUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.length > MAX_URL_LENGTH) return undefined;
  const candidate = /^[A-Za-z][A-Za-z\d+.-]*:\/\//u.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  if (url.username !== "" || url.password !== "") return undefined;
  if (url.hostname === "" || !HOST_PATTERN.test(url.hostname)) return undefined;
  return url.href;
}

/**
 * 构建一个毫秒级数值配置项：正整数字面量、带单位说明与默认值。
 * @param description - 配置项说明（含单位）。
 * @param fallback - 默认值（毫秒）。
 * @returns 可用作 volatile 配置字段的 schema。
 */
function timeoutField(description: string, fallback: number) {
  return Schema.number()
    .description(description)
    .step(1)
    .min(1)
    .max(MAX_SAFE_INTEGER)
    .default(fallback)
    .volatile();
}

/** x-dash 面板地址：内嵌打开的地址，同时是服务查询的目标（只填一处）。 */
const dashUrl = Schema.string()
  .description("x-dash 面板地址")
  .default("http://127.0.0.1:60010")
  .volatile();

/** 暗号所在的环境变量名；填名字，不填暗号本身。 */
const tokenEnvVar = Schema.string()
  .description("暗号所在的环境变量名")
  .default("X_INFRA_MCP_TOKEN")
  .volatile();

/** 启动服务查询进程所用的 Python 可执行文件。 */
const pythonCommand = Schema.string()
  .description("Python 位置")
  .default("python3")
  .volatile();

/** 服务查询进程的工作目录：x-infra-mcp 的检出目录。 */
const mcpModuleDir = Schema.string()
  .description("x-infra-mcp 所在目录")
  .default("/Volumes/machub_app/proj/x-infra/x-infra-mcp")
  .volatile();

/** 面板加载多久仍未完成即提示可能无法打开。 */
const panelLoadTimeoutMs = timeoutField("面板加载超时（毫秒）", 8000);

/** "测试连接"对面板地址做可达性探测的等待上限。 */
const probeTimeoutMs = timeoutField("连通性探测超时（毫秒）", 5000);

/** 助手单次服务查询最多等待多久。 */
const toolCallTimeoutMs = timeoutField("单次查询等待上限（毫秒）", 60000);

/** 是否把服务查询能力接入助手。 */
const mcpEnabled = Schema.boolean()
  .description("把服务查询能力接入助手")
  .default(true)
  .volatile();

/** 运行期配置形态：volatile 字段为活引用（.get() 读当前值）。 */
export interface Config {
  dashUrl: Volatile<string>;
  tokenEnvVar: Volatile<string>;
  pythonCommand: Volatile<string>;
  mcpModuleDir: Volatile<string>;
  panelLoadTimeoutMs: Volatile<number>;
  probeTimeoutMs: Volatile<number>;
  toolCallTimeoutMs: Volatile<number>;
  mcpEnabled: Volatile<boolean>;
}

/** 插件配置 schema。 */
export const Config = Schema.object({
  dashUrl,
  tokenEnvVar,
  pythonCommand,
  mcpModuleDir,
  panelLoadTimeoutMs,
  probeTimeoutMs,
  toolCallTimeoutMs,
  mcpEnabled,
});
