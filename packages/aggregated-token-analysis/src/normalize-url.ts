/**
 * http(s) 地址规范化纯函数：宿主半与浏览器半共用的唯一实现。浏览器半只
 * 引本文件、不引 config.ts，宿主 schema 与默认值因此不进浏览器半产物
 * （技术设计 D06 的 C5 门禁依赖这一点）。与 kmh-mademe、kmh-infra 的
 * 同名函数同型（第三份拷贝，债见技术设计确认记录第 2 条）。
 */

/** 主机名合法字符：域名、IPv4、IPv6 字面量（端口已由 URL 解析剥离）。 */
const HOST_PATTERN = /^\[?[A-Za-z0-9._~-]+\]?$/u;

/** 地址长度上限。输入校验的安全边界，不是用户可调的功能性阈值。 */
const MAX_URL_LENGTH = 2048;

/**
 * 规范化一个 http(s) 地址：无 scheme 补 https；仅接受 http/https；拒绝
 * 带内嵌凭据、空主机、非法主机名与超长输入。主机名显式校验是防线——部分
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
