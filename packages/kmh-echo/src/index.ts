/** 将插件自身的生命周期阶段名字同步追加到本地文件。 */
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, isAbsolute } from "node:path";

/** Cordis 插件实例名称。 */
export const name = "kmh-echo";

/** 日志路径由部署配置提供，使用运行主机上的绝对路径。 */
export const Config = z.object({
  file: z
    .transform(z.string().required(), (value) => {
      if (!isAbsolute(value))
        throw new z.ValidationError("file 必须是绝对路径", { path: ["file"] });
      return value;
    })
    .required(),
});

/** 经过配置校验的日志路径。 */
export type Config = ReturnType<typeof Config>;

/**
 * 每次激活记录 apply 和 effect；更新记录 update，清理记录 unload。
 * 更新使用激活时的日志路径，重新激活后使用新路径。目录创建与写入错误向调用者传播。
 * @param ctx - 拥有监听与清理函数的插件上下文。
 * @param config - 经过 Config 校验的文件绝对路径。
 */
export function apply(ctx: Context, config: Config): void {
  mkdirSync(dirname(config.file), { recursive: true, mode: 0o700 });
  const echo = (event: "apply" | "effect" | "update" | "unload"): void => {
    appendFileSync(config.file, `${event}\n`, {
      encoding: "utf8",
      mode: 0o600,
      flush: true,
    });
  };

  echo("apply");
  ctx.effect(() => {
    echo("effect");
    const stop = ctx.on("internal/update", (_config, _noSave, next) => {
      echo("update");
      next();
    });
    return () => {
      stop();
      echo("unload");
    };
  }, "kmh-echo.lifecycle()");
}
