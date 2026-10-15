/**
 * MadeMe MCP 装配：按插件配置把 dsh-mcp-client（streamable-http）挂到助手
 * 工具面，工具名形如 mcp__mademe__<tool>。配置的 volatile 字段热更新时
 * （loader/volatile-update）按新地址重挂：serverName 固定为 mademe，工具
 * 名保持稳定；禁用开关或空地址时卸载，面板与配置表单不受影响。
 */
import type { Context, Fiber } from "@deepseek-ai/cordis";
import * as McpClient from "@deepseek-ai/dsh-mcp-client";
import type { Config } from "./config.ts";

/** 管理 mcp-client 实例的挂载、重挂与卸载。 */
export class McpMount {
  private fiber: Fiber | undefined;
  private mountedKey: string | undefined;

  /**
   * @param ctx - 宿主插件上下文（mcp-client 将作为子插件挂载其下）。
   * @param config - 运行期配置（volatile 活引用）。
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}

  /**
   * 按当前配置同步挂载状态：装配键（启用且地址非空时的 url）未变不动，
   * 变化时先卸载旧实例再按新地址挂载，禁用或空地址时仅卸载。
   */
  sync(): void {
    const enabled = this.config.mcpEnabled.get();
    const url = this.config.mcpUrl.get();
    const key = enabled && url ? url : undefined;
    if (key === this.mountedKey) return;
    this.mountedKey = key;
    this.disposeFiber();
    if (key === undefined) return;
    const fiber = this.ctx.plugin(
      McpClient,
      McpClient.Config({
        transport: "streamable-http",
        serverName: "mademe",
        url: key,
      }),
    );
    this.fiber = fiber;
    Promise.resolve(fiber).catch((error: unknown) => {
      this.ctx.logger.warn(
        "kmh-mademe: MCP 初始连接失败，工具暂不可用（连接失败不阻塞插件，按重连策略重试）",
        error,
      );
    });
  }

  /** 卸载当前实例（插件停用时调用）。 */
  dispose(): void {
    this.mountedKey = undefined;
    this.disposeFiber();
  }

  /** 卸载并清空当前 fiber；卸载失败仅记录不阻塞后续重挂。 */
  private disposeFiber(): void {
    const fiber = this.fiber;
    this.fiber = undefined;
    if (fiber === undefined) return;
    Promise.resolve(fiber.dispose()).catch((error: unknown) => {
      this.ctx.logger.warn("kmh-mademe: MCP 实例卸载失败", error);
    });
  }
}
