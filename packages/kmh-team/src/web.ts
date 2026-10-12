/** 团队 HTTP 入口全部复用 DSH 鉴权和连接路由。 */
import type { Context } from "@deepseek-ai/cordis";
import type { TeamRuntime } from "./index.ts";
import {
  CreateRoleSchema,
  CreateTeamSchema,
  TeamIdSchema,
  SaveConfigSchema,
  ConfigViewSchema,
  BootstrapSchema,
} from "./protocol/index.ts";
/** @param ctx - Web 宿主。 @param runtime - 插件实例。 */
export function mountWeb(ctx: Context, runtime: TeamRuntime): void {
  for (const action of [
    "bootstrap",
    "roles",
    "create",
    "view",
    "submit",
    "stop",
    "retry",
    "config",
    "watch",
  ] as const)
    ctx.connection.fetch.register({
      path: `/api/kmh-team/${action}`,
      methods: ["GET", "POST"],
      requestBody: "buffered",
      fetch: async (request) => {
        try {
          const url = new URL(request.url);
          const readRoom = async () =>
            runtime.load(TeamIdSchema.parse(url.searchParams.get("teamId")));
          switch (action) {
            case "bootstrap":
              return Response.json(
                BootstrapSchema.parse({
                  roles: runtime.roles.list(),
                  catalog: await ctx.sessionController.modelCatalog(),
                  cwd: process.cwd(),
                }),
                { headers: { "Cache-Control": "no-store" } },
              );
            case "roles":
              return Response.json(
                request.method === "GET"
                  ? runtime.roles.list()
                  : await runtime.roles.create(
                      CreateRoleSchema.parse(await request.json()),
                    ),
              );
            case "create":
              return Response.json(
                (
                  await runtime.create(
                    CreateTeamSchema.parse(await request.json()),
                  )
                ).view(),
              );
            case "view":
              return Response.json((await readRoom()).view(), {
                headers: { "Cache-Control": "no-store" },
              });
            case "submit":
              await runtime.submit(await request.json());
              return Response.json({ accepted: true });
            case "stop": {
              const room = await readRoom();
              runtime.executor.stop(room);
              return Response.json({
                accepted: true,
                working: room.view().working.length,
              });
            }
            case "retry": {
              const room = await readRoom();
              await room.retrySave();
              for (const submission of room.submissions)
                runtime.executor.schedule(room, submission);
              return Response.json(room.view());
            }
            case "config": {
              const descriptor = () => {
                const found = ctx.settings
                  .describe()
                  .find((d) => d.ns === "kmh-team");
                if (found === undefined) throw Error("settings-unavailable");
                return found;
              };
              if (request.method === "POST") {
                const value = SaveConfigSchema.parse(await request.json());
                await ctx.settings.update(
                  "kmh-team",
                  { contextMessageCount: value.contextMessageCount },
                  value.revision,
                );
              }
              return Response.json(
                ConfigViewSchema.parse({
                  contextMessageCount: runtime.config.contextMessageCount.get(),
                  memberMaxParallel: runtime.config.memberMaxParallel.get(),
                  revision: descriptor().revision,
                }),
              );
            }
            case "watch": {
              const room = await readRoom();
              const encoder = new TextEncoder();
              let release: (() => void) | undefined;
              let closed = false;
              let abort: (() => void) | undefined;
              const cleanup = () => {
                closed = true;
                release?.();
                if (abort !== undefined)
                  request.signal.removeEventListener("abort", abort);
              };
              const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                  const send = () => {
                    if (!closed)
                      controller.enqueue(
                        encoder.encode(JSON.stringify(room.view()) + "\n"),
                      );
                  };
                  abort = () => {
                    if (closed) return;
                    cleanup();
                    controller.close();
                  };
                  send();
                  release = room.subscribe(send);
                  if (request.signal.aborted) abort();
                  else
                    request.signal.addEventListener("abort", abort, {
                      once: true,
                    });
                },
                cancel: cleanup,
              });
              return new Response(stream, {
                headers: {
                  "Content-Type": "application/x-ndjson",
                  "Cache-Control": "no-store",
                },
              });
            }
          }
        } catch (error) {
          return Response.json(
            { code: "kmh-team-error", message: String(error) },
            { status: 400 },
          );
        }
      },
    });
}
