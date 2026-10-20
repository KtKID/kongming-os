/** 会话输入框额度：订阅与模型选择器相同的已确认目录状态。 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import {
  Button,
  Tooltip,
  IconCloseOutlineRegular,
  useAnchoredPosition,
  useDismissOnOutsidePointer,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { ModelDirectory } from "@deepseek-ai/dsh-client-ui-model-selection/client";
import type { QuotaStore } from "./quota-store.ts";
import {
  modelQuota,
  windowLow,
  QUOTA_HTTP_TIMEOUT_ERROR,
} from "../quota-rules.ts";
import {
  periodLabel,
  QuotaStatus,
  QuotaWindows,
  type QuotaTranslate,
} from "./QuotaCard.tsx";

import css from "./quota.module.css";

export interface ComposerQuotaProps {
  directory: Pick<ModelDirectory, "store" | "load">;
  quota: QuotaStore;
  t: QuotaTranslate;
  openSettings?: () => void;
}
export function ComposerQuota({
  directory,
  quota,
  t,
  openSettings,
}: ComposerQuotaProps): JSX.Element | null {
  const model = useSyncExternalStore(
    (fn) => directory.store.subscribe(fn),
    () => directory.store.getSnapshot(),
    () => directory.store.getSnapshot(),
  );
  const state = useSyncExternalStore(
    quota.subscribe,
    quota.getSnapshot,
    quota.getSnapshot,
  );
  const settings = state.settings?.value;
  const active = model.current?.provider === "codex-cli";
  const enabled =
    active && settings !== undefined && settings.quotaDisplayMode !== "off";
  useEffect(() => {
    void directory.load().catch(() => {});
  }, [directory]);
  useEffect(() => (enabled ? quota.retain() : undefined), [enabled, quota]);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [focused, setFocused] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback(() => {
    setHovered(false);
    setPinned(false);
    setFocused(false);
  }, []);
  const open = enabled && (hovered || pinned || focused);
  const position = useAnchoredPosition({
    open,
    anchorRef: anchor,
    panelRef: panel,
    side: "top",
    align: "end",
    gap: 8,
    margin: 12,
  });
  useDismissOnOutsidePointer(anchor, open, close, panel);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        anchor.current?.focus();
        close();
      }
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open, close]);
  useEffect(
    () => close(),
    [model.current?.provider, model.current?.model, close],
  );
  if (!active || settings?.quotaDisplayMode === "off") return null;
  const windows =
    model.current === null
      ? []
      : modelQuota(state.view.groups, model.current.model);
  const lowest = windows.reduce<(typeof windows)[number] | undefined>(
    (low, w) =>
      low === undefined || w.remainingPercent < low.remainingPercent ? w : low,
    undefined,
  );
  const statusText =
    state.view.state === "signed-out"
      ? t("quotaSignIn")
      : state.error === QUOTA_HTTP_TIMEOUT_ERROR
        ? t("quotaTimedOut")
        : state.error !== null ||
            state.settingsError !== null ||
            state.view.state === "error" ||
            state.view.state === "unsupported"
          ? t("quotaFailed")
          : state.loading
            ? t("quotaLoading")
            : t("quotaPending");
  const badge = (window: (typeof windows)[number]): JSX.Element => (
    <span
      className={css.period}
      data-low={windowLow(
        window,
        state.view.fetchedAtMs,
        state.now,
        settings ?? null,
      )}
    >
      <span>{periodLabel(window, t)}</span>
      {settings?.quotaDisplayMode === "bar" ? (
        <progress
          className={css.progress}
          aria-label={`${periodLabel(window, t)} ${Math.round(window.remainingPercent)}%`}
          value={window.remainingPercent}
          max={100}
          data-low={windowLow(
            window,
            state.view.fetchedAtMs,
            state.now,
            settings,
          )}
        />
      ) : (
        <span>{Math.round(window.remainingPercent)}%</span>
      )}
    </span>
  );
  return (
    <div
      className={css.composer}
      data-codex-quota-composer
      data-provider="codex-cli"
    >
      <Button
        size="sm"
        variant="ghost"
        ref={anchor}
        type="button"
        className={css.trigger}
        aria-label={t("quotaDetails")}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={(event) => {
          if (
            !panel.current?.contains(
              event.relatedTarget instanceof Node ? event.relatedTarget : null,
            )
          )
            setHovered(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!panel.current?.contains(event.relatedTarget)) setFocused(false);
        }}
        onClick={() => {
          setPinned(!pinned);
          setFocused(false);
          setHovered(false);
        }}
      >
        {windows.length === 0 ? (
          statusText
        ) : (
          <>
            <span className={css.all}>
              {windows.map((w, i) => (
                <span key={i}>{badge(w)}</span>
              ))}
            </span>
            {lowest !== undefined && (
              <span className={css.compact}>{badge(lowest)}</span>
            )}
          </>
        )}
      </Button>
      {open &&
        createPortal(
          <div
            ref={panel}
            id={id}
            role="dialog"
            aria-label={t("quotaDetails")}
            className={css.panel}
            style={position ?? { visibility: "hidden" }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            onBlur={(event) => {
              if (
                !event.currentTarget.contains(event.relatedTarget) &&
                event.relatedTarget !== anchor.current
              )
                setFocused(false);
            }}
          >
            <div className={css.row}>
              <h3>{t("quotaDetails")}</h3>
              <Tooltip label={t("quotaClose")} side="top" portal>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("quotaClose")}
                  onClick={() => {
                    anchor.current?.focus();
                    close();
                  }}
                >
                  <IconCloseOutlineRegular size={16} />
                </Button>
              </Tooltip>
            </div>
            <div className={css.section}>
              <QuotaWindows state={state} windows={windows} t={t} />
            </div>
            <QuotaStatus
              state={state}
              t={t}
              retry={() => {
                quota.refresh(true).catch(() => undefined);
              }}
            />
            {windows.length === 0 && state.view.state === "ready" && (
              <p className={css.muted}>{t("quotaPending")}</p>
            )}
            <div className={css.row}>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  quota.refresh(true).catch(() => undefined);
                }}
                disabled={state.loading}
              >
                {t("quotaRefresh")}
              </Button>
              {openSettings !== undefined && (
                <Button size="sm" variant="ghost" onClick={openSettings}>
                  {state.view.state === "signed-out"
                    ? t("quotaSignIn")
                    : t("quotaSettings")}
                </Button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
