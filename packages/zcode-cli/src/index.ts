/** Independently distributable KMH provider for the official ZCode CLI raw endpoint. */
import type { Context } from "@deepseek-ai/cordis";
import {
  LlmAdapter,
  ReasoningEffortId,
  LlmError,
  type GenerateOptions,
  type StreamChunk,
  type LlmResolvedModelInfo,
  type LlmModelInfo,
} from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-subprocess";
import type {} from "@deepseek-ai/dsh-session";
import type { Config } from "./config.ts";
import { ZcodeCli } from "./runtime.ts";
import { projectResult } from "./protocol.ts";
import { mountWeb } from "./web.ts";
export { Config } from "./config.ts";
export { ZcodeCli } from "./runtime.ts";
/** Cordis plugin identity. */
export const name = "kmh/zcode-cli";
/** Required model and process services. */
export const inject = ["llm", "subprocess"];

/** Adapt fully assembled CLI results into the KMH provider vocabulary. */
export class ZcodeAdapter extends LlmAdapter {
  constructor(private readonly runtime: ZcodeCli) {
    super();
  }
  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: "KMH / ZCode CLI" };
  }
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve([
      {
        provider,
        id: this.runtime.config.model,
        name: this.runtime.config.nativeModel,
        inputModalities: ["text"],
      },
    ]);
  }
  override resolveModel(
    provider: string,
    model: string,
  ): Promise<LlmResolvedModelInfo> {
    if (provider !== "zcode-cli" || model !== this.runtime.config.model)
      return Promise.reject(
        new LlmError("ZCode model route is unavailable", "INVALID_MODEL"),
      );
    return Promise.resolve({
      provider,
      id: model,
      name: this.runtime.config.nativeModel,
      inputModalities: ["text"],
      defaultMaxTokens: this.runtime.config.defaultMaxTokens,
      reasoning: {
        efforts: [{ id: ReasoningEffortId("high"), name: "High" }],
        defaultEffort: ReasoningEffortId("high"),
      },
    });
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    await this.resolveModel(options.provider, options.model);
    if (
      options.reasoningEffort !== undefined &&
      options.reasoningEffort !== "high"
    )
      throw new LlmError(
        "Unsupported ZCode reasoning level",
        "INVALID_REASONING_EFFORT",
      );
    try {
      yield* projectResult(await this.runtime.generate(options));
    } catch (error) {
      const code =
        error instanceof Error && /^ZCODE_[A-Z_]+$/.test(error.message)
          ? error.message
          : "ZCODE_REQUEST_FAILED";
      throw new LlmError(code, code);
    }
  }
}
/**
 * Register the provider and mount the Web login interface when Web services are available.
 * @param ctx - Plugin owner of adapter, routes and CLI process ranges.
 * @param config - Validated execution and storage settings.
 */
export function apply(ctx: Context, config: Config): void {
  const runtime = new ZcodeCli(ctx, config);
  ctx.llm.registerAdapter(["zcode-cli"], new ZcodeAdapter(runtime));
  ctx.inject(["connection"], (web) => mountWeb(web, runtime));
}
