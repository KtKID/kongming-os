/** Credential-free account and model state shared by Host and Client. */
import { z } from "zod";
/** Browser-visible account and connection state. */
export const PublicStatus = z.object({
  login: z.enum([
    "idle",
    "starting",
    "waiting",
    "signed-in",
    "cancelled",
    "failed",
  ]),
  attemptId: z.string().optional(),
  authorizeUrl: z.string().url().optional(),
  connection: z.enum(["unchecked", "registered", "ready", "failed"]),
  model: z.string(),
  reasoning: z.string(),
  error: z.string().optional(),
  diagnostic: z
    .object({
      code: z.union([z.string(), z.number()]),
      message: z.string(),
    })
    .optional(),
  accountFamily: z.enum(["bigmodel", "zai"]).optional(),
  credentialSource: z.enum(["plugin", "desktop"]).optional(),
});
/** Safe state projected to the local authenticated Web page. */
export type PublicStatus = z.infer<typeof PublicStatus>;
/** 请求阶段：starting 覆盖准备与通道注册，waiting 覆盖模型等待（未知细分阶段同此）。 */
export const RequestStage = z.enum(["starting", "waiting"]);
export type RequestStage = z.infer<typeof RequestStage>;
/** 终止原因七类；首个生效者不再被后续事件覆盖。 */
export const TerminationCause = z.enum([
  "user-stop",
  "startup-timeout",
  "total-timeout",
  "provider-error",
  "channel-exit",
  "host-unload",
  "cleanup-failure",
]);
export type TerminationCause = z.infer<typeof TerminationCause>;
export const RequestOutcome = z.enum(["running", "succeeded", "failed"]);
export type RequestOutcome = z.infer<typeof RequestOutcome>;
/** Web 可见的请求状态；慢请求位由快照按阈值计算，不落盘存储。 */
export const RequestStatus = z.object({
  requestId: z.string(),
  sessionId: z.string().nullable(),
  stage: RequestStage,
  attempt: z.number().int().min(1),
  startedAt: z.number(),
  updatedAt: z.number(),
  /** 进入 waiting 的时刻；未进入过等待为 null，客户端据此计算已等待时长。 */
  waitingSince: z.number().nullable(),
  slow: z.boolean(),
  outcome: RequestOutcome,
  attemptFailures: z.array(
    z.object({
      attempt: z.number().int().min(1),
      cause: TerminationCause,
      detail: z.string().optional(),
    }),
  ),
  termination: z
    .object({
      cause: TerminationCause,
      at: z.number(),
      detail: z.string().optional(),
    })
    .optional(),
  cleanupResult: z
    .object({ ok: z.boolean(), detail: z.string().optional() })
    .optional(),
});
export type RequestStatus = z.infer<typeof RequestStatus>;
