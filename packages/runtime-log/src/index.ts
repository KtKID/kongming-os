/** 将 Cordis 插件日志追加到 KMH 私有记录文件。 */
import type { Context } from "@deepseek-ai/cordis";
import schema from "@deepseek-ai/schemastery";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { formatWithOptions } from "node:util";

/** Cordis 插件名称。 */
export const name = "kmh-runtime-log";

/** 部署指定的绝对日志路径。 */
export const Config = schema.object({
  file: schema
    .transform(schema.string().required(), (value) => {
      if (!isAbsolute(value))
        throw new schema.ValidationError("file 必须是绝对路径", {
          path: ["file"],
        });
      return value;
    })
    .required(),
});

/** 校验后的日志配置。 */
export type Config = ReturnType<typeof Config>;

/**
 * 注册一个随插件释放的日志导出器；每条记录同步刷新到磁盘，写入错误撤回导出器并向调用者传播。
 * @param ctx - 拥有导出器的 Cordis 上下文。
 * @param config - 私有日志文件的绝对路径。
 */
export function apply(ctx: Context, config: Config): void {
  mkdirSync(dirname(config.file), { recursive: true, mode: 0o700 });
  const stop = ctx.logger.exporter({
    levels: { default: 3 },
    export: (message) => {
      const args: readonly unknown[] = message.args;
      const record = {
        time: new Date(message.ts).toISOString(),
        pid: process.pid,
        name: message.name,
        level: message.type,
        text: formatWithOptions({ colors: false, depth: 6 }, ...args),
      };
      try {
        appendFileSync(config.file, JSON.stringify(record) + "\n", {
          mode: 0o600,
          flush: true,
        });
      } catch (error) {
        // 撤回可能异步：尽力释放并吞掉释放本身的失败，让原始写入错误传播。
        void Promise.resolve(stop()).catch(() => undefined);
        process.stderr.write(`kmh-runtime-log: ${String(error)}\n`);
        throw error;
      }
    },
  });
}
