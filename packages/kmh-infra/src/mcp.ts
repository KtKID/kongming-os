/**
 * kmh-infra 的服务查询装配：按插件配置把 dsh-mcp-client（stdio）挂到助手
 * 工具面，工具名形如 mcp__infra__<tool>。配置的 volatile 字段热更新时
 * （loader/volatile-update）按新参数重挂：serverName 固定为 infra，工具名
 * 保持稳定；接入开关关闭或关键参数为空时卸载。
 *
 * 暗号由插件在挂载与配置变更时自行解析（见 token.ts）：先读用户 shell 配置，
 * 再回退 KMH 进程环境——Web 以任何环境启动都不需要预先注入暗号，暗号轮换
 * 也不需要重启服务。解析期间不打扰在跑的实例，结果回来后只有装配键或暗号
 * 取值真的变化才重挂；连发多次配置变更时只有最新一次的结果会落地（代次
 * 校验），被超过的解析结果直接丢弃。
 *
 * 两个环境变量必须显式传给子进程：DSH 给子进程的是一份"洗过的"父进程环境，
 * 凡名字匹配 KEY|PASSWORD|SECRET|TOKEN 的一律不转发，因此 X_INFRA_MCP_TOKEN
 * 不会被自动带进去。暗号只在这条传递路径与进程环境里存在，不写入任何配置
 * 文件，也不进入日志与错误消息。
 *
 * 措辞引导随装配一起挂载与卸载：工具不存在时不留对它们的描述。
 */
import type { Context, Fiber } from "@deepseek-ai/cordis";
import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import type { Config } from "./config.ts";
import * as Prompt from "./prompt.ts";
import {
  resolveToken,
  fetchTokenFromShellProfile,
  type TokenResolution,
} from "./token.ts";

/** 服务查询进程的固定参数：以模块方式启动 x-infra-mcp。 */
const SERVER_MODULE_ARGS = ["-m", "x_infra_mcp.mcp_server"];

/** mcp-client 侧的服务命名空间：工具名 mcp__infra__<tool>。 */
const SERVER_NAME = "infra";

/** shell 取值函数形态；测试用它注入替身，真实解析顺序始终走 token.ts。 */
export type ShellTokenFetcher = (
  varName: string,
  shell: string,
) => Promise<string | undefined>;

/** 管理 mcp-client 实例与措辞引导段落的挂载、重挂与卸载。 */
export class McpMount {
  private fiber: Fiber | undefined;
  private promptFiber: Fiber | undefined;
  private mountedKey: string | undefined;
  private mountedToken: string | undefined;
  private resolvingKey: string | undefined;
  private generation = 0;

  /**
   * @param ctx - 宿主插件上下文（mcp-client 与引导段落作为子插件挂载其下）。
   * @param config - 运行期配置（volatile 活引用）。
   * @param fetcher - shell 取值函数；缺省用 token.ts 的真实实现，测试注入替身
   *   时解析顺序（shell 优先、进程环境后备）仍走真实代码。
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    private readonly fetcher: ShellTokenFetcher = fetchTokenFromShellProfile,
  ) {}

  /**
   * 按当前配置同步装配状态：禁用或关键参数为空时立即卸载并作废在途解析；
   * 可用时异步解析暗号（可能要起一个 shell 读用户配置），解析完成后装配键
   * 或暗号取值有变化才重挂，都没变就不动在跑的实例（解析同时承担暗号轮换
   * 的刷新）。同一装配键的解析已在途时本次直接返回。
   */
  sync(): void {
    const enabled = this.config.mcpEnabled.get();
    const command = this.config.pythonCommand.get();
    const cwd = this.config.mcpModuleDir.get();
    const dashUrl = this.config.dashUrl.get();
    const toolCallTimeoutMs = this.config.toolCallTimeoutMs.get();
    const tokenName = this.config.tokenEnvVar.get();
    const usable =
      enabled &&
      command !== "" &&
      cwd !== "" &&
      dashUrl !== "" &&
      toolCallTimeoutMs > 0;
    const key = usable
      ? JSON.stringify({ command, cwd, dashUrl, toolCallTimeoutMs })
      : undefined;
    if (key === undefined) {
      this.cancelPending();
      this.mountedKey = undefined;
      this.mountedToken = undefined;
      this.disposeFiber();
      return;
    }
    if (key === this.resolvingKey) return;
    this.generation += 1;
    const generation = this.generation;
    this.resolvingKey = key;
    resolveToken(tokenName, process.env, this.fetcher)
      .then((resolution: TokenResolution) => {
        if (generation !== this.generation) return;
        this.resolvingKey = undefined;
        if (key === this.mountedKey && resolution.token === this.mountedToken) {
          return;
        }
        this.mountedKey = key;
        // 暗号单独保存与比较，不进装配键：装配键可能被日志或诊断打印。
        this.mountedToken = resolution.token;
        this.disposeFiber();
        this.mount(
          { command, cwd, dashUrl, toolCallTimeoutMs, tokenName },
          resolution,
        );
      })
      .catch((error: unknown) => {
        if (generation !== this.generation) return;
        this.resolvingKey = undefined;
        this.ctx.logger.warn(
          "kmh-infra: 暗号解析异常，本次不改变当前装配；下次配置变更会重试",
          error,
        );
      });
  }

  /** 卸载当前实例与引导段落，并作废在途的暗号解析（插件停用、或配置令其不可用时调用）。 */
  dispose(): void {
    this.cancelPending();
    this.mountedKey = undefined;
    this.mountedToken = undefined;
    this.disposeFiber();
  }

  /** 作废在途解析：之后完成的解析结果都会因代次过旧被丢弃。 */
  private cancelPending(): void {
    this.generation += 1;
    this.resolvingKey = undefined;
  }

  /**
   * 按解析结果挂载查询实例与引导段落；暗号缺失只告警不阻塞（查询会返回
   * 身份校验错误），日志里只出现变量名与来源，不出现取值。
   * @param params - 组成装配键的配置取值（解析发起时的快照）。
   * @param resolution - 暗号解析结果。
   */
  private mount(
    params: {
      command: string;
      cwd: string;
      dashUrl: string;
      toolCallTimeoutMs: number;
      tokenName: string;
    },
    resolution: TokenResolution,
  ): void {
    const token = resolution.token;
    if (token === undefined) {
      this.ctx.logger.warn(
        `kmh-infra: 环境变量 ${params.tokenName === "" ? "(未配置变量名)" : params.tokenName} 在用户 shell 配置与 KMH 进程环境里都没有取值，服务查询会返回身份校验错误；把暗号设进 shell 配置后保存任一配置即可重取`,
      );
    } else {
      this.ctx.logger.info(
        `kmh-infra: 暗号取自${resolution.source === "shell" ? "用户 shell 配置" : "KMH 进程环境"}（变量 ${params.tokenName}）`,
      );
    }
    const env: Record<string, string> = { X_DASH_BASE_URL: params.dashUrl };
    if (token !== undefined) env.X_INFRA_MCP_TOKEN = token;
    const fiber = this.ctx.plugin(
      McpClient,
      McpClient.Config({
        transport: "stdio",
        serverName: SERVER_NAME,
        command: params.command,
        args: SERVER_MODULE_ARGS,
        cwd: params.cwd,
        env,
        toolCallTimeoutMs: params.toolCallTimeoutMs,
        failOnStartupError: false,
      }),
    );
    this.fiber = fiber;
    Promise.resolve(fiber).catch((error: unknown) => {
      this.ctx.logger.warn(
        "kmh-infra: 服务查询初始连接失败，工具暂不可用（连接失败不阻塞插件，按重连策略重试）",
        error,
      );
    });
    this.promptFiber = this.ctx.plugin(Prompt);
  }

  /** 卸载并清空当前 fiber；卸载失败仅记录不阻塞后续重挂。 */
  private disposeFiber(): void {
    const promptFiber = this.promptFiber;
    this.promptFiber = undefined;
    if (promptFiber !== undefined) {
      Promise.resolve(promptFiber.dispose()).catch((error: unknown) => {
        this.ctx.logger.warn("kmh-infra: 措辞引导段落卸载失败", error);
      });
    }
    const fiber = this.fiber;
    this.fiber = undefined;
    if (fiber === undefined) return;
    Promise.resolve(fiber.dispose()).catch((error: unknown) => {
      this.ctx.logger.warn("kmh-infra: 服务查询实例卸载失败", error);
    });
  }
}
