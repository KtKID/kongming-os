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
  accountRead: "account/read",
  accountRateLimitsRead: "account/rateLimits/read",
} as const;

/** 官方 0.162 v2 生成协议的本功能消费字段；分区校验使合法周期独立保留。 */
export const QuotaAccountResult = z.object({
  account: z
    .discriminatedUnion("type", [
      z.object({
        type: z.literal("chatgpt"),
        email: z.string().nullable(),
        planType: z.string(),
      }),
      z.object({ type: z.literal("apiKey") }),
      z.object({
        type: z.literal("amazonBedrock"),
        usesCodexManagedCredentials: z.boolean(),
      }),
    ])
    .nullable(),
});
export const NativeQuotaWindow = z.object({
  usedPercent: z.number().min(0).max(100),
  windowDurationMins: z.number().int().positive().nullable(),
  resetsAt: z.number().int().nonnegative().max(8640000000000).nullable(),
});
export const NativeCredits = z.object({
  hasCredits: z.boolean(),
  unlimited: z.boolean(),
  balance: z.string().nullable(),
});
export const NativeSpendLimit = z.object({
  limit: z.string(),
  used: z.string(),
  remainingPercent: z.number().min(0).max(100),
  resetsAt: z.number().int().nonnegative().max(8640000000000),
});
export const NativeResetCredits = z.object({
  availableCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  credits: z
    .array(
      z.object({
        id: z.string(),
        title: z.string().nullable(),
        description: z.string().nullable(),
        resetType: z.string(),
        status: z.string(),
        grantedAt: z.number().int().nonnegative(),
        expiresAt: z.number().int().nonnegative().max(8640000000000).nullable(),
      }),
    )
    .nullable(),
});
export const NativeQuotaSnapshot = z.object({
  limitId: z.string().nullable().optional(),
  limitName: z.string().nullable().optional(),
  primary: z.unknown().optional(),
  secondary: z.unknown().optional(),
  credits: z.unknown().optional(),
  individualLimit: z.unknown().optional(),
});
export const NativeQuotaResult = z.object({
  rateLimits: z.unknown(),
  rateLimitsByLimitId: z.record(z.string(), z.unknown()).nullable().optional(),
  rateLimitResetCredits: z.unknown().optional(),
  accountId: z.string().nullable().optional(),
});
/** 服务端请求与通知的方法名。 */
export const Incoming = {
  itemToolCall: "item/tool/call",
  itemDynamicToolCall: "item/dynamicTool/call",
  itemCommandExecutionRequestApproval: "item/commandExecution/requestApproval",
  itemFileChangeRequestApproval: "item/fileChange/requestApproval",
  itemPermissionsRequestApproval: "item/permissions/requestApproval",
  itemToolRequestUserInput: "item/tool/requestUserInput",
  mcpServerElicitationRequest: "mcpServer/elicitation/request",
  turnStarted: "turn/started",
  turnCompleted: "turn/completed",
  itemStarted: "item/started",
  itemCompleted: "item/completed",
  commandExecutionOutputDelta: "item/commandExecution/outputDelta",
  mcpToolCallProgress: "item/mcpToolCall/progress",
  turnDiffUpdated: "turn/diff/updated",
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
    // 推理等级原值：wire 键为 supportedReasoningEfforts，值为
    // {reasoningEffort, description} 对象数组，以 unknown 接住由调用方归一；
    // 缺失表示该模型不支持调节。
    supportedReasoningEfforts: z.array(z.unknown()).optional(),
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
  experimentalRawEvents: z.boolean().optional(),
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
  model: z.string().optional(),
  effort: z.string().optional(),
  summary: z.enum(["auto", "concise", "detailed", "none"]).optional(),
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
/** item/completed 的生图项（app-server ThreadItem::ImageGeneration 的 wire 形态）。 */
export const ImageGenerationItemParams = z
  .object({
    type: z.literal("imageGeneration"),
    id: z.string().min(1),
    status: z.string(),
    revisedPrompt: z.string().nullable().optional(),
    savedPath: z.string().optional(),
  })
  .passthrough();

/** 生图项的可投影产物：项 id、落盘路径与展示名。 */
export interface ImageProjection {
  id: string;
  path: string;
  name: string | undefined;
}

/**
 * 从 item/completed 的生图项提取可投影产物。
 * @param item - ThreadItem::ImageGeneration 的原始对象。
 * @returns 已完成且已落盘时返回 id、路径与展示名；否则 undefined（不构成错误）。
 */
export function imageProjectionOf(item: unknown): ImageProjection | undefined {
  const parsed = ImageGenerationItemParams.safeParse(item);
  if (!parsed.success) return undefined;
  const { id, status, revisedPrompt, savedPath } = parsed.data;
  if (status !== "completed" || savedPath === undefined) return undefined;
  const prompt = revisedPrompt?.trim();
  return {
    id,
    path: savedPath,
    name:
      prompt === undefined || prompt === "" ? undefined : prompt.slice(0, 60),
  };
}

/** app-server ThreadItem::Reasoning 的可见文本；摘要与原始内容均为字符串数组。 */
export const ReasoningItemContent = z.object({
  summary: z.array(z.string()).default([]),
  content: z.array(z.string()).default([]),
});

/**
 * 从 app-server 完成项提取摘要，摘要为空时读取原始内容。
 * @param item - item/completed 的 reasoning 对象。
 * @returns 非空文本；两个数组皆空时返回 undefined。
 * @throws ZodError 文本数组包含非法元素。
 */
export function reasoningItemText(item: unknown): string | undefined {
  const parsed = ReasoningItemContent.parse(item);
  const summaryTexts = parsed.summary.filter((text) => text !== "");
  if (summaryTexts.length > 0) return summaryTexts.join("\n\n");
  const contentTexts = parsed.content.filter((text) => text !== "");
  return contentTexts.length > 0 ? contentTexts.join("") : undefined;
}

/** item/started、item/completed 通知参数：item 形态留由消费方判别。 */
export const ItemEventParams = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().optional(),
    item: z.unknown(),
  })
  .passthrough();
/** item/commandExecution/outputDelta 通知参数（feat08）。 */
export const CommandExecutionOutputDeltaParams = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  itemId: z.string().min(1),
  delta: z.string(),
});
/** item/mcpToolCall/progress 通知参数。 */
export const McpToolCallProgressParams = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  itemId: z.string().min(1),
  message: z.string(),
});
/** turn/diff/updated 通知参数。 */
export const TurnDiffUpdatedParams = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  diff: z.string(),
});

/** 审批类服务端请求的公共定位字段。 */
const approvalLocator = {
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  itemId: z.string().min(1),
} as const;
/** item/commandExecution/requestApproval 请求参数（0.160.0 生成 schema 收敛）。 */
export const CommandExecutionRequestApprovalParams = z
  .object({
    ...approvalLocator,
    startedAtMs: z.number(),
    kind: z.string().optional(),
    approvalId: z.string().nullable().optional(),
    reason: z.string().nullable().optional(),
    command: z.string().nullable().optional(),
    cwd: z.string().nullable().optional(),
  })
  .passthrough();
/** 桥发出的命令审批决定值（枚举全集见 decisions D18，桥只发三种）。 */
export const CommandExecutionRequestApprovalResponse = z.object({
  decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
});
/** item/fileChange/requestApproval 请求参数。 */
export const FileChangeRequestApprovalParams = z
  .object({
    ...approvalLocator,
    startedAtMs: z.number(),
    reason: z.string().nullable().optional(),
    grantRoot: z.string().nullable().optional(),
  })
  .passthrough();
export const FileChangeRequestApprovalResponse = z.object({
  decision: z.enum(["accept", "acceptForSession", "decline", "cancel"]),
});
/** item/permissions/requestApproval 请求参数（授权范围原样透传给用户审阅）。 */
export const PermissionsRequestApprovalParams = z
  .object({
    ...approvalLocator,
    startedAtMs: z.number(),
    cwd: z.string(),
    reason: z.string().nullable().optional(),
    permissions: z.unknown(),
  })
  .passthrough();
/** 权限审批回执：批准=请求声明的范围、scope 取 turn；拒绝=空授权。 */
export const PermissionsRequestApprovalResponse = z.object({
  permissions: z.record(z.string(), z.unknown()),
  scope: z.enum(["turn", "session"]),
});
/** item/tool/requestUserInput 请求参数（EXPERIMENTAL）。 */
export const ToolRequestUserInputParams = z
  .object({
    ...approvalLocator,
    isBlocking: z.boolean().optional(),
    questions: z.array(
      z
        .object({
          id: z.string().min(1),
          header: z.string(),
          question: z.string(),
          isOther: z.boolean().optional(),
          isSecret: z.boolean().optional(),
          options: z
            .array(
              z.object({
                label: z.string(),
                description: z.string().optional(),
              }),
            )
            .nullable()
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
/** 用户输入回执：问题 id → 答案串数组。 */
export const ToolRequestUserInputResponse = z.object({
  answers: z.record(z.string(), z.object({ answers: z.array(z.string()) })),
});
/** mcpServer/elicitation/request 请求参数（request 扁平字段按 mode 判别）。 */
export const McpServerElicitationRequestParams = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().nullable().optional(),
    serverName: z.string().min(1),
    mode: z.string().optional(),
    message: z.string().optional(),
    url: z.string().optional(),
    requestedSchema: z.unknown().optional(),
  })
  .passthrough();
/** elicitation 回执。 */
export const McpServerElicitationRequestResponse = z.object({
  action: z.enum(["accept", "decline", "cancel"]),
  content: z.unknown().optional(),
});

/** thread/compacted 通知参数：压缩后上下文全量回传的载体。 */
export const ThreadCompactedParams = z
  .object({
    threadId: z.string().min(1),
    // 0.160.0 实测字段留待桥接验证收敛，此处先保留原始对象。
  })
  .passthrough();
/** 单次上游响应/累计的用量明细（TokenUsageBreakdown，camelCase）。 */
export const TokenUsageBreakdownParams = z.object({
  totalTokens: z.number(),
  inputTokens: z.number(),
  cachedInputTokens: z.number(),
  cacheWriteInputTokens: z.number(),
  outputTokens: z.number(),
  reasoningOutputTokens: z.number(),
});
/** thread/tokenUsage/updated 通知参数（0.162 wire 实测：last=最近一次响应）。 */
export const TokenUsageParams = z
  .object({
    threadId: z.string().min(1),
    turnId: z.string().min(1),
    tokenUsage: z.object({
      total: TokenUsageBreakdownParams,
      last: TokenUsageBreakdownParams,
    }),
  })
  .passthrough();
/** account/updated 通知参数。 */
export const AccountUpdatedParams = z.object({}).passthrough();
/** 顶层 error 通知参数。 */
export const ErrorNotificationParams = z
  .object({
    message: z.string().optional(),
    error: z
      .object({
        message: z.string(),
        additionalDetails: z.string().nullish(),
      })
      .passthrough()
      .optional(),
    willRetry: z.boolean().optional(),
    turnId: z.string().optional(),
  })
  .passthrough();

/** 官方 thread/fork 的回合位置；两个切点字段互斥。 */
export const ThreadForkParams = z
  .object({
    threadId: z.string(),
    lastTurnId: z.string().optional(),
    beforeTurnId: z.string().optional(),
  })
  .refine(
    (value) =>
      value.lastTurnId === undefined || value.beforeTurnId === undefined,
    "fork positions are mutually exclusive",
  );
