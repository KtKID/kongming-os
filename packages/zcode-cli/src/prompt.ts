/** Complete KMH agent identity, independent of the model transport. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-system-prompt";
import schema from "@deepseek-ai/schemastery";
/** Cordis prompt module identity. */
export const name = "kmh/zcode-cli/prompt";
/** Required prompt registry. */
export const inject = ["systemPrompt"];
/** Complete, configurable system prompt supplied and logged by KMH. */
export const Config = schema.object({
  text: schema
    .string()
    .default(
      "你是 kmh agent，底层是 zcode cli 里的模型。你的系统提示、工具、技能与任务执行由 KMH 管理。使用 KMH 提供的工具处理任务，并根据工具结果继续工作。当前提供 read 工具用于读取文件。准确说明已完成的工作与尚待验证的结果。",
    ),
});
/** Validated complete prompt settings. */
export type Config = ReturnType<typeof Config>;
/** Register the exact complete system prompt. @param ctx - Scoped prompt owner. @param config - Prompt text. */
export function apply(ctx: Context, config: Config): void {
  ctx.systemPrompt.section({
    name: "kmh-zcode-identity",
    order: 0,
    text: config.text,
    complete: true,
    interpolate: false,
  });
}
