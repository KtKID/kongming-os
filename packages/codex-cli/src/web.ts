/** 详情页 HTTP API：账号操作、逐项选择与测试连接（经宿主 browser-auth 鉴权链）。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import { z } from "zod";
import type { CodexCli } from "./index.ts";
import { capabilityViews } from "./capabilities.ts";
import { probeConnection } from "./probe.ts";
import { checkVersion } from "./status.ts";

const configBody = z
  .object({
    selection: z
      .object({
        commandExecution: z.boolean(),
        fileChange: z.boolean(),
        viewImage: z.boolean(),
        webSearch: z.boolean(),
        skills: z.boolean(),
      })
      .strict(),
  })
  .strict();
const probeBody = z.object({ model: z.string().min(1) }).strict();
const noStore = { "Cache-Control": "no-store" } as const;

/**
 * 挂载 `/api/codex-cli/*` 路由到宿主连接通道。
 * @param ctx - Web 服务宿主上下文。
 * @param runtime - 插件运行时。
 */
export function mountWeb(ctx: Context, runtime: CodexCli): void {
  for (const action of [
    "status",
    "login",
    "cancel",
    "logout",
    "check",
  ] as const) {
    ctx.connection.fetch.register({
      path: `/api/codex-cli/${action}`,
      methods: [action === "status" ? "GET" : "POST"],
      requestBody: "buffered",
      fetch: async () =>
        Response.json(await dispatch(ctx, runtime, action), {
          headers: noStore,
        }),
    });
  }
  ctx.connection.fetch.register({
    path: "/api/codex-cli/config",
    methods: ["GET", "POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      if (request.method === "GET")
        return Response.json(
          { selection: runtime.settings.selection },
          { headers: noStore },
        );
      const body = configBody.parse(await request.json());
      // 立即保存显示；进行中的回合不受影响，下一回合按新选择启动。
      await runtime.saveSelection(body.selection);
      return Response.json(
        { selection: runtime.settings.selection },
        { headers: noStore },
      );
    },
  });
  ctx.connection.fetch.register({
    path: "/api/codex-cli/probe",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (request) => {
      const body = probeBody.parse(await request.json());
      const result = await probeConnection(
        ctx,
        runtime.config,
        body.model,
        runtime.settings.selection,
      );
      runtime.settings.lastProbe = {
        at: new Date().toISOString(),
        ...result,
      };
      return Response.json(result, { headers: noStore });
    },
  });
}
/** 动作分发；返回体不含任何凭据值。 */
async function dispatch(
  ctx: Context,
  runtime: CodexCli,
  action: "status" | "login" | "cancel" | "logout" | "check",
): Promise<Record<string, unknown>> {
  switch (action) {
    case "status": {
      const [account, version] = await Promise.all([
        runtime.account.status(),
        checkVersion(
          ctx,
          runtime.config,
          AbortSignal.timeout(runtime.config.probeTimeoutMs),
        ),
      ]);
      return {
        account,
        version,
        selection: runtime.settings.selection,
        // 能力列表与各项可用状态（场景6：版本等部署条件不可用时如实标注）。
        capabilities: capabilityViews(version),
        ...(runtime.settings.lastProbe === undefined
          ? {}
          : { lastProbe: runtime.settings.lastProbe }),
        defaultModel: runtime.settings.defaultModel,
      };
    }
    case "login":
      return { account: await runtime.account.login() };
    case "cancel":
      return { account: await runtime.account.cancel() };
    case "logout":
      return { account: await runtime.account.logout() };
    case "check":
      return {
        version: await checkVersion(
          ctx,
          runtime.config,
          AbortSignal.timeout(runtime.config.probeTimeoutMs),
        ),
      };
  }
}
