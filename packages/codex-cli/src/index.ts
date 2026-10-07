/** Independently distributable KMH provider for the official Codex CLI app-server. */
import { Service, type Context } from "@deepseek-ai/cordis";
import { CodexAccount } from "./account.ts";
import { mountWeb } from "./web.ts";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { Config } from "./config.ts";
import { CodexAdapter } from "./adapter.ts";
import { connectCodex } from "./connection.ts";
import { emptySnapshot } from "./cursor.ts";
import { fetchCatalog, type CodexModelEntry } from "./models.ts";
import {
  CodexSessionStore,
  cursorToRecord,
  recordToCursor,
  type BindingRecord,
} from "./session-store.ts";
import { prepareIsolation, verifyIsolation } from "./isolation.ts";
import { CodexTurn } from "./turn.ts";
import { ThreadResult, TurnResult } from "./protocol.ts";
export { Config } from "./config.ts";
export { connectCodex, CodexConnection } from "./connection.ts";
export { CodexAdapter } from "./adapter.ts";
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
/** 详情页可变设置：开关与最近测试结果。 */
export interface RuntimeSettings {
  nativeToolsEnabled: boolean;
  defaultModel?: string;
  lastProbe?: { at: string; ok: boolean; error?: string };
}

export class CodexCli extends Service {
  private catalogCache: Promise<CodexModelEntry[]> | undefined;
  private readonly sessions = new Map<string, SessionState>();
  private readonly store: CodexSessionStore;
  /** 账号操作（状态/登录/取消/退出）。 */
  readonly account: CodexAccount;
  /** 详情页可变设置；开关下一回合生效。 */
  readonly settings: RuntimeSettings;

  constructor(
    ctx: Context,
    readonly config: Config,
  ) {
    super(ctx, "codexCli");
    this.store = new CodexSessionStore(config.dataDir);
    this.account = new CodexAccount(ctx, config);
    this.settings = { nativeToolsEnabled: config.nativeToolsEnabled };
    ctx.effect(
      () => () => {
        for (const state of this.sessions.values())
          state.turn.dispose().catch(() => undefined);
        this.sessions.clear();
      },
      "codex-cli: sessions",
    );
  }

  /** 解析请求会话的工作目录；查不到时回落插件配置 cwd。 */
  resolveCwd(sessionId: GenerateOptions["sessionId"]): string {
    if (sessionId === undefined) return this.config.cwd;
    const sessions = this.ctx.get("sessions");
    const cwd = sessions?.get(sessionId)?.header?.cwd;
    return cwd === undefined ? this.config.cwd : cwd;
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
  /** 读取会话的 thread 绑定。 */
  /** 读取会话的持久化绑定记录。 */
  async bindingRecord(sessionKey: string): Promise<BindingRecord | undefined> {
    return await this.store.get(sessionKey);
  }
  /** 持久化会话绑定：thread、差分游标与 fork 边界一并落盘。 */
  async recordBinding(sessionKey: string, turn: CodexTurn): Promise<void> {
    if (turn.threadId === undefined) return;
    const state = this.sessions.get(sessionKey);
    if (state !== undefined) state.threadId = turn.threadId;
    await this.store.put(
      sessionKey,
      cursorToRecord(turn.threadId, turn.cursor, turn.lastCompletedTurnId),
    );
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
  /**
   * 会话内串行执行：同一会话的 turn 操作排队，共用同一 CodexTurn。
   * @param sessionKey - 会话标识。
   * @param run - 本次要执行的流式驱动。
   */
  async *withSession(
    sessionKey: string,
    cwd: string,
    run: (turn: CodexTurn) => AsyncGenerator<StreamChunk>,
  ): AsyncGenerator<StreamChunk> {
    const state = this.stateOf(sessionKey, cwd);
    await this.restoreCursor(sessionKey, state.turn);
    const previous = state.chain;
    const tokens: StreamChunk[] = [];
    let failure: unknown;
    let done: (() => void) | undefined;
    state.chain = new Promise<void>((resolve) => {
      done = resolve;
    });
    await previous;
    try {
      for await (const chunk of run(state.turn)) tokens.push(chunk);
    } catch (error) {
      failure = error;
      // 停止/失败链路：先发 turn/interrupt 并有界等待终止通知，再回收。
      await state.turn
        .interrupt(AbortSignal.timeout(this.config.cancelReceiptTimeoutMs))
        .catch(() => undefined);
      state.turn.dispose().catch(() => undefined);
    } finally {
      done?.();
    }
    if (failure !== undefined) {
      if (failure instanceof Error) throw failure;
      throw new Error("CODEX_SESSION_FAILED", { cause: failure });
    }
    yield* tokens;
  }
  /** 取或建会话状态；已终止的 turn 重建以复用绑定。 */
  private stateOf(sessionKey: string, cwd: string): SessionState {
    let state = this.sessions.get(sessionKey);
    if (state === undefined || state.turn.terminated) {
      const threadId = state?.threadId;
      state = {
        turn: new CodexTurn(this.ctx, this.config, cwd),
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
      nativeToolsEnabled: this.settings.nativeToolsEnabled,
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
    try {
      await verifyIsolation(connection, plan, signal);
      turn.adopt(connection);
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
        {
          threadId,
          input: [{ type: "text", text: texts.join("\n") || "ping" }],
        },
        signal,
      );
      turn.setIds(threadId, TurnResult.parse(turnResult).turn.id);
      yield* turn.pump(signal);
    } finally {
      await turn.dispose();
    }
  }
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
  ctx.llm.registerAdapter(["codex-cli"], new CodexAdapter(runtime));
  ctx.inject(["connection"], (web) => mountWeb(web, runtime));
}
