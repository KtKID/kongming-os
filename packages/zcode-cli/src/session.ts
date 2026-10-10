/** session 中继：KMH 会话与 CLI session 的绑定、增量发送与事件流驱动。 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "@deepseek-ai/cordis";
import type { SubprocessHandle } from "@deepseek-ai/dsh-subprocess";
import type { JsonRpcLineTransport } from "@deepseek-ai/dsh-sdk-protocol";
import type { GenerateOptions, StreamChunk } from "@deepseek-ai/dsh-llm";
import type { Config } from "./config.ts";
import type { ModelEntry } from "./models.ts";
import type { RequestSupervisor, RequestRecord } from "./supervisor.ts";
import type { TerminationCause } from "./status.ts";
import { TurnEventProjector } from "./events.ts";
import { ZcodeInteractionBridge } from "./interaction.ts";

/** 单个 KMH 会话的绑定记录。 */
interface BindingRecord {
  /** CLI session id。 */
  cliSessionId: string;
  /** 创建时的会话工作区（resume 需原样回传）。 */
  workspacePath: string;
  workspaceKey: string;
}
type BindingFile = Record<string, BindingRecord>;

/**
 * 绑定存储：进程内缓存 + JSON 原子落盘；缺失或损坏视为空并重置。
 */
class SessionBindingStore {
  private cache: BindingFile | undefined;
  private loading: Promise<BindingFile> | undefined;
  constructor(private readonly dataDir: string) {}
  private get file(): string {
    return join(this.dataDir, "session-bindings.json");
  }
  private async load(): Promise<BindingFile> {
    this.cache ??= await (this.loading ??= this.read());
    return this.cache;
  }
  private async read(): Promise<BindingFile> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.file, "utf8"));
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        Array.isArray(parsed)
      )
        return {};
      const result: BindingFile = {};
      for (const [key, value] of Object.entries(parsed)) {
        const cliSessionId = fieldOf(value, "cliSessionId");
        const workspacePath = fieldOf(value, "workspacePath");
        const workspaceKey = fieldOf(value, "workspaceKey");
        if (
          typeof cliSessionId === "string" &&
          typeof workspacePath === "string" &&
          typeof workspaceKey === "string"
        )
          result[key] = { cliSessionId, workspacePath, workspaceKey };
      }
      return result;
    } catch {
      return {};
    }
  }
  async get(sessionKey: string): Promise<BindingRecord | undefined> {
    return (await this.load())[sessionKey];
  }
  async put(sessionKey: string, record: BindingRecord): Promise<void> {
    const all = await this.load();
    all[sessionKey] = record;
    await this.flush(all);
  }
  async delete(sessionKey: string): Promise<void> {
    const all = await this.load();
    if (sessionKey in all) {
      delete all[sessionKey];
      await this.flush(all);
    }
  }
  private async flush(all: BindingFile): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const temporary = join(this.dataDir, `.bindings-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(all), {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temporary, this.file);
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

type SessionListener = (payload: unknown) => void;
/** 长驻连接：一条注册完成的 app-server 进程与按会话分发的事件流。 */
class RelayConnection {
  private readonly listeners = new Set<SessionListener>();
  private dead = false;
  /** 本连接是否已完成事件订阅。 */
  subscribed = false;
  /** 到达的 session/event 通知总数（诊断：宿主是否收到推送）。 */
  eventCount = 0;
  /** 最近一次事件到达时刻；未到达过为 undefined。 */
  lastEventAt: number | undefined;
  /** 进行中的回合计数：大于零的连接免于空闲回收。 */
  activeTurns = 0;
  /** 最近一次回合活动时刻（空闲回收依据）。 */
  lastUsedAt = Date.now();
  /** 标记一次活动（发送、事件或回合结束都算），重置空闲计时。 */
  touch(): void {
    this.lastUsedAt = Date.now();
  }
  readonly done: Promise<void>;
  constructor(
    readonly rpc: JsonRpcLineTransport,
    private readonly child: SubprocessHandle,
  ) {
    // 每连接只服务一个 CLI 会话：session/event 信封不携带会话身份
    // （model.streaming 载荷也没有），按会话分进程是官方桌面的既有形态。
    rpc.onNotification((method, params) => {
      if (method === "session/event") this.eventCount += 1;
      if (method !== "session/event" || typeof params !== "object") return;
      // 真实信封：判别字段 type 在信封层，payload 只携带 kind/delta 等本体；
      // 合并后交付（0.16.9 实测形态）。
      const envelope = params as { type?: unknown; payload?: unknown };
      if (typeof envelope.type !== "string") return;
      this.lastUsedAt = Date.now();
      const payload = envelope.payload;
      const merged: unknown =
        typeof payload === "object" && payload !== null
          ? { ...payload, type: envelope.type }
          : { type: envelope.type };
      this.lastEventAt = Date.now();
      for (const listener of this.listeners) listener(merged);
    });
    this.done = child.done.then(
      () => this.markDead(),
      () => this.markDead(),
    );
  }
  private markDead(): void {
    this.dead = true;
  }
  get exited(): boolean {
    return this.dead;
  }
  /** 注册本连接的事件监听；返回注销函数。 */
  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** 关闭输入并等待进程退出；超时强制回收。 */
  async stop(cleanupTimeoutMs: number): Promise<void> {
    if (this.dead) return;
    this.child.stdin?.end();
    this.rpc.close();
    const confirmed = await this.child.waitForExit(
      AbortSignal.timeout(cleanupTimeoutMs),
    );
    if (!confirmed) this.child.terminate();
    await this.child.done.catch(() => undefined);
  }
}

/** 由宿主 runtime 提供的进程启动器（完成路径解析、账号读取与 provider 注册）。 */
export interface RelayLaunchDeps {
  /** 拉起并注册一条长驻 app-server 连接。 */
  launch(signal: AbortSignal): Promise<{
    rpc: JsonRpcLineTransport;
    child: SubprocessHandle;
  }>;
}
/** 中继依赖：配置、监督、目录与工作区解析。 */
export interface SessionRelayOptions {
  ctx: Context;
  config: Config;
  supervision: RequestSupervisor;
  /** 目录解析（登录后可用）。 */
  catalog: (signal: AbortSignal) => Promise<readonly ModelEntry[]>;
  /** 已解析目录的同步快照（反向凭据头校验用；未解析时为空表）。 */
  catalogSnapshot: () => readonly ModelEntry[];
  /** 请求会话的工作目录解析；失败回落启动目录。 */
  requestCwd: (
    sessionId: GenerateOptions["sessionId"],
    signal: AbortSignal,
  ) => Promise<string | undefined>;
  /** 账号凭据读取（反向凭据头应答用）。 */
  apiKey: () => Promise<string>;
  launch: RelayLaunchDeps["launch"];
}
/** 历史文本提取结果：导入用前缀与本次新输入。 */
export function splitHistory(
  messages: readonly GenerateOptions["messages"][number][],
): {
  imported: { role: "user" | "assistant"; content: string }[];
  input: string;
} {
  const flatten = (message: (typeof messages)[number]): string =>
    message.content
      .filter(
        (block): block is { type: "text"; text: string } =>
          block.type === "text",
      )
      .map((block) => block.text)
      .join("\n");
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message !== undefined && message.role === "user") {
      lastUserIndex = i;
      break;
    }
  }
  const imported: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of messages.slice(0, lastUserIndex)) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = flatten(message);
    if (content !== "") imported.push({ role: message.role, content });
  }
  const lastUser =
    lastUserIndex >= 0 ? messages.slice(lastUserIndex)[0] : undefined;
  const input = lastUser === undefined ? "" : flatten(lastUser);
  return { imported, input };
}

/**
 * session 中继器：管理长驻连接、KMH↔CLI 会话绑定与单回合事件驱动。
 * 一个回合 = 一次 session/send；reasoning/text 增量实时投影，CLI 工具活动
 * 留在 CLI 内执行（审批经 interaction 桥回 KMH 公开服务）。
 */
export class ZcodeSessionRelay {
  /** 每个 KMH 会话一条专属连接（官方桌面同形态：会话 worker 进程）。 */
  private readonly connections = new Map<string, RelayConnection>();
  private readonly launching = new Map<string, Promise<RelayConnection>>();
  /** 会话建立单飞：标题生成等并发首调不允许双建 CLI 会话。 */
  private readonly ensuring = new Map<string, Promise<unknown>>();
  /** 同会话回合串行链：CLI 每会话同时只受理一个 prompt，排队消解并发。 */
  private readonly turnChains = new Map<string, Promise<void>>();
  private readonly store: SessionBindingStore;
  private readonly reverse = new Map<string, string>();
  private readonly reaper: ReturnType<typeof setInterval>;
  constructor(private readonly options: SessionRelayOptions) {
    this.store = new SessionBindingStore(options.config.dataDir);
    // 空闲回收：CLI 进程内存占用高，闲置会话的连接定期回收（下次回合 resume 续用）。
    // 扫描间隔随闲置时限收敛（idle/2，夹在 1s 与 60s 之间），小闲置配置可被测试观测。
    this.reaper = setInterval(
      () => this.sweepIdle(),
      Math.min(
        60_000,
        Math.max(1_000, Math.ceil(idleMsOf(options.config) / 2)),
      ),
    );
    this.reaper.unref?.();
  }
  /** CLI 会话 → KMH 会话反查（审批桥定位 Agent 用）。 */
  kmhSessionOf(cliSessionId: string): string | undefined {
    return this.reverse.get(cliSessionId);
  }
  /** 回收超过空闲时限且无在途回合的连接。 */
  private sweepIdle(): void {
    const idleMs = this.options.config.sessionIdleMs;
    const now = Date.now();
    for (const [key, connection] of this.connections) {
      if (connection.exited) {
        this.connections.delete(key);
        continue;
      }
      // 在途回合免回收：闲置判定只适用于静默连接；回合悬挂由请求总超时兜底。
      if (connection.activeTurns > 0) continue;
      if (now - connection.lastUsedAt >= idleMs) {
        this.connections.delete(key);
        this.options.ctx.logger.info(
          `zcode-cli idle connection swept (key=${key.slice(0, 18)}…, events=${String(connection.eventCount)}, lastEventAt=${String(connection.lastEventAt ?? "never")})`,
        );
        connection
          .stop(this.options.config.cleanupTimeoutMs)
          .catch(() => undefined);
      }
    }
  }
  private async ensureConnection(
    sessionKey: string,
    signal: AbortSignal,
  ): Promise<RelayConnection> {
    const alive = this.connections.get(sessionKey);
    if (alive !== undefined && !alive.exited) return alive;
    const pending = this.launching.get(sessionKey);
    if (pending !== undefined) return pending;
    const launch = this.connect(signal)
      .finally(() => this.launching.delete(sessionKey))
      .then((connection) => {
        this.connections.set(sessionKey, connection);
        return connection;
      });
    this.launching.set(sessionKey, launch);
    return launch;
  }
  private async connect(signal: AbortSignal): Promise<RelayConnection> {
    const { rpc, child } = await this.options.launch(signal);
    const connection = new RelayConnection(rpc, child);
    this.options.ctx.logger.info(
      "zcode-cli session connection launched and provider registered",
    );
    const bridge = new ZcodeInteractionBridge(this.options.ctx, {
      kmhSessionOf: (id) => this.kmhSessionOf(id),
      apiKey: () => this.options.apiKey(),
      catalog: () => this.options.catalogSnapshot(),
      providerId: this.options.config.providerId,
    });
    rpc.onRequest((method, params) => bridge.handle(method, params));
    return connection;
  }
  /** 取得或重建指定 KMH 会话的 CLI session；返回会话 id。 */
  private async ensureSession(
    connection: RelayConnection,
    sessionKey: string,
    options: GenerateOptions,
    signal: AbortSignal,
  ): Promise<string> {
    // 并发首调（如新会话的标题生成与主回复同时到达）共享同一次建立，
    // 防止双查绑定双建会话导致两个回合互相串台。
    const inFlight = this.ensuring.get(sessionKey);
    if (inFlight !== undefined) {
      await inFlight;
      return this.ensureSession(connection, sessionKey, options, signal);
    }
    const attempt = this.establishSession(
      connection,
      sessionKey,
      options,
      signal,
    );
    this.ensuring.set(sessionKey, attempt);
    try {
      return await attempt;
    } finally {
      this.ensuring.delete(sessionKey);
    }
  }
  private async establishSession(
    connection: RelayConnection,
    sessionKey: string,
    options: GenerateOptions,
    signal: AbortSignal,
  ): Promise<string> {
    const workspacePath =
      (await this.options.requestCwd(options.sessionId, signal)) ??
      this.options.config.cwd;
    const bound = await this.store.get(sessionKey);
    if (bound !== undefined) {
      try {
        const raw: unknown = await connection.rpc.request(
          "session/resume",
          {
            sessionId: bound.cliSessionId,
            workspace: {
              workspacePath: bound.workspacePath,
              workspaceKey: bound.workspaceKey,
            },
          },
          signal,
        );
        const sessionId = sessionIdOf(raw);
        if (sessionId === bound.cliSessionId) {
          this.reverse.set(bound.cliSessionId, sessionKey);
          await this.subscribeOnce(connection, bound.cliSessionId, signal);
          return bound.cliSessionId;
        }
      } catch (error) {
        if (signal.aborted) throw error;
        // 会话已不可恢复（数据目录清理等）：废弃绑定并重建。
        await this.store.delete(sessionKey);
        this.reverse.delete(bound.cliSessionId);
      }
    }
    const { imported } = splitHistory(options.messages);
    const raw: unknown = await connection.rpc.request(
      "session/create",
      {
        workspace: { workspacePath, workspaceKey: workspacePath },
        persistence: "immediate",
        ...(imported.length > 0
          ? {
              importedHistory: {
                source: "claudeCode",
                messages: imported.map((message, index) => ({
                  ...message,
                  timestamp: Date.now() - (imported.length - index) * 1000,
                })),
              },
            }
          : {}),
      },
      signal,
    );
    const sessionId = sessionIdOf(raw);
    if (sessionId === undefined) throw new Error("ZCODE_SESSION_CREATE_FAILED");
    await this.store.put(sessionKey, {
      cliSessionId: sessionId,
      workspacePath,
      workspaceKey: workspacePath,
    });
    this.reverse.set(sessionId, sessionKey);
    await this.subscribeOnce(connection, sessionId, signal);
    return sessionId;
  }
  /** 连接建立后订阅本会话事件流（新连接都需要，含 resume 后重订）。 */
  private async subscribeOnce(
    connection: RelayConnection,
    sessionId: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (connection.subscribed) return;
    await connection.rpc.request(
      "session/subscribe",
      { sessionId, deliveryKind: "desktop-continuous", afterSeq: 0 },
      signal,
    );
    connection.subscribed = true;
  }
  /** 停止在途回合：官方 session/stop，回执计入监督记录。 */
  private async stopTurn(
    connection: RelayConnection,
    sessionId: string,
    record: RequestRecord,
  ): Promise<void> {
    record.noteStop();
    try {
      const receipt = await Promise.race([
        connection.rpc.request("session/stop", { sessionId }, undefined).then(
          () => true,
          () => false,
        ),
        new Promise<boolean>((resolve) =>
          setTimeout(
            () => resolve(false),
            this.options.config.cancelReceiptTimeoutMs,
          ),
        ),
      ]);
      record.noteReceipt(receipt);
      this.options.ctx.logger.info(
        `zcode-cli session/stop receipt=${String(receipt)}`,
      );
    } catch {
      record.noteReceipt(false);
    } finally {
      // 回执即回合停止确认；两段式状态行据 exitConfirmed 解除「正在停止」。
      const confirmed = record.stop?.receipt === true;
      record.noteExitConfirmed(confirmed);
      record.cleanup(confirmed, confirmed ? undefined : "stop receipt missing");
    }
  }
  /**
   * 驱动一个中继回合：增量发送 + 事件投影为流式块。
   * 生命周期与 generate() 相同：总预算计时、用户停止经官方停止通道、
   * 首个终止原因不被覆盖。
   */
  async *turn(
    options: GenerateOptions,
    entry: ModelEntry,
    record: RequestRecord,
    lifetime: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const sessionKey =
      options.sessionId === undefined
        ? "kmh-zcode-anonymous"
        : String(options.sessionId);
    const merged = new AbortController();
    const disarm: (() => void)[] = [];
    const budget = setTimeout(() => {
      record.terminate(
        "total-timeout",
        `${this.options.config.requestTimeoutMs}ms`,
      );
      merged.abort(new Error("ZCODE_REQUEST_TIMEOUT"));
    }, this.options.config.requestTimeoutMs);
    const arm = (
      source: AbortSignal | undefined,
      cause: TerminationCause,
    ): void => {
      if (source === undefined) return;
      const trip = () => {
        record.terminate(cause);
        merged.abort(
          new Error(
            cause === "user-stop"
              ? "ZCODE_REQUEST_CANCELLED"
              : "ZCODE_HOST_UNLOAD",
          ),
        );
      };
      if (source.aborted) {
        trip();
        return;
      }
      source.addEventListener("abort", trip, { once: true });
      disarm.push(() => source.removeEventListener("abort", trip));
    };
    arm(options.signal, "user-stop");
    arm(lifetime, "host-unload");
    const signal = merged.signal;
    // 同会话回合串行：CLI 每会话同时只受理一个 prompt（并发 send 会被拒）；
    // 标题生成等并发调用排队执行，等待期间总预算照常消耗。
    const previous = this.turnChains.get(sessionKey) ?? Promise.resolve();
    let releaseChain: () => void = () => undefined;
    const chained = new Promise<void>((resolve) => {
      releaseChain = resolve;
    });
    this.turnChains.set(sessionKey, chained);
    await previous.catch(() => undefined);
    const projector = new TurnEventProjector();
    const queue: StreamChunk[] = [];
    let wake: () => void = () => undefined;
    let queueSignal = new Promise<void>(() => undefined);
    let firstChunkAt: number | undefined;
    let chunkCount = 0;
    const notify = (): void => {
      wake();
    };
    let connection: RelayConnection | undefined;
    let cliSessionId: string | undefined;
    let unsubscribe: (() => void) | undefined;
    try {
      connection = await this.ensureConnection(sessionKey, signal);
      connection.activeTurns += 1;
      connection.touch();
      cliSessionId = await this.ensureSession(
        connection,
        sessionKey,
        options,
        signal,
      );
      const { input } = splitHistory(options.messages);
      if (input === "") throw new Error("ZCODE_SESSION_INPUT_MISSING");
      unsubscribe = connection.subscribe((payload) => {
        for (const chunk of projector.push(payload)) queue.push(chunk);
        notify();
      });
      connection.done
        .then(() => {
          for (const chunk of projector.fail(
            "CLI process exited",
            "ZCODE_CHANNEL_EXIT",
          ))
            queue.push(chunk);
          notify();
        })
        .catch(() => undefined);
      record.note({ stage: "waiting" });
      const inputId = randomUUID();
      this.options.ctx.logger.info(
        `zcode-cli session send (cliSession=${cliSessionId.slice(0, 18)}…, model=${entry.nativeId}, effort=${options.reasoningEffort ?? this.options.config.reasoningLevel})`,
      );
      connection.touch();
      try {
        await connection.rpc.request(
          "session/send",
          {
            sessionId: cliSessionId,
            inputId,
            content: input,
            modelSelection: {
              providerId: this.options.config.providerId,
              modelId: entry.nativeId,
              options: {
                reasoningLevel:
                  options.reasoningEffort ?? this.options.config.reasoningLevel,
              },
            },
          },
          signal,
        );
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("prompt is already running")
        )
          throw new Error("ZCODE_SESSION_BUSY");
        throw error;
      }
      // 事件泵：终态落定且队列排空后结束；停止/超时/进程退出注入终态。
      const stopLatch = new Promise<void>((resolve) => {
        const observe = (): void => {
          if (!signal.aborted) return;
          resolve();
          const settle =
            record.termination?.cause === "total-timeout"
              ? projector.fail("request timeout", "ZCODE_REQUEST_TIMEOUT")
              : projector.abort("user stop");
          for (const chunk of settle) queue.push(chunk);
          wake();
        };
        if (signal.aborted) observe();
        else signal.addEventListener("abort", observe, { once: true });
      });
      while (true) {
        // 先绑唤醒信号再排水：排水与 yield 期间到达的事件可立即唤醒下一轮。
        queueSignal = new Promise<void>((resolve) => {
          wake = resolve;
        });
        while (queue.length > 0) {
          const chunk = queue.shift();
          if (chunk === undefined) break;
          if (firstChunkAt === undefined) {
            firstChunkAt = Date.now();
            this.options.ctx.logger.info(
              `zcode-cli first stream chunk (kind=${chunk.type}, events=${String(connection.eventCount)})`,
            );
          }
          chunkCount += 1;
          yield chunk;
        }
        if (projector.finished) break;
        await Promise.race([
          queueSignal,
          stopLatch,
          new Promise<void>((resolve) => setTimeout(resolve, 250)),
        ]);
      }
      this.options.ctx.logger.info(
        `zcode-cli turn settled (chunks=${String(chunkCount)}, events=${String(connection.eventCount)})`,
      );
      if (record.termination === undefined) {
        const code = projector.outcomeCode;
        // 通道类失败终止整条请求；提供方回合失败记一次尝试失败；其余按成功。
        if (code === "ZCODE_CHANNEL_EXIT" || code === "ZCODE_SESSION_CLOSED")
          record.terminate("channel-exit", code);
        else if (code !== undefined) record.failAttempt("provider-error", code);
        else record.succeed();
      }
    } finally {
      releaseChain();
      if (this.turnChains.get(sessionKey) === chained)
        this.turnChains.delete(sessionKey);
      unsubscribe?.();
      clearTimeout(budget);
      for (const off of disarm) off();
      // 停止链路先等官方停止回执（有界），回执即落回收账，解除「正在停止」。
      if (
        record.termination?.cause === "user-stop" &&
        connection !== undefined &&
        cliSessionId !== undefined
      )
        await this.stopTurn(connection, cliSessionId, record);
      if (connection !== undefined) {
        connection.activeTurns -= 1;
        connection.touch();
      }
    }
  }
  /** 回合外的宿主卸载：停全部会话连接并等待回收。 */
  async dispose(): Promise<void> {
    clearInterval(this.reaper);
    const stopping = [...this.connections.values()].map((connection) =>
      connection.stop(this.options.config.cleanupTimeoutMs),
    );
    this.connections.clear();
    await Promise.allSettled(stopping);
  }
}
/** 读取未知对象键值（无断言窄化）。 */
function fieldOf(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  for (const [name, item] of Object.entries(value))
    if (name === key) return item;
  return undefined;
}
/** 读取闲置回收时限（sweeper 间隔计算用）。 */
function idleMsOf(config: Config): number {
  return config.sessionIdleMs;
}
/** 从 create/resume 应答中提取会话 id（快照形状随版本漂移，防御提取）。 */
function sessionIdOf(raw: unknown): string | undefined {
  const top = fieldOf(raw, "session");
  const inner = fieldOf(raw, "value");
  const innerSession = fieldOf(inner, "session");
  for (const source of [raw, top, inner, innerSession]) {
    const id = fieldOf(source, "sessionId");
    if (typeof id === "string") return id;
  }
  return undefined;
}
