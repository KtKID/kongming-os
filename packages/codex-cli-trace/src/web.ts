/** 在既有认证通道内挂载只读 trace 查询。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-connection";
import { z } from "zod";
import {
  SessionRequestSchema,
  EntryRequestSchema,
  TimelineRequestSchema,
  ErrorSchema,
} from "./protocol.ts";
import { exportTrace } from "./export.ts";
import { TRACE_BASE } from "./paths.ts";
import { TraceReadError } from "./source.ts";
import type { TraceReader } from "./reader.ts";
const SnapshotRequest = SessionRequestSchema.extend({
  reload: z.enum(["0", "1"]).default("0"),
}).strict();
const reasons: Readonly<Record<string, string>> = {
  READ_CHANGED: "源记录发生变化，请重新读取",
  SOURCE_MISMATCH: "CLI 记录与当前会话不对应",
  SOURCE_AMBIGUOUS: "当前会话对应多份 CLI 文件",
  SOURCE_UNREADABLE: "CLI 记录暂时无法读取",
  BINDING_INVALID: "已有会话对应关系格式损坏",
  BINDING_UNREADABLE: "已有会话对应关系暂时无法读取",
  ENTRY_MISSING: "这条记录暂时无法读取",
  SOURCE_UNAVAILABLE: "当前会话暂无可导出记录",
};
export const noStore = { "Cache-Control": "no-store" };
/** 将边界错误映射为可展示说明，原始正文只从原文接口提供。 */
export function failure(error: unknown): Response {
  const code =
    error instanceof z.ZodError
      ? "INVALID_REQUEST"
      : error instanceof TraceReadError
        ? error.code
        : error instanceof Error && error.message.startsWith("BINDING_")
          ? error.message
          : "TRACE_FAILED";
  const status =
    error instanceof z.ZodError
      ? 400
      : error instanceof TraceReadError
        ? error.status
        : 503;
  return Response.json(
    ErrorSchema.parse({
      error: code,
      reason:
        reasons[code] ??
        (code === "INVALID_REQUEST"
          ? "查看参数无效"
          : "执行记录读取失败，请重试"),
    }),
    { status, headers: noStore },
  );
}
/** 路由持有者卸载时等待所有注册释放。 */
export function mountRoutes(
  ctx: Context,
  reader: TraceReader,
): () => Promise<void> {
  const disposers: Array<() => Promise<void>> = [];
  for (const action of ["snapshot", "timeline", "entry", "export"]) {
    disposers.push(
      ctx.connection.fetch.register({
        path: TRACE_BASE + "/" + action,
        methods: ["GET"],
        requestBody: "buffered",
        fetch: async (request) => {
          try {
            const input = Object.fromEntries(new URL(request.url).searchParams);
            let result: unknown;
            if (action === "export") {
              const q = SessionRequestSchema.parse(input);
              return await exportTrace(reader, q.sessionId, {
                signal: request.signal,
              });
            }
            if (action === "snapshot") {
              const q = SnapshotRequest.parse(input);
              result = await reader.snapshot(q.sessionId, {
                reload: q.reload === "1",
                signal: request.signal,
              });
            } else if (action === "timeline") {
              result = await reader.timeline(
                TimelineRequestSchema.parse(input),
                request.signal,
              );
            } else {
              const q = EntryRequestSchema.parse(input);
              result = await reader.entry(
                q.sessionId,
                q.readToken,
                q.entryId,
                request.signal,
              );
            }
            return Response.json(result, { headers: noStore });
          } catch (error) {
            return failure(error);
          }
        },
      }),
    );
  }
  return async () => {
    await Promise.all(disposers.map((dispose) => dispose()));
  };
}
