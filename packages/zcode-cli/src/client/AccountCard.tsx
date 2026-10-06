/** Inline account authorization and minimal model probe in Plugins. */
import { useEffect, useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import qrcode from "qrcode-generator";
import { z } from "zod";
import { PublicStatus } from "../status.ts";
import { authorizeUrl } from "../authorize-url.ts";
import type { LocaleKey } from "./locales.ts";

type Props = PropsRuntime<"plugins.item"> & PropsLocale<"settings.zcode-cli">;
type Action = "login" | "cancel" | "logout" | "check";
const failure = z.object({ error: z.string() });
async function request(
  action: "status" | Action,
  attemptId?: string,
): Promise<PublicStatus> {
  const response = await fetch(`/api/zcode-cli/${action}`, {
    method: action === "status" ? "GET" : "POST",
    ...(action === "cancel"
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId }),
        }
      : {}),
  });
  const value: unknown = await response.json();
  if (!response.ok) throw new Error(failure.parse(value).error);
  return PublicStatus.parse(value);
}
function errorKey(code: string): LocaleKey {
  switch (code) {
    case "ZCODE_CLI_MISSING":
      return "missing";
    case "ZCODE_LOGIN_TIMEOUT":
      return "timeout";
    case "ZCODE_PROBE_TIMEOUT":
      return "probeTimeout";
    case "ZCODE_REQUEST_TIMEOUT":
      return "requestTimeout";
    case "ZCODE_LOGIN_FAILED":
      return "loginFailed";
    case "ZCODE_CREDENTIAL_INVALID":
    case "ZCODE_CREDENTIAL_READ_FAILED":
      return "credential";
    case "ZCODE_LOGIN_REQUIRED":
      return "loginRequired";
    case "ZCODE_MODEL_CONNECTION_FAILED":
      return "modelFailed";
    case "ZCODE_MODEL_REGISTRATION_FAILED":
      return "registrationFailed";
    case "ZCODE_PERSONAL_CONFIG_INVALID":
      return "personalConfigInvalid";
    case "ZCODE_MODELS_ENDPOINT_FAILED":
    case "ZCODE_MODELS_ENDPOINT_EMPTY":
      return "modelsUnavailable";
    case "ZCODE_LOGIN_ATTEMPT_CHANGED":
      return "attemptChanged";
    default:
      return "actionFailed";
  }
}
function QrCode({ url, label }: { url: string; label: string }) {
  const qr = qrcode(0, "M");
  qr.addData(authorizeUrl(url).href);
  qr.make();
  const count = qr.getModuleCount();
  const blocks: string[] = [];
  for (let row = 0; row < count; row++)
    for (let col = 0; col < count; col++)
      if (qr.isDark(row, col)) blocks.push(`M${col + 4},${row + 4}h1v1h-1z`);
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${count + 8} ${count + 8}`}
      width={220}
      height={220}
      style={{ background: "white", display: "block" }}
    >
      <path d={blocks.join("")} fill="black" />
    </svg>
  );
}
function AccountPanel({ t }: PropsLocale<"settings.zcode-cli">) {
  const [state, setState] = useState<PublicStatus>();
  const [busy, setBusy] = useState<Action>();
  const [error, setError] = useState<LocaleKey>();
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async (): Promise<void> => {
      try {
        const status = await request("status");
        if (!controller.signal.aborted) setState(status);
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? errorKey(cause.message) : "network",
          );
      } finally {
        if (!controller.signal.aborted)
          timer = setTimeout(() => {
            refresh().catch(() => undefined);
          }, 1500);
      }
    };
    refresh().catch(() => undefined);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);
  function act(action: Action): void {
    setBusy(action);
    setError(undefined);
    request(action, state?.attemptId)
      .then(setState, (cause: unknown) => {
        setError(cause instanceof Error ? errorKey(cause.message) : "network");
      })
      .finally(() => {
        setBusy(undefined);
      })
      .catch(() => undefined);
  }
  const loginKeys = {
    idle: "idle",
    starting: "starting",
    waiting: "waiting",
    "signed-in": "signedIn",
    cancelled: "cancelled",
    failed: "failed",
  } satisfies Record<PublicStatus["login"], LocaleKey>;
  const connectionKeys = {
    unchecked: "unchecked",
    registered: "registered",
    ready: "ready",
    failed: "failed",
  } satisfies Record<PublicStatus["connection"], LocaleKey>;
  const waiting = state?.login === "waiting" || state?.login === "starting";
  const signedIn = state?.login === "signed-in";
  const url =
    state?.authorizeUrl && state.login === "waiting"
      ? authorizeUrl(state.authorizeUrl).href
      : undefined;
  const shownError =
    error ?? (state?.error ? errorKey(state.error) : undefined);
  if (!state)
    return (
      <p role={shownError ? "alert" : "status"}>{t(shownError ?? "loading")}</p>
    );
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <p>
        {t(state?.accountFamily === "bigmodel" ? "bigmodelIntro" : "intro")}
      </p>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr",
          gap: 12,
          margin: 0,
        }}
      >
        <dt>{t("account")}</dt>
        <dd style={{ margin: 0 }}>
          {t(state ? loginKeys[state.login] : "starting")}
        </dd>
        {state.credentialSource && (
          <>
            <dt>{t("credentialSource")}</dt>
            <dd style={{ margin: 0 }}>
              {t(
                state.credentialSource === "desktop"
                  ? "sourceDesktop"
                  : "sourcePlugin",
              )}
            </dd>
          </>
        )}
        <dt>{t("model")}</dt>
        <dd style={{ margin: 0 }}>{state?.model}</dd>
        <dt>{t("reasoning")}</dt>
        <dd style={{ margin: 0 }}>{t("high")}</dd>
        <dt>{t("connection")}</dt>
        <dd style={{ margin: 0 }}>
          {t(
            busy === "check"
              ? "checking"
              : state
                ? connectionKeys[state.connection]
                : "unchecked",
          )}
        </dd>
      </dl>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {waiting ? (
          <Button
            variant="outline"
            disabled={!!busy}
            onClick={() => {
              act("cancel");
            }}
          >
            {t("cancel")}
          </Button>
        ) : (
          <>
            <Button
              variant={signedIn ? "outline" : "primary"}
              disabled={!!busy || !state}
              onClick={() => {
                act("login");
              }}
            >
              {t(
                signedIn
                  ? "retry"
                  : state?.accountFamily === "bigmodel"
                    ? "bigmodelLogin"
                    : "login",
              )}
            </Button>
            {signedIn && (
              <>
                <Button
                  variant="primary"
                  disabled={!!busy}
                  onClick={() => {
                    act("check");
                  }}
                >
                  {t(busy === "check" ? "checking" : "check")}
                </Button>
                <Button
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => {
                    act("logout");
                  }}
                >
                  {t("logout")}
                </Button>
              </>
            )}
          </>
        )}
      </div>
      {url && (
        <div style={{ display: "grid", gap: 12 }}>
          <QrCode url={url} label={t("qr")} />
          <p>{t(state?.accountFamily === "bigmodel" ? "bigmodelQr" : "qr")}</p>
          <a href={url} target="_blank" rel="noreferrer">
            {t("open")}
          </a>
        </div>
      )}
      {shownError && <p role="alert">{t(shownError)}</p>}
      {state.error && (
        <p>
          {t("errorCode")}: <code>{state.error}</code>
        </p>
      )}
      {state.diagnostic && (
        <div role="alert" style={{ overflowWrap: "anywhere" }}>
          <p>
            {t("nativeCode")}: <code>{state.diagnostic.code}</code>
          </p>
          <p style={{ whiteSpace: "pre-wrap" }}>
            {t("nativeMessage")}: {state.diagnostic.message}
          </p>
        </div>
      )}
    </div>
  );
}
/**
 * Render the plugin summary or account controls inside the existing Plugins page.
 * @param props - View and locale supplied by the slot renderer.
 * @returns Summary text or expandable authorization controls.
 */
export function AccountCard(props: Props) {
  return props.view === "summary" ? (
    props.t("description")
  ) : (
    <AccountPanel t={props.t} />
  );
}
