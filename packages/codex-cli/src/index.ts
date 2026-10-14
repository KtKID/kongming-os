/** Independently distributable KMH provider for the official Codex CLI app-server. */
import { brandString } from "@deepseek-ai/dsh-brand";
import { Service, type Context } from "@deepseek-ai/cordis";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { addAbortListener } from "node:events";
import type { SessionLiveState } from "./live-state.ts";
export type { SessionLiveState } from "./live-state.ts";
import { CodexToolPolicy } from "./tool-policy.ts";
import { applyToolSwitch, listToolSwitches } from "./tool-switches-service.ts";
import type { ToolSwitchList, ToolSwitchUpdate } from "./tool-switches.ts";
import { CodexAccount } from "./account.ts";
import { mountWeb } from "./web.ts";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { Config } from "./config.ts";
import {
  selectionFromLegacy,
  selectionOf,
  type NativeSelection,
} from "./capabilities.ts";
import { fieldOf } from "./protocol.ts";
import { CodexAdapter } from "./adapter.ts";
import { connectCodex } from "./connection.ts";
import { emptySnapshot } from "./cursor.ts";
import { fetchCatalog, type CodexModelEntry } from "./models.ts";
import {
  CodexSessionStore,
  cursorToRecord,
  recordToCursor,
  type BindingRecord,
  type SavedToolPolicy,
} from "./session-store.ts";
import {
  prepareIsolation,
  verifyIsolation,
  type PermissionKnobs,
} from "./isolation.ts";
import type {} from "@deepseek-ai/dsh-session-projection";
import type {} from "@deepseek-ai/dsh-permission-presets";
import { CodexTurn } from "./turn.ts";
import { ThreadResult, TurnResult, TurnStartParams } from "./protocol.ts";
export { Config } from "./config.ts";
export { connectCodex, CodexConnection } from "./connection.ts";
export { CodexAdapter } from "./adapter.ts";
export * from "./protocol.ts";

/** Cordis plugin identity. */
export const name = "kmh/codex-cli";
/** Required model, process, user-interaction and attachment services（审批桥与生图投影依赖）。 */
export const inject = [
  "llm",
  "subprocess",
  "agents",
  "approval",
  "userQuestions",
  "attachments",
  "tools",
];
declare module "@deepseek-ai/cordis" {
  interface Context {
    codexCli: CodexCli;
  }
}
/** 会话级状态：turn、工作目录与 thread 绑定。 */
interface SessionState {
  turn: CodexTurn;
  threadId: string | undefined;
  chain: Promise<void>;
}
/**
 * Own shared runtime state for the Codex CLI provider.
 * 目录缓存、会话串行与 thread 绑定挂在此服务上，adapter 与 Web 共用。
 */
/** 详情页可变设置：逐项选择与最近测试结果。 */
export interface RuntimeSettings {
  selection: NativeSelection;
  defaultModel?: string;
  lastProbe?: { at: string; ok: boolean; error?: string };
}
/** 设置文件形态（dataDir/codex-settings.json）。 */
interface SettingsFile {
  selection: NativeSelection;
}
/** 读取持久化设置；缺失或损坏时按旧开关迁移（feat02 场景7）。 */
function loadSettings(config: Config): RuntimeSettings {
  try {
    const text: unknown = readFileSync(
      join(config.dataDir, "codex-settings.json"),
      "utf8",
    );
    const parsed: unknown = JSON.parse(typeof text === "string" ? text : "");
    const record =
      parsed === null || typeof parsed !== "object" ? undefined : parsed;
    const selection = selectionOf(fieldOf(record, "selection"));
    return { selection };
  } catch {
    return { selection: selectionFromLegacy(config.nativeToolsEnabled) };
  }
}

export class CodexCli extends Service {
  private catalogCache: Promise<CodexModelEntry[]> | undefined;
  private readonly sessions = new Map<string, SessionState>();
  /** 会话 → CLI 连接实时状态（状态小球轮询数据源）。 */
  private readonly liveStates = new Map<string, SessionLiveState>();
  private readonly store: CodexSessionStore;
  /** 账号操作（状态/登录/取消/退出）。 */
  readonly account: CodexAccount;
  /** 详情页可变设置；逐项选择立即保存、下一回合生效。 */
  readonly settings: RuntimeSettings;
  /** 由 profile 插件挂载的 Config 策略与执行守卫。 */
  toolPolicy: CodexToolPolicy | undefined;

  constructor(
    ctx: Context,
    readonly config: Config,
  ) {
    super(ctx, "codexCli");
    this.store = new CodexSessionStore(config.dataDir);
    this.account = new CodexAccount(ctx, config);
    this.settings = loadSettings(config);
    ctx.effect(
      () => () => {
        for (const state of this.sessions.values())
          state.turn.dispose().catch(() => undefined);
        this.sessions.clear();
      },
      "codex-cli: sessions",
    );
  }
  /** 本插件自报的工具开关清单；refresh 时重新发现原生目录（详情页选择器读取）。 */
  toolSwitches(signal: AbortSignal, refresh = false): Promise<ToolSwitchList> {
    return listToolSwitches(this, this.ctx, signal, refresh);
  }
  /** 切换一个开关并带修订号写入 profile 配置，返回新清单；只对普通新建会话生效。 */
  setToolSwitch(
    update: ToolSwitchUpdate,
    signal: AbortSignal,
  ): Promise<ToolSwitchList> {
    return applyToolSwitch(this, this.ctx, update, signal);
  }
  /** 保存逐项选择：原子落盘后立即生效于下一回合（进行中回合不受影响）。 */
  async saveSelection(selection: NativeSelection): Promise<void> {
    const accepted = selectionOf(selection);
    if (this.toolPolicy !== undefined) {
      for (const key of [
        "commandExecution",
        "fileChange",
        "viewImage",
        "webSearch",
      ] as const) {
        if (accepted[key] !== this.settings.selection[key])
          throw new Error("CODEX_TOOLS_REQUIRE_PROFILE_CONFIG");
      }
    }
    await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 });
    const file = join(this.config.dataDir, "codex-settings.json");
    const temp = `${file}.tmp`;
    const body: SettingsFile = { selection: accepted };
    await writeFile(temp, JSON.stringify(body));
    await rename(temp, file);
    this.settings.selection = accepted;
  }

  /** 解析请求会话的工作目录；查不到时回落插件配置 cwd。 */
  resolveCwd(sessionId: GenerateOptions["sessionId"]): string {
    if (sessionId === undefined) return this.config.cwd;
    const sessions = this.ctx.get("sessions");
    const cwd = sessions?.get(sessionId)?.header?.cwd;
    return cwd === undefined ? this.config.cwd : cwd;
  }
  /** 权限档回落：与 kmh-web 组合默认（workspace-write + ask）一致。 */
  private static readonly DEFAULT_PERMISSION: PermissionKnobs = {
    sandbox: "workspace-write",
    approval: "ask",
  };
  /**
   * 会话生效权限档（D17）：读 permissions 投影的 sandbox/approval 旋钮；
   * 无投影、无覆盖或读取失败时回落部署组合默认。进行中回合按其开始时
   * 的档位完成（每次 start 重新读取）。
   */
  resolvePermission(sessionId: GenerateOptions["sessionId"]): PermissionKnobs {
    const fallback = CodexCli.DEFAULT_PERMISSION;
    if (sessionId === undefined) return fallback;
    const sessions = this.ctx.get("sessions");
    const projections = this.ctx.get("sessionProjections");
    const session = sessions?.get(sessionId);
    if (projections === undefined || session === undefined) return fallback;
    try {
      const state = projections.stateOf(session, "permissions");
      if (state === undefined) return fallback;
      return {
        sandbox: state.sandbox ?? fallback.sandbox,
        approval: state.approval ?? fallback.approval,
      };
    } catch {
      return fallback;
    }
  }
  /** 模型目录缓存；每次调用复用在途请求。 */
  catalog(): Promise<CodexModelEntry[]> {
    this.catalogCache ??= (async () => {
      const signal = AbortSignal.timeout(this.config.probeTimeoutMs);
      const connection = await connectCodex(
        this.ctx,
        {
          command: this.config.command,
          cwd: this.config.cwd,
          configOverrides: [],
          env: this.config.env,
          graceMs: this.config.graceMs,
          startupTimeoutMs: this.config.startupTimeoutMs,
        },
        signal,
      );
      try {
        const entries = await fetchCatalog(connection, signal);
        const head = entries[0];
        if (head !== undefined) this.settings.defaultModel = head.id;
        return entries;
      } finally {
        await connection.stop(this.config.cleanupTimeoutMs);
      }
    })();
    return this.catalogCache;
  }
  /**
   * 读取会话的持久化绑定记录。
   * @param sessionKey - KMH 会话标识。
   * @returns 独立记录副本；尚未创建时为空，保存文件损坏时抛错。
   */
  async bindingRecord(sessionKey: string): Promise<BindingRecord | undefined> {
    return await this.store.get(sessionKey);
  }
  /**
   * 读取分叉的源会话绑定。
   * @param sessionId - KMH 会话标识。
   * @returns 父会话记录；普通会话或父记录缺失时为空。
   */
  async sourceBinding(
    sessionId: GenerateOptions["sessionId"],
  ): Promise<BindingRecord | undefined> {
    const parent =
      sessionId === undefined
        ? undefined
        : this.ctx.get("sessions")?.get(sessionId)?.header.parentSession;
    return parent === undefined ? undefined : this.store.get(parent);
  }
  /**
   * 保存创建时工具信息；保留已经接受的原生编号和消息处理位置。
   * @param sessionKey - KMH 会话标识。
   * @param toolPolicy - 创建时的完整工具选择与目录。
   */
  async saveToolPolicy(
    sessionKey: string,
    toolPolicy: SavedToolPolicy,
  ): Promise<void> {
    const previous = await this.store.get(sessionKey);
    await this.store.put(sessionKey, {
      ...previous,
      fingerprints: previous?.fingerprints ?? [],
      toolPolicy,
    });
  }
  /**
   * 持久化会话绑定并保留创建时的工具信息。
   * @param sessionKey - KMH 会话标识。
   * @param turn - 持有原生编号及消息处理位置的回合。
   * @param inheritedTurns - 原生分叉实际继承的完成回合；缺省保留原记录。
   */
  async recordBinding(
    sessionKey: string,
    turn: CodexTurn,
    inheritedTurns?: NonNullable<BindingRecord["turns"]>,
  ): Promise<void> {
    if (turn.threadId === undefined) return;
    const state = this.sessions.get(sessionKey);
    if (state !== undefined) state.threadId = turn.threadId;
    const previous = await this.store.get(sessionKey);
    const record = {
      ...previous,
      ...cursorToRecord(turn.threadId, turn.cursor, turn.lastCompletedTurnId),
    };
    const turns = inheritedTurns ?? previous?.turns ?? [];
    record.turns = [...turns];
    if (
      turn.lastCompletedTurnId !== undefined &&
      record.turns.at(-1)?.turnId !== turn.lastCompletedTurnId
    ) {
      record.turns.push({
        turnId: brandString<
          NonNullable<BindingRecord["turns"]>[number]["turnId"]
        >(turn.lastCompletedTurnId),
        fingerprints: [...turn.cursor.fingerprints],
        delivered: [...turn.pendingDigests],
      });
    }
    if (
      previous?.threadId !== undefined &&
      previous.threadId !== turn.threadId
    ) {
      record.previousThreadIds = [
        ...(previous.previousThreadIds ?? []),
        previous.threadId,
      ];
    }
    // 固定声明的名称对应关系随原绑定一起保存。
    const registry = turn.toolRegistry;
    if (registry !== undefined) {
      record.toolFingerprint = registry.fingerprint;
      record.toolMap = Object.fromEntries(registry.declaredToKmh);
      record.toolsVersion =
        previous !== undefined &&
        previous.toolFingerprint === registry.fingerprint
          ? (previous.toolsVersion ?? 1)
          : (previous?.toolsVersion ?? 0) + 1;
    }
    await this.store.put(sessionKey, record);
  }
  /** 恢复会话 turn 的差分游标（进程重启后续聊不重复投递）。 */
  private async restoreCursor(
    sessionKey: string,
    turn: CodexTurn,
  ): Promise<void> {
    const record = await this.store.get(sessionKey);
    if (record === undefined) return;
    turn.cursor = recordToCursor(record);
    turn.lastCompletedTurnId = record.lastTurnId;
    // 待核对队列种子：上一流尾已写入绑定，此处回读幂等；新块随流追加。
    turn.pendingDigests = [...turn.cursor.delivered];
    const state = this.sessions.get(sessionKey);
    if (state !== undefined) state.threadId = record.threadId;
  }
  /** 会话终止后释放其 turn 归属。 */
  releaseSession(turn: CodexTurn): void {
    for (const [key, state] of this.sessions)
      if (state.turn === turn) {
        this.sessions.delete(key);
        return;
      }
  }
  /** 记录会话的 CLI 连接实时状态（小球数据源）。 */
  private markLive(
    sessionKey: string,
    state: Omit<SessionLiveState, "updatedAt" | "retrying"> & {
      retrying?: boolean;
    },
  ): void {
    this.liveStates.set(sessionKey, {
      retrying: false,
      ...state,
      updatedAt: Date.now(),
    });
  }
  /**
   * 全部会话的实时状态快照（/api/codex-cli/live 返回体）。
   * 空闲但 turn 仍挂起工具回执属正常步间状态（KMH 执行完工具会续推），
   * 重试期间红色状态携带原因；停止或完成后 streaming 为 false。
   */
  liveSnapshot(): {
    sessions: Array<SessionLiveState & { sessionId: string }>;
  } {
    return {
      sessions: [...this.liveStates].map(([key, state]) => ({
        ...state,
        sessionId: key,
      })),
    };
  }
  /**
   * 会话内串行执行：同一会话的 turn 操作排队，共用同一 CodexTurn。
   * @param sessionKey - 会话标识。
   * @param cwd - 会话工作目录。
   * @param run - 本次要执行的流式驱动。
   * @param signal - 排队等待的取消与超时信号。
   */
  async *withSession(
    sessionKey: string,
    cwd: string,
    run: (turn: CodexTurn) => AsyncGenerator<StreamChunk>,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const state = this.stateOf(sessionKey, cwd);
    const previous = state.chain;
    let drained = false;
    let failure: unknown;
    let done: (() => void) | undefined;
    state.chain = new Promise<void>((resolve) => {
      done = resolve;
    });
    try {
      await waitForSession(previous, signal);
    } catch (error) {
      // 排队取消后，后继请求仍须等待当前拥有者交还执行权。
      previous.then(
        () => done?.(),
        () => done?.(),
      );
      throw error;
    }
    try {
      await this.restoreCursor(sessionKey, state.turn);
      this.markLive(sessionKey, {
        color: "green",
        streaming: true,
        detail: "CLI 通信中",
      });
      for await (const chunk of run(state.turn)) yield chunk;
      drained = true;
    } catch (error) {
      failure = error;
      // 停止/失败链路：先发 turn/interrupt 并有界等待终止通知，再回收。
      // interrupt 正常返回=CLI 确认停止；超时/失败=停止未确认。
      let confirmed = false;
      await state.turn
        .interrupt(AbortSignal.timeout(this.config.cancelReceiptTimeoutMs))
        .then(
          () => {
            confirmed = true;
          },
          () => undefined,
        );
      const reason =
        error instanceof Error && error.name === "TimeoutError"
          ? `CODEX_REQUEST_TIMEOUT: ${this.config.requestTimeoutMs}ms`
          : error instanceof Error
            ? error.message
            : String(error);
      const aborted = isCancelCause(error);
      this.markLive(sessionKey, {
        color: confirmed && aborted ? "gray" : "red",
        streaming: false,
        detail: aborted
          ? confirmed
            ? "已停止：CLI 确认中断，进程已回收"
            : `停止未确认：CLI 未确认中断（${reason.slice(0, 120)}）`
          : `回合异常中断：${reason.slice(0, 120)}`,
      });
      await state.turn.dispose().catch(() => undefined);
    } finally {
      try {
        // 消费方提前 return 时，中断仍在产出的 turn 后再交还会话执行权。
        if (!drained && failure === undefined) {
          let confirmed = false;
          await state.turn
            .interrupt(AbortSignal.timeout(this.config.cancelReceiptTimeoutMs))
            .then(
              () => {
                confirmed = true;
              },
              () => undefined,
            );
          await state.turn.dispose().catch(() => undefined);
          this.markLive(sessionKey, {
            color: confirmed ? "gray" : "red",
            streaming: false,
            detail: confirmed
              ? "输出消费已结束：CLI 确认停止"
              : "输出消费已结束：CLI 停止未确认",
          });
        }
      } finally {
        done?.();
      }
    }
    if (failure !== undefined) {
      if (failure instanceof Error) throw failure;
      throw new Error("CODEX_SESSION_FAILED", { cause: failure });
    }
    this.markLive(sessionKey, {
      color: state.turn.terminated ? "gray" : "green",
      streaming: false,
      detail: state.turn.terminated
        ? "已停止：回合已终止，进程已回收"
        : "已连接：CLI 进程在线，随时续聊",
    });
  }
  /** 取或建会话状态；已终止的 turn 重建以复用绑定。 */
  private stateOf(sessionKey: string, cwd: string): SessionState {
    let state = this.sessions.get(sessionKey);
    if (state === undefined || state.turn.terminated) {
      const threadId = state?.threadId;
      // 替换已终止的 turn 时同步回收其连接与进程：不 dispose 会让它带着
      // 未回执的工具请求滞留（线上实测泄漏进程干等数分钟后被 Codex 侧
      // 超时中断）。dispose 幂等，正常路径已回收时无副作用。
      if (state !== undefined) void state.turn.dispose().catch(() => undefined);
      state = {
        turn: new CodexTurn(
          this.ctx,
          this.config,
          cwd,
          [],
          (retrying, detail) => {
            this.markLive(sessionKey, {
              color: retrying ? "red" : "green",
              streaming: true,
              retrying,
              detail,
            });
          },
        ),
        threadId,
        chain: Promise.resolve(),
      };
      this.sessions.set(sessionKey, state);
    }
    return state;
  }
  /**
   * 辅助请求（标题生成、压缩评估）：独立临时会话，完成后回收。
   * 业务 thread 绑定与历史不受影响。
   */
  async *streamAuxiliary(
    options: GenerateOptions,
  ): AsyncGenerator<StreamChunk> {
    const signal = options.signal ?? new AbortController().signal;
    const plan = await prepareIsolation(this.ctx, this.config, {
      cwd: this.config.cwd,
      signal,
      selection: this.settings.selection,
    });
    const connection = await connectCodex(
      this.ctx,
      {
        command: this.config.command,
        cwd: this.config.cwd,
        configOverrides: plan.configOverrides,
        env: this.config.env,
        graceMs: this.config.graceMs,
        startupTimeoutMs: this.config.startupTimeoutMs,
      },
      signal,
    );
    const turn = new CodexTurn(this.ctx, this.config, this.config.cwd);
    turn.adopt(connection);
    try {
      await verifyIsolation(connection, plan, signal);
      const ephemeral: unknown = await connection.request(
        "thread/start",
        {
          model: options.model,
          ephemeral: true,
          cwd: this.config.cwd,
          baseInstructions: options.system,
          dynamicTools: [],
        },
        signal,
      );
      const threadId = ThreadResult.parse(ephemeral).thread.id;
      const texts: string[] = [];
      for (const message of options.messages)
        if (message.role === "user")
          for (const block of message.content ?? [])
            if (block.type === "text") texts.push(block.text);
      const turnResult: unknown = await connection.request(
        "turn/start",
        TurnStartParams.parse({
          threadId,
          input: [{ type: "text", text: texts.join("\n") || "ping" }],
          model: options.model,
          effort: options.reasoningEffort,
          summary: this.config.reasoningSummary,
        }),
        signal,
      );
      turn.setIds(threadId, TurnResult.parse(turnResult).turn.id);
      yield* turn.pump(signal);
    } finally {
      await turn.dispose();
    }
  }
}

/** 等待会话执行权；取消只结束排队者的等待。 */
async function waitForSession(
  previous: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (signal === undefined) return await previous;
  signal.throwIfAborted();
  let listener: ReturnType<typeof addAbortListener> | undefined;
  try {
    await Promise.race([
      previous,
      new Promise<never>((_resolve, reject) => {
        listener = addAbortListener(signal, () => {
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- DSH 以 AgentCancelCause 对象传递停止原因。
          reject(signal.reason);
        });
      }),
    ]);
    signal.throwIfAborted();
  } finally {
    listener?.[Symbol.dispose]();
  }
}

/**
 * 是否宿主主动取消（DSH AgentCancelCause 为普通对象经 signal.reason 抛出，
 * 形态见 dsh-session types；AbortError 也算）。用户/宿主停止且 CLI 确认中
 * 断属正常停止（灰球），其余失败按异常（红球）。
 */
function isCancelCause(error: unknown): boolean {
  if (error instanceof Error) return error.name === "AbortError";
  if (error === null || typeof error !== "object") return false;
  const kind = (error as { kind?: unknown }).kind;
  return (
    kind === "user" ||
    kind === "parent" ||
    kind === "hook" ||
    kind === "disposed"
  );
}

/** 空游标导出（临时会话与测试用）。 */
export { emptySnapshot };

/**
 * Register the provider runtime and adapter routes.
 * @param ctx - Plugin owner of the runtime and process ranges.
 * @param config - Validated execution and storage settings.
 */
export function apply(ctx: Context, config: Config): void {
  const runtime = new CodexCli(ctx, config);
  ctx.codexCli = runtime;
  runtime.toolPolicy = new CodexToolPolicy(ctx, runtime);
  ctx.llm.registerAdapter(["codex-cli"], new CodexAdapter(runtime));
  ctx.inject(["connection"], (web) => mountWeb(web, runtime));
}
