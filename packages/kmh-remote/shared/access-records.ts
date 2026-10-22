// 访问记录共享约定：校验密码结果、文件记录与分页返回值，统一错误和容量常量。
import { z } from 'zod';

export const MAX_FILE_BYTES = 10_000_000;
export const PAGE_SIZE = 10;
export const RECORD_VERSION = 1;
export const RECORDS_METHOD = 'records.list';
export const MAX_RECORD_QUERY_BYTES = 4096;
export const RecordsRequestIdSchema = z.object({ rpcId: z.string() });
export const FailureSchema = z.object({
  code: z.string().min(1),
  desc: z.string(),
  operation: z.string().optional(),
});
export type RecordFailure = z.infer<typeof FailureSchema>;
const SourceSchema = z.object({
  peerAddress: z.string().nullable(),
  sourceNote: z.string().optional(),
  claimedAddresses: z.array(
    z.object({ address: z.string(), trust: z.literal('unverified') }),
  ),
  entryKind: z.enum(['lan', 'public']),
});
const OutcomeSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('success') }),
  z.object({ outcome: z.literal('failure'), error: FailureSchema }),
]);
export const AttemptSchema = z.intersection(SourceSchema, OutcomeSchema);
export type PasswordAttempt = z.infer<typeof AttemptSchema>;
export const RecordSchema = z.intersection(
  z.object({
    version: z.literal(RECORD_VERSION),
    sequence: z.string().regex(/^[1-9]\d*$/),
    occurredAt: z
      .string()
      .regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}[+-]\d\d:\d\d$/),
    timeZone: z.string(),
    event: z.literal('password-attempt'),
  }),
  AttemptSchema,
);
export type AccessRecord = z.infer<typeof RecordSchema>;
export const QuerySchema = z
  .object({ cursor: z.string().max(2048).optional() })
  .strict();
export const CursorSchema = z
  .object({
    instance: z.string(),
    cutoff: z.string().regex(/^\d+$/),
    file: z.string(),
    offset: z.number().int().nonnegative(),
  })
  .strict();
export const PageSchema = z.object({
  records: z.array(RecordSchema).max(PAGE_SIZE),
  nextCursor: z.string().nullable(),
  homeLabel: z.string(),
  saveError: FailureSchema.nullable(),
  recovered: z.boolean(),
});
export const PageResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), value: PageSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({
      code: z.string(),
      message: z.string(),
      details: z.object({
        desc: z.string(),
        saveError: FailureSchema.nullable().optional(),
      }),
    }),
  }),
]);
export type RecordPage = z.infer<typeof PageSchema>;
export type PageResult = z.infer<typeof PageResultSchema>;
export type RecordsCall = (
  endpoint: string,
  payload: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;

/** 把异常转为可显示的原始错误；无底层 code 时使用调用方给定的稳定代码。 */
export function recordFailure(
  error: unknown,
  fallback: string,
  operation: string,
): RecordFailure {
  const parsed = z
    .object({ code: z.string().optional(), message: z.string() })
    .safeParse(error);
  return {
    code: parsed.success ? (parsed.data.code ?? fallback) : fallback,
    desc: parsed.success ? parsed.data.message : String(error),
    operation,
  };
}

/** 统一识别保留的记录方法路径，编码与非法路径都在 Remote 侧按记录请求拦截。 */
export function isRecordsPath(raw: string): boolean {
  let decoded = raw;
  for (let i = 0; i < 3; i++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return (
    decoded
      .split(/[?#]/, 1)[0]
      ?.replaceAll(/\/+|\\/g, '/')
      .includes('/kmh-remote/records.') === true
  );
}
