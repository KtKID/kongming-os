/** 四项显示偏好保留编辑草稿，宿主确认后同步详情页和输入框。 */
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  Button,
  Input,
  Switch,
  Menu,
  IconChevronDownOutlineRegular,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type { QuotaStore } from "./quota-store.ts";
import type { QuotaPreferences } from "../quota-protocol.ts";
import type { QuotaTranslate } from "./QuotaCard.tsx";

import css from "./quota.module.css";
import { QUOTA_HTTP_TIMEOUT_ERROR } from "../quota-rules.ts";

interface Draft {
  mode: QuotaPreferences["quotaDisplayMode"];
  alerts: boolean;
  short: string;
  weekly: string;
  revision: number | undefined;
}
const threshold = (value: string): boolean =>
  /^\d+$/u.test(value) &&
  Number.isInteger(Number(value)) &&
  Number(value) >= 1 &&
  Number(value) <= 100;
export function QuotaDisplaySettings({
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
  const accepted = state.settings?.value;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [modeOpen, setModeOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty && accepted !== undefined)
      setDraft({
        mode: accepted.quotaDisplayMode,
        alerts: accepted.quotaAlertsEnabled,
        short: String(accepted.quotaShortThresholdPercent),
        weekly: String(accepted.quotaWeeklyThresholdPercent),
        revision: state.settings?.revision,
      });
  }, [accepted, state.settings?.revision, dirty]);
  const writable =
    state.settings?.writable === true && state.settings.mode === "host";
  if (draft === null)
    return (
      <p className={css.muted}>
        {(state.settingsError === QUOTA_HTTP_TIMEOUT_ERROR
          ? t("quotaSettingsTimedOut")
          : state.settingsError) ??
          t(
            state.settings?.status === "unavailable"
              ? "quotaReadonly"
              : "quotaSettingsLoading",
          )}
      </p>
    );
  const change = (patch: Partial<Draft>): void => {
    setDirty(true);
    setError(null);
    setDraft({ ...draft, ...patch });
  };
  const validShort = threshold(draft.short),
    validWeekly = threshold(draft.weekly);
  const save = async (): Promise<void> => {
    if (!validShort || !validWeekly || !writable || saving) return;
    setSaving(true);
    setError(null);
    try {
      await store.save(
        {
          quotaDisplayMode: draft.mode,
          quotaAlertsEnabled: draft.alerts,
          quotaShortThresholdPercent: Number(draft.short),
          quotaWeeklyThresholdPercent: Number(draft.weekly),
        },
        draft.revision,
      );
      setDirty(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setDraft((current) =>
        current === null
          ? null
          : { ...current, revision: store.getSnapshot().settings?.revision },
      );
    } finally {
      setSaving(false);
    }
  };
  const disabled = !writable || saving;
  return (
    <section
      className={css.card}
      data-codex-quota="settings"
      aria-label={t("quotaSettings")}
    >
      <h3>{t("quotaSettings")}</h3>
      <div className={css.fields}>
        <div className={css.field}>
          <span>{t("quotaMode")}</span>
          <Menu
            open={modeOpen && !disabled}
            onClose={() => setModeOpen(false)}
            selectedId={draft.mode}
            align="end"
            portal
            autoFocus
            items={[
              { id: "percent", label: t("quotaPercent") },
              { id: "bar", label: t("quotaBar") },
              { id: "off", label: t("quotaOff") },
            ]}
            onSelect={(mode) => {
              if (mode === "percent" || mode === "bar" || mode === "off")
                change({ mode });
              setModeOpen(false);
            }}
            anchor={
              <Button
                variant="outline"
                size="sm"
                className={css.mode}
                aria-label={t("quotaMode")}
                aria-haspopup="menu"
                aria-expanded={modeOpen && !disabled}
                disabled={disabled}
                onClick={() => setModeOpen(!modeOpen)}
              >
                {t(
                  draft.mode === "percent"
                    ? "quotaPercent"
                    : draft.mode === "bar"
                      ? "quotaBar"
                      : "quotaOff",
                )}
                <IconChevronDownOutlineRegular size={14} />
              </Button>
            }
          />
        </div>
        <div className={css.field}>
          <span>{t("quotaAlerts")}</span>
          <Switch
            label={t("quotaAlerts")}
            checked={draft.alerts}
            onChange={(alerts) => change({ alerts })}
            disabled={disabled}
          />
        </div>
        <div className={css.field}>
          <label className={css.row}>
            {t("quotaShortThreshold")}
            <span className={css.control}>
              <Input
                className={css.threshold}
                type="number"
                min={1}
                max={100}
                step={1}
                value={draft.short}
                aria-label={t("quotaShortThreshold")}
                aria-invalid={!validShort}
                aria-describedby={
                  !validShort ? "codex-quota-short-error" : undefined
                }
                onChange={(event) => change({ short: event.target.value })}
                disabled={disabled || !draft.alerts}
              />
              %
            </span>
          </label>
          {!validShort && (
            <p className={css.invalid} id="codex-quota-short-error">
              {t("quotaRange")}
            </p>
          )}
        </div>
        <div className={css.field}>
          <label className={css.row}>
            {t("quotaWeeklyThreshold")}
            <span className={css.control}>
              <Input
                className={css.threshold}
                type="number"
                min={1}
                max={100}
                step={1}
                value={draft.weekly}
                aria-label={t("quotaWeeklyThreshold")}
                aria-invalid={!validWeekly}
                aria-describedby={
                  !validWeekly ? "codex-quota-weekly-error" : undefined
                }
                onChange={(event) => change({ weekly: event.target.value })}
                disabled={disabled || !draft.alerts}
              />
              %
            </span>
          </label>
          {!validWeekly && (
            <p className={css.invalid} id="codex-quota-weekly-error">
              {t("quotaRange")}
            </p>
          )}
        </div>
      </div>
      {!writable && <p className={css.muted}>{t("quotaReadonly")}</p>}
      {error !== null && (
        <p className={css.invalid} role="alert">
          {error}
        </p>
      )}
      <div className={css.footer}>
        <Button
          variant="primary"
          size="sm"
          disabled={disabled || !dirty || !validShort || !validWeekly}
          onClick={() => {
            save().catch(() => undefined);
          }}
        >
          {saving ? t("quotaSaving") : t("quotaSave")}
        </Button>
      </div>
    </section>
  );
}
