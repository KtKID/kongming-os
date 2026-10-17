/** 移动任务的唯一协议源：定义状态、原因和控制报文，并由脚本生成网关与 ArkTS 表示。 */
import { z } from "zod";

export const MobileCapabilitiesSchema = z.object({
  kmhTaskControlVersion: z.literal(1),
  kmhSessionObservationVersion: z.literal(1).optional(),
});

/** SDK 握手中的自有能力字段；各端从此定义读取版本校验。 */
export const SdkCapabilitiesSchema = z.object({
  kmhTaskControl: z.object({ version: z.literal(1) }),
  kmhSessionObservation: z.object({ version: z.literal(1) }),
});
export type SdkCapabilities = z.infer<typeof SdkCapabilitiesSchema>;

export const AgentStatusSchema = z
  .enum(["idle", "running", "suspended"])
  .describe("KMH 生命周期；feat01 场景3—7");
export const SessionStateSchema = z
  .union([AgentStatusSchema, z.literal("unavailable")])
  .describe("会话观察结果；feat03 场景3—5");
export const AbortCauseSchema = z
  .enum(["user", "parent", "hook", "disposed", "unspecified"])
  .describe("用户、父任务、规则、释放及缺失原因；feat02 场景2");
export const AnswerAvailabilitySchema = z
  .enum(["complete", "partial", "temporarily-unavailable", "unavailable"])
  .describe("正文可用性；feat03 场景6");
export const A2aTaskStateSchema = z
  .enum([
    "working",
    "input-required",
    "completed",
    "failed",
    "canceled",
    "rejected",
    "auth-required",
  ])
  .describe("现有 A2A 七值任务状态；feat02、feat04");
export const TaskCodeSchema = z
  .enum([
    "TASK_ABORTED_USER",
    "TASK_ABORTED_PARENT",
    "TASK_ABORTED_RULE",
    "TASK_ABORTED_RELEASED",
    "TASK_ABORTED_UNSPECIFIED",
    "TASK_BLOCKED",
    "TASK_OUTPUT_LIMIT",
    "TASK_EXECUTION_ERROR",
    "TASK_INTERRUPTED",
    "TASK_HISTORY_FORKED",
    "TASK_REASON_UNKNOWN",
    "TASK_EMPTY_RESULT",
    "TASK_SUSPENDED",
    "TASK_RESUME_FAILED",
    "TASK_RECEIVE_FAILED",
    "TASK_STATUS_UNAVAILABLE",
    "TASK_STATUS_UNKNOWN",
    "TASK_RESULT_UNAVAILABLE",
    "TASK_STOP_FAILED",
    "TASK_CONTROL_UNAVAILABLE",
    "TASK_BUSY",
    "TASK_PROTOCOL_ERROR",
  ])
  .describe("原因分类码；feat01—feat04、C3、C8");
export const TaskOutcomeSchema = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("pending") }),
    z.object({ kind: z.literal("completed") }),
    z.object({ kind: z.literal("aborted"), cause: AbortCauseSchema }),
    z.object({ kind: z.literal("blocked") }),
    z.object({ kind: z.literal("error") }),
    z.object({ kind: z.literal("max-tokens") }),
    z.object({ kind: z.literal("interrupted") }),
    z.object({ kind: z.literal("forked") }),
    z.object({
      kind: z.literal("unknown"),
      endConfirmed: z.boolean(),
      sourceReason: z.string().optional(),
    }),
  ])
  .describe("任务结果及明确/未知结束；feat02 场景1—5、feat03 场景5");
export const TaskDetailSchema = z
  .object({
    code: TaskCodeSchema,
    message: z.string(),
    sourceCode: z.union([z.string(), z.number()]).optional(),
    sourceReason: z.string().optional(),
    abortCause: AbortCauseSchema.optional(),
  })
  .describe("可展示的分类码、来源码与说明；C3、spec R2");
/** 当前会话事实与原任务结果分别归属；状态缺项保留可用性含义。 */
export const SessionObservationSchema = z.object({
  kind: z.literal("session-observation"),
  version: z.literal(1),
  contextId: z.string().min(1),
  epoch: z.string().min(1),
  revision: z.number().int().nonnegative(),
  agentAvailable: z.boolean(),
  status: AgentStatusSchema.optional(),
  executionRef: z.string().min(1).optional(),
  activeTaskId: z.string().min(1).optional(),
  submissionPending: z.boolean(),
  detail: TaskDetailSchema.optional(),
});
export const SessionQuerySchema = z.object({
  contextId: z.string().min(1),
  sessionId: z.string().min(1),
  prepare: z.boolean().optional(),
});
export const SessionControlSchema = SessionQuerySchema.extend({
  operationId: z.string().min(1),
  expectedExecutionRef: z.string().min(1),
});
export const SessionStatusNotificationSchema = z.object({
  sessionId: z.string().min(1),
  observation: SessionObservationSchema,
});
export const WireSessionQueryRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.literal("sessions/status"),
  params: SessionQuerySchema.omit({ sessionId: true }),
});
export const WireSessionControlRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.enum(["sessions/cancel", "sessions/resume"]),
  params: SessionControlSchema.omit({ sessionId: true }),
});
/** 运行参数的结构从同一源生成；默认值仅在客户端资源维护。 */
export const RuntimeSettingsSchema = z.object({
  kmhStatusPollIntervalMs: z.number().int().positive(),
  httpConnectTimeoutMs: z.number().int().positive(),
  streamReadTimeoutMs: z.number().int().positive(),
  controlReadTimeoutMs: z.number().int().positive(),
  probeConnectTimeoutMs: z.number().int().positive(),
  probeReadTimeoutMs: z.number().int().positive(),
});
export const RuntimeOverridesSchema = RuntimeSettingsSchema.partial();
export const TaskIdentitySchema = z.object({
  taskId: z.string().min(1),
  contextId: z.string().min(1),
});
export const TaskStateDataSchema = TaskIdentitySchema.extend({
  version: z.literal(1),
  epoch: z.string().min(1),
  revision: z.number().int().nonnegative(),
  outcome: TaskOutcomeSchema,
  sessionState: SessionStateSchema,
  executionStopped: z.union([z.boolean(), z.null()]),
  detail: TaskDetailSchema.optional(),
  contentCursor: z.number().int().min(-1),
  answer: z.string().optional(),
  reasoning: z.string().optional(),
  answerAvailability: AnswerAvailabilitySchema.optional(),
}).describe("同一任务的权威状态；SSE、查询与取消回执共用；C5、C7");
export const TaskSnapshotSchema = TaskStateDataSchema.extend({
  answer: z.string(),
  reasoning: z.string(),
  answerAvailability: AnswerAvailabilitySchema,
}).describe("原任务的完整查询快照；feat03 场景1—7");
export const TaskQuerySchema = TaskIdentitySchema.extend({
  sessionId: z.string().min(1),
  afterCursor: z.number().int().min(-1).optional(),
});
export const TaskControlSchema = TaskQuerySchema.extend({
  operationId: z.string().min(1),
});
export const SessionControlResultSchema = z.object({
  kind: z.literal("session-control"),
  operationId: z.string().min(1),
  operation: z.enum(["cancel", "resume"]),
  outcome: z.enum(["accepted", "completed", "failed", "target-changed"]),
  observation: SessionObservationSchema,
  task: TaskSnapshotSchema.optional(),
  detail: TaskDetailSchema.optional(),
});
export const TaskBindingSchema = TaskIdentitySchema.extend({
  version: z.literal(1),
  internalSessionId: z.string().min(1),
  messageId: z.string().min(1),
  beforeSeq: z.number().int().min(-1),
  turn: z.number().int().nonnegative().optional(),
  admission: z.enum(["intent", "accepted"]),
  stoppedBeforeTurn: z.literal(true).optional(),
  createdAt: z.number().int().nonnegative(),
}).describe("薄索引只保留定位及接纳阶段；D02");
export const RawTurnReasonSchema = z
  .object({
    kind: z.string(),
    reason: z
      .object({ kind: z.string().optional(), reason: z.string().optional() })
      .optional(),
    error: z
      .object({
        code: z.union([z.string(), z.number()]).optional(),
        message: z.string().optional(),
      })
      .optional(),
  })
  .describe("原始结束原因的保留边界；feat02 场景2—4");
const WirePartSchema = z.object({
  kind: z.string(),
  text: z.string().optional(),
  reasoningText: z.string().optional(),
});
const WireMessageSchema = z.object({
  parts: z.array(WirePartSchema).optional(),
});
export const WireTaskStatusSchema = z.object({
  state: A2aTaskStateSchema,
  message: WireMessageSchema.optional(),
});
const WireMetadataSchema = z.object({
  kmh: TaskStateDataSchema.optional(),
  kmhSession: SessionObservationSchema.optional(),
});
export const WireStatusUpdateSchema = z.object({
  kind: z.literal("status-update"),
  taskId: z.string().min(1),
  contextId: z.string().min(1),
  status: WireTaskStatusSchema,
  final: z.boolean(),
  metadata: WireMetadataSchema.optional(),
});
export const WireArtifactUpdateSchema = z.object({
  kind: z.literal("artifact-update"),
  taskId: z.string().min(1),
  contextId: z.string().min(1),
  append: z.boolean().optional(),
  lastChunk: z.boolean(),
  artifact: z.object({
    artifactId: z.string(),
    parts: z.array(WirePartSchema),
  }),
  metadata: WireMetadataSchema.optional(),
});
export const WireApprovalRequestSchema = z.object({
  kind: z.literal("approval-request"),
  taskId: z.string().min(1),
  contextId: z.string().min(1),
  approvalId: z.string(),
  toolName: z.string().optional(),
  reason: z.string().optional(),
});
export const WireTaskSchema = z.object({
  kind: z.literal("task"),
  id: z.string(),
  contextId: z.string(),
  status: WireTaskStatusSchema,
  metadata: WireMetadataSchema.optional(),
});
/** 手机控制请求共用参数；操作标识用于停止/继续去重，查询保留原任务。 */
export const WireTaskActionParamsSchema = z.object({
  id: z.string().min(1),
  contextId: z.string().min(1),
  operationId: z.string().min(1).optional(),
  afterCursor: z.number().int().min(-1).optional(),
  kmhSessionObservationVersion: z.literal(1).optional(),
});
export const WireTaskActionRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string(),
  method: z.enum([
    "tasks/get",
    "tasks/resubscribe",
    "tasks/cancel",
    "tasks/resume",
  ]),
  params: WireTaskActionParamsSchema,
});
export const WireRpcErrorSchema = z.union([
  z.string(),
  z.object({
    code: z.union([z.string(), z.number()]).optional(),
    message: z.string().optional(),
  }),
]);
export const WireFrameSchema = z
  .object({
    jsonrpc: z.literal("2.0"),
    id: z.union([z.string(), z.number(), z.null()]).optional(),
    result: z
      .union([
        WireStatusUpdateSchema,
        WireArtifactUpdateSchema,
        WireApprovalRequestSchema,
        WireTaskSchema,
        SessionObservationSchema,
        SessionControlResultSchema,
      ])
      .optional(),
    error: WireRpcErrorSchema.optional(),
  })
  .describe("客户端收包的状态边界；缺失状态明确失败，C8 / T22");

export type SessionObservation = z.infer<typeof SessionObservationSchema>;
export type SessionQuery = z.infer<typeof SessionQuerySchema>;
export type SessionControl = z.infer<typeof SessionControlSchema>;
export type SessionControlResult = z.infer<typeof SessionControlResultSchema>;
export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;
export type TaskOutcome = z.infer<typeof TaskOutcomeSchema>;
export type TaskDetail = z.infer<typeof TaskDetailSchema>;
export type TaskIdentity = z.infer<typeof TaskIdentitySchema>;
export type TaskStateData = z.infer<typeof TaskStateDataSchema>;
export type TaskSnapshot = z.infer<typeof TaskSnapshotSchema>;
export type TaskBinding = z.infer<typeof TaskBindingSchema>;
export type TaskQuery = z.infer<typeof TaskQuerySchema>;
export type TaskControl = z.infer<typeof TaskControlSchema>;
export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type TaskCode = z.infer<typeof TaskCodeSchema>;
export type A2aTaskState = z.infer<typeof A2aTaskStateSchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type TaskProjection = { outcome: TaskOutcome; detail?: TaskDetail };

/** 删除来源说明中的凭据值；正文由既有正文通道处理。 */
export function redactTaskMessage(message: string): string {
  return message
    .replace(
      /((?:["'])(?:api[_-]?key|token|secret|password|authorization)(?:["'])\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi,
      '$1"[已隐藏]"',
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+/gi, "$1[已隐藏]")
    .replace(
      /((?:api[_-]?key|token|secret|password|authorization)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[已隐藏]",
    );
}

/** 保留观察/控制异常已有的来源码和说明，并复用同一凭据保护。 */
export function taskFailureDetail(
  code: TaskCode,
  error: unknown,
  fallback: string,
): TaskDetail {
  const parsed = WireRpcErrorSchema.safeParse(error);
  const source =
    parsed.success && typeof parsed.data !== "string" ? parsed.data : undefined;
  return {
    code,
    message: redactTaskMessage(
      parsed.success && typeof parsed.data === "string"
        ? parsed.data
        : (source?.message ?? fallback),
    ),
    ...(source?.code === undefined
      ? {}
      : {
          sourceCode:
            typeof source.code === "string"
              ? redactTaskMessage(source.code)
              : source.code,
        }),
  };
}

/** 原因只映射一次：保留具体来源，未知结束单独表示已经结束的事实。 */
export function projectTurnReason(input: unknown): TaskProjection {
  const parsed = RawTurnReasonSchema.safeParse(input);
  if (!parsed.success)
    return {
      outcome: { kind: "unknown", endConfirmed: true },
      detail: {
        code: "TASK_REASON_UNKNOWN",
        message: "任务已结束，来源原因格式无法识别",
      },
    };
  const reason = parsed.data;
  switch (reason.kind) {
    case "completed":
      return { outcome: { kind: "completed" } };
    case "aborted": {
      const p = AbortCauseSchema.safeParse(reason.reason?.kind);
      const cause = p.success ? p.data : "unspecified";
      const rows: Record<
        z.infer<typeof AbortCauseSchema>,
        { code: TaskCode; message: string }
      > = {
        user: { code: "TASK_ABORTED_USER", message: "用户中止了当前处理" },
        parent: {
          code: "TASK_ABORTED_PARENT",
          message: "上级任务中止了当前处理",
        },
        hook: { code: "TASK_ABORTED_RULE", message: "执行规则中止了当前处理" },
        disposed: {
          code: "TASK_ABORTED_RELEASED",
          message: "执行环境释放，当前处理已中止",
        },
        unspecified: {
          code: "TASK_ABORTED_UNSPECIFIED",
          message: "当前处理已中止，来源未提供可识别的细分原因",
        },
      };
      const row = rows[cause];
      return {
        outcome: { kind: "aborted", cause },
        detail: {
          ...row,
          abortCause: cause,
          ...(reason.reason?.kind === undefined
            ? {}
            : { sourceReason: redactTaskMessage(reason.reason.kind) }),
          message: redactTaskMessage(
            reason.reason?.reason
              ? `${row.message}：${reason.reason.reason}`
              : row.message,
          ),
        },
      };
    }
    case "error":
      return {
        outcome: { kind: "error" },
        detail: {
          code: "TASK_EXECUTION_ERROR",
          message: redactTaskMessage(
            reason.error?.message ?? "处理出错，来源未提供说明",
          ),
          ...(reason.error?.code === undefined
            ? {}
            : {
                sourceCode:
                  typeof reason.error.code === "string"
                    ? redactTaskMessage(reason.error.code)
                    : reason.error.code,
              }),
        },
      };
    case "blocked":
      return {
        outcome: { kind: "blocked" },
        detail: {
          code: "TASK_BLOCKED",
          message: "执行前检查受阻，来源未提供补充说明",
        },
      };
    case "max-tokens":
      return {
        outcome: { kind: "max-tokens" },
        detail: {
          code: "TASK_OUTPUT_LIMIT",
          message: "回答达到输出长度上限，已有内容已保留",
        },
      };
    case "interrupted":
      return {
        outcome: { kind: "interrupted" },
        detail: {
          code: "TASK_INTERRUPTED",
          message: "上次处理异常中断，已有内容已保留",
        },
      };
    case "forked":
      return {
        outcome: { kind: "forked" },
        detail: {
          code: "TASK_HISTORY_FORKED",
          message: "这条历史记录位于会话分叉边界",
        },
      };
    default:
      return {
        outcome: {
          kind: "unknown",
          endConfirmed: true,
          sourceReason: redactTaskMessage(reason.kind),
        },
        detail: {
          code: "TASK_REASON_UNKNOWN",
          ...(reason.error?.code === undefined
            ? {}
            : {
                sourceCode:
                  typeof reason.error.code === "string"
                    ? redactTaskMessage(reason.error.code)
                    : reason.error.code,
              }),
          sourceReason: redactTaskMessage(reason.kind),
          message: `任务已结束，来源原因：${redactTaskMessage(reason.kind)}${reason.reason?.reason || reason.error?.message ? "：" + redactTaskMessage(reason.reason?.reason ?? reason.error?.message ?? "") : ""}`,
        },
      };
  }
}

/** 将业务结果映射到既有 A2A 七值；细分信息由同一任务状态携带。 */
export function a2aStateForOutcome(outcome: TaskOutcome): A2aTaskState {
  switch (outcome.kind) {
    case "pending":
      return "working";
    case "completed":
      return "completed";
    case "aborted":
      return "canceled";
    case "unknown":
      return outcome.endConfirmed ? "failed" : "working";
    case "blocked":
    case "error":
    case "max-tokens":
    case "interrupted":
    case "forked":
      return "failed";
  }
}

/** 供生成器读取的公开定义；值域、类型和校验产物均从这些 schema 导出。 */
export const taskContracts = {
  MobileCapabilities: MobileCapabilitiesSchema,
  SdkCapabilities: SdkCapabilitiesSchema,
  SessionObservation: SessionObservationSchema,
  SessionQuery: SessionQuerySchema,
  SessionControl: SessionControlSchema,
  SessionControlResult: SessionControlResultSchema,
  SessionStatusNotification: SessionStatusNotificationSchema,
  WireSessionQueryRequest: WireSessionQueryRequestSchema,
  WireSessionControlRequest: WireSessionControlRequestSchema,
  RuntimeSettings: RuntimeSettingsSchema,
  RuntimeOverrides: RuntimeOverridesSchema,
  AgentStatus: AgentStatusSchema,
  SessionState: SessionStateSchema,
  AbortCause: AbortCauseSchema,
  AnswerAvailability: AnswerAvailabilitySchema,
  A2aTaskState: A2aTaskStateSchema,
  TaskCode: TaskCodeSchema,
  TaskOutcome: TaskOutcomeSchema,
  TaskDetail: TaskDetailSchema,
  TaskIdentity: TaskIdentitySchema,
  TaskStateData: TaskStateDataSchema,
  TaskSnapshot: TaskSnapshotSchema,
  TaskQuery: TaskQuerySchema,
  TaskControl: TaskControlSchema,
  TaskBinding: TaskBindingSchema,
  RawTurnReason: RawTurnReasonSchema,
  WireTaskStatus: WireTaskStatusSchema,
  WireStatusUpdate: WireStatusUpdateSchema,
  WireArtifactUpdate: WireArtifactUpdateSchema,
  WireApprovalRequest: WireApprovalRequestSchema,
  WireTask: WireTaskSchema,
  WireRpcError: WireRpcErrorSchema,
  WireTaskActionParams: WireTaskActionParamsSchema,
  WireTaskActionRequest: WireTaskActionRequestSchema,
  WireFrame: WireFrameSchema,
};
