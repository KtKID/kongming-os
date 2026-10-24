/** 额度展示的纯规则；模型匹配依据参考插件 sidebar-quota.js 的精确、Spark、Reserve 规则。 */
import type {
  QuotaGroup,
  QuotaPreferences,
  QuotaWindow,
} from "./quota-protocol.ts";
export const QUOTA_MIN_INTERVAL_MS = 300000;
/** 覆盖响应头与正文读取，给宿主15秒中止和进程收尾保留余量。 */
export const QUOTA_HTTP_TIMEOUT_MS = 30000;
export const QUOTA_HTTP_TIMEOUT_ERROR = "QUOTA_HTTP_TIMEOUT";
export const QUOTA_REFRESH_INTERVAL_MS = QUOTA_MIN_INTERVAL_MS;
export const QUOTA_ERROR_BACKOFF_MS = QUOTA_MIN_INTERVAL_MS;
export const QUOTA_STALE_AFTER_MS = QUOTA_MIN_INTERVAL_MS;
export const QUOTA_DETAIL_CACHE_MS = QUOTA_MIN_INTERVAL_MS;

/** 已确认的周期分类；其他时长保留实际值。 */
export function windowKind(window: QuotaWindow): "short" | "weekly" | "other" {
  return window.windowMinutes === 300
    ? "short"
    : window.windowMinutes === 10080
      ? "weekly"
      : "other";
}
/** 仅新鲜且重置时间仍有效的结果可以触发颜色提醒。 */
export function windowFresh(
  window: QuotaWindow,
  at: number | null,
  now: number,
): boolean {
  return (
    at !== null &&
    now >= at &&
    now - at <= QUOTA_STALE_AFTER_MS &&
    (window.resetsAtMs === null || window.resetsAtMs > now)
  );
}
/** 阈值采用原始百分比严格小于比较，显示舍入保持独立。 */
export function windowLow(
  window: QuotaWindow,
  at: number | null,
  now: number,
  settings: QuotaPreferences | null,
): boolean {
  if (!settings?.quotaAlertsEnabled || !windowFresh(window, at, now))
    return false;
  const kind = windowKind(window);
  return kind === "short"
    ? window.remainingPercent < settings.quotaShortThresholdPercent
    : kind === "weekly" &&
        window.remainingPercent < settings.quotaWeeklyThresholdPercent;
}
const normalize = (value: string): string =>
  value.toLocaleLowerCase("en-US").replaceAll(/[^a-z0-9]+/gu, "-");
/** 缺失独立额度组保留未知状态，普通模型共享 codex 主组。 */
export function modelQuota(
  groups: readonly QuotaGroup[],
  model: string,
): QuotaWindow[] {
  const key = normalize(model);
  const exact = groups.filter((g) =>
    [g.id, g.name].some((v) => v !== null && normalize(v) === key),
  );
  const selected =
    exact.length > 0
      ? exact
      : key === "gpt-reserve"
        ? []
        : /\bspark\b/u.test(key)
          ? groups.filter((g) =>
              /\bspark\b/u.test(normalize(`${g.id} ${g.name ?? ""}`)),
            )
          : groups.filter((g) => g.id === "codex");
  return selected
    .flatMap((g) => g.windows)
    .sort(
      (a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity),
    );
}
