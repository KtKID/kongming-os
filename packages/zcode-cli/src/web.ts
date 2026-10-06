/** Authenticated local account HTTP API. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import { z } from "zod";
import type { ZcodeCli } from "./runtime.ts";

const cancelBody = z.object({ attemptId: z.string().uuid() }).strict();
/**
 * Dispatch account actions through an already authenticated connection carrier.
 * @param runtime - Owner of native login and model processes.
 * @param action - Registered operation.
 * @param request - Authenticated HTTP request.
 * @returns Credential-free JSON result with cache disabled.
 */
export async function accountResponse(
  runtime: ZcodeCli,
  action: "status" | "login" | "cancel" | "logout" | "check" | "requests",
  request: Request,
): Promise<Response> {
  try {
    switch (action) {
      case "status":
        break;
      case "login":
        await runtime.login();
        break;
      case "cancel":
        await runtime.cancel(cancelBody.parse(await request.json()).attemptId);
        break;
      case "logout":
        await runtime.logout();
        break;
      case "check":
        await runtime.check();
        break;
      case "requests":
        // 按请求的状态快照：含阶段、尝试次数与慢请求位，供会话视图轮询。
        return Response.json(
          { requests: runtime.requests() },
          { headers: { "Cache-Control": "no-store" } },
        );
    }
    return Response.json(await runtime.status(), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const code =
      error instanceof Error && /^ZCODE_[A-Z_]+$/.test(error.message)
        ? error.message
        : "ZCODE_ACTION_FAILED";
    return Response.json(
      { error: code },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
/** Mount authenticated account API routes for the Plugins UI. @param ctx - Web services owner. @param runtime - CLI account service. */
export function mountWeb(ctx: Context, runtime: ZcodeCli): void {
  for (const action of [
    "status",
    "login",
    "cancel",
    "logout",
    "check",
    "requests",
  ] as const) {
    ctx.connection.fetch.register({
      path: `/api/zcode-cli/${action}`,
      // status 与 requests 均为无副作用查询，走 GET；动作类走 POST。
      methods: [action === "status" || action === "requests" ? "GET" : "POST"],
      requestBody: "buffered",
      fetch: (request) => accountResponse(runtime, action, request),
    });
  }
}
