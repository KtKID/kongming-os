/**
 * kmh-infra 服务插件，宿主半：声明配置 schema（volatile 字段，settings 体系
 * 读写与持久化），并按配置把服务查询能力挂到助手工具面（stdio，
 * mcp__infra__<tool>）；配置热更新经 loader/volatile-update 重挂。
 */
import type { Context } from "@deepseek-ai/cordis";
// type-only: loader 的 Events 声明（loader/volatile-update）。
import type {} from "@deepseek-ai/cordis-plugin-loader";
import type { Config } from "./config.ts";
import { McpMount } from "./mcp.ts";

export { Config, normalizeHttpUrl } from "./config.ts";

/** Cordis 插件名（诊断用）；profile 中的 name 是模块说明符 @kmh/kmh-infra。 */
export const name = "kmh-infra";

/**
 * 装配宿主半：挂载服务查询能力与措辞引导，并订阅配置热更新。
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
    "kmh-infra: query mount",
  );
}
