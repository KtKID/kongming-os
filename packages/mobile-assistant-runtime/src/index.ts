/** 小艺专用 SDK transport：保留 DSH stdio 协议，添加助手 preset、历史恢复和审批应答。 */
import type { Context } from "@deepseek-ai/cordis";
import schema from "@deepseek-ai/schemastery";
import { z } from "zod";
import { carrierKeyOf } from "@deepseek-ai/dsh-scope";
import { JsonRpcLineTransport } from "@deepseek-ai/dsh-sdk-protocol";
import type {} from "@deepseek-ai/dsh-user-approval";
import {
  MobileAssistantServer,
  InitializeSchema,
  PromptSchema,
} from "./server.js";

export const name = "mobile-assistant-runtime";
export const inject = [
  "agents",
  "agentPresets",
  "sessionPersistence",
  "approval",
];

/** 移动助手使用的 preset；配置缺失时加载失败。 */
export const Config = schema.object({ preset: schema.string().required() });
const ApprovalResult = z.object({
  outcome: z.enum(["allowed-once", "rejected", "cancelled"]),
});

/** 装配 stdio SDK；shutdown 回执写完后等待根运行时退出，EOF 由 dsh 启动器处理。 */
export function apply(ctx: Context, config: { preset: string }): void {
  const transport = new JsonRpcLineTransport(process.stdin, process.stdout);
  const server = new MobileAssistantServer(ctx, transport, config.preset);
  let exitTask: Promise<void> | undefined;
  transport.onRequest(async (method, params) => {
    switch (method) {
      case "initialize":
        await ctx.get("loader")?.await();
        return server.initialize(InitializeSchema.parse(params));
      case "session/prompt":
        return server.prompt(PromptSchema.parse(params));
      case "shutdown": {
        const result = await server.shutdown();
        setImmediate(() => {
          exitTask ??= transport
            .flush()
            .then(() => ctx.root.fiber.dispose())
            .then(() => {
              process.exit(0);
            });
          exitTask.catch((error) => {
            ctx.logger.warn("移动助手 SDK 退出失败", error);
            process.exitCode = 1;
          });
        });
        return result;
      }
      default:
        throw new Error(`移动助手 SDK 未知方法：${method}`);
    }
  });
  ctx.on("approval/request", async function (req, next) {
    const agent = ctx.agents
      .list()
      .find((candidate) => candidate === carrierKeyOf(this));
    if (
      agent === undefined ||
      ctx.agentPresets.composedPreset(agent.ctx) !== config.preset
    )
      return next();
    try {
      const result = await transport.request("approval/ask", {
        sessionId: String(agent.session.id),
        toolName: req.toolName,
        ...(req.callId === undefined ? {} : { callId: String(req.callId) }),
        ...(req.reason === undefined ? {} : { reason: req.reason }),
      });
      return ApprovalResult.parse(result).outcome;
    } catch (error) {
      ctx.logger.warn("移动助手审批通道不可用", error);
      return "unavailable";
    }
  });
  ctx.effect(() => {
    transport.start();
    return async () => {
      transport.close();
      await server.shutdown();
    };
  }, "mobile-assistant.sdk");
}
