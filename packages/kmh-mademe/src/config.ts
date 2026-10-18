/**
 * MadeMe 插件配置 schema。字段为 volatile：经插件页/设置表单修改后，loader
 * 把新值热提交进运行中的配置引用（apply 收到的 config 即活引用），持久化由
 * settings + config-editor 走当前 profile 的 Cordis patch。
 * URL 的格式校验与规范化由配置表单的 parse 层承担（normalizeHttpUrl）。
 */
import type { Volatile } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";

/** 主机名合法字符：域名、IPv4、IPv6 字面量（端口已由 URL 解析剥离）。 */
const HOST_PATTERN = /^\[?[A-Za-z0-9._~-]+\]?$/u;

/**
 * 规范化一个 http(s) 地址：无 scheme 补 https；仅接受 http/https；拒绝
 * 带内嵌凭据、空主机、非法主机名与超长输入。主机名显式校验是防线——
 * 部分 WebKit 系 webview 的 URL 构造对非法 host 不抛错（与 Node 不一致）。
 * @param input - 用户或配置层的原始地址。
 * @returns 规范化后的绝对 URL；无法规范化时返回 undefined。
 */
export function normalizeHttpUrl(input: string): string | undefined {
  const trimmed = input.trim();
  if (trimmed === "" || trimmed.length > 2048) return undefined;
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

// 服务默认地址 30000（2026-10 用户提供）。
// URL 的格式校验与规范化在配置表单的 parse 层完成（settingsHttpUrlField）；
// 宿主 schema 用原生 string 字段——transform 节点的序列化产物会被 settings
// describe 的 client 侧校验丢弃，导致配置页不可见（实测结论）。
/** MadeMe 服务地址（网页内嵌打开的目标）。 */
const serviceUrl = Schema.string()
  .description("MadeMe 服务地址")
  .default("http://127.0.0.1:30000")
  .volatile();

/** 运行期配置形态：volatile 字段为活引用（.get() 读当前值）。 */
export interface Config {
  serviceUrl: Volatile<string>;
}

/** 插件配置 schema。 */
export const Config = Schema.object({ serviceUrl });
