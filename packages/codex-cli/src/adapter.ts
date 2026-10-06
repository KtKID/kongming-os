/** Codex 模型提供方 adapter：差分投递、动态工具桥与流式投影。 */
import {
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import { diffIncrement, snapshotAt } from "./cursor.ts";
import type { CodexCli } from "./index.ts";
import { resolveLlmModel, toLlmModels } from "./models.ts";
import type { CodexTurn } from "./turn.ts";

/**
 * 注册为 `codex-cli` 提供方的适配器。一次 stream 调用映射为 Codex turn 的
 * 一段生成：新用户输入发起 turn，工具结果回传续推挂起的 turn；
 * 全量历史经差分游标只投增量。
 */
export class CodexAdapter extends LlmAdapter {
  constructor(private readonly runtime: CodexCli) {
    super();
  }
  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: "KMH / Codex CLI" };
  }
  override async listModels(
    provider: string,
  ): Promise<readonly LlmModelInfo[]> {
    return toLlmModels(provider, await this.runtime.catalog());
  }
  override async resolveModel(
    provider: string,
    model: string,
  ): Promise<LlmResolvedModelInfo> {
    if (provider !== "codex-cli")
      throw new LlmError("Codex model route is unavailable", "INVALID_MODEL");
    const entries = await this.runtime.catalog();
    const entry = entries.find((candidate) => candidate.id === model);
    if (entry === undefined)
      throw new LlmError(`Unknown Codex model: ${model}`, "INVALID_MODEL");
    return resolveLlmModel(
      provider,
      entry,
      this.runtime.config.defaultMaxTokens,
    );
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.provider !== "codex-cli")
      throw new LlmError("Codex model route is unavailable", "INVALID_MODEL");
    if (options.temperature !== undefined)
      throw new LlmError(
        "Codex app-server does not accept temperature",
        "INVALID_ARGS",
      );
    if (options.stop !== undefined)
      throw new LlmError(
        "Codex app-server does not accept stop sequences",
        "INVALID_ARGS",
      );
    // 辅助请求（标题生成）走独立临时会话，不触碰业务绑定。
    if (
      options.purpose === "session-title" ||
      options.purpose === "compaction"
    ) {
      yield* this.runtime.streamAuxiliary(options);
      return;
    }
    const sessionKey =
      options.sessionId === undefined
        ? "kmh-codex-anonymous"
        : String(options.sessionId);
    try {
      yield* this.runtime.withSession(
        sessionKey,
        this.runtime.resolveCwd(options.sessionId),
        (turn) => this.drive(turn, options),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = /^CODEX_[A-Z_]+/.test(message)
        ? (message.split(":")[0] ?? "CODEX_REQUEST_FAILED")
        : "CODEX_REQUEST_FAILED";
      throw new LlmError(message, code);
    }
  }
  /** 驱动一次差分投递与流投影。 */
  private async *drive(
    turn: CodexTurn,
    options: GenerateOptions,
  ): AsyncGenerator<StreamChunk> {
    const cursor = turn.cursor;
    const increment = diffIncrement(options.messages, cursor);
    if (increment.kind === "baseline-lost")
      throw new Error(`CODEX_BASELINE_LOST: ${increment.reason}`);
    if (increment.kind === "new-input") {
      if (turn.pendingCallIds().length > 0)
        throw new Error("CODEX_TOOL_PENDING");
      const sessionKey =
        options.sessionId === undefined
          ? "kmh-codex-anonymous"
          : String(options.sessionId);
      await turn.start(
        {
          text: increment.text,
          model: options.model,
          reasoningEffort: options.reasoningEffort,
          baseInstructions: systemPromptOf(options),
          developerInstructions: undefined,
          tools: (options.tools ?? []).map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.parameters,
          })),
        },
        this.runtime.binding(sessionKey),
        options.signal ?? new AbortController().signal,
      );
      this.runtime.recordBinding(sessionKey, turn.threadId);
      yield* turn.pump(options.signal ?? new AbortController().signal);
    } else {
      yield* turn.resumeWithToolResults(
        increment.results,
        options.signal ?? new AbortController().signal,
      );
    }
    turn.cursor = snapshotAt(options.messages, increment.consumed);
    if (turn.terminated) this.runtime.releaseSession(turn);
  }
}
/** 提取请求的系统提示：循环请求的系统消息或一次性调用的 system 字段。 */
function systemPromptOf(options: GenerateOptions): string | undefined {
  if (options.system !== undefined) return options.system;
  for (const message of options.messages)
    if (message.role === "system" || message.role === "developer") {
      const texts: string[] = [];
      for (const block of message.content ?? [])
        if (block.type === "text") texts.push(block.text);
      if (texts.length > 0) return texts.join("\n");
    }
  return undefined;
}
