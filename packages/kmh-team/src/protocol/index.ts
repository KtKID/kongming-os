/** 群聊请求、持久事件及客户端视图的唯一协议定义。 */
import type {} from "@deepseek-ai/dsh-session/types";
import type {} from "@deepseek-ai/dsh-session-projection/types";
import { z } from "zod";
import { brandString, type Branded } from "@deepseek-ai/dsh-brand";

export type RoleId = Branded<"kmh-role">;
export type TeamId = Branded<"kmh-team">;
export type TaskId = Branded<"kmh-task">;
export type RequestId = Branded<"kmh-request">;
export const RoleIdSchema = z.uuid().transform(brandString<RoleId>);
export const TeamIdSchema = z.uuid().transform(brandString<TeamId>);
export const TaskIdSchema = z.uuid().transform(brandString<TaskId>);
export const RequestIdSchema = z.uuid().transform(brandString<RequestId>);
const text = z.string().trim().min(1);
export const ModelSchema = z
  .object({ provider: text, model: text, reasoningEffort: text.optional() })
  .strict();
export const ActorSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("team-owner") }).strict(),
  z.object({ kind: z.literal("member"), roleId: RoleIdSchema }).strict(),
]);
export const RoleSchema = z
  .object({
    roleId: RoleIdSchema,
    name: text,
    instructions: text,
    createRequestId: RequestIdSchema,
  })
  .strict();
export const CreateRoleSchema = z
  .object({ requestId: RequestIdSchema, name: text, instructions: text })
  .strict();
export const CreateTeamSchema = z
  .object({
    requestId: RequestIdSchema,
    model: ModelSchema,
    memberRoleIds: z.array(RoleIdSchema),
    cwd: text,
    preset: text.optional(),
  })
  .strict();
export const MentionSchema = z
  .object({
    actor: ActorSchema,
    offset: z.int().min(0),
    length: z.int().min(1),
  })
  .strict();
export const SubmitSchema = z
  .object({
    teamId: TeamIdSchema,
    requestId: RequestIdSchema,
    body: text,
    mentions: z.array(MentionSchema),
  })
  .strict();
export const PublicMessageSchema = z
  .object({
    messageId: z.uuid(),
    publicSeq: z.int().min(1),
    sender: z.union([
      z.object({ kind: z.literal("user") }).strict(),
      ActorSchema,
    ]),
    body: z.string().min(1),
  })
  .strict();
export const SnapshotSchema = z
  .object({
    snapshotId: z.uuid(),
    contextMessageCount: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
    cutPublicSeq: z.int().min(1),
    messages: z.array(PublicMessageSchema),
  })
  .strict();
export const TaskSchema = z
  .object({
    taskId: TaskIdSchema,
    actor: ActorSchema,
    triggerMessageId: z.uuid(),
    snapshotId: z.uuid(),
  })
  .strict();
export const CreatedSchema = z
  .object({
    kind: z.literal("created"),
    version: z.literal(1),
    teamId: TeamIdSchema,
    createRequestId: RequestIdSchema,
    cwd: text,
    ownerPreset: text.optional(),
    model: ModelSchema,
    members: z.array(RoleSchema),
  })
  .strict();
export const SubmissionSchema = z
  .object({
    kind: z.literal("submission"),
    version: z.literal(1),
    requestId: RequestIdSchema,
    userMessage: PublicMessageSchema,
    snapshot: SnapshotSchema,
    tasks: z.array(TaskSchema),
  })
  .strict();
export const LinkedSchema = z
  .object({
    kind: z.literal("task-linked"),
    version: z.literal(1),
    taskId: TaskIdSchema,
    executionSessionId: z.string().min(1),
    hostEpoch: z.uuid(),
  })
  .strict();
export const OutcomeSchema = z.enum([
  "completed",
  "failed",
  "stopped",
  "interrupted",
]);
export const EndedSchema = z
  .object({
    kind: z.literal("task-ended"),
    version: z.literal(1),
    taskId: TaskIdSchema,
    outcome: OutcomeSchema,
    reply: PublicMessageSchema.optional(),
    notice: z.string().optional(),
  })
  .strict();
export const EventSchema = z.discriminatedUnion("kind", [
  CreatedSchema,
  SubmissionSchema,
  LinkedSchema,
  EndedSchema,
]);
export const NoticeSchema = z
  .object({
    taskId: TaskIdSchema,
    triggerMessageId: z.uuid(),
    actor: ActorSchema,
    outcome: OutcomeSchema,
    text: z.string(),
  })
  .strict();
export const ViewSchema = z
  .object({
    team: CreatedSchema,
    messages: z.array(PublicMessageSchema),
    notices: z.array(NoticeSchema),
    working: z.array(ActorSchema),
    hostEpoch: z.uuid(),
    revision: z.int().min(0),
    error: z.string().optional(),
  })
  .strict();
export const ConfigViewSchema = z
  .object({
    contextMessageCount: z.int().min(1),
    memberMaxParallel: z.int().min(1),
    revision: z.int().min(0),
  })
  .strict();
export const SaveConfigSchema = z
  .object({
    contextMessageCount: z.int().min(1).max(Number.MAX_SAFE_INTEGER),
    revision: z.int().min(0),
  })
  .strict();
export const ErrorSchema = z
  .object({ code: z.string(), message: z.string() })
  .strict();
export type Role = z.infer<typeof RoleSchema>;
export type Actor = z.infer<typeof ActorSchema>;
export type CreateRole = z.input<typeof CreateRoleSchema>;
export type CreateTeam = z.infer<typeof CreateTeamSchema>;
export type Submission = z.infer<typeof SubmissionSchema>;
export type TeamEvent = z.infer<typeof EventSchema>;
export type TeamView = z.infer<typeof ViewSchema>;
export type TeamConfig = z.infer<typeof CreatedSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type ContextSnapshot = z.infer<typeof SnapshotSchema>;
export type PublicMessage = z.infer<typeof PublicMessageSchema>;
export type Submit = z.infer<typeof SubmitSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;

/** 回应者的团队内地址；固定角色可在不同团队复用。 */
export function actorKey(actor: Actor): string {
  return actor.kind === "team-owner" ? "team-owner" : actor.roleId;
}

declare module "@deepseek-ai/dsh-session/types" {
  interface SessionEventMap {
    "kmh-team/created": z.infer<typeof CreatedSchema>;
    "kmh-team/submission": Submission;
    "kmh-team/task-linked": z.infer<typeof LinkedSchema>;
    "kmh-team/task-ended": z.infer<typeof EndedSchema>;
  }
}
declare module "@deepseek-ai/dsh-session-projection/types" {
  interface SessionProjectionMap {
    kmhTeam: TeamConfig | null;
  }
  interface SessionProjectionStateMap {
    kmhTeam: TeamConfig | null;
  }
}

export const BootstrapSchema = z.object({
  roles: z.array(RoleSchema),
  cwd: z.string(),
  catalog: z.object({
    default: ModelSchema,
    groups: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        models: z.array(z.object({ id: z.string(), name: z.string() })),
      }),
    ),
    failures: z.array(
      z.object({ id: z.string(), name: z.string(), message: z.string() }),
    ),
    routableProviders: z.array(z.string()),
  }),
});
export type Bootstrap = z.infer<typeof BootstrapSchema>;
