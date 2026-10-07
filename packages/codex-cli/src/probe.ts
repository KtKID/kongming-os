/** 详情页测试连接：独立临时会话内对当前模型发短请求并回收。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Config } from "./config.ts";
import type { NativeSelection } from "./capabilities.ts";
import { connectCodex } from "./connection.ts";
import { prepareIsolation } from "./isolation.ts";
import { CodexTurn } from "./turn.ts";

/** 测试连接结果。 */
export interface ProbeResult {
  ok: boolean;
  error?: string;
}
/**
 * 用当前选择的模型执行短文本请求验证可用性。
 * @param ctx - 宿主上下文。
 * @param config - 插件配置。
 * @param model - 详情页当前选择的模型。
 * @param selection - 原生能力逐项选择（临时会话同样遵守隔离语义）。
 */
export async function probeConnection(
  ctx: Context,
  config: Config,
  model: string,
  selection: NativeSelection,
): Promise<ProbeResult> {
  const signal = AbortSignal.timeout(config.probeTimeoutMs);
  const plan = await prepareIsolation(ctx, config, {
    cwd: config.cwd,
    signal,
    selection,
  });
  const connection = await connectCodex(
    ctx,
    {
      command: config.command,
      cwd: config.cwd,
      configOverrides: plan.configOverrides,
      env: config.env,
      graceMs: config.graceMs,
      startupTimeoutMs: config.startupTimeoutMs,
    },
    signal,
  );
  const turn = new CodexTurn(ctx, config, config.cwd);
  try {
    turn.adopt(connection);
    await turn.start(
      {
        text: "ping",
        model,
        baseInstructions: "Reply with the single word: pong.",
        tools: [],
      },
      undefined,
      signal,
    );
    for await (const _chunk of turn.pump(signal)) void _chunk;
    return turn.terminalStatus === "completed"
      ? { ok: true }
      : {
          ok: false,
          error: `CODEX_PROBE_STATUS_${turn.terminalStatus ?? "unknown"}`,
        };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await turn.dispose();
    await connection.stop(config.cleanupTimeoutMs);
  }
}
