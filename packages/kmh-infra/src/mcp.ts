/**
 * kmh-infra 的服务查询装配：按插件配置把 dsh-mcp-client（stdio）挂到助手
 * 工具面，工具名形如 mcp__infra__<tool>。配置的 volatile 字段热更新时
 * （loader/volatile-update）按新参数重挂：serverName 固定为 infra，工具名
 * 保持稳定；接入开关关闭或关键参数为空时卸载。
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

/** 服务查询进程的固定参数：以模块方式启动 x-infra-mcp。 */
const SERVER_MODULE_ARGS = ["-m", "x_infra_mcp.mcp_server"];

/** mcp-client 侧的服务命名空间：工具名 mcp__infra__<tool>。 */
const SERVER_NAME = "infra";

/** 管理 mcp-client 实例与措辞引导段落的挂载、重挂与卸载。 */
export class McpMount {
  private fiber: Fiber | undefined;
  private promptFiber: Fiber | undefined;
  private mountedKey: string | undefined;
  private mountedToken: string | undefined;

  /**
   * @param ctx - 宿主插件上下文（mcp-client 与引导段落作为子插件挂载其下）。
   * @param config - 运行期配置（volatile 活引用）。
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}

  /**
   * 按当前配置同步挂载状态：装配键（不含暗号）与暗号取值都未变时不动，
   * 变化时先卸载旧实例再按新参数挂载，禁用或关键参数为空时仅卸载。
   */
  sync(): void {
    const enabled = this.config.mcpEnabled.get();
    const command = this.config.pythonCommand.get();
    const cwd = this.config.mcpModuleDir.get();
    const dashUrl = this.config.dashUrl.get();
    const toolCallTimeoutMs = this.config.toolCallTimeoutMs.get();
    const tokenName = this.config.tokenEnvVar.get();
    // 暗号单独保存与比较，不进装配键：装配键可能被日志或诊断打印。
    const token = tokenName === "" ? undefined : process.env[tokenName];
    const usable =
      enabled &&
      command !== "" &&
      cwd !== "" &&
      dashUrl !== "" &&
      toolCallTimeoutMs > 0;
    const key = usable
      ? JSON.stringify({ command, cwd, dashUrl, toolCallTimeoutMs })
      : undefined;
    if (key === this.mountedKey && token === this.mountedToken) return;
    this.mountedKey = key;
    this.mountedToken = token;
    this.disposeFiber();
    if (key === undefined) return;
    if (token === undefined || token === "") {
      this.ctx.logger.warn(
        `kmh-infra: 环境变量 ${tokenName === "" ? "(未配置变量名)" : tokenName} 没有取值，服务查询会返回身份校验错误；暗号要在启动 KMH 之前设进环境`,
      );
    }
    const env: Record<string, string> = { X_DASH_BASE_URL: dashUrl };
    if (token !== undefined && token !== "") env.X_INFRA_MCP_TOKEN = token;
    const fiber = this.ctx.plugin(
      McpClient,
      McpClient.Config({
        transport: "stdio",
        serverName: SERVER_NAME,
        command,
        args: SERVER_MODULE_ARGS,
        cwd,
        env,
        toolCallTimeoutMs,
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

  /** 卸载当前实例与引导段落（插件停用、或配置令其不可用时调用）。 */
  dispose(): void {
    this.mountedKey = undefined;
    this.mountedToken = undefined;
    this.disposeFiber();
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
