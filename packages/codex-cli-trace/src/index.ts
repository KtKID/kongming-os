/** 独立的 CLI 执行记录插件；只消费磁盘记录和既有 Web 扩展。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import type { Config } from "./config.ts";
import { TraceReader } from "./reader.ts";
import { mountRoutes } from "./web.ts";
import { READER_IDLE_MS } from "./paths.ts";
export { Config } from "./config.ts";
export const name = "codex-cli-trace";
/** 装载只读运行对象，销毁时停止清理计时并等待读取静止。 */
export function apply(ctx: Context, config: Config): void {
  const reader = new TraceReader(config);
  ctx.effect(() => {
    const timer = setInterval(() => {
      reader.evictIdle();
    }, READER_IDLE_MS);
    timer.unref();
    return async () => {
      clearInterval(timer);
      await reader.dispose();
    };
  }, "codex-cli-trace: reader");
  ctx.inject(["connection"], (web) => {
    web.effect(() => mountRoutes(web, reader), "codex-cli-trace: routes");
  });
}
