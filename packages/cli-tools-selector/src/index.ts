/** CLI 工具开关选择器（宿主侧）：挂载详情页读取/切换路由，把请求转给 codex-cli 的开关能力。 */
import type { Context } from "@deepseek-ai/cordis";
import { mountRoutes } from "./web.ts";

export const name = "cli-tools-selector";

/**
 * 注册宿主路由；连接通道不可用时（如 headless）不挂路由也不报错。
 * @param ctx - 插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.inject(["connection"], (web) => {
    mountRoutes(web);
  });
}
