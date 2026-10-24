/** 浏览器与宿主共用的只读额度协议；时间统一为毫秒。 */
import { z } from "zod";

const timestamp = z.number().int().nonnegative().max(8640000000000000);
/** 传输层校验字段类型，范围与默认值由宿主 Config 定义。 */
export const QuotaPreferences = z.object({
  quotaDisplayMode: z.enum(["percent", "bar", "off"]),
  quotaAlertsEnabled: z.boolean(),
  quotaShortThresholdPercent: z.number(),
  quotaWeeklyThresholdPercent: z.number(),
});
export type QuotaPreferences = z.infer<typeof QuotaPreferences>;
export const QuotaContext = z.object({
  settingsNamespace: z.string().min(1).nullable(),
  preferences: QuotaPreferences,
});
export const QuotaQuery = z
  .object({
    detail: z.enum(["summary", "full"]).default("summary"),
    force: z.enum(["0", "1"]).default("0"),
  })
  .strict();
export const QuotaWindow = z.object({
  usedPercent: z.number().min(0).max(100),
  remainingPercent: z.number().min(0).max(100),
  windowMinutes: z.number().int().positive().nullable(),
  resetsAtMs: timestamp.nullable(),
});
export type QuotaWindow = z.infer<typeof QuotaWindow>;
export const QuotaGroup = z.object({
  id: z.string(),
  name: z.string().nullable(),
  windows: z.array(QuotaWindow),
});
export type QuotaGroup = z.infer<typeof QuotaGroup>;
export const QuotaError = z.object({
  area: z.enum(["account", "windows", "credits", "spend", "resets"]),
  code: z.enum(["read-failed", "invalid-data", "unsupported"]),
  message: z.string(),
});
export type QuotaError = z.infer<typeof QuotaError>;
export const QuotaView = z.object({
  accountEpoch: z.number().int().nonnegative(),
  state: z.enum(["loading", "ready", "signed-out", "unsupported", "error"]),
  fetchedAtMs: timestamp.nullable(),
  nextRefreshAtMs: timestamp,
  groups: z.array(QuotaGroup),
  credits: z
    .object({
      hasCredits: z.boolean(),
      unlimited: z.boolean(),
      balance: z.string().nullable(),
    })
    .nullable(),
  creditsAtMs: timestamp.nullable(),
  spend: z
    .object({
      limit: z.string(),
      used: z.string(),
      remainingPercent: z.number().min(0).max(100),
      resetsAtMs: timestamp,
    })
    .nullable(),
  spendAtMs: timestamp.nullable(),
  resets: z
    .object({
      availableCount: z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER),
      cards: z
        .array(
          z.object({
            id: z.string(),
            title: z.string().nullable(),
            description: z.string().nullable(),
            status: z.string(),
            expiresAtMs: timestamp.nullable(),
          }),
        )
        .nullable(),
    })
    .nullable(),
  resetsAtMs: timestamp.nullable(),
  errors: z.array(QuotaError),
});
export type QuotaView = z.infer<typeof QuotaView>;

/** 初始化或账号失效时清空所有区域，保留共享冷却时间。 */
export function emptyQuota(accountEpoch = 0, nextRefreshAtMs = 0): QuotaView {
  return {
    accountEpoch,
    state: "loading",
    fetchedAtMs: null,
    nextRefreshAtMs,
    groups: [],
    credits: null,
    creditsAtMs: null,
    spend: null,
    spendAtMs: null,
    resets: null,
    resetsAtMs: null,
    errors: [],
  };
}
