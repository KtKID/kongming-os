/**
 * Codex 详情卡片：账号、版本、原生能力逐项选择与测试连接，贡献到插件
 * 管理区的 `plugins.item` 槽位。`view: summary` 只出一句话简介（列表卡片
 * 与详情页标题下共用）；`view: page` 才渲染完整内容，因此详情页只出现一份。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Button,
  IconRightUpOutlineRegular,
  StateDot,
  Switch,
  Tag,
  type TagTone,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type { QuotaStore } from "./quota-store.ts";
import { QuotaCard } from "./QuotaCard.tsx";
import { QuotaDisplaySettings } from "./QuotaDisplaySettings.tsx";
import css from "./quota.module.css";

/** 原生能力条目（Host 侧 status 路由给出，客户端只渲染）。 */
interface CapabilityView {
  id: string;
  label: string;
  description: string;
  available: boolean;
  reason?: string;
}
/** 状态接口形态（与 Host 侧 status 路由一致）。 */
interface StatusResponse {
  account: {
    login: string;
    credentialSource?: string;
    authorizeUrl?: string;
    error?: string;
  };
  version: { version?: string; ok: boolean; reason?: string };
  selection: Record<string, boolean>;
  capabilities: CapabilityView[];
  defaultModel?: string;
  lastProbe?: { at: string; ok: boolean; error?: string };
}

/** 组合 props：槽位运行时份额（`view`）与注册声明的 locale 注入（`t`）。 */
export type CodexCardProps = PropsRuntime<"plugins.item"> &
  PropsLocale<"settings.codex-cli">;

/** 状态响应守卫：字段存在且类型正确才采用。 */
function isStatus(value: unknown): value is StatusResponse {
  if (value === null || typeof value !== "object") return false;
  const account = fieldOf(value, "account");
  const version = fieldOf(value, "version");
  const selection = fieldOf(value, "selection");
  const capabilities = fieldOf(value, "capabilities");
  return (
    isRecordWith(account, "login", "string") &&
    isRecordWith(version, "ok", "boolean") &&
    selection !== null &&
    typeof selection === "object" &&
    Array.isArray(capabilities)
  );
}
function fieldOf(value: object, key: string): unknown {
  for (const [name, item] of Object.entries(value))
    if (name === key) return item;
  return undefined;
}
function isRecordWith(
  value: unknown,
  key: string,
  kind: "string" | "boolean",
): boolean {
  if (value === null || typeof value !== "object") return false;
  const field = fieldOf(value, key);
  return typeof field === kind;
}

/** 登录枚举到文案与标签色。 */
function accountView(
  t: CodexCardProps["t"],
  login: string,
): {
  text: string;
  tone: TagTone;
} {
  if (login === "signed-in")
    return { text: t("accountSignedIn"), tone: "success" };
  if (login === "waiting")
    return { text: t("accountWaiting"), tone: "warning" };
  if (login === "starting") return { text: t("accountStarting"), tone: "info" };
  if (login === "failed") return { text: t("accountFailed"), tone: "danger" };
  return { text: t("accountSignedOut"), tone: "neutral" };
}

/** 一行键值展示。 */
function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className={css.fact}>
      <span className={css.label}>{label}</span>
      <span className={css.value}>{children}</span>
    </div>
  );
}

/**
 * 拉取并按请求视图渲染：简介一句话或完整详情。
 * @param props - 槽位传入的 `view` 与 locale 注入的 `t`。
 * @returns 简介文本节点，或完整详情卡片。
 */
export function CodexCard(
  props: CodexCardProps & { quota?: QuotaStore },
): JSX.Element {
  if (props.view === "summary") return <>{props.t("summary")}</>;
  return <CodexPage {...props} />;
}
function CodexPage(
  props: CodexCardProps & { quota?: QuotaStore },
): JSX.Element {
  const { t } = props;
  const [status, setStatus] = useState<StatusResponse | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/codex-cli/status", {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (isStatus(body)) setStatus(body);
    } catch {
      setStatus(undefined);
    }
  }, []);
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);
  const act = useCallback(
    async (action: string, body?: unknown) => {
      setBusy(action);
      const accountChanged = action === "login" || action === "logout";
      if (accountChanged) props.quota?.reset(false);
      try {
        await fetch(`/api/codex-cli/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        await refresh();
      } finally {
        setBusy(undefined);
        if (accountChanged) props.quota?.reset();
      }
    },
    [refresh, props.quota],
  );
  if (status === undefined)
    return (
      <p className={css.loading} role="status">
        <StateDot state="ongoing" /> {t("loading")}
      </p>
    );
  const account = accountView(t, status.account.login);
  const disabled = busy !== undefined;
  return (
    <div id="codex-cli-account" className={css.page}>
      {props.quota !== undefined && <QuotaCard store={props.quota} t={t} />}
      {props.quota !== undefined && (
        <QuotaDisplaySettings store={props.quota} t={t} />
      )}
      <section className={css.card}>
        <Row label={t("versionLabel")}>
          <StateDot
            state={
              status.version.ok
                ? "done"
                : status.version.version === undefined
                  ? "idle"
                  : "error"
            }
          />
          {status.version.version ?? t("versionMissing")}
          {status.version.ok ? (
            <Tag tone="success">{t("versionSupported")}</Tag>
          ) : (
            <Tag tone="danger">{t("versionUnsupported")}</Tag>
          )}
          {!status.version.ok && status.version.reason !== undefined && (
            <span className={css.note}>{status.version.reason}</span>
          )}
        </Row>
        <Row label={t("accountLabel")}>
          <Tag tone={account.tone}>{account.text}</Tag>
          {status.account.error !== undefined && (
            <span className={css.note}>{status.account.error}</span>
          )}
        </Row>
        {status.account.credentialSource !== undefined && (
          <Row label={t("credentialLabel")}>
            {status.account.credentialSource}
          </Row>
        )}
        <Row label={t("modelLabel")}>
          {status.defaultModel ?? t("modelCatalogFirst")}
        </Row>
        <Row label={t("probeLabel")}>
          {status.lastProbe === undefined ? (
            t("probeNever")
          ) : (
            <>
              <Tag tone={status.lastProbe.ok ? "success" : "danger"}>
                {status.lastProbe.ok ? t("probePass") : t("probeFail")}
              </Tag>
              {new Date(status.lastProbe.at).toLocaleString()}
              {!status.lastProbe.ok && status.lastProbe.error !== undefined && (
                <span className={css.note}>{status.lastProbe.error}</span>
              )}
            </>
          )}
        </Row>
        <p className={css.note}>{t("toolSelectionScope")}</p>
        <Row label={t("capabilitiesLabel")}>
          <span className={css.section}>
            {status.capabilities
              .filter((capability) => capability.id === "skills")
              .map((capability) => (
                <span key={capability.id} className={css.capability}>
                  <Switch
                    checked={status.selection[capability.id] === true}
                    onChange={(next) => {
                      act("config", {
                        selection: {
                          ...status.selection,
                          [capability.id]: next,
                        },
                      }).catch(() => undefined);
                    }}
                    label={capability.label}
                  />
                  <span className={css.capabilityText}>
                    <span className={css.value}>
                      <span className={css.label}>{capability.label}</span>
                      {!capability.available && (
                        <Tag tone="neutral">{t("capabilityUnavailable")}</Tag>
                      )}
                    </span>
                    <span className={css.note}>{capability.description}</span>
                    {!capability.available &&
                      capability.reason !== undefined && (
                        <span className={css.note}>{capability.reason}</span>
                      )}
                  </span>
                </span>
              ))}
          </span>
        </Row>
        <p className={css.note}>{t("capabilityNextTurn")}</p>
        {status.account.authorizeUrl !== undefined && (
          <div className={css.actions}>
            <Button
              variant="outline"
              icon={<IconRightUpOutlineRegular size={16} />}
              onClick={() => {
                window.open(
                  status.account.authorizeUrl,
                  "_blank",
                  "noreferrer",
                );
              }}
            >
              {t("openAuthorize")}
            </Button>
          </div>
        )}
        <div className={css.actions}>
          {status.account.login === "signed-in" ? (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                act("logout").catch(() => undefined);
              }}
            >
              {t("signOut")}
            </Button>
          ) : (
            <>
              <Button
                variant="primary"
                disabled={disabled}
                onClick={() => {
                  act("login").catch(() => undefined);
                }}
              >
                {t("signIn")}
              </Button>
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() => {
                  act("cancel").catch(() => undefined);
                }}
              >
                {t("cancelLogin")}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            disabled={disabled || status.defaultModel === undefined}
            onClick={() => {
              act("probe", {
                model: status.defaultModel ?? "gpt-6-sol",
              }).catch(() => undefined);
            }}
          >
            {t("probe")}
          </Button>
        </div>
        <p className={css.note}>{t("logoutNote")}</p>
      </section>
    </div>
  );
}
