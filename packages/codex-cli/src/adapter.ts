/** Codex 模型提供方 adapter：差分投递、动态工具桥与流式投影。 */
import {
  LlmAdapter,
  LlmError,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";
import {
  diffIncrement,
  snapshotAt,
  emptySnapshot,
  type CursorSnapshot,
  type Increment,
} from "./cursor.ts";
import type { BindingRecord } from "./session-store.ts";
import type { CodexCli } from "./index.ts";
import { resolveLlmModel, toLlmModels } from "./models.ts";
import { toolDeclarationNote } from "./tool-registry.ts";
import type { CodexTurn, TurnStartInput } from "./turn.ts";

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
    const deadline = AbortSignal.timeout(this.runtime.config.requestTimeoutMs);
    const signal =
      options.signal === undefined
        ? deadline
        : AbortSignal.any([options.signal, deadline]);
    const request = { ...options, signal };
    const sessionKey =
      options.sessionId === undefined
        ? "kmh-codex-anonymous"
        : String(options.sessionId);
    try {
      // 辅助请求与主对话共用单次请求时限。
      if (
        options.purpose === "session-title" ||
        options.purpose === "compaction"
      ) {
        yield* this.runtime.streamAuxiliary(request);
        return;
      }
      yield* this.runtime.withSession(
        sessionKey,
        this.runtime.resolveCwd(options.sessionId),
        (turn) => this.drive(turn, request),
        signal,
      );
    } catch (error) {
      if (signal.aborted) {
        if (signal.reason === deadline.reason && deadline.aborted)
          throw new LlmError(
            `CODEX_REQUEST_TIMEOUT: ${this.runtime.config.requestTimeoutMs}ms`,
            "CODEX_REQUEST_TIMEOUT",
          );
        throw new LlmError("Codex request stopped", "ABORTED");
      }
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
    const sessionKey =
      options.sessionId === undefined
        ? "kmh-codex-anonymous"
        : String(options.sessionId);
    const signal = options.signal ?? new AbortController().signal;
    const preparedPolicy = this.runtime.toolPolicy?.forStream(options);
    const startInput: Omit<TurnStartInput, "text"> = {
      policyFingerprint: preparedPolicy?.fingerprint,
      model: options.model,
      // 业务工具使用创建时选择，独立技能由策略按本回合读取。
      selection: preparedPolicy?.native ?? this.runtime.settings.selection,
      // 会话身份与权限档（D17/feat09）：审批桥取活跃 Agent、-c 映射档位。
      sessionId: options.sessionId,
      permission: this.runtime.resolvePermission(options.sessionId),
      reasoningEffort: options.reasoningEffort,
      baseInstructions: systemPromptOf(options),
      // D13：不改写提示正文（整词替换会改普通词义），以一段声明约定说明
      // 指明 KMH 工具名与 kmh- 前缀声明名的对应关系。
      developerInstructions:
        (options.tools ?? []).length > 0 ? toolDeclarationNote() : undefined,
      tools: (options.tools ?? []).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
      })),
    };
    const record = await this.runtime.bindingRecord(sessionKey);
    const source =
      record?.threadId === undefined
        ? await this.runtime.sourceBinding(options.sessionId)
        : undefined;
    let plan: ForkPlan | undefined;
    let increment = diffIncrement(options.messages, {
      fingerprints: turn.cursor.fingerprints,
      delivered: turn.pendingDigests,
    });
    if (source?.threadId !== undefined) {
      plan = forkPlanOf(source, options.messages);
      increment = plan.increment;
    } else if (increment.kind === "baseline-lost") {
      if (
        record?.threadId === undefined ||
        !["prefix-mismatch", "history-shrunk", "history-rewritten"].includes(
          increment.reason,
        )
      ) {
        throw new Error(`CODEX_SESSION_HISTORY_MISMATCH: ${increment.reason}`);
      }
      plan = forkPlanOf(record, options.messages);
      increment = plan.increment;
    }
    if (increment.kind === "new-input") {
      if (turn.pendingCallIds().length > 0)
        throw new Error("CODEX_TOOL_PENDING");
      if (plan !== undefined) {
        await turn.dispose();
        turn.cursor = plan.cursor;
        turn.pendingDigests = [...plan.cursor.delivered];
        turn.lastCompletedTurnId = plan.turns.at(-1)?.turnId;
        await turn.rebuild(
          startInput,
          plan.source,
          increment.text,
          signal,
          async () => this.runtime.recordBinding(sessionKey, turn, plan?.turns),
        );
      } else {
        await turn.start(
          { text: increment.text, ...startInput },
          record?.threadId,
          signal,
          async () => this.runtime.recordBinding(sessionKey, turn),
        );
      }
      turn.pendingDigests = [...increment.delivered, ...turn.pendingDigests];
      yield* turn.pump(signal);
    } else {
      turn.pendingDigests = [...increment.delivered];
      yield* turn.resumeWithToolResults(increment.results, signal);
    }
    turn.cursor = snapshotAt(
      options.messages,
      increment.consumed,
      turn.pendingDigests,
    );
    await this.runtime.recordBinding(sessionKey, turn);
    if (turn.terminated) this.runtime.releaseSession(turn);
  }
}

interface ForkPlan {
  source: { threadId: string; lastTurnId?: string; beforeTurnId?: string };
  cursor: CursorSnapshot;
  turns: NonNullable<BindingRecord["turns"]>;
  increment: Extract<Increment, { kind: "new-input" }>;
}
/** 根据源回合已接受的消息位置选择精确的原生回合切点。 */
function forkPlanOf(
  record: BindingRecord,
  messages: GenerateOptions["messages"],
): ForkPlan {
  const threadId = record.threadId;
  if (threadId === undefined) throw new Error("CODEX_FORK_SOURCE_MISSING");
  const turns = record.turns ?? [];
  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index];
    if (turn === undefined) continue;
    const cursor = {
      fingerprints: turn.fingerprints,
      delivered: turn.delivered,
    };
    const increment = diffIncrement(messages, cursor);
    if (increment.kind === "new-input")
      return {
        source: { threadId, lastTurnId: turn.turnId },
        cursor,
        turns: turns.slice(0, index + 1),
        increment,
      };
  }
  const cursor = emptySnapshot();
  const increment = diffIncrement(messages, cursor);
  const first = turns[0];
  if (increment.kind === "new-input" && first !== undefined)
    return {
      source: { threadId, beforeTurnId: first.turnId },
      cursor,
      turns: [],
      increment,
    };
  throw new Error(
    "CODEX_FORK_BOUNDARY_UNSUPPORTED: exact native turn position is unavailable",
  );
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
