/** 读取 CLI 持久行的最小形态，新增字段和未知类型保留给原文入口。 */
import { z } from "zod";
export const EnvelopeSchema = z.looseObject({
  type: z.string(),
  payload: z.unknown(),
  timestamp: z.string().optional(),
  ordinal: z.number().int().nonnegative().optional(),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;
export const BindingFileSchema = z.record(z.string(), z.unknown());
export const BindingSchema = z.looseObject({
  threadId: z.string().min(1).optional(),
});
export const MetaSchema = z.looseObject({
  id: z.string().min(1),
  cli_version: z.string().optional(),
});
export const NativeUsageSchema = z.looseObject({
  input_tokens: z.number().int().nonnegative().optional(),
  cached_input_tokens: z.number().int().nonnegative().optional(),
  cache_write_input_tokens: z.number().int().nonnegative().optional(),
  output_tokens: z.number().int().nonnegative().optional(),
  reasoning_output_tokens: z.number().int().nonnegative().optional(),
  total_tokens: z.number().int().nonnegative().optional(),
});
export type NativeUsage = z.infer<typeof NativeUsageSchema>;
export const UsageRecordSchema = z.looseObject({
  turn_id: z.string(),
  response_id: z.string(),
  thread_id: z.string().optional(),
  usage: NativeUsageSchema,
  turn_token_usage: NativeUsageSchema.optional(),
  thread_token_usage: NativeUsageSchema.optional(),
});
export const ContextSchema = z.looseObject({
  turn_id: z.string(),
  model: z.string().optional(),
  effort: z.string().optional(),
});
export const TaskSchema = z.looseObject({
  type: z.enum([
    "task_started",
    "task_complete",
    "task_cancelled",
    "turn_aborted",
  ]),
  turn_id: z.string().optional(),
  duration_ms: z.number().nonnegative().optional(),
  time_to_first_token_ms: z.number().nonnegative().optional(),
  last_agent_message: z.string().optional(),
});
export const ItemSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  tool: z.string().optional(),
  arguments: z.unknown().optional(),
  status: z.string().optional(),
  success: z.boolean().optional(),
  duration: z
    .object({ secs: z.number().nonnegative(), nanos: z.number().nonnegative() })
    .optional(),
  content_items: z.unknown().optional(),
  content: z.unknown().optional(),
  summary_text: z.unknown().optional(),
  raw_content: z.unknown().optional(),
});
export const CompletedSchema = z.looseObject({
  type: z.literal("item_completed"),
  thread_id: z.string().optional(),
  turn_id: z.string(),
  item: ItemSchema,
  started_at_ms: z.number().optional(),
  completed_at_ms: z.number().optional(),
});
export const ResponseSchema = z.looseObject({
  type: z.string(),
  id: z.string().optional(),
  name: z.string().optional(),
  call_id: z.string().optional(),
  role: z.string().optional(),
  arguments: z.unknown().optional(),
  output: z.unknown().optional(),
  content: z.unknown().optional(),
  summary: z.unknown().optional(),
  internal_chat_message_metadata_passthrough: z
    .looseObject({ turn_id: z.string().optional() })
    .optional(),
});
export const TextPartsSchema = z.array(
  z.looseObject({ type: z.string().optional(), text: z.string().optional() }),
);
export const TokenCountSchema = z.looseObject({
  type: z.literal("token_count"),
  info: z
    .looseObject({
      total_token_usage: NativeUsageSchema.optional(),
      last_token_usage: NativeUsageSchema.optional(),
    })
    .nullable()
    .optional(),
});
export const IdentitySchema = z.looseObject({
  thread_id: z.string().optional(),
  session_id: z.string().optional(),
});
