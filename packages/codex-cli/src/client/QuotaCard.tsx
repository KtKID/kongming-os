/** 账号详情与输入框浮层共用周期展示，所有百分比与颜色直接派生。 */
import { useEffect, useSyncExternalStore } from "react";
import { Button, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { TranslateNS } from "@deepseek-ai/dsh-client-ui-slots";
import type { QuotaStore, QuotaClientSnapshot } from "./quota-store.ts";
import type { QuotaWindow } from "../quota-protocol.ts";
import {
  windowKind,
  windowFresh,
  windowLow,
  QUOTA_HTTP_TIMEOUT_ERROR,
} from "../quota-rules.ts";
import css from "./quota.module.css";
export type QuotaTranslate = TranslateNS<"settings.codex-cli">;

export function periodLabel(window: QuotaWindow, t: QuotaTranslate): string {
  const kind = windowKind(window);
  return kind === "short"
    ? t("quotaShort")
    : kind === "weekly"
      ? t("quotaWeekly")
      : window.windowMinutes === null
        ? t("quotaPeriodUnknown")
        : `${window.windowMinutes} ${t("quotaMinutes")}`;
}
export function resetLabel(
  window: QuotaWindow,
  now: number,
  t: QuotaTranslate,
): string {
  if (window.resetsAtMs === null) return t("quotaResetUnknown");
  if (window.resetsAtMs <= now) return t("quotaResetPending");
  const minutes = Math.ceil((window.resetsAtMs - now) / 60000);
  return `${new Date(window.resetsAtMs).toLocaleString()} · ${minutes < 60 ? `${minutes} ${t("quotaMinutes")}` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`}`;
}
export function QuotaWindows({
  state,
  windows,
  t,
}: {
  state: QuotaClientSnapshot;
  windows: readonly QuotaWindow[];
  t: QuotaTranslate;
}): JSX.Element {
  return (
    <>
      {windows.map((window, index) => (
        <div
          className={css.window}
          key={index}
          data-period={windowKind(window)}
        >
          <div className={css.row}>
            <span>{periodLabel(window, t)}</span>
            <span className={css.remaining}>
              {Math.round(window.remainingPercent)}% {t("quotaRemaining")}
            </span>
          </div>
          <progress
            className={css.progress}
            aria-label={periodLabel(window, t)}
            value={window.remainingPercent}
            max={100}
            data-low={windowLow(
              window,
              state.view.fetchedAtMs,
              state.now,
              state.settings?.value ?? null,
            )}
          />
          <small>{resetLabel(window, state.now, t)}</small>
          {!windowFresh(window, state.view.fetchedAtMs, state.now) && (
            <p className={css.muted}>{t("quotaPending")}</p>
          )}
        </div>
      ))}
    </>
  );
}
export function QuotaStatus({
  state,
  t,
  retry,
}: {
  state: QuotaClientSnapshot;
  t: QuotaTranslate;
  retry: () => void;
}): JSX.Element | null {
  if (state.view.state === "signed-out")
    return (
      <p>
        <a href="#codex-cli-account">{t("quotaSignIn")}</a>
      </p>
    );
  if (state.view.state === "unsupported")
    return <p className={css.muted}>{t("quotaUnsupported")}</p>;
  const failed = state.error !== null || state.view.state === "error";
  return (
    <>
      {state.loading && (
        <p className={css.loading} role="status">
          <StateDot state="ongoing" /> {t("quotaLoading")}
        </p>
      )}
      {!state.loading && !failed && state.view.state === "loading" && (
        <p className={css.muted} role="status">
          {t("quotaPending")}
        </p>
      )}
      {failed && (
        <p className={css.muted}>
          {t(
            state.error === QUOTA_HTTP_TIMEOUT_ERROR
              ? "quotaTimedOut"
              : "quotaFailed",
          )}{" "}
          {t("quotaReadError")}{" "}
          <Button size="sm" variant="ghost" onClick={retry}>
            {t("quotaRetry")}
          </Button>
        </p>
      )}
      {state.view.fetchedAtMs !== null && (
        <p className={css.muted}>
          {t("quotaUpdated")}{" "}
          {new Date(state.view.fetchedAtMs).toLocaleString()}
        </p>
      )}
    </>
  );
}
export function QuotaCard({
  store,
  t,
}: {
  store: QuotaStore;
  t: QuotaTranslate;
}): JSX.Element {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  useEffect(() => store.retain(), [store]);
  const view = state.view;
  const retry = (): void => {
    store.refresh(true).catch(() => undefined);
  };
  return (
    <section
      className={css.card}
      data-codex-quota="overview"
      aria-label={t("quotaTitle")}
    >
      <div className={css.row}>
        <h3>{t("quotaTitle")}</h3>
        <Button
          size="sm"
          variant="ghost"
          onClick={retry}
          disabled={state.loading}
        >
          {t("quotaRefresh")}
        </Button>
      </div>
      <QuotaStatus state={state} t={t} retry={retry} />
      {view.errors
        .filter((e) => e.area === "windows")
        .slice(0, 1)
        .map((e) => (
          <p key={e.area} className={css.muted}>
            {t("quotaSectionError")}{" "}
            <Button size="sm" variant="ghost" onClick={retry}>
              {t("quotaRetry")}
            </Button>
          </p>
        ))}
      {view.groups.map((group) => (
        <section key={group.id} className={css.group}>
          <h4>{group.name ?? group.id}</h4>
          {group.windows.length === 0 ? (
            <p className={css.muted}>{t("quotaUnknown")}</p>
          ) : (
            <div className={css.windows}>
              <QuotaWindows state={state} windows={group.windows} t={t} />
            </div>
          )}
        </section>
      ))}
      {view.state !== "signed-out" && view.state !== "unsupported" && (
        <div className={css.extras}>
          <section className={css.section} data-quota-area="credits">
            <h4>{t("quotaCredits")}</h4>
            <p className={css.figure}>
              {view.credits === null
                ? t("quotaUnknown")
                : view.credits.unlimited
                  ? t("quotaUnlimited")
                  : (view.credits.balance ?? t("quotaBalanceUnknown"))}
            </p>
            <small>{t("quotaExpiryUnknown")}</small>
            {view.spend !== null && (
              <p>
                {t("quotaSpend")} {view.spend.used} / {view.spend.limit} ·{" "}
                {new Date(view.spend.resetsAtMs).toLocaleString()}
              </p>
            )}
            {view.errors
              .filter((e) => e.area === "credits" || e.area === "spend")
              .map((e) => (
                <p key={e.area} className={css.muted}>
                  {t("quotaSectionError")}{" "}
                  <Button size="sm" variant="ghost" onClick={retry}>
                    {t("quotaRetry")}
                  </Button>
                </p>
              ))}
            {view.creditsAtMs !== null && (
              <small>
                {t("quotaUpdated")}{" "}
                {new Date(view.creditsAtMs).toLocaleString()}
              </small>
            )}
          </section>
          <section className={css.section}>
            <h4>{t("quotaResets")}</h4>
            <p className={css.figure}>
              {view.resets?.availableCount ?? t("quotaUnknown")}
            </p>
            {view.resets !== null && view.resets.cards === null && (
              <p className={css.muted}>{t("quotaDetailsUnknown")}</p>
            )}
            {view.resets?.cards?.map((card) => (
              <div className={css.resetCard} key={card.id}>
                <p>{card.title ?? t("quotaResetCard")}</p>
                <small>
                  {card.expiresAtMs === null
                    ? t("quotaExpiryUnknown")
                    : new Date(card.expiresAtMs).toLocaleString()}
                </small>
              </div>
            ))}
            {view.errors
              .filter((e) => e.area === "resets")
              .map((e) => (
                <p key={e.area} className={css.muted}>
                  {t("quotaSectionError")}{" "}
                  <Button size="sm" variant="ghost" onClick={retry}>
                    {t("quotaRetry")}
                  </Button>
                </p>
              ))}
            {view.resetsAtMs !== null && (
              <small>
                {t("quotaUpdated")} {new Date(view.resetsAtMs).toLocaleString()}
              </small>
            )}
          </section>
        </div>
      )}
      <small>
        {state.now < view.nextRefreshAtMs
          ? `${t("quotaCooldown")} ${new Date(view.nextRefreshAtMs).toLocaleTimeString()}`
          : t("quotaFrequency")}
      </small>
    </section>
  );
}
