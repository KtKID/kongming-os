/** 前后端共享的 trace 协议；外部输入和响应统一由此校验。 */
import { z } from "zod";
import { TIMELINE_PAGE_SIZE, MAX_TIMELINE_PAGE_SIZE } from "./paths.ts";
const count = z.number().int().nonnegative();
const millis = z.number().nonnegative().nullable();
export const SessionRequestSchema = z
  .object({ sessionId: z.string().min(1).max(256) })
  .strict();
export const SourceRefSchema = z.object({
  line: count.min(1),
  byteStart: count,
  byteEnd: count,
  ordinal: count.optional(),
});
export type SourceRef = z.infer<typeof SourceRefSchema>;
export const UsageSchema = z.object({
  input: count.nullable(),
  cached: count.nullable(),
  cacheWrite: count.nullable(),
  output: count.nullable(),
  reasoning: count.nullable(),
  total: count.nullable(),
  coverage: z.enum(["complete", "partial", "missing"]),
});
export type Usage = z.infer<typeof UsageSchema>;
export const IssueSchema = z.object({
  kind: z.string(),
  message: z.string(),
  source: SourceRefSchema.nullable(),
  nativeTurnId: z.string().nullable(),
});
export type Issue = z.infer<typeof IssueSchema>;
export const EntryKindSchema = z.enum([
  "message",
  "response",
  "tool",
  "skill",
  "file",
  "reasoning",
  "unknown",
]);
export const EntrySchema = z.object({
  entryId: z.string(),
  nativeTurnId: z.string().nullable(),
  kind: EntryKindSchema,
  title: z.string(),
  at: z.string().nullable(),
  status: z.enum(["completed", "failed", "pending", "unknown"]),
  durationMs: millis,
  toolName: z.string().nullable(),
  callId: z.string().nullable(),
  usage: UsageSchema.nullable(),
  sources: z.array(SourceRefSchema),
});
export type TraceEntry = z.infer<typeof EntrySchema>;
export const TurnSchema = z.object({
  nativeTurnId: z.string(),
  title: z.string(),
  model: z.string().nullable(),
  effort: z.string().nullable(),
  status: z.enum(["completed", "failed", "pending", "unknown"]),
  durationMs: millis,
  ttftMs: millis,
  startedAt: z.string().nullable(),
  responseCount: count,
  toolCount: count,
  failedTools: count,
  skillCount: count,
  usage: UsageSchema,
  usageSources: z.array(SourceRefSchema),
});
export type TraceTurn = z.infer<typeof TurnSchema>;
export const SourceSchema = z.object({
  path: z.string(),
  cliVersion: z.string().nullable(),
  bytes: count,
  completeByteEnd: count,
  pendingTailBytes: count,
  lineCount: count,
});
export type TraceSource = z.infer<typeof SourceSchema>;
export const SnapshotSchema = z.object({
  sessionId: z.string(),
  nativeSessionId: z.string().nullable(),
  state: z.enum(["ready", "unlinked", "waiting"]),
  readToken: z.string().nullable(),
  readAt: z.string(),
  refreshIntervalMs: count.min(1),
  source: SourceSchema.nullable(),
  turns: z.array(TurnSchema),
  issues: z.array(IssueSchema),
});
export type TraceSnapshot = z.infer<typeof SnapshotSchema>;
export const TimelineRequestSchema = SessionRequestSchema.extend({
  readToken: z.string().min(1),
  nativeTurnId: z.string().min(1),
  category: z.union([z.literal("all"), EntryKindSchema]).default("all"),
  q: z.string().max(4096).default(""),
  onlyErrors: z.enum(["0", "1"]).default("0"),
  cursor: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_TIMELINE_PAGE_SIZE)
    .default(TIMELINE_PAGE_SIZE),
}).strict();
export type TimelineRequest = z.infer<typeof TimelineRequestSchema>;
export const TimelineSchema = z.object({
  entries: z.array(EntrySchema),
  nextCursor: count.nullable(),
  total: count,
  readToken: z.string(),
});
export type TimelinePage = z.infer<typeof TimelineSchema>;
export const EntryRequestSchema = SessionRequestSchema.extend({
  readToken: z.string().min(1),
  entryId: z.string().min(1),
}).strict();
export const DetailSchema = z.object({
  entry: EntrySchema,
  arguments: z.string().nullable(),
  result: z.string().nullable(),
  text: z.string().nullable(),
  raw: z.array(z.object({ source: SourceRefSchema, text: z.string() })),
});
export type TraceDetail = z.infer<typeof DetailSchema>;
export const ErrorSchema = z.object({ error: z.string(), reason: z.string() });
export const ExportRecordSchema = z.object({
  source: SourceRefSchema,
  encoding: z.enum(["utf8", "base64"]),
  raw: z.string(),
});
export const TraceExportSchema = z.object({
  formatVersion: z.literal(1),
  exportedAt: z.string(),
  sessionId: z.string(),
  nativeSessionId: z.string(),
  source: SourceSchema,
  turns: z.array(TurnSchema),
  summary: UsageSchema,
  issues: z.array(IssueSchema),
  records: z.array(ExportRecordSchema),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
});
