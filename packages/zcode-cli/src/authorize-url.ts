/** Shared validation for full official authorization URLs and completed CLI output lines. */
const origins = new Set([
  "https://chat.z.ai",
  "https://bigmodel.cn",
  "https://zcode.z.ai",
]);
/**
 * Validate the complete authorization URL, preserving all query parameters.
 * @param value - Official CLI or OAuth initialization URL.
 * @returns Parsed URL; rejects credentials, callbacks and unofficial origins.
 */
export function authorizeUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    void error;
    throw new Error("ZCODE_AUTHORIZE_URL_INVALID");
  }
  if (
    !origins.has(url.origin) ||
    url.username ||
    url.password ||
    url.pathname.startsWith("/api/v1/oauth/cli/callback/")
  )
    throw new Error("ZCODE_AUTHORIZE_URL_INVALID");
  return url;
}
/**
 * Read an entire newline-terminated URL from native CLI output.
 * @param output - Accumulated stderr, which may end with an incomplete line.
 * @returns Complete official URL or undefined until a URL line arrives.
 */
export function extractAuthorizeUrl(output: string): string | undefined {
  const match = output.match(/(?:^|\n)(https:\/\/[^\r\n]+)\r?\n/);
  return match?.[1] === undefined ? undefined : authorizeUrl(match[1]).href;
}
