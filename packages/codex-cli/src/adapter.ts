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
import { fieldOf } from "./protocol.ts";
import type { CodexCli } from "./index.ts";
import { resolveLlmModel, toLlmModels } from "./models.ts";
import { toolDeclarationNote, toolFingerprintOf } from "./tool-registry.ts";
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
    const sessionKey =
      options.sessionId === undefined
        ? "kmh-codex-anonymous"
        : String(options.sessionId);
    const signal = options.signal ?? new AbortController().signal;
    const startInput: Omit<TurnStartInput, "text"> = {
      model: options.model,
      // 逐项选择按当前值传入：进行中的回合沿用其启动时的进程参数，
      // 下一回合开始时重新读取（feat02 场景4/场景8 语义）。
      selection: this.runtime.settings.selection,
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
    // 差分以待核对工作队列为输入：历史 assistant 消息核对/指纹推进时出队，
    // 余量随分支对账回 turn，本回合新块入队并随游标持久化（跨进程续用）。
    const increment = diffIncrement(options.messages, {
      fingerprints: turn.cursor.fingerprints,
      delivered: turn.pendingDigests,
    });
    if (increment.kind === "baseline-lost") {
      // 编辑/重发/历史改写：等同从该点分叉——fork 或新建并注入重建历史。
      yield* this.rebuildFromBinding(
        turn,
        options,
        startInput,
        sessionKey,
        signal,
      );
      return;
    }
    // 差分已消费的历史 assistant 消息从待核对队列出队；余量随分支对账回
    // turn 上（见各分支注释），本回合新产出的块继续入队并随游标持久化。
    if (increment.kind === "new-input") {
      if (turn.pendingCallIds().length > 0)
        throw new Error("CODEX_TOOL_PENDING");
      const record = await this.runtime.bindingRecord(sessionKey);
      // D13 目录变化检测（feat03 场景9）：绑定记录带指纹且与当前目录不符时，
      // 跳过 resume/fork（两者都继承旧工具集），新建 thread 重新声明工具并
      // 按既有历史重建规则恢复上下文；旧记录无指纹表示裸名旧 thread，照常续用。
      const fingerprint = toolFingerprintOf(startInput.tools);
      if (
        record !== undefined &&
        record.toolFingerprint !== undefined &&
        record.toolFingerprint !== fingerprint
      ) {
        yield* this.rebuildFromBinding(
          turn,
          options,
          startInput,
          sessionKey,
          signal,
          { fresh: true },
        );
        return;
      }
      await turn.start(
        { text: increment.text, ...startInput },
        record?.threadId,
        signal,
      );
      // start 的 reopen 清空了队列：差分余量（历史尚未消费的摘要）在队头
      // 恢复，本回合新块随后追加。
      turn.pendingDigests = [...increment.delivered, ...turn.pendingDigests];
      yield* turn.pump(signal);
    } else {
      // resume 路径不重开队列：直接以差分余量为基准。
      turn.pendingDigests = [...increment.delivered];
      let resumed = false;
      try {
        yield* turn.resumeWithToolResults(increment.results, signal);
        resumed = true;
      } catch (error) {
        // 挂起表丢失（会话状态重建把带挂起工具的 turn 换掉，线上表现为
        // CODEX_NO_PENDING_TOOL 回合失败且旧进程泄漏等待回执）：按基线
        // 失效同样的恢复语义重建续推。其余失配继续抛出。
        if (
          !(error instanceof Error) ||
          error.message !== "CODEX_NO_PENDING_TOOL"
        )
          throw error;
      }
      if (!resumed) {
        yield* this.rebuildFromBinding(
          turn,
          options,
          startInput,
          sessionKey,
          signal,
        );
        return;
      }
    }
    turn.cursor = snapshotAt(
      options.messages,
      increment.consumed,
      turn.pendingDigests,
    );
    await this.runtime.recordBinding(sessionKey, turn);
    if (turn.terminated) this.runtime.releaseSession(turn);
  }
  /**
   * 按绑定记录重建绑定线程并续推：优先 fork 到 lastTurnId 边界（未决的
   * 当前 turn 不进 fork），失败或无源时新建 thread 并注入重建历史。
   * @param turn - 待重建的 turn（其连接与挂起状态已被视为失效）。
   * @param mode.fresh - 目录变化路径：跳过 fork（fork 继承旧工具集），
   *   直接新建 thread 重新声明当前工具；失败时报错含重新建立会话的出路。
   */
  private async *rebuildFromBinding(
    turn: CodexTurn,
    options: GenerateOptions,
    startInput: Omit<TurnStartInput, "text">,
    sessionKey: string,
    signal: AbortSignal,
    mode: { fresh: boolean } = { fresh: false },
  ): AsyncGenerator<StreamChunk> {
    await turn.dispose();
    const source =
      mode.fresh === true
        ? undefined
        : await this.runtime.bindingRecord(sessionKey);
    try {
      await turn.rebuild(
        startInput,
        source === undefined
          ? undefined
          : {
              threadId: source.threadId,
              ...(source.lastTurnId !== undefined
                ? { lastTurnId: source.lastTurnId }
                : {}),
            },
        rebuildTextOf(options.messages),
        signal,
      );
    } catch (error) {
      // feat03 场景9：恢复失败给出明确原因与出路（重试或新建会话重建绑定）。
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `CODEX_TOOL_CATALOG_REBUILD_FAILED: 工具目录变化后重建会话失败（${reason}）；可重试本回合，或新建会话以重建绑定`,
      );
    }
    yield* turn.pump(signal);
    // 快照在 pump 之后：重建 turn 期间产出的块摘要（delivered）才能随
    // 游标落盘，后续轮次的边界核对才有据可依（实测先快照会丢失摘要）。
    turn.cursor = snapshotAt(
      options.messages,
      options.messages.length,
      turn.pendingDigests,
    );
    await this.runtime.recordBinding(sessionKey, turn);
    this.runtime.releaseSession(turn);
  }
}
/** 每段重建摘要的截断长度。 */
const REBUILD_SNIPPET_LIMIT = 600;
/**
 * 把 KMH 对话历史序列化为一条重建输入（fork 后新 thread 的首个 turn）。
 * 用户消息保留原文；助手与工具往返折叠为摘要，避免重建输入膨胀。
 */
export function rebuildTextOf(messages: GenerateOptions["messages"]): string {
  const lines: string[] = [
    "以下是本会话此前的对话记录重建。请把它作为上下文继续对话，不要重复回答已回答过的内容。",
  ];
  for (const message of messages) {
    const content = fieldOf(message, "content");
    const texts: string[] = [];
    for (const block of Array.isArray(content) ? content : [])
      if (fieldOf(block, "type") === "text") {
        const text = fieldOf(block, "text");
        if (typeof text === "string") texts.push(text);
      }
    const joined = texts.join("\n").slice(0, REBUILD_SNIPPET_LIMIT);
    if (message.role === "user") lines.push(`用户：${joined}`);
    else if (message.role === "assistant") {
      const name = fieldOf(message, "toolCallId");
      if (typeof name === "string")
        lines.push(`助手调用了工具，结果摘要：${joined}`);
      else lines.push(`助手：${joined}`);
    } else if (message.role === "tool")
      lines.push(`（工具结果已并入上文摘要）`);
  }
  return lines.join("\n\n");
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
