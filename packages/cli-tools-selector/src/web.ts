/** 详情页路由：GET 读清单（可 refresh）、POST 切换；状态码映射与契约校验。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import type {} from "@kmh/codex-cli";
import {
  ToolSwitchListSchema,
  ToolSwitchUpdateSchema,
} from "@kmh/codex-cli/tool-switches";
import { SWITCHES_PATH } from "./paths.ts";

export { SWITCHES_PATH };

const noStore = { "Cache-Control": "no-store" } as const;

function failure(status: number, error: string, reason?: string): Response {
  return Response.json(
    { error, ...(reason === undefined ? {} : { reason }) },
    { status, headers: noStore },
  );
}

/** 把 codex-cli 抛出的错误映射为状态码：修订号冲突 409、未知开关 400、其余 500。 */
function statusOf(error: unknown): { status: number; code: string } {
  if (error instanceof Error && error.name === "SettingsConflictError")
    return { status: 409, code: "SETTINGS_CONFLICT" };
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("CLI_TOOL_SWITCH_UNKNOWN"))
    return { status: 400, code: "CLI_TOOL_SWITCH_UNKNOWN" };
  return { status: 500, code: "CLI_TOOL_SWITCHES_FAILED" };
}

/**
 * 挂载开关读取与切换路由到宿主连接通道。
 * codex-cli 服务不存在时回 503，调用方据此显示失败与重试。
 * @param ctx - 提供 connection 服务的上下文。
 */
export function mountRoutes(ctx: Context): void {
  ctx.connection.fetch.register({
    path: SWITCHES_PATH,
    methods: ["GET", "POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      const codex = ctx.get("codexCli");
      if (codex === undefined) return failure(503, "CODEX_CLI_UNAVAILABLE");
      try {
        if (request.method === "GET") {
          const refresh =
            new URL(request.url).searchParams.get("refresh") === "1";
          const list = await codex.toolSwitches(request.signal, refresh);
          return Response.json(ToolSwitchListSchema.parse(list), {
            headers: noStore,
          });
        }
        const body = ToolSwitchUpdateSchema.safeParse(await request.json());
        if (!body.success)
          return failure(400, "INVALID_BODY", body.error.message);
        const list = await codex.setToolSwitch(body.data, request.signal);
        return Response.json(ToolSwitchListSchema.parse(list), {
          headers: noStore,
        });
      } catch (error) {
        const { status, code } = statusOf(error);
        return failure(
          status,
          code,
          error instanceof Error ? error.message : String(error),
        );
      }
    },
  });
}
