/** 官方 Codex CLI app-server 连接：进程生命周期与行协议双向分发。 */
import type { Context } from "@deepseek-ai/cordis";
import {
  SubprocessExecutableNotFoundError,
  type SubprocessHandle,
} from "@deepseek-ai/dsh-subprocess";
import {
  JsonRpcLineTransport,
  JsonRpcResponseError,
} from "@deepseek-ai/dsh-sdk-protocol";
import { realpath } from "node:fs/promises";
import type { Readable } from "node:stream";
import {
  createFrameBridge,
  InitializeParams,
  InitializeResult,
} from "./protocol.ts";

/** 建立一条连接所需的执行设置。 */
export interface CodexConnectOptions {
  command: string;
  cwd: string;
  configOverrides: readonly string[];
  env?: Record<string, string | undefined>;
  graceMs: number;
  startupTimeoutMs: number;
}
/** 服务端请求（如 item/tool/call）的处理函数；拒绝即向 CLI 回错误。 */
export type ServerRequestHandler = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown>;
/** 通知的处理函数。 */
export type NotificationHandler = (
  method: string,
  params: Record<string, unknown>,
) => void;

/**
 * 一条到官方 CLI 的行协议连接。进程随连接存活：关闭输入并等待退出后连接不可复用。
 * 进程意外退出时，在途请求以 JSON-RPC transport closed 拒绝。
 */
export class CodexConnection {
  private readonly transport: JsonRpcLineTransport;
  private exitState = false;
  constructor(
    input: Readable,
    private readonly child: SubprocessHandle,
    private readonly bridge: ReturnType<typeof createFrameBridge>,
    private readonly stderrTail: { value: string },
  ) {
    this.transport = new JsonRpcLineTransport(input, bridge);
    void child.done.then(
      () => {
        this.exitState = true;
      },
      () => {
        this.exitState = true;
      },
    );
  }
  /** 进程退出观察回执；用于等待回收完成。 */
  get done(): Promise<unknown> {
    return this.child.done;
  }
  /** 是否已经退出。 */
  get exited(): boolean {
    return this.exitState;
  }
  /** 诊断用 stderr 尾部（有界）。 */
  get stderr(): string {
    return this.stderrTail.value;
  }
  /** 开始读取输入流；幂等。 */
  start(): void {
    this.transport.start();
  }
  /** 停止读取并拆除桥接流；不触碰进程本身。 */
  close(): void {
    this.transport.close();
    this.bridge.destroy();
  }
  /** 安装服务端请求处理；未安装时服务端请求收到 method not found 错误回执。 */
  onServerRequest(handler: ServerRequestHandler): void {
    this.transport.onRequest(handler);
  }
  /** 安装通知处理。 */
  onNotification(handler: NotificationHandler): void {
    this.transport.onNotification(handler);
  }
  /** 发起一次请求并等待响应；signal 中止时在途条目立即拒绝。 */
  request(
    method: string,
    params: object,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.transport.request(method, params, signal);
  }
  /** 发送一条通知。 */
  notify(method: string, params?: object): void {
    this.transport.notify(method, params);
  }
  /**
   * 关闭输入并等待进程退出；超时后经 subprocess 托管强制回收。
   * @param cleanupTimeoutMs - 干净退出的等待时限。
   * @returns clean 表示进程自行退出，forced 表示超时后强制回收。
   */
  async stop(cleanupTimeoutMs: number): Promise<"clean" | "forced"> {
    if (this.exited) return "clean";
    this.child.stdin?.end();
    this.close();
    const confirmed = await this.child.waitForExit(
      AbortSignal.timeout(cleanupTimeoutMs),
    );
    if (!confirmed) this.child.terminate();
    await this.child.done.catch(() => undefined);
    return confirmed ? "clean" : "forced";
  }
}

/**
 * 拉起官方 CLI、完成 initialize 握手并返回可用连接。
 * @param ctx - 宿主上下文，提供受管 subprocess 服务。
 * @param options - 可执行文件、工作目录、-c 覆盖与超时设置。
 * @param signal - 中止信号：启动阶段中止即终止进程并抛出 CODEX_STARTUP_CANCELLED。
 * @throws CODEX_CLI_MISSING 可执行文件不存在；CODEX_STDIO_MISSING 管道缺失；
 *   CODEX_STARTUP_TIMEOUT 握手超时；CODEX_STARTUP_FAILED 握手被拒或进程提前退出。
 */
export async function connectCodex(
  ctx: Context,
  options: CodexConnectOptions,
  signal: AbortSignal,
): Promise<CodexConnection> {
  signal.throwIfAborted();
  let executable: string;
  try {
    const resolved = await ctx.subprocess.resolveExecutable(
      options.command,
      {},
      signal,
    );
    if (resolved === undefined) throw new Error("CODEX_CLI_MISSING");
    executable = await realpath(resolved);
  } catch (error) {
    if (error instanceof SubprocessExecutableNotFoundError)
      throw new Error("CODEX_CLI_MISSING");
    throw error;
  }
  const argv = [executable, "app-server", "--stdio"];
  for (const override of options.configOverrides) argv.push("-c", override);
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(options.env ?? {}))
    if (value !== undefined) env[key] = value;
  const child = ctx.subprocess.spawn({
    argv,
    cwd: options.cwd,
    env,
    graceMs: options.graceMs,
    stdio: { stdin: "pipe", stdout: "pipe", stderr: "pipe" },
  });
  const stderrTail = { value: "" };
  child.stderr?.on("data", (chunk: Buffer) => {
    stderrTail.value = (stderrTail.value + chunk.toString("utf8")).slice(-2000);
  });
  const input = child.stdout;
  const output = child.stdin;
  if (!input || !output) {
    child.terminate();
    await child.done.catch(() => undefined);
    throw new Error("CODEX_STDIO_MISSING");
  }
  const bridge = createFrameBridge(output);
  const connection = new CodexConnection(input, child, bridge, stderrTail);
  const startup = AbortSignal.any([
    signal,
    AbortSignal.timeout(options.startupTimeoutMs),
  ]);
  try {
    const params = InitializeParams.parse({
      clientInfo: {
        name: "kmh_codex_cli",
        title: "KMH Codex CLI",
        version: "0.1.0",
      },
      capabilities: { experimentalApi: true },
    });
    connection.start();
    const raw: unknown = await connection.request(
      "initialize",
      params,
      startup,
    );
    InitializeResult.parse(raw);
    connection.notify("initialized", {});
    return connection;
  } catch (error) {
    connection.close();
    child.terminate();
    await child.done.catch(() => undefined);
    if (signal.aborted) throw new Error("CODEX_STARTUP_CANCELLED");
    if (startup.aborted) throw new Error("CODEX_STARTUP_TIMEOUT");
    if (error instanceof JsonRpcResponseError)
      throw new Error("CODEX_STARTUP_FAILED");
    if (error instanceof Error && error.message === "CODEX_STDIO_MISSING")
      throw error;
    // 进程提前退出等传输层失败：带 stderr 尾部辅助定位。
    throw new Error(
      `CODEX_STARTUP_FAILED: ${error instanceof Error ? error.message : String(error)}${stderrTail.value ? `; stderr: ${stderrTail.value.slice(-300)}` : ""}`,
    );
  }
}
