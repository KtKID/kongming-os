/** 官方 CLI 版本检查与账号状态展示类型。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Config } from "./config.ts";

export type { AccountStatus } from "./account-status.ts";
/** 支持基线：首个验证通过的官方 CLI 版本。 */
export const MINIMUM_CODEX_VERSION = "0.160.0";
/** 版本检查结果。 */
export interface VersionStatus {
  version: string | undefined;
  ok: boolean;
  reason?: string;
}
/** 语义化三段比较：负数表示 a 小。 */
function compare(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < 3; index++) {
    const left = a[index] ?? 0;
    const right = b[index] ?? 0;
    if (left !== right) return left - right;
  }
  return 0;
}
function parseVersion(text: string): readonly number[] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match
    ? [Number(match[1]), Number(match[2]), Number(match[3])]
    : undefined;
}
/**
 * 运行 `codex --version` 并对照支持基线。
 * @param ctx - 宿主上下文。
 * @param config - 插件配置。
 * @param signal - 中止信号。
 */
export async function checkVersion(
  ctx: Context,
  config: Config,
  signal: AbortSignal,
): Promise<VersionStatus> {
  const minimum = parseVersion(MINIMUM_CODEX_VERSION);
  if (minimum === undefined) throw new Error("CODEX_VERSION_BASELINE_INVALID");
  try {
    const executable = await ctx.subprocess.resolveExecutable(
      config.command,
      config.env,
      signal,
    );
    if (executable === undefined)
      return { version: undefined, ok: false, reason: "CODEX_CLI_MISSING" };
    const text = await new Promise<string>((resolve, reject) => {
      const proc = ctx.subprocess.spawn({
        argv: [executable, "--version"],
        cwd: config.cwd,
        env: config.env,
        graceMs: config.graceMs,
        stdio: { stdin: "ignore", stdout: "pipe", stderr: "pipe" },
      });
      let output = "";
      proc.stdout?.on("data", (chunk: Buffer) => {
        output += chunk.toString("utf8");
      });
      proc.done.then(
        () => resolve(output),
        (error: unknown) =>
          reject(error instanceof Error ? error : new Error(String(error))),
      );
    });
    const fullVersion = /^codex-cli ([^\s]+)$/m.exec(text)?.[1];
    const version =
      fullVersion === undefined ? undefined : parseVersion(fullVersion);
    if (version === undefined || fullVersion === undefined)
      return {
        version: undefined,
        ok: false,
        reason: "CODEX_VERSION_UNPARSED",
      };
    const ok = compare(version, minimum) >= 0;
    return {
      version: fullVersion,
      ok,
      ...(ok ? {} : { reason: "CODEX_VERSION_UNSUPPORTED" }),
    };
  } catch (error) {
    return {
      version: undefined,
      ok: false,
      reason: error instanceof Error ? error.message : "CODEX_CLI_MISSING",
    };
  }
}
