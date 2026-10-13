/** 一个 KMH 回合内的 Codex turn：进程、thread、挂起工具与流式投影。 */
import type { Context } from "@deepseek-ai/cordis";
import { readFile } from "node:fs/promises";
import { addAbortListener } from "node:events";
import type { z } from "zod";
import type { TokenUsageBreakdownParams } from "./protocol.ts";
import type {} from "@deepseek-ai/dsh-attachment";
import {
  ToolCallId,
  type StreamChunk,
  type TokenUsage,
} from "@deepseek-ai/dsh-llm";
import type { Config } from "./config.ts";
import type { NativeSelection } from "./capabilities.ts";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { connectCodex, type CodexConnection } from "./connection.ts";
import {
  AgentMessageDeltaParams,
  CommandExecutionOutputDeltaParams,
  DynamicToolCallParams,
  DynamicToolCallResponse,
  ErrorNotificationParams,
  Incoming,
  ItemEventParams,
  KMH_TOOL_NAMESPACE,
  McpToolCallProgressParams,
  ReasoningDeltaParams,
  ThreadResult,
  ThreadForkParams,
  TokenUsageParams,
  TurnCompletedParams,
  TurnDiffUpdatedParams,
  TurnResult,
  TurnStartParams,
  imageProjectionOf,
  reasoningItemText,
} from "./protocol.ts";
import {
  prepareIsolation,
  verifyIsolation,
  type PermissionKnobs,
} from "./isolation.ts";
import { blockDigest, emptySnapshot, type CursorSnapshot } from "./cursor.ts";
import {
  buildToolRegistry,
  resolveKmhToolName,
  type ToolRegistry,
} from "./tool-registry.ts";
import { CodexApprovalBridge } from "./approval.ts";
import {
  NATIVE_DIFF_NOTE_ID,
  NATIVE_NOTE_LIMIT,
  NATIVE_TRUNCATED_NOTE,
  NATIVE_UNSETTLED_NOTE,
  diffBudgetAccepts,
  diffSummaryLineOf,
  nativeCompletionNoteOf,
  nativeHeaderOf,
  newDiffBudget,
  newNoteBudget,
  type DiffNoteBudget,
  type NativeNoteBudget,
} from "./native-items.ts";
import {
  imageFailureNote,
  imageSizeNote,
  imageSizeRequirementOf,
  pngSizeOf,
} from "./image-delivery.ts";
import { fieldOf } from "./protocol.ts";

/** turn 启动所需请求侧信息。 */
export interface TurnStartInput {
  /** 完整冻结工具策略参与 thread 复用。 */
  policyFingerprint?: string | undefined;
  text: string;
  model: string;
  reasoningEffort?: string | undefined;
  baseInstructions?: string | undefined;
  developerInstructions?: string | undefined;
  tools: { name: string; description: string; inputSchema: unknown }[];
  /** 逐项选择覆盖；缺省用部署配置迁移。 */
  selection?: NativeSelection | undefined;
  /** 会话标识：审批桥据此取活跃 Agent（feat09）。 */
  sessionId?: SessionId | undefined;
  /** 会话生效权限档（D17）；选中执行类原生工具时映射为 -c 沙箱/审批参数。 */
  permission?: PermissionKnobs | undefined;
}
/** 队列事件。 */
type Queued =
  | { kind: "chunk"; chunk: StreamChunk }
  | { kind: "tool-pause" }
  | { kind: "turn-done"; status: string }
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
  /** 已开块索引；同一 item 的后续 delta 沿用现有块及累积文本。 */
  private readonly openBlocks = new Set<number>();
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
  /** 会话标识：审批桥取活跃 Agent 用。 */
  private sessionId: SessionId | undefined;
  /** 回合级审批中止：dispose/interrupt 时待审批决定随回合取消（feat06 场景1）。 */
  private approvalAbort: AbortController | undefined;
  /** 原生叙述账目（feat08 v1）：按 item 的体积与收尾状态；reopen 重置。 */
  private readonly nativeNotes = new Map<string, NativeNoteBudget>();
  /** turn 级 diff 叙述账目。 */
  private diffBudget: DiffNoteBudget = newDiffBudget();
  /**
   * 本回合的工具声明表（D13）：声明名 kmh-<原名> 与目录指纹。
   * start/rebuild 时建立；临时会话（adopt）保持 undefined，仅兼容裸名。
   */
  toolRegistry: ToolRegistry | undefined;
  /**
   * 未上报的逐响应用量样本队列（token 用量）：Codex 每次上游响应完成发
   * 一条 thread/tokenUsage/updated（last=该响应用量），turn/completed 不带
   * 用量；KMH 要求每个 step 的 assistant 消息都有样本（缺一则整轮不显示），
   * 且首个样本常在本侧 yield 工具挂起之后才到达——队列 + finish 时消费
   * （空则补零样本）使各样本之和恒等于回合总量，与到达时序解耦。
   */
  private readonly usageQueue: TokenUsage[] = [];

  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly cwd: string,
    /** 调用方在隔离覆盖之上追加的进程配置（测试 fixture 等）。 */
    private readonly extraOverrides: readonly string[] = [],
    /** 官方重试通知及恢复输出时的连接状态。 */
    private readonly onConnectionState?: (
      retrying: boolean,
      detail: string,
    ) => void,
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
    this.openBlocks.clear();
    this.lastUserText = "";
    this.toolRegistry = undefined;
    this.approvalAbort = undefined;
    this.nativeNotes.clear();
    this.diffBudget = newDiffBudget();
    this.usageQueue.length = 0;
  }

  /** 等待结果回传的挂起工具调用标识。 */
  pendingCallIds(): string[] {
    return [...this.pending.keys()];
  }
  /**
   * 消费一条未上报用量样本；队列空时补零样本（该步样本尚未到达或本轮
   * 无上游响应）。晚到样本留给下一步，各步样本之和仍等于回合总量。
   */
  private consumeUsageSample(): TokenUsage {
    return (
      this.usageQueue.shift() ?? {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }
    );
  }
  /**
   * 回合终局消费：合并队列全部剩余样本为一个（KMH 消费端只认最后一条
   * usage chunk，逐条发会被覆盖；样本不相交，逐字段求和保持口径一致）。
   * 队列空时补零样本，保证终局步也有样本。
   */
  private consumeUsageTotal(): TokenUsage {
    const merged = this.consumeUsageSample();
    merged.totalTokens = merged.totalTokens ?? 0;
    while (this.usageQueue.length > 0) {
      const next = this.usageQueue.shift();
      if (next === undefined) break;
      merged.inputTokens += next.inputTokens;
      merged.outputTokens += next.outputTokens;
      merged.totalTokens += next.totalTokens ?? 0;
      merged.cacheReadTokens =
        (merged.cacheReadTokens ?? 0) + (next.cacheReadTokens ?? 0);
      merged.cacheWriteTokens =
        (merged.cacheWriteTokens ?? 0) + (next.cacheWriteTokens ?? 0);
      if (next.reasoningTokens !== undefined)
        merged.reasoningTokens =
          (merged.reasoningTokens ?? 0) + next.reasoningTokens;
    }
    return merged;
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
   * @param onBound - 收到编号后、发送任务前等待的保存操作；失败时停止发送。
   * @returns 新建或恢复后的 threadId。
   */
  async start(
    input: TurnStartInput,
    threadId: string | undefined,
    signal: AbortSignal,
    onBound?: (id: string) => Promise<void>,
  ): Promise<string> {
    this.reopen();
    this.lastUserText = input.text;
    this.sessionId = input.sessionId;
    this.approvalAbort = new AbortController();
    const plan = await prepareIsolation(this.ctx, this.config, {
      cwd: this.cwd,
      signal,
      selection: input.selection,
      permission: input.permission,
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
    const registry = buildToolRegistry(input.tools, input.policyFingerprint);
    this.toolRegistry = registry;
    if (threadId === undefined) {
      const raw: unknown = await connection.request(
        "thread/start",
        {
          model: input.model,
          experimentalRawEvents: true,
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
      if (this.threadId !== threadId)
        throw new Error("CODEX_SESSION_ID_MISMATCH");
    }
    await onBound?.(this.threadId);
    const turn: unknown = await connection.request(
      "turn/start",
      TurnStartParams.parse({
        threadId: this.threadId,
        input: [{ type: "text", text: input.text }],
        model: input.model,
        effort: input.reasoningEffort,
        summary: this.config.reasoningSummary,
      }),
      signal,
    );
    this.turnId = TurnResult.parse(turn).turn.id;
    return this.threadId;
  }

  /**
   * 原生分叉继承已选位置的历史，仅提交新增输入；失败保留源会话。
   * @param input - 源会话工具与本次模型、权限选择。
   * @param source - 原生父会话及完成回合前后的位置。
   * @param text - 完整新增或编辑后的输入。
   * @param signal - 取消信号。
   * @param onBound - 新编号保存操作；发送输入前等待完成。
   * @returns 原生分叉创建的会话编号。
   */
  async rebuild(
    input: Omit<TurnStartInput, "text">,
    source: { threadId: string; lastTurnId?: string; beforeTurnId?: string },
    text: string,
    signal: AbortSignal,
    onBound?: (id: string) => Promise<void>,
  ): Promise<string> {
    this.reopen();
    this.lastUserText = text;
    this.sessionId = input.sessionId;
    this.approvalAbort = new AbortController();
    const plan = await prepareIsolation(this.ctx, this.config, {
      cwd: this.cwd,
      signal,
      selection: input.selection,
      permission: input.permission,
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
    const registry = buildToolRegistry(input.tools, input.policyFingerprint);
    this.toolRegistry = registry;
    const params = ThreadForkParams.parse(source);
    const raw: unknown = await connection.request(
      "thread/fork",
      params,
      signal,
    );
    this.threadId = ThreadResult.parse(raw).thread.id;
    if (this.threadId === source.threadId)
      throw new Error("CODEX_FORK_ID_MISMATCH");
    await onBound?.(this.threadId);
    const threadId = this.threadId;
    if (threadId === undefined) throw new Error("CODEX_REBUILD_THREAD_MISSING");
    const turn: unknown = await connection.request(
      "turn/start",
      TurnStartParams.parse({
        threadId,
        input: [{ type: "text", text }],
        model: input.model,
        effort: input.reasoningEffort,
        summary: this.config.reasoningSummary,
      }),
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
        if (method === "rawResponseItem/completed")
          this.ctx
            .get("codexCli")
            ?.toolPolicy?.observeNative(this.sessionId, params);
        this.handleNotification(method, params);
      } catch (error) {
        this.push({
          kind: "failure",
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    });
    connection.onServerRequest(async (method, params) => {
      // 审批类服务端请求：交审批桥转 KMH 用户决定（feat09，D18）。
      const bridge = new CodexApprovalBridge(
        this.ctx,
        this.sessionId,
        this.approvalAbort?.signal,
      );
      switch (method) {
        case Incoming.itemCommandExecutionRequestApproval:
          try {
            return await bridge.handleCommandApproval(params);
          } catch (error) {
            this.ctx.logger.warn(
              `codex-cli command approval failed: ${error instanceof Error ? error.message : String(error)}`,
            );
            throw error;
          }
        case Incoming.itemFileChangeRequestApproval:
          return await bridge.handleFileChangeApproval(params);
        case Incoming.itemPermissionsRequestApproval:
          return await bridge.handlePermissionsApproval(params);
        case Incoming.itemToolRequestUserInput:
          return await bridge.handleUserInput(params);
        case Incoming.mcpServerElicitationRequest:
          return await bridge.handleElicitation(params);
      }
      if (
        method !== Incoming.itemToolCall &&
        method !== Incoming.itemDynamicToolCall
      ) {
        this.ctx.logger.warn(
          `codex-cli unexpected server request: ${method}; params=${JSON.stringify(params).slice(0, 400)}`,
        );
        throw new Error(`CODEX_SERVER_REQUEST_UNEXPECTED: ${method}`);
      }
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
        // 工具挂起也是一步 assistant 消息：pump 收尾时补用量样本。
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
        if (!this.openBlocks.has(index))
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
        if (!this.openBlocks.has(index))
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
      case Incoming.itemStarted: {
        // 原生执行叙述（feat08 v1）：开始即开一个独立文本块（场景1/3）。
        const started = ItemEventParams.parse(params);
        const header = nativeHeaderOf(started.item);
        if (header !== undefined)
          this.openNativeNote(header.itemId, header.header);
        break;
      }
      case Incoming.commandExecutionOutputDelta: {
        // 命令输出随执行更新（场景1）：增量追加进该调用的叙述块，超限截断。
        const output = CommandExecutionOutputDeltaParams.parse(params);
        this.appendNativeNote(output.itemId, output.delta);
        break;
      }
      case Incoming.mcpToolCallProgress: {
        const progress = McpToolCallProgressParams.parse(params);
        this.appendNativeNote(progress.itemId, `▸ 进度：${progress.message}\n`);
        break;
      }
      case Incoming.turnDiffUpdated: {
        // turn 级文件变更摘要（D14）：按范围统计行数，更新次数封顶。
        const updated = TurnDiffUpdatedParams.parse(params);
        if (diffBudgetAccepts(this.diffBudget)) {
          this.diffBudget.updates += 1;
          if (!this.nativeNotes.has(NATIVE_DIFF_NOTE_ID))
            this.openNativeNote(
              NATIVE_DIFF_NOTE_ID,
              "▸ [codex 原生·变更] 本回合文件变更：",
            );
          this.appendNativeNote(
            NATIVE_DIFF_NOTE_ID,
            `${diffSummaryLineOf(updated.diff)}\n`,
          );
        }
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
            typeof record.id === "string"
          ) {
            const text = reasoningItemText(item);
            if (text !== undefined) {
              const index = this.allocate(record.id);
              this.push({
                kind: "chunk",
                chunk: {
                  type: "block-end",
                  index,
                  block: { type: "reasoning", text },
                },
              });
            }
          } else if (record.type === "imageGeneration") {
            this.projectImage(item).catch(() => undefined);
            this.closeNativeNote(item);
          } else {
            // 其余原生 item：追加完成状态并收尾叙述块（场景1：结果）。
            this.closeNativeNote(item);
          }
        }
        break;
      }
      case Incoming.turnCompleted: {
        const completed = TurnCompletedParams.parse(params);
        if (this.turnId !== undefined && completed.turn.id !== this.turnId)
          return;
        this.terminalStatus = completed.turn.status;
        this.lastCompletedTurnId = completed.turn.id;
        // 缺结束确认的调用补记待确认（场景5/6），再补算未闭合块摘要。
        this.closeUnsettledNativeNotes();
        this.digestOpenBlocks();
        // turn/completed 的 turn 不带 usage（0.162 wire 实测）；样本来自
        // thread/tokenUsage/updated 队列，pump 收尾时统一消费。
        this.push({ kind: "turn-done", status: completed.turn.status });
        break;
      }
      case Incoming.tokenUsageUpdated: {
        // 记录本回合的逐响应用量样本（跨回合/旧回合回放按 turnId 过滤）。
        const usageEvent = TokenUsageParams.parse(params);
        if (usageEvent.turnId !== this.turnId) return;
        const mapped = breakdownToUsage(usageEvent.tokenUsage.last);
        if (mapped !== undefined) this.usageQueue.push(mapped);
        break;
      }
      case Incoming.error: {
        const failure = ErrorNotificationParams.parse(params);
        if (
          this.turnId !== undefined &&
          failure.turnId !== undefined &&
          failure.turnId !== this.turnId
        )
          return;
        const detail = [
          failure.error?.message ?? failure.message ?? "unknown",
          failure.error?.additionalDetails,
        ]
          .filter(Boolean)
          .join(": ");
        if (failure.willRetry === true) {
          this.onConnectionState?.(true, detail);
          break;
        }
        this.push({
          kind: "failure",
          error: new Error(`CODEX_SERVER_ERROR: ${detail}`),
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
    try {
      // 附件服务缺失（headless 部署）时跳过投影；访问放在 try 内——
      // cordis 上下文代理对未注入服务的访问是抛错而非 undefined。
      const store = this.ctx.attachments;
      if (store === undefined) return;
      const data = await readFile(projection.path);
      const [first] = await store.saveImages([
        {
          data,
          mediaType: "image/png",
          ...(projection.name !== undefined ? { name: projection.name } : {}),
        },
      ]);
      if (first === undefined) throw new Error("CODEX_IMAGE_REF_MISSING");
      // 索引键不能与叙述块共用：openNativeNote 已按同一 item id 开过文本块
      // （先关先赢会让同索引的 image 块被组装器静默丢弃），用独立后缀。
      const index = this.allocate(`${projection.id}:image`);
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
  /** 开启一条原生叙述块（item/started）。 */
  private openNativeNote(itemId: string, header: string): void {
    if (this.nativeNotes.has(itemId)) return;
    const budget = newNoteBudget();
    budget.chars = header.length;
    budget.text = `${header}\n`;
    this.nativeNotes.set(itemId, budget);
    const index = this.allocate(itemId);
    this.push({
      kind: "chunk",
      chunk: { type: "block-start", index, blockType: "text" },
    });
    this.push({
      kind: "chunk",
      chunk: { type: "text-delta", index, text: budget.text },
    });
  }
  /** 向原生叙述块追加增量（输出/进度/diff 摘要），超限截断、收尾后拒收。 */
  private appendNativeNote(itemId: string, text: string): void {
    const budget = this.nativeNotes.get(itemId);
    if (budget === undefined || budget.closed || budget.truncated) return;
    if (budget.chars + text.length > NATIVE_NOTE_LIMIT) {
      budget.truncated = true;
      budget.text += NATIVE_TRUNCATED_NOTE;
      const index = this.allocate(itemId);
      this.push({
        kind: "chunk",
        chunk: { type: "text-delta", index, text: NATIVE_TRUNCATED_NOTE },
      });
      return;
    }
    budget.chars += text.length;
    budget.text += text;
    const index = this.allocate(itemId);
    this.push({
      kind: "chunk",
      chunk: { type: "text-delta", index, text },
    });
  }
  /** 收尾原生叙述块（item/completed）：补完成状态并块结束（一次性）。 */
  private closeNativeNote(item: unknown): void {
    const note = nativeCompletionNoteOf(item);
    if (note === undefined) return;
    const id = fieldOf(item, "id");
    if (typeof id !== "string") return;
    const budget = this.nativeNotes.get(id);
    const index = this.allocate(id);
    if (budget === undefined) {
      // 错过 started 的完成事件：以完整单块补记（开头 + 完成状态）。
      const header = nativeHeaderOf(item);
      if (header === undefined) return;
      const full = `${header.header}\n${note}`;
      this.nativeNotes.set(id, {
        ...newNoteBudget(),
        closed: true,
        text: full,
      });
      this.push({
        kind: "chunk",
        chunk: { type: "block-start", index, blockType: "text" },
      });
      this.push({
        kind: "chunk",
        chunk: { type: "text-delta", index, text: full },
      });
      this.push({
        kind: "chunk",
        chunk: {
          type: "block-end",
          index,
          block: { type: "text", text: full },
        },
      });
      return;
    }
    if (budget.closed) return;
    budget.closed = true;
    budget.text += note;
    this.push({
      kind: "chunk",
      chunk: { type: "text-delta", index, text: note },
    });
    this.push({
      kind: "chunk",
      chunk: {
        type: "block-end",
        index,
        block: { type: "text", text: budget.text },
      },
    });
  }
  /** 回合终局：仍未收尾的原生叙述补记待确认并闭合（场景5/6）。 */
  private closeUnsettledNativeNotes(): void {
    for (const [itemId, budget] of this.nativeNotes) {
      if (budget.closed) continue;
      // diff 摘要不是调用记录：无"待确认"语义，交给 digestOpenBlocks 常规闭合。
      if (itemId === NATIVE_DIFF_NOTE_ID) continue;
      budget.closed = true;
      budget.text += NATIVE_UNSETTLED_NOTE;
      const index = this.allocate(itemId);
      this.push({
        kind: "chunk",
        chunk: { type: "text-delta", index, text: NATIVE_UNSETTLED_NOTE },
      });
      this.push({
        kind: "chunk",
        chunk: {
          type: "block-end",
          index,
          block: { type: "text", text: budget.text },
        },
      });
    }
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
      if (
        chunk.type === "text-delta" ||
        chunk.type === "reasoning-delta" ||
        chunk.type === "tool-call-delta"
      )
        this.onConnectionState?.(false, "CLI 通信中");
      // 文本/推理块按索引累积：Codex 对 turn 末条消息常不发 item/completed，
      // 摘要在 turn-done 时以累积文本补算（与 KMH 侧按 delta 组装一致）。
      if (chunk.type === "block-start") {
        this.openBlocks.add(chunk.index);
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
        this.openBlocks.delete(chunk.index);
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
  private async wait(signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    if (this.queue.length > 0) return Promise.resolve();
    let listener: ReturnType<typeof addAbortListener> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        this.wakeup = resolve;
        listener = addAbortListener(signal, () => {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- DSH 以 AgentCancelCause 对象传递停止原因。
          reject(signal.reason);
        });
      });
      signal.throwIfAborted();
    } finally {
      this.wakeup = undefined;
      listener?.[Symbol.dispose]();
    }
  }

  /**
   * 消费投影流直到工具挂起或 turn 终止。
   * @param signal - 取消或超时信号；等待期间中止会立即抛出 signal.reason。
   */
  async *pump(signal: AbortSignal): AsyncGenerator<StreamChunk> {
    while (true) {
      signal.throwIfAborted();
      if (this.queue.length === 0) await this.wait(signal);
      const event = this.queue.shift();
      if (event === undefined) continue;
      if (event.kind === "chunk") {
        yield event.chunk;
        continue;
      }
      if (event.kind === "tool-pause") {
        // 工具挂起：先补本步用量样本再结束本次流，不回收进程，等待下一
        // 次调用回传结果续推。样本此刻未到时补零，真实样本留在队列供下一
        // 步消费（各步样本之和恒等于回合总量）。
        yield { type: "usage", usage: this.consumeUsageSample() };
        yield { type: "finish", reason: { kind: "tool-calls" } };
        return;
      }
      if (event.kind === "failure") {
        await this.dispose();
        throw event.error;
      }
      // turn-done：报用量并按状态收尾（终局合并全部剩余样本）。
      const chunks: StreamChunk[] = [];
      chunks.push({ type: "usage", usage: this.consumeUsageTotal() });
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
      if (this.terminalStatus === undefined)
        throw new Error("CODEX_INTERRUPT_UNCONFIRMED");
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
    // 待审批决定随本回合取消：中止使 approval/request 归结 cancelled、
    // userQuestions.ask 抛 ASK_ABORTED，迟到的用户答复按过期处理。
    this.approvalAbort?.abort(new Error("CODEX_TURN_DISPOSED"));
    const connection = this.connection;
    this.connection = undefined;
    if (connection !== undefined && !connection.exited)
      await connection.stop(this.config.cleanupTimeoutMs);
  }
}
/**
 * Codex 用量明细（TokenUsageBreakdown，总量口径含缓存）投影为 KMH 用量
 * （拆分口径：inputTokens 仅未缓存部分，缓存单独计）。totalTokens 保留
 * 官方精确总数——KMH 的 normalizeUsage 缺它且缺 cacheWrite 桶时直接拒绝。
 */
function breakdownToUsage(
  value: z.infer<typeof TokenUsageBreakdownParams>,
): TokenUsage {
  const cacheWrite = Math.max(0, value.cacheWriteInputTokens);
  const cacheRead = Math.max(0, value.cachedInputTokens);
  const input = Math.max(0, value.inputTokens - cacheRead - cacheWrite);
  const output = Math.max(0, value.outputTokens);
  const reasoning = Math.max(0, value.reasoningOutputTokens);
  return {
    inputTokens: input,
    outputTokens: output,
    // 与官方总数一致性：total = input + cached + cacheWrite + output。
    totalTokens: Math.max(0, value.totalTokens),
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    ...(reasoning > 0 && reasoning <= output
      ? { reasoningTokens: reasoning }
      : {}),
  };
}
