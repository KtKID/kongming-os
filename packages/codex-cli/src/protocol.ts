/** Codex app-server 行协议的帧编码与 v2 方法、通知的输入输出类型。 */
import { z } from "zod";
import { Writable, type WritableOptions } from "node:stream";

/**
 * 官方 CLI 行协议不携带 `jsonrpc` 字段：发送方向经本 bridge 剥除后再写出。
 * @param output - 进程标准输入流。
 * @param options - 透传的 Writable 构造参数。
 * @returns 写入端接 JsonRpcLineTransport 的桥接流。
 */
export function createFrameBridge(
  output: Writable,
  options?: WritableOptions,
): Writable {
  return new Writable({
    ...options,
    write(chunk: Buffer, _encoding, callback) {
      let rest: Record<string, unknown>;
      try {
        const parsed: unknown = JSON.parse(chunk.toString("utf8"));
        if (typeof parsed !== "object" || parsed === null)
          throw new Error("CODEX_FRAME_INVALID");
        rest = {};
        for (const [key, value] of Object.entries(parsed))
          if (key !== "jsonrpc") rest[key] = value;
        output.write(JSON.stringify(rest) + "\n", callback);
      } catch (error) {
        callback(
          error instanceof Error ? error : new Error("CODEX_FRAME_INVALID"),
        );
      }
    },
  });
}

/** 从 unknown 对象安全取一个字段；无该字段或非对象时返回 undefined。 */
export function fieldOf(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  for (const [name, item] of Object.entries(value))
    if (name === key) return item;
  return undefined;
}
/** 浅拷贝 unknown 对象为可写字段表；非对象时抛错。 */
export function shallowCopy(
  value: unknown,
  code: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object") throw new Error(code);
  const copy: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) copy[key] = item;
  return copy;
}

/** 方法名常量：集中一处，避免字符串散落。 */
export const Method = {
  initialize: "initialize",
  modelList: "model/list",
  threadStart: "thread/start",
  threadResume: "thread/resume",
  turnStart: "turn/start",
  turnInterrupt: "turn/interrupt",
  accountLoginStart: "account/login/start",
  accountLoginCancel: "account/login/cancel",
  accountLogout: "account/logout",
  accountStatus: "account/status",
} as const;
/** 服务端请求与通知的方法名。 */
export const Incoming = {
  itemToolCall: "item/tool/call",
  itemDynamicToolCall: "item/dynamicTool/call",
  turnStarted: "turn/started",
  turnCompleted: "turn/completed",
  itemStarted: "item/started",
  itemCompleted: "item/completed",
  agentMessageDelta: "item/agentMessage/delta",
  reasoningTextDelta: "item/reasoning/textDelta",
  reasoningSummaryTextDelta: "item/reasoning/summaryTextDelta",
  threadCompacted: "thread/compacted",
  tokenUsageUpdated: "thread/tokenUsage/updated",
  accountUpdated: "account/updated",
  accountLoginCompleted: "account/login/completed",
  error: "error",
} as const;

const clientInfo = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  version: z.string().min(1),
});
/** initialize 请求参数。 */
export const InitializeParams = z.object({
  clientInfo,
  capabilities: z.object({ experimentalApi: z.boolean() }).passthrough(),
});
/** initialize 响应。 */
export const InitializeResult = z
  .object({
    userAgent: z.string().optional(),
    permissions: z.unknown().optional(),
  })
  .passthrough();

/** model/list 请求参数。 */
export const ModelListParams = z.object({ includeHidden: z.boolean() });
/** 模型目录条目（字段按 0.160.0 验证实测收敛，未知字段容忍）。 */
export const ModelEntry = z
  .object({
    id: z.string().min(1),
    displayName: z.string().optional(),
    // 推理等级为模型声明的可选值列表：wire 上是 {reasoningEffort, description}
    // 对象数组，兼容纯字符串形态；缺失表示该模型不支持调节。
    reasoningEfforts: z
      .array(
        z.union([
          z.string(),
          z.object({ reasoningEffort: z.string() }).passthrough(),
        ]),
      )
      .optional(),
    defaultReasoningEffort: z.string().optional(),
    supportsReasoningSummaries: z.boolean().optional(),
  })
  .passthrough();
/** model/list 响应。 */
export const ModelListResult = z.object({
  data: z.array(ModelEntry),
  nextPageCursor: z.string().optional(),
});

/** thread/start 的动态工具声明（单函数形态）。 */
export const DynamicToolSpec = z.object({
  name: z.string().min(1),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
  deferLoading: z.boolean().optional(),
});
/** KMH 工具的稳定挂载命名空间：thread 重建前后形态不变。 */
export const KMH_TOOL_NAMESPACE = "kmh";
/** namespace 形态的动态工具声明。 */
export const DynamicNamespaceSpec = z.object({
  type: z.literal("namespace"),
  name: z.literal(KMH_TOOL_NAMESPACE),
  description: z.string(),
  tools: z.array(DynamicToolSpec),
});
/** thread/start 请求参数。 */
export const ThreadStartParams = z.object({
  model: z.string().optional(),
  ephemeral: z.boolean().optional(),
  cwd: z.string().optional(),
  baseInstructions: z.string().optional(),
  developerInstructions: z.string().optional(),
  dynamicTools: z.array(DynamicToolSpec).optional(),
});
/** thread/start 与 thread/resume 的响应。 */
export const ThreadResult: z.ZodType<{ thread: { id: string } }> = z.object({
  thread: z.object({ id: z.string().min(1) }).passthrough(),
});

/** turn/start 的用户输入。 */
export const UserTextInput = z.object({
  type: z.literal("text"),
  text: z.string(),
});
/** turn/start 请求参数。 */
export const TurnStartParams = z.object({
  threadId: z.string().min(1),
  input: z.array(UserTextInput).min(1),
});
/** turn/start 响应。 */
export const TurnResult: z.ZodType<{ turn: { id: string } }> = z.object({
  turn: z.object({ id: z.string().min(1) }).passthrough(),
});
/** turn/interrupt 请求参数。 */
export const TurnInterruptParams = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
});

/** item/tool/call 服务端请求参数（动态工具执行请求）。 */
export const DynamicToolCallParams = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  callId: z.string().min(1),
  namespace: z.string().nullable().optional(),
  tool: z.string().min(1),
  arguments: z.unknown(),
});
/** item/tool/call 的回执内容项。 */
export const ToolCallContentItem = z.object({
  type: z.literal("inputText"),
  text: z.string(),
});
/** item/tool/call 回执。 */
export const DynamicToolCallResponse = z.object({
  success: z.boolean(),
  contentItems: z.array(ToolCallContentItem),
});

/** turn/completed 通知参数。 */
export const TurnCompletedParams = z.object({
  threadId: z.string().min(1),
  turn: z.object({ id: z.string().min(1), status: z.string() }).passthrough(),
});
/** item/agentMessage/delta 通知参数。 */
export const AgentMessageDeltaParams = z
  .object({
    threadId: z.string().min(1),
    itemId: z.string().min(1),
    delta: z.string(),
  })
  .passthrough();
/** item/reasoning/textDelta 通知参数。 */
export const ReasoningDeltaParams = z
  .object({
    threadId: z.string().min(1),
    itemId: z.string().min(1),
    delta: z.string(),
  })
  .passthrough();
/** item/started、item/completed 通知参数：item 形态留由消费方判别。 */
export const ItemEventParams = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().optional(),
    item: z.unknown(),
  })
  .passthrough();
/** thread/compacted 通知参数：压缩后上下文全量回传的载体。 */
export const ThreadCompactedParams = z
  .object({
    threadId: z.string().min(1),
    // 0.160.0 实测字段留待桥接验证收敛，此处先保留原始对象。
  })
  .passthrough();
/** thread/tokenUsage/updated 通知参数。 */
export const TokenUsageParams = z
  .object({
    threadId: z.string().min(1),
  })
  .passthrough();
/** account/updated 通知参数。 */
export const AccountUpdatedParams = z.object({}).passthrough();
/** 顶层 error 通知参数。 */
export const ErrorNotificationParams = z
  .object({
    message: z.string().optional(),
  })
  .passthrough();
