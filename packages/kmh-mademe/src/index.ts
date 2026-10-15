/**
 * MadeMe 服务插件，宿主半：声明配置 schema（volatile 字段，settings 体系
 * 读写与持久化），并把 MCP 客户端按配置挂到助手工具面（streamable-http，
 * 工具名 mcp__mademe__<tool>）；配置热更新经 loader/volatile-update 重挂。
 */
import type { Context } from "@deepseek-ai/cordis";
// type-only: loader 的 Events 声明（loader/volatile-update）。
import type {} from "@deepseek-ai/cordis-plugin-loader";
import type { Config } from "./config.ts";
import { McpMount } from "./mcp.ts";

export { Config, normalizeHttpUrl } from "./config.ts";

/** Cordis 插件名（诊断用）；profile 中的 name 是模块说明符 @kmh/mademe。 */
export const name = "kmh-mademe";

/**
 * 装配宿主半：挂载 MCP 客户端并订阅配置热更新。
 * @param ctx - 宿主插件上下文。
 * @param config - 运行期配置（volatile 活引用）。
 */
export function apply(ctx: Context, config: Config): void {
  const mount = new McpMount(ctx, config);
  mount.sync();
  ctx.on("loader/volatile-update", () => {
    mount.sync();
  });
  ctx.effect(
    () => () => {
      mount.dispose();
    },
    "kmh-mademe: mcp mount",
  );
}
