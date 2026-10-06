/** Independently distributable KMH provider for the official Codex CLI app-server. */
import type { Context } from "@deepseek-ai/cordis";
import { Service } from "@deepseek-ai/cordis";
import type { Config } from "./config.ts";
export { Config } from "./config.ts";
export { connectCodex, CodexConnection } from "./connection.ts";
export * from "./protocol.ts";

/** Cordis plugin identity. */
export const name = "kmh/codex-cli";
/** Required model and process services. */
export const inject = ["llm", "subprocess"];
declare module "@deepseek-ai/cordis" {
  interface Context {
    codexCli: CodexCli;
  }
}

/**
 * Own shared runtime state for the Codex CLI provider.
 * 账号状态、模型目录与连接串行控制挂在此服务上，adapter 与 Web 共用。
 */
export class CodexCli extends Service {
  constructor(
    ctx: Context,
    readonly config: Config,
  ) {
    super(ctx, "codexCli");
  }
}

/**
 * Register the provider runtime; adapter registration mounts with the bridge task.
 * @param ctx - Plugin owner of the runtime and process ranges.
 * @param config - Validated execution and storage settings.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.codexCli = new CodexCli(ctx, config);
}
