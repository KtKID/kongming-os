/** Official CLI process ownership, raw model dispatch and cancellable native login. */
import { Service, type Context } from "@deepseek-ai/cordis";
import { SubprocessExecutableNotFoundError } from "@deepseek-ai/dsh-subprocess";
import {
  JsonRpcLineTransport,
  JsonRpcResponseError,
} from "@deepseek-ai/dsh-sdk-protocol";
import type { SubprocessHandle } from "@deepseek-ai/dsh-subprocess";
import { Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import { readFile, mkdir, realpath, stat } from "node:fs/promises";
import { dirname, join, isAbsolute, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import type { Config } from "./config.ts";
import { readAccount, saveAccount } from "./account.ts";
import { loginBigModel } from "./bigmodel-login.ts";
import { preparePersonalConfig } from "./personal-config.ts";
import { extractAuthorizeUrl } from "./authorize-url.ts";
import { projectRequest, GenerationResult } from "./protocol.ts";
import {
  builtinTemplateModels,
  fetchAccountModels,
  resolveCatalog,
  type ModelEntry,
} from "./models.ts";
import { ReasoningEffortId, type GenerateOptions } from "@deepseek-ai/dsh-llm";

import { RequestSupervisor, type RequestRecord } from "./supervisor.ts";
import type {
  PublicStatus,
  RequestStatus,
  TerminationCause,
} from "./status.ts";
export { PublicStatus } from "./status.ts";
declare module "@deepseek-ai/cordis" {
  interface Context {
    zcodeCli: ZcodeCli;
  }
}
const incomingAuth = z.object({
  providerId: z.string(),
  modelSelection: z.object({ providerId: z.string(), modelId: z.string() }),
});
const outgoingFrame = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]).optional(),
  method: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
});
const builtin = z.object({ revision: z.union([z.string(), z.number()]) });
const loginResult = z.object({ status: z.literal("ready") });
const nativeErrorData = z.object({
  code: z
    .union([z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), z.number()])
    .optional(),
  providerCode: z
    .union([z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), z.number()])
    .optional(),
  providerMessage: z.string().optional(),
});
interface Paths {
  executable: string;
  builtin: string;
  env: NodeJS.ProcessEnv;
}
/** 启动阶段失败码：统一归入 startup-timeout，具体码进 detail。 */
const startupCodes = new Set([
  "ZCODE_CLI_MISSING",
  "ZCODE_CONFIG_PATH_INVALID",
  "ZCODE_STDIO_MISSING",
  "ZCODE_LOGIN_REQUIRED",
  "ZCODE_PROBE_TIMEOUT",
]);
/** 逻辑请求指纹：模型、系统提示、消息与工具声明的哈希，重试续接共用。 */
function requestFingerprint(options: GenerateOptions): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        model: options.model ?? null,
        system: options.system ?? null,
        messages: options.messages,
        tools: options.tools ?? [],
      }),
    )
    .digest("hex");
}
/** 归类通道层未覆盖的 generate 阶段失败；已有终止或尝试失败时不重复记录。 */
function classifyFailure(record: RequestRecord, error: unknown): void {
  if (record.termination !== undefined || record.outcome !== "running") return;
  const message = error instanceof Error ? error.message : undefined;
  if (message !== undefined && startupCodes.has(message))
    record.terminate("startup-timeout", message);
  else record.failAttempt("provider-error", message);
}
interface Attempt {
  id: string;
  controller: AbortController;
  done: Promise<void>;
}

/** Own all CLI ranges and prevent stale login attempts from publishing results. */
export class ZcodeCli extends Service {
  private readonly processes = new Set<SubprocessHandle>();
  private readonly lifetime = new AbortController();
  private readonly supervision = new RequestSupervisor();
  private attempt: Attempt | undefined;
  private catalog: Promise<ModelEntry[]> | undefined;
  private state: PublicStatus;
  constructor(
    ctx: Context,
    readonly config: Config,
  ) {
    super(ctx, "zcodeCli");
    this.state = {
      login: "idle",
      connection: "unchecked",
      model: config.model,
      reasoning: config.reasoningLevel,
    };
    ctx.effect(() => () => this.dispose(), "zcode-cli: processes");
  }
  private async paths(
    signal?: AbortSignal,
    nativeIds: readonly string[] = [],
  ): Promise<Paths> {
    await mkdir(this.config.dataDir, { recursive: true, mode: 0o700 });
    let command: string;
    try {
      command = await this.ctx.subprocess.resolveExecutable(
        this.config.command,
        this.config.env,
        signal,
      );
    } catch (error) {
      if (error instanceof SubprocessExecutableNotFoundError)
        throw new Error("ZCODE_CLI_MISSING");
      throw error;
    }
    if (command === undefined) throw new Error("ZCODE_CLI_MISSING");
    const executable = await realpath(command);
    const builtinPath =
      this.config.builtinConfigFile ||
      join(dirname(executable), "../config/provider/zcode-builtin.json");
    if (!isAbsolute(builtinPath)) throw new Error("ZCODE_CONFIG_PATH_INVALID");
    const env: NodeJS.ProcessEnv = {
      ...this.config.env,
      // Official CLI owns proxy routing; Node's automatic proxy layer duplicates it.
      NODE_USE_ENV_PROXY: "0",
      ZCODE_DATA_BASE_DIR: this.config.dataDir,
      ZCODE_BUILTIN_PROVIDER_CONFIG_FILE: builtinPath,
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: await preparePersonalConfig(
        this.config,
        nativeIds,
      ),
    };
    const secret = process.env.ZCODE_CREDENTIAL_SECRET;
    if (secret !== undefined && env.ZCODE_CREDENTIAL_SECRET === undefined)
      env.ZCODE_CREDENTIAL_SECRET = secret;
    return { executable, builtin: builtinPath, env };
  }
  /**
   * Resolve the account's usable models, caching until the next login change.
   * The catalog head is the default model: the configured fixed model when set,
   * otherwise the official template order intersected with the account endpoint.
   */
  private async resolveCatalog(signal?: AbortSignal): Promise<ModelEntry[]> {
    if (this.catalog) return this.catalog;
    const load = (async (): Promise<ModelEntry[]> => {
      const fetchSignal = AbortSignal.any([
        this.lifetime.signal,
        AbortSignal.timeout(this.config.probeTimeoutMs),
        ...(signal ? [signal] : []),
      ]);
      const paths = await this.paths(fetchSignal);
      const account = await readAccount(
        this.config.dataDir,
        this.config.providerId,
        paths.env,
      );
      if (!account) throw new Error("ZCODE_LOGIN_REQUIRED");
      let accountIds: string[];
      try {
        accountIds = await fetchAccountModels(
          this.config.apiBaseUrl,
          account.apiKey,
          fetchSignal,
        );
      } catch (error) {
        if (signal?.aborted) throw new Error("ZCODE_REQUEST_CANCELLED");
        if (fetchSignal.aborted) throw new Error("ZCODE_PROBE_TIMEOUT");
        if (!this.config.model) throw error;
        // 显式固定模型时即使模型端点不可用也保持旧行为：仅提供该模型。
        return resolveCatalog([], [], this.config.model);
      }
      const builtin = await builtinTemplateModels(
        paths.builtin,
        this.config.apiBaseUrl,
      );
      return resolveCatalog(builtin, accountIds, this.config.model);
    })();
    this.catalog = load;
    try {
      const entries = await load;
      const head = entries[0];
      if (head !== undefined) this.state.model = head.id;
      return entries;
    } catch (error) {
      if (this.catalog === load) this.catalog = undefined;
      throw error;
    }
  }
  /**
   * Resolve the requesting session's workspace directory when the sessions
   * service exposes one; a missing service, session, header, or directory
   * stays undefined so the request falls back to the startup directory.
   */
  private async resolveRequestCwd(
    sessionId: GenerateOptions["sessionId"],
    signal?: AbortSignal,
  ): Promise<string | undefined> {
    if (sessionId === undefined) return undefined;
    const sessions = this.ctx.get("sessions");
    const cwd = sessions?.get(sessionId)?.header?.cwd;
    if (cwd === undefined || !isAbsolute(cwd)) return undefined;
    try {
      if (!(await stat(cwd)).isDirectory()) return undefined;
    } catch {
      return undefined;
    }
    signal?.throwIfAborted();
    return cwd;
  }
  private spawn(
    paths: Paths,
    args: string[],
    signal: AbortSignal,
    cwd: string = this.config.cwd,
  ): SubprocessHandle {
    signal.throwIfAborted();
    const child = this.ctx.subprocess.spawn({
      argv: [paths.executable, ...args],
      cwd,
      env: paths.env,
      signal,
      graceMs: this.config.graceMs,
      stdio: { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
    });
    this.processes.add(child);
    child.done.then(
      () => this.processes.delete(child),
      () => this.processes.delete(child),
    );
    return child;
  }
  /** @returns Current account and connection facts without credential values. */
  async status(): Promise<PublicStatus> {
    try {
      const env = { ...process.env, ...this.config.env };
      const account = await readAccount(
        this.config.dataDir,
        this.config.providerId,
        env,
      );
      if (!this.attempt) {
        this.state.login = account
          ? "signed-in"
          : this.state.login === "signed-in"
            ? "idle"
            : this.state.login;
        if (account) this.state.credentialSource = account.source;
        else delete this.state.credentialSource;
      }
    } catch (error) {
      this.state.login = "failed";
      this.state.error =
        error instanceof Error ? error.message : "ZCODE_CREDENTIAL_INVALID";
    }
    return {
      ...this.state,
      accountFamily:
        this.config.providerId === "account:bigmodel-individual-coding-plan"
          ? "bigmodel"
          : "zai",
    };
  }
  /** Start one native CLI authorization attempt; repeated starts share the active attempt. @returns Safe attempt state. */
  async login(): Promise<PublicStatus> {
    this.lifetime.signal.throwIfAborted();
    if (this.attempt) return this.status();
    const id = randomUUID();
    const controller = new AbortController();
    this.state = {
      login: "starting",
      attemptId: id,
      connection: "unchecked",
      model: this.config.model,
      reasoning: this.config.reasoningLevel,
    };
    // Delay execution until the attempt identity is installed for all completion paths.
    const done = Promise.resolve().then(() => this.runLogin(id, controller));
    this.attempt = { id, controller, done };
    return { ...this.state };
  }
  private async runLogin(
    id: string,
    controller: AbortController,
  ): Promise<void> {
    const signal = AbortSignal.any([
      controller.signal,
      this.lifetime.signal,
      AbortSignal.timeout(this.config.loginTimeoutMs),
    ]);
    let child: SubprocessHandle | undefined;
    try {
      const paths = await this.paths(signal);
      if (
        this.config.providerId === "account:bigmodel-individual-coding-plan"
      ) {
        const account = await loginBigModel(signal, (url) => {
          if (this.attempt?.id === id && !signal.aborted)
            this.state = { ...this.state, login: "waiting", authorizeUrl: url };
        });
        await saveAccount(
          this.config.dataDir,
          this.config.providerId,
          account,
          paths.env,
          signal,
        );
        if (this.attempt?.id === id) {
          this.catalog = undefined;
          this.state = {
            login: "signed-in",
            connection: "unchecked",
            model: this.config.model,
            reasoning: this.config.reasoningLevel,
          };
        }
        return;
      }
      child = this.spawn(paths, ["login", "--no-browser", "--json"], signal);
      const out = new StringDecoder("utf8");
      const err = new StringDecoder("utf8");
      let stdout = "";
      let stderr = "";
      let bytes = 0;
      const receive = (kind: "out" | "err", chunk: Buffer | string): void => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > this.config.maxLoginOutputBytes) {
          controller.abort(new Error("ZCODE_LOGIN_OUTPUT_LIMIT"));
          return;
        }
        if (kind === "out")
          stdout += typeof chunk === "string" ? chunk : out.write(chunk);
        else {
          stderr += typeof chunk === "string" ? chunk : err.write(chunk);
          let url: string | undefined;
          try {
            url = extractAuthorizeUrl(stderr);
          } catch (error) {
            controller.abort(error);
            return;
          }
          if (url && this.attempt?.id === id && !signal.aborted) {
            this.state = {
              ...this.state,
              login: "waiting",
              authorizeUrl: url,
            };
          }
        }
      };
      const stdoutStream = child.stdout;
      const stderrStream = child.stderr;
      const onOut = (chunk: Buffer | string): void => receive("out", chunk);
      const onErr = (chunk: Buffer | string): void => receive("err", chunk);
      stdoutStream?.on("data", onOut);
      stderrStream?.on("data", onErr);
      try {
        const outcome = await child.done;
        signal.throwIfAborted();
        stdout += out.end();
        if (outcome.exitCode !== 0) throw new Error("ZCODE_LOGIN_FAILED");
        loginResult.parse(JSON.parse(stdout));
        const account = await readAccount(
          this.config.dataDir,
          this.config.providerId,
          paths.env,
        );
        if (!account) throw new Error("ZCODE_LOGIN_CREDENTIAL_MISSING");
        if (this.attempt?.id === id) {
          this.catalog = undefined;
          this.state = {
            login: "signed-in",
            connection: "unchecked",
            model: this.config.model,
            reasoning: this.config.reasoningLevel,
          };
        }
      } finally {
        stdoutStream?.off("data", onOut);
        stderrStream?.off("data", onErr);
      }
    } catch (error) {
      // CLI text may include account secrets; expose only controlled failure codes.
      if (
        this.attempt?.id === id &&
        !this.lifetime.signal.aborted &&
        (!controller.signal.aborted ||
          (controller.signal.reason instanceof Error &&
            [
              "ZCODE_LOGIN_OUTPUT_LIMIT",
              "ZCODE_AUTHORIZE_URL_INVALID",
            ].includes(controller.signal.reason.message)))
      )
        this.state = {
          login: "failed",
          connection: "unchecked",
          model: this.config.model,
          reasoning: this.config.reasoningLevel,
          error:
            controller.signal.reason instanceof Error &&
            [
              "ZCODE_LOGIN_OUTPUT_LIMIT",
              "ZCODE_AUTHORIZE_URL_INVALID",
            ].includes(controller.signal.reason.message)
              ? controller.signal.reason.message
              : signal.aborted
                ? "ZCODE_LOGIN_TIMEOUT"
                : error instanceof Error &&
                    [
                      "ZCODE_CLI_MISSING",
                      "ZCODE_LOGIN_TIMEOUT",
                      "ZCODE_AUTHORIZE_URL_INVALID",
                      "ZCODE_CREDENTIAL_INVALID",
                    ].includes(error.message)
                  ? error.message
                  : "ZCODE_LOGIN_FAILED",
        };
    } finally {
      if (child) {
        child.terminate();
        await child.done.catch(() => undefined);
      }
      if (this.attempt?.id === id) this.attempt = undefined;
    }
  }
  /** Cancel one matching attempt and wait for its process to exit. @param id - Browser attempt identity. */
  async cancel(id: string): Promise<void> {
    const attempt = this.attempt;
    if (!attempt || attempt.id !== id)
      throw new Error("ZCODE_LOGIN_ATTEMPT_CHANGED");
    attempt.controller.abort();
    await attempt.done;
    if (this.state.attemptId !== id) return;
    this.state = {
      login: "cancelled",
      connection: "unchecked",
      model: this.config.model,
      reasoning: this.config.reasoningLevel,
    };
  }
  /** Invoke official logout after cancelling an active login. */
  async logout(): Promise<void> {
    if (this.attempt) await this.cancel(this.attempt.id);
    const signal = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(this.config.requestTimeoutMs),
    ]);
    const paths = await this.paths(signal);
    const child = this.spawn(paths, ["logout", "--json"], signal);
    child.stdout?.resume();
    child.stderr?.resume();
    try {
      const outcome = await child.done;
      signal.throwIfAborted();
      if (outcome.exitCode !== 0) throw new Error("ZCODE_LOGOUT_FAILED");
    } finally {
      child.terminate();
      await child.done.catch(() => undefined);
    }
    this.catalog = undefined;
    this.state = {
      login: "idle",
      connection: "unchecked",
      model: this.config.model,
      reasoning: this.config.reasoningLevel,
    };
  }
  private async raw<T>(
    run: (rpc: JsonRpcLineTransport) => Promise<T>,
    signal: AbortSignal,
    requestCwd?: string,
    catalog: readonly ModelEntry[] = [],
    record?: RequestRecord,
    stopGate: Promise<void> = Promise.resolve(),
  ): Promise<T> {
    const paths = await this.paths(
      signal,
      catalog.map((entry) => entry.nativeId),
    );
    const account = await readAccount(
      this.config.dataDir,
      this.config.providerId,
      paths.env,
    );
    if (!account) throw new Error("ZCODE_LOGIN_REQUIRED");
    const release = builtin.parse(
      JSON.parse(await readFile(paths.builtin, "utf8")),
    );
    const revision = `zcode-builtin:${release.revision}:${createHash("sha256").update(resolve(paths.builtin)).digest("hex")}`;
    const cwd = requestCwd ?? this.config.cwd;
    const child = this.spawn(paths, ["app-server"], signal, cwd);
    child.stderr?.resume();
    const input = child.stdout;
    const output = child.stdin;
    if (!input || !output) {
      child.terminate();
      await child.done;
      throw new Error("ZCODE_STDIO_MISSING");
    }
    const bridge = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        try {
          const { jsonrpc, ...frame } = outgoingFrame.parse(
            JSON.parse(chunk.toString("utf8")),
          );
          if (jsonrpc !== "2.0") throw new Error("Invalid frame");
          output.write(JSON.stringify(frame) + "\n", callback);
        } catch (error) {
          callback(
            error instanceof Error ? error : new Error("ZCODE_FRAME_INVALID"),
          );
        }
      },
    });
    const rpc = new JsonRpcLineTransport(input, bridge);
    rpc.onRequest((method, params) => {
      if (method !== "interaction/requestProviderRuntimeHeaders")
        throw new Error("ZCODE_INTERACTION_UNSUPPORTED");
      const request = incomingAuth.parse(params);
      if (
        request.providerId !== this.config.providerId ||
        request.modelSelection.providerId !== this.config.providerId ||
        !catalog.some(
          (entry) => entry.nativeId === request.modelSelection.modelId,
        )
      )
        throw new Error("ZCODE_AUTH_ROUTE_MISMATCH");
      return Promise.resolve({
        headersApplied: true,
        requestAuth: { apiKey: account.apiKey },
      });
    });
    rpc.start();
    delete this.state.diagnostic;
    let registered = false;
    try {
      await rpc.request(
        "provider/updateAccountConfig",
        {
          revision: randomUUID(),
          basedOnZCodeBuiltinRevision: revision,
          providers: {
            [this.config.providerId]: {
              access: { type: "zhipu-account", entitled: true },
              builtinModelIds: catalog.map((entry) => entry.nativeId),
            },
          },
          states: {
            [this.config.providerId]: {
              availability: "available",
              entitled: true,
              current: true,
            },
          },
        },
        signal,
      );
      registered = true;
      this.state.connection = "registered";
      return await run(rpc);
    } catch (error) {
      this.state.connection = "failed";
      // 用户停止期间在途请求的任何落定都按取消归类，首因不被通道错误覆盖。
      if (record !== undefined && record.termination?.cause === "user-stop") {
        this.state.error = "ZCODE_REQUEST_CANCELLED";
        throw new Error(this.state.error);
      }
      if (signal.aborted) {
        // 首因为总超时的中止沿用独立错误码，不再与用户取消混用。
        this.state.error =
          record !== undefined && record.termination?.cause === "total-timeout"
            ? "ZCODE_REQUEST_TIMEOUT"
            : "ZCODE_REQUEST_CANCELLED";
        throw new Error(this.state.error);
      }
      if (error instanceof JsonRpcResponseError) {
        const data = nativeErrorData.safeParse(error.data);
        const code = data.success
          ? (data.data.providerCode ?? data.data.code)
          : undefined;
        record?.failAttempt("provider-error", String(code ?? error.code));
        this.state.diagnostic = {
          code: code ?? error.code ?? "ZCODE_NATIVE_ERROR",
          message: (data.success
            ? (data.data.providerMessage ?? error.message)
            : error.message
          )
            .replaceAll(account.apiKey, "[redacted]")
            .replaceAll(account.identity, "[redacted]")
            .replace(/(?:Bearer\s+|sk-)[\w.-]+/gi, "[redacted]")
            .replace(
              /((?:api[_-]?key|access[_-]?token|authorization)[\s"':=]+)[^\s,"'}]+/gi,
              "$1[redacted]",
            )
            .slice(0, 1000),
        };
      } else if (error instanceof Error && startupCodes.has(error.message)) {
        record?.terminate("startup-timeout", error.message);
      } else {
        // 传输层失败且无错误响应：按模型通道提前退出终止整条请求。
        record?.terminate(
          "channel-exit",
          error instanceof Error ? error.message : undefined,
        );
      }
      this.state.error = registered
        ? "ZCODE_MODEL_CONNECTION_FAILED"
        : "ZCODE_MODEL_REGISTRATION_FAILED";
      throw new Error(this.state.error);
    } finally {
      // 停止链路先等官方取消回执落地（有界），再拆传输，避免回执被拆除吞掉。
      if (record?.stop !== undefined) {
        await Promise.race([
          stopGate,
          new Promise<void>((resolve) =>
            setTimeout(resolve, this.config.cancelReceiptTimeoutMs + 100),
          ),
        ]);
      }
      // 本机回收结果独立于终止原因记录；子进程句柄失败即清理失败。
      let cleanupOk = true;
      let cleanupDetail: string | undefined;
      rpc.close();
      bridge.destroy();
      child.terminate();
      await child.done.catch((error: unknown) => {
        cleanupOk = false;
        cleanupDetail = error instanceof Error ? error.message : String(error);
      });
      record?.cleanup(cleanupOk, cleanupDetail);
      // 用户停止以受管范围清空确认收尾；超时未清空保留待确认状态。
      if (record?.stop !== undefined) {
        const confirmed = await child.waitForExit(
          AbortSignal.timeout(this.config.cleanupTimeoutMs),
        );
        record.noteExitConfirmed(confirmed);
      }
    }
  }
  /**
   * @returns The account's usable models; the head is the default model.
   * Requires a completed sign-in and reaches the account model endpoint once.
   */
  models(signal?: AbortSignal): Promise<readonly ModelEntry[]> {
    return this.resolveCatalog(signal);
  }
  /** Require completed sign-in, then send a separately bounded ping with no tools. */
  async check(): Promise<void> {
    if ((await this.status()).login !== "signed-in")
      throw new Error("ZCODE_LOGIN_REQUIRED");
    const signal = AbortSignal.any([
      this.lifetime.signal,
      AbortSignal.timeout(this.config.probeTimeoutMs),
    ]);
    try {
      const catalog = await this.resolveCatalog(signal);
      const head = catalog[0];
      if (head === undefined) throw new Error("ZCODE_MODELS_UNAVAILABLE");
      await this.generate({
        provider: "zcode-cli",
        model: head.id,
        reasoningEffort: ReasoningEffortId("low"),
        messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
        tools: [],
        maxTokens: this.config.probeMaxTokens,
        signal,
      });
      delete this.state.error;
      delete this.state.diagnostic;
    } catch (error) {
      this.state.connection = "failed";
      const code = signal.aborted
        ? "ZCODE_PROBE_TIMEOUT"
        : error instanceof Error && /^ZCODE_[A-Z_]+$/.test(error.message)
          ? error.message
          : "ZCODE_MODEL_CONNECTION_FAILED";
      this.state.error = code;
      throw new Error(code);
    }
  }
  /**
   * Dispatch KMH's complete request to the raw endpoint and own cancellation.
   * 每个终止信号源单独监听并写入监督记录：首个生效原因保持不变，
   * 总超时以 ZCODE_REQUEST_TIMEOUT 报出，不再与用户取消混用同一错误码。
   * @param options - Logged model request with current tool declarations.
   * @returns Validated by the adapter before emitting KMH events.
   */
  async generate(options: GenerateOptions): Promise<unknown> {
    const record = this.supervision.open(
      options.sessionId,
      requestFingerprint(options),
    );
    // 请求总预算从接收请求开始计时，覆盖准备、启动、模型等待与通道内部重试。
    const merged = new AbortController();
    const disarm: (() => void)[] = [];
    // 用户停止先经官方取消通道：run 闭包注入在途 rpc，回执落地前不拆传输。
    let liveRpc: JsonRpcLineTransport | undefined;
    let dispatchStarted = false;
    let settleStop: () => void = () => undefined;
    const stopSettled = new Promise<void>((resolve) => {
      settleStop = resolve;
    });
    const issueCancel = async (): Promise<void> => {
      try {
        if (liveRpc !== undefined && dispatchStarted) {
          const receipt = await Promise.race([
            liveRpc
              .request(
                "workspace/cancelGenerateText",
                { operationId: record.requestId },
                AbortSignal.timeout(this.config.cancelReceiptTimeoutMs),
              )
              .then(
                (value: unknown) =>
                  typeof value === "object" &&
                  value !== null &&
                  (value as { cancelled?: unknown }).cancelled === true,
                () => false,
              ),
            new Promise<boolean>((resolve) =>
              setTimeout(
                () => resolve(false),
                this.config.cancelReceiptTimeoutMs,
              ),
            ),
          ]);
          record.noteReceipt(receipt);
        }
      } finally {
        merged.abort(new Error("ZCODE_REQUEST_CANCELLED"));
        settleStop();
      }
    };
    const arm = (source: AbortSignal | undefined, cause: TerminationCause) => {
      if (source === undefined) return;
      const trip = () => {
        record.terminate(cause);
        if (cause === "user-stop") {
          record.noteStop();
          issueCancel().catch(() => undefined);
          return;
        }
        merged.abort(new Error("ZCODE_REQUEST_CANCELLED"));
      };
      if (source.aborted) {
        trip();
        return;
      }
      source.addEventListener("abort", trip, { once: true });
      disarm.push(() => source.removeEventListener("abort", trip));
    };
    arm(options.signal, "user-stop");
    arm(this.lifetime.signal, "host-unload");
    const budget = setTimeout(() => {
      record.terminate("total-timeout", `${this.config.requestTimeoutMs}ms`);
      merged.abort(new Error("ZCODE_REQUEST_TIMEOUT"));
    }, this.config.requestTimeoutMs);
    const signal = merged.signal;
    try {
      const catalog = await this.resolveCatalog(signal);
      const entry =
        options.model === undefined
          ? catalog[0]
          : catalog.find((item) => item.id === options.model?.toLowerCase());
      if (entry === undefined) throw new Error("ZCODE_MODEL_UNAVAILABLE");
      const request = projectRequest(options);
      const requestCwd = await this.resolveRequestCwd(
        options.sessionId,
        signal,
      );
      const result = await this.raw(
        (rpc) => {
          liveRpc = rpc;
          dispatchStarted = true;
          record.note({ stage: "waiting" });
          return rpc.request(
            "workspace/generateText",
            {
              workspace: {
                workspacePath: requestCwd ?? this.config.cwd,
                workspaceKey: requestCwd ?? this.config.cwd,
              },
              selection: {
                providerId: this.config.providerId,
                modelId: entry.nativeId,
                options: {
                  reasoningLevel:
                    options.reasoningEffort ?? this.config.reasoningLevel,
                },
              },
              ...request,
              querySource: "kmh",
              operationId: record.requestId,
              // CLI 0.16.9 将 maxOutputTokens 当必填校验，缺省即拒绝整个请求。
              maxOutputTokens:
                options.maxTokens ?? this.config.defaultMaxTokens,
            },
            signal,
          );
        },
        signal,
        requestCwd,
        catalog,
        record,
        stopSettled,
      );
      const validated = GenerationResult.parse(result);
      record.succeed();
      this.state.connection = "ready";
      delete this.state.error;
      delete this.state.diagnostic;
      return validated;
    } catch (error) {
      classifyFailure(record, error);
      // 首因为总超时时，把底层沿用旧分类的中止错误改回超时语义。
      if (
        record.termination?.cause === "total-timeout" &&
        error instanceof Error &&
        error.message === "ZCODE_REQUEST_CANCELLED"
      )
        throw new Error("ZCODE_REQUEST_TIMEOUT");
      throw error;
    } finally {
      clearTimeout(budget);
      for (const off of disarm) off();
    }
  }
  /** 以慢请求阈值返回全部请求状态快照，供 Web 与诊断入口读取。 */
  requests(): RequestStatus[] {
    return this.supervision.snapshot(this.config.slowRequestMs);
  }
  /** Terminate every owned range and await login settlement during unload. */
  async dispose(): Promise<void> {
    this.lifetime.abort();
    this.attempt?.controller.abort();
    for (const child of this.processes) child.terminate();
    await Promise.allSettled([...this.processes].map((child) => child.done));
    await this.attempt?.done;
  }
}
