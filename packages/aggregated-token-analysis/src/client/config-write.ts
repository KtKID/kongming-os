/**
 * 经公开 settings Remote 保存本插件配置，将写入结果回填共享配置镜像。
 * 宿主拒绝时先读取当前值，再抛出宿主原文供配置页展示；恢复读取的失败单独记录。
 */
import type { Context } from "@deepseek-ai/cordis";
import type { SettingsFormScope } from "@deepseek-ai/dsh-client-ui-primitives";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type { TokenAnalysisSettings } from "./config-controller.ts";

type PathOp = Parameters<Context["remote"]["settings"]["mutate"]>[1][number];

/**
 * 构造本页的配置写入函数，保持表单的 revision 校验与共享镜像同步。
 * @param ctx - 已注入 remote、remote.settings 与 configForms 的浏览器插件上下文。
 * @param namespace - 本插件的配置条目 ID。
 * @returns 写入成功返回 true；宿主拒绝或传输失败时保留原文抛出。
 */
export function createConfigWriter(
  ctx: Context,
  namespace: string,
): SettingsFormScope<TokenAnalysisSettings>["mutate"] {
  const mirror = ctx.configForms.describe();
  return async (ops, revision) => {
    const changes = ops.map((op): PathOp => {
      if (op.op === "unset") return { op: op.op, path: [...op.path] };
      if (typeof op.value !== "string" && typeof op.value !== "number") {
        throw new Error(
          `Unexpected configuration value for ${op.path.join(".")}`,
        );
      }
      return { op: op.op, path: [...op.path], value: op.value };
    });
    const result = await ctx.remote.settings.mutate(
      namespace,
      changes,
      revision,
    );
    if (result.ok) {
      mirror.acceptView(result.value);
      return true;
    }
    // 保留写入错误为主错误；恢复读取只更新宿主状态，便于用户继续检查草稿。
    try {
      const current = await ctx.remote.settings.describe();
      if (current.ok) {
        const view = current.value.namespaces.find(
          (item) => item.ns === namespace,
        );
        if (view !== undefined) mirror.acceptView(view);
      } else {
        console.warn(current.error.message);
      }
    } catch (error) {
      console.warn(error);
    }
    throw new Error(result.error.message);
  };
}
