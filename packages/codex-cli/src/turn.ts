/** 一个 KMH 回合内的 Codex turn：进程、thread、挂起工具与流式投影。 */
import type { Context } from "@deepseek-ai/cordis";
import { readFile } from "node:fs/promises";
import type {} from "@deepseek-ai/dsh-attachment";
import {
  ToolCallId,
  type StreamChunk,
  type TokenUsage,
} from "@deepseek-ai/dsh-llm";
import type { Config } from "./config.ts";
import type { NativeSelection } from "./capabilities.ts";
import { connectCodex, type CodexConnection } from "./connection.ts";
import {
  AgentMessageDeltaParams,
  DynamicToolCallParams,
  DynamicToolCallResponse,
  ErrorNotificationParams,
  Incoming,
  KMH_TOOL_NAMESPACE,
  ReasoningDeltaParams,
  ThreadResult,
  TurnCompletedParams,
  TurnResult,
  imageProjectionOf,
} from "./protocol.ts";
import { prepareIsolation, verifyIsolation } from "./isolation.ts";
import { blockDigest, emptySnapshot, type CursorSnapshot } from "./cursor.ts";
import {
  buildToolRegistry,
  resolveKmhToolName,
  type ToolRegistry,
} from "./tool-registry.ts";
import {
  imageFailureNote,
  imageSizeNote,
  imageSizeRequirementOf,
  pngSizeOf,
} from "./image-delivery.ts";
import { fieldOf } from "./protocol.ts";

/** turn 启动所需请求侧信息。 */
export interface TurnStartInput {
  text: string;
  model: string;
  reasoningEffort?: string | undefined;
  baseInstructions?: string | undefined;
  developerInstructions?: string | undefined;
  tools: { name: string; description: string; inputSchema: unknown }[];
  /** 逐项选择覆盖；缺省用部署配置迁移。 */
  selection?: NativeSelection | undefined;
}
/** 队列事件。 */
type Queued =
  | { kind: "chunk"; chunk: StreamChunk }
  | { kind: "tool-pause" }
  | { kind: "turn-done"; status: string; usage?: TokenUsage }
  | { kind: "failure"; error: Error };
/** 挂起的动态工具请求。 */
interface PendingTool {
  callId: string;
  tool: string;
  arguments: unknown;
  reply: (response: unknown) => void;
  fail: (error: Error) => void;
}

/**
 * 管理一个 KMH 回合内的 CLI 进程与 Codex turn。
 * 工具请求到达时挂起 Codex（延迟回执），由 adapter 在下一次 stream 调用回传结果续推；
 * turn 终止后连接与进程回收。
 */
export class CodexTurn {
  private connection: CodexConnection | undefined;
  private queue: Queued[] = [];
  private wakeup: (() => void) | undefined;
  private closed = false;
  private itemIndex = new Map<string, number>();
  private nextIndex = 0;
  private readonly pending = new Map<string, PendingTool>();
  /** 已投影为会话图片块的生图项 id：防重复投影。 */
  private readonly projectedImages = new Set<string>();
  /** 文本/推理块的类型与 delta 累积（摘要补算用），按流块索引。 */
  private readonly blockTypes = new Map<number, "text" | "reasoning">();
  private readonly blockText = new Map<number, string>();
  private readonly endedBlocks = new Set<number>();
  threadId: string | undefined;
  turnId: string | undefined;
  /** 最近一次完成（含 interrupted）的 turn id；fork 重建的边界。 */
  lastCompletedTurnId: string | undefined;
  /** 差分游标：已投递到 Codex thread 的对齐点。 */
  cursor: CursorSnapshot = emptySnapshot();
  /**
   * 待核对回合块摘要队列：本 turn 投影的块入队（block-end 时），差分
   * 消费历史中的 assistant 消息时出队。adapter 在每次差分后把它对账为
   * 游标返回的剩余队列，再随快照持久化（见 cursor.ts 注释）。
   */
  pendingDigests: string[] = [];
  /** 回合终止状态；completed 或 interrupted 后进程可回收。 */
  terminalStatus: string | undefined;
  /** 最近一次投递的用户输入文本：生图尺寸要求识别来源（feat10）。 */
  private lastUserText = "";
  /**
   * 本回合的工具声明表（D13）：声明名 kmh-<原名> 与目录指纹。
   * start/rebuild 时建立；临时会话（adopt）保持 undefined，仅兼容裸名。
   */
  toolRegistry: ToolRegistry | undefined;

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly cwd: string,
    /** 调用方在隔离覆盖之上追加的进程配置（测试 fixture 等）。 */
    private readonly extraOverrides: readonly string[] = [],
  ) {}

  /**
   * 重启已回收的 turn 对象：复位关闭与终止标志并清空残留事件。
   * start/rebuild 会复用本对象重新拉起进程；此前若经 dispose 回收，
   * closed 标志会让 push 静默丢弃全部事件（恢复路径实测挂死于此）。
   */
  private reopen(): void {
    this.closed = false;
    this.terminalStatus = undefined;
    this.queue = [];
    this.itemIndex.clear();
    this.nextIndex = 0;
    this.pending.clear();
    this.wakeup = undefined;
    this.pendingDigests = [];
    this.blockTypes.clear();
    this.blockText.clear();
    this.endedBlocks.clear();
    this.lastUserText = "";
    this.toolRegistry = undefined;
  }

  /** 等待结果回传的挂起工具调用标识。 */
  pendingCallIds(): string[] {
    return [...this.pending.keys()];
  }
  /** 是否已经终止（进程应回收）。 */
  get terminated(): boolean {
    return this.terminalStatus !== undefined || this.closed;
  }

  /**
   * 启动进程与 turn：隔离准备、连接、thread 创建或恢复、turn/start。
   * @param input - 用户文本、模型与工具目录。
   * @param threadId - 已有绑定的 thread；缺省时创建新 thread。
   * @param signal - 取消信号。
   * @returns 新建或恢复后的 threadId。
   */
  async start(
    input: TurnStartInput,
    threadId: string | undefined,
    signal: AbortSignal,
  ): Promise<string> {
    this.reopen();
    this.lastUserText = input.text;
    const plan = await prepareIsolation(this.ctx, this.config, {
      cwd: this.cwd,
      signal,
      selection: input.selection,
    });
    const connection = await connectCodex(
      this.ctx,
      {
        command: this.config.command,
        cwd: this.cwd,
        configOverrides: [...plan.configOverrides, ...this.extraOverrides],
        env: this.config.env,
        graceMs: this.config.graceMs,
        startupTimeoutMs: this.config.startupTimeoutMs,
      },
      signal,
    );
    this.connection = connection;
    this.installHandlers();
    await verifyIsolation(connection, plan, signal);
    // D13：统一 kmh- 前缀声明（含范围与碰撞校验），回执按声明表解析。
    const registry = buildToolRegistry(input.tools);
    this.toolRegistry = registry;
    if (threadId === undefined) {
      const raw: unknown = await connection.request(
        "thread/start",
        {
          model: input.model,
          cwd: this.cwd,
          baseInstructions: input.baseInstructions,
          developerInstructions: input.developerInstructions,
          // 平铺 legacy 声明：canonical namespace 的模型侧名称为无点拼接
          // （kmh+name），不适合人读与防撞，沿用已验证的平铺真名形态。
          dynamicTools: input.tools.map((tool) => ({
            name: registry.kmhToDeclared.get(tool.name),
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
        signal,
      );
      this.threadId = ThreadResult.parse(raw).thread.id;
    } else {
      // 旧 thread 以其建立时的声明续用：当前目录的裸名经兼容路径解析。
      const raw: unknown = await connection.request(
        "thread/resume",
        { threadId },
        signal,
      );
      this.threadId = ThreadResult.parse(raw).thread.id;
    }
    const turn: unknown = await connection.request(
      "turn/start",
      { threadId: this.threadId, input: [{ type: "text", text: input.text }] },
      signal,
    );
    this.turnId = TurnResult.parse(turn).turn.id;
    return this.threadId;
  }

  /**
   * 基线失效或原生会话缺失时重建绑定：优先从既有 thread fork（含到
   * lastTurnId 为止的历史），失败或无源时新建 thread；随后把重建文本作为
   * 首 turn 输入投递。
   * @param input - 模型与工具目录。
   * @param source - 既有绑定（threadId 与 fork 边界）；缺省新建。
   * @param rebuildText - KMH 侧历史序列化后的重建输入。
   * @param signal - 取消信号。
   * @returns 重建后的 threadId。
   */
  async rebuild(
    input: Omit<TurnStartInput, "text">,
    source: { threadId: string; lastTurnId?: string } | undefined,
    rebuildText: string,
    signal: AbortSignal,
  ): Promise<string> {
    this.reopen();
    this.lastUserText = rebuildText;
    const plan = await prepareIsolation(this.ctx, this.config, {
      cwd: this.cwd,
      signal,
      selection: input.selection,
    });
    const connection = await connectCodex(
      this.ctx,
      {
        command: this.config.command,
        cwd: this.cwd,
        configOverrides: [...plan.configOverrides, ...this.extraOverrides],
        env: this.config.env,
        graceMs: this.config.graceMs,
        startupTimeoutMs: this.config.startupTimeoutMs,
      },
      signal,
    );
    this.connection = connection;
    this.installHandlers();
    await verifyIsolation(connection, plan, signal);
    // D13：重建（含目录变化）一律重新声明带前缀工具；fork 分支继承源线程
    // 的既有工具集，目录变化场景由 adapter 直接走 fresh 分支（source=undefined）。
    const registry = buildToolRegistry(input.tools);
    this.toolRegistry = registry;
    let forked = false;
    if (source !== undefined) {
      try {
        const params: Record<string, unknown> = { threadId: source.threadId };
        if (source.lastTurnId !== undefined)
          params.lastTurnId = source.lastTurnId;
        const raw: unknown = await connection.request(
          "thread/fork",
          params,
          signal,
        );
        this.threadId = ThreadResult.parse(raw).thread.id;
        forked = true;
      } catch {
        // 原生会话缺失或 fork 被拒：回落全新 thread 与全量重建。
        forked = false;
      }
    }
    if (!forked) {
      const raw: unknown = await connection.request(
        "thread/start",
        {
          model: input.model,
          cwd: this.cwd,
          baseInstructions: input.baseInstructions,
          dynamicTools: input.tools.map((tool) => ({
            name: registry.kmhToDeclared.get(tool.name),
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
        signal,
      );
      this.threadId = ThreadResult.parse(raw).thread.id;
    }
    const threadId = this.threadId;
    if (threadId === undefined) throw new Error("CODEX_REBUILD_THREAD_MISSING");
    const turn: unknown = await connection.request(
      "turn/start",
      { threadId, input: [{ type: "text", text: rebuildText }] },
      signal,
    );
    this.turnId = TurnResult.parse(turn).turn.id;
    return threadId;
  }

  /** 移交外部建立的连接（临时会话路径）；此后由本对象负责回收。 */
  adopt(connection: CodexConnection): void {
    this.connection = connection;
    this.installHandlers();
  }
  /** 设置 thread 与 turn 标识（临时会话路径）。 */
  setIds(threadId: string, turnId: string): void {
    this.threadId = threadId;
    this.turnId = turnId;
  }

  /** 安装通知与服务端请求处理。 */
  private installHandlers(): void {
    const connection = this.connection;
    if (connection === undefined) return;
    connection.onNotification((method, params) => {
      try {
        this.handleNotification(method, params);
      } catch (error) {
        this.push({
          kind: "failure",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    });
    connection.onServerRequest(async (method, params) => {
      if (
        method !== Incoming.itemToolCall &&
        method !== Incoming.itemDynamicToolCall
      )
        throw new Error("CODEX_SERVER_REQUEST_UNEXPECTED");
      const call = DynamicToolCallParams.parse(params);
      if (this.threadId !== undefined && call.threadId !== this.threadId)
        throw new Error("CODEX_TOOL_CALL_THREAD_MISMATCH");
      if (
        call.namespace !== undefined &&
        call.namespace !== null &&
        call.namespace !== KMH_TOOL_NAMESPACE
      )
        throw new Error("CODEX_TOOL_CALL_NAMESPACE_UNEXPECTED");
      // D13：按声明表解析（兼容旧 thread 裸名）；未知名明确错误回执，不挂起。
      const kmhName = resolveKmhToolName(this.toolRegistry, call.tool);
      if (kmhName === undefined) {
        this.ctx.logger.warn(
          `codex-cli unknown tool callback: ${call.tool} (call ${call.callId})`,
        );
        return DynamicToolCallResponse.parse({
          success: false,
          contentItems: [
            {
              type: "inputText",
              text: `CODEX_TOOL_UNKNOWN: ${call.tool} 不在当前 KMH 工具目录中`,
            },
          ],
        });
      }
      return await new Promise<unknown>((resolve, reject) => {
        this.pending.set(call.callId, {
          callId: call.callId,
          tool: kmhName,
          arguments: call.arguments,
          reply: resolve,
          fail: reject,
        });
        const id = ToolCallId(call.callId);
        const index = this.allocate("");
        const argumentsDelta = JSON.stringify(call.arguments ?? {});
        this.push({
          kind: "chunk",
          chunk: { type: "block-start", index, blockType: "tool-call" },
        });
        this.push({
          kind: "chunk",
          chunk: {
            type: "tool-call-delta",
            index,
            id,
            name: kmhName,
            argumentsDelta,
          },
        });
        this.push({
          kind: "chunk",
          chunk: {
            type: "block-end",
            index,
            block: {
              type: "tool-call",
              id,
              name: kmhName,
              arguments: argumentsDelta,
            },
          },
        });
        this.push({ kind: "tool-pause" });
      });
    });
  }
  /** 通知投影。 */
  private handleNotification(
    method: string,
    params: Record<string, unknown>,
  ): void {
    if (
      this.threadId !== undefined &&
      params.threadId !== undefined &&
      params.threadId !== this.threadId
    )
      return;
    switch (method) {
      case Incoming.agentMessageDelta: {
        const delta = AgentMessageDeltaParams.parse(params);
        const index = this.allocate(delta.itemId);
        this.push({
          kind: "chunk",
          chunk: { type: "block-start", index, blockType: "text" },
        });
        this.push({
          kind: "chunk",
          chunk: { type: "text-delta", index, text: delta.delta },
        });
        break;
      }
      case Incoming.reasoningTextDelta:
      case Incoming.reasoningSummaryTextDelta: {
        const delta = ReasoningDeltaParams.parse(params);
        const index = this.allocate(delta.itemId);
        this.push({
          kind: "chunk",
          chunk: { type: "block-start", index, blockType: "reasoning" },
        });
        this.push({
          kind: "chunk",
          chunk: { type: "reasoning-delta", index, text: delta.delta },
        });
        break;
      }
      case Incoming.itemCompleted: {
        const item = params.item;
        if (item !== null && typeof item === "object") {
          const record = item as {
            type?: unknown;
            id?: unknown;
            text?: unknown;
            content?: unknown;
          };
          if (
            record.type === "agentMessage" &&
            typeof record.id === "string" &&
            typeof record.text === "string"
          ) {
            const index = this.allocate(record.id);
            this.push({
              kind: "chunk",
              chunk: {
                type: "block-end",
                index,
                block: { type: "text", text: record.text },
              },
            });
          } else if (
            record.type === "reasoning" &&
            typeof record.id === "string" &&
            Array.isArray(record.content)
          ) {
            const index = this.allocate(record.id);
            this.push({
              kind: "chunk",
              chunk: {
                type: "block-end",
                index,
                block: { type: "reasoning", text: record.content.join("") },
              },
            });
          } else if (record.type === "imageGeneration") {
            this.projectImage(item).catch(() => undefined);
          }
        }
        break;
      }
      case Incoming.turnCompleted: {
        const completed = TurnCompletedParams.parse(params);
        if (this.turnId !== undefined && completed.turn.id !== this.turnId)
          return;
        this.terminalStatus = completed.turn.status;
        // 终局先补算未闭合块的摘要，再入队终止事件：drive 收尾快照即完整。
        this.digestOpenBlocks();
        const usage = projectUsage(fieldOf(completed.turn, "usage"));
        this.push(
          usage === undefined
            ? { kind: "turn-done", status: completed.turn.status }
            : { kind: "turn-done", status: completed.turn.status, usage },
        );
        break;
      }
      case Incoming.error: {
        const failure = ErrorNotificationParams.parse(params);
        // 可重试的瞬态错误不打断 turn，仅忽略。
        if (failure.willRetry === true) break;
        const message = fieldOf(failure.error, "message");
        this.push({
          kind: "failure",
          error: new Error(
            `CODEX_SERVER_ERROR: ${typeof message === "string" ? message : "unknown"}`,
          ),
        });
        break;
      }
      default:
        break;
    }
  }
  /**
   * 把 Codex 原生生图结果投影为会话图片块：读取落盘产物、经宿主附件服务
   * 落成 ImageAttachmentRef 后以 image 块送回 KMH 展示，并随图报告实际
   * 像素尺寸（feat10）。投影失败不打断生成（跳过并告警）：投影是展示
   * 增强，生成与续推链路不依赖它；失败时改为推送双态报告文本块。
   * @param item - item/completed 携带的 ThreadItem::ImageGeneration。
   */
  private async projectImage(item: unknown): Promise<void> {
    const projection = imageProjectionOf(item);
    if (projection === undefined) return;
    if (this.projectedImages.has(projection.id)) return;
    this.projectedImages.add(projection.id);
    // 部分部署（headless）可能没有附件服务：跳过投影。
    const store = this.ctx.attachments;
    if (store === undefined) return;
    try {
      const data = await readFile(projection.path);
      const [first] = await store.saveImages([
        {
          data,
          mediaType: "image/png",
          ...(projection.name !== undefined ? { name: projection.name } : {}),
        },
      ]);
      if (first === undefined) throw new Error("CODEX_IMAGE_REF_MISSING");
      const index = this.allocate(projection.id);
      this.push({
        kind: "chunk",
        chunk: { type: "block-start", index, blockType: "image" },
      });
      this.push({
        kind: "chunk",
        chunk: {
          type: "block-end",
          index,
          block: { type: "image", attachment: first },
        },
      });
      this.pushNote(
        `${projection.id}:size`,
        imageSizeNote(
          pngSizeOf(data),
          imageSizeRequirementOf(this.lastUserText),
        ),
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.ctx.logger.warn(`codex-cli image projection failed: ${reason}`);
      // 双态报告：Codex 侧已生成（原生产物路径即恢复入口），KMH 侧接入失败。
      this.pushNote(
        `${projection.id}:failure`,
        imageFailureNote(projection.path, reason),
      );
    }
  }
  /** 推送一个自成一体的文本块（尺寸/失败等投影附注）。 */
  private pushNote(itemId: string, text: string): void {
    const index = this.allocate(itemId);
    this.push({
      kind: "chunk",
      chunk: { type: "block-start", index, blockType: "text" },
    });
    this.push({
      kind: "chunk",
      chunk: { type: "text-delta", index, text },
    });
    this.push({
      kind: "chunk",
      chunk: { type: "block-end", index, block: { type: "text", text } },
    });
  }
  /** 为流块分配序号；同一 itemId 复用。 */
  private allocate(itemId: string): number {
    let index = this.itemIndex.get(itemId);
    if (index === undefined) {
      index = this.nextIndex++;
      this.itemIndex.set(itemId, index);
    }
    return index;
  }
  private push(event: Queued): void {
    if (this.closed) return;
    const chunk = event.kind === "chunk" ? event.chunk : undefined;
    if (chunk !== undefined) {
      // 文本/推理块按索引累积：Codex 对 turn 末条消息常不发 item/completed，
      // 摘要在 turn-done 时以累积文本补算（与 KMH 侧按 delta 组装一致）。
      if (chunk.type === "block-start") {
        if (chunk.blockType === "text" || chunk.blockType === "reasoning") {
          this.blockTypes.set(chunk.index, chunk.blockType);
          this.blockText.set(chunk.index, "");
        }
      } else if (
        chunk.type === "text-delta" ||
        chunk.type === "reasoning-delta"
      ) {
        const text = this.blockText.get(chunk.index) ?? "";
        this.blockText.set(chunk.index, text + chunk.text);
      } else if (chunk.type === "block-end") {
        this.endedBlocks.add(chunk.index);
        const block = chunk.block as { type?: unknown; text?: unknown };
        if (
          (block.type === "text" || block.type === "reasoning") &&
          typeof block.text === "string"
        )
          this.blockText.set(chunk.index, block.text);
        // 本回合产出的块入待核对队列：turn 边界差分用它核对历史 assistant 消息。
        const d = blockDigest(chunk.block);
        if (d !== undefined) this.pendingDigests.push(d);
      }
    }
    this.queue.push(event);
    this.wakeup?.();
  }
  /** turn 终局补算未闭合文本/推理块的摘要（内容取 delta 累积）。 */
  private digestOpenBlocks(): void {
    for (const [index, type] of this.blockTypes) {
      if (this.endedBlocks.has(index)) continue;
      this.endedBlocks.add(index);
      const d = blockDigest({ type, text: this.blockText.get(index) ?? "" });
      if (d !== undefined) this.pendingDigests.push(d);
    }
  }
  private wait(): Promise<void> {
    if (this.queue.length > 0) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.wakeup = resolve;
    });
  }

  /**
   * 消费投影流直到工具挂起或 turn 终止。
   * @param signal - 取消信号；中止时队列关闭并抛出 CODEX_TURN_CANCELLED。
   */
  async *pump(signal: AbortSignal): AsyncGenerator<StreamChunk> {
    while (true) {
      signal.throwIfAborted();
      if (this.queue.length === 0) await this.wait();
      const event = this.queue.shift();
      if (event === undefined) continue;
      if (event.kind === "chunk") {
        yield event.chunk;
        continue;
      }
      if (event.kind === "tool-pause") {
        // 工具挂起：结束本次流但不回收进程，等待下一次调用回传结果续推。
        yield { type: "finish", reason: { kind: "tool-calls" } };
        return;
      }
      if (event.kind === "failure") {
        await this.dispose();
        throw event.error;
      }
      // turn-done：报用量并按状态收尾。
      const chunks: StreamChunk[] = [];
      if (event.usage !== undefined)
        chunks.push({ type: "usage", usage: event.usage });
      const status = event.status;
      chunks.push({
        type: "finish",
        reason:
          status === "completed"
            ? { kind: "stop" }
            : {
                kind: status === "interrupted" ? "aborted" : "error",
                failure: {
                  message: `CODEX_TURN_STATUS_${status}`,
                  code: status === "interrupted" ? "ABORTED" : "PROVIDER_ERROR",
                },
              },
      });
      try {
        for (const chunk of chunks) yield chunk;
      } finally {
        await this.dispose();
      }
      return;
    }
  }
  /**
   * 回传一组工具结果并继续消费投影流。
   * @param results - 与挂起工具逐一匹配的结果集合。
   */
  async *resumeWithToolResults(
    results: { callId: string; text: string; isError: boolean }[],
    signal: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    if (this.pending.size === 0) throw new Error("CODEX_NO_PENDING_TOOL");
    for (const result of results) {
      const tool = this.pending.get(result.callId);
      if (tool === undefined) throw new Error("CODEX_TOOL_CALL_MISMATCH");
      this.pending.delete(result.callId);
      tool.reply({
        success: !result.isError,
        contentItems: [{ type: "inputText", text: result.text }],
      });
    }
    yield* this.pump(signal);
  }
  /** 中断当前 turn 并等待终止通知，随后回收进程。 */
  async interrupt(signal: AbortSignal): Promise<void> {
    const connection = this.connection;
    if (connection === undefined || this.terminalStatus !== undefined) {
      await this.dispose();
      return;
    }
    const threadId = this.threadId;
    const turnId = this.turnId;
    if (threadId === undefined || turnId === undefined) {
      await this.dispose();
      return;
    }
    try {
      await connection.request(
        "turn/interrupt",
        { threadId, turnId },
        AbortSignal.any([
          signal,
          AbortSignal.timeout(this.config.cancelReceiptTimeoutMs),
        ]),
      );
      // 等待 interrupted 终止通知到达（有界）。
      const deadline = Date.now() + this.config.cancelReceiptTimeoutMs;
      while (this.terminalStatus === undefined && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 25));
    } finally {
      this.failPending(new Error("CODEX_TURN_CANCELLED"));
      await this.dispose();
    }
  }
  /** 拒绝全部挂起工具请求。 */
  private failPending(error: Error): void {
    for (const tool of this.pending.values()) tool.fail(error);
    this.pending.clear();
  }
  /** 回收连接与进程；幂等。 */
  async dispose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.wakeup?.();
    this.failPending(new Error("CODEX_TURN_DISPOSED"));
    const connection = this.connection;
    this.connection = undefined;
    if (connection !== undefined && !connection.exited)
      await connection.stop(this.config.cleanupTimeoutMs);
  }
}
/** Codex turn 用量投影为 KMH 用量；输入拆出缓存部分。 */
function projectUsage(value: unknown): TokenUsage | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const record = value as {
    inputTokens?: unknown;
    cachedInputTokens?: unknown;
    outputTokens?: unknown;
  };
  if (
    typeof record.inputTokens !== "number" ||
    typeof record.outputTokens !== "number"
  )
    return undefined;
  const cached =
    typeof record.cachedInputTokens === "number" ? record.cachedInputTokens : 0;
  return {
    inputTokens: Math.max(0, record.inputTokens - cached),
    outputTokens: record.outputTokens,
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
  };
}
