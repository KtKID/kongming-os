/**
 * Codex 详情卡片：账号、版本、开关与测试连接，贡献到插件管理区的
 * `plugins.item` 槽位。`view: summary` 只出一句话简介（列表卡片与详情页
 * 标题下共用）；`view: page` 才渲染完整内容，因此详情页只出现一份。
 */
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
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

/** 状态接口形态（与 Host 侧 status 路由一致）。 */
interface StatusResponse {
  account: {
    login: string;
    credentialSource?: string;
    authorizeUrl?: string;
    error?: string;
  };
  version: { version?: string; ok: boolean; reason?: string };
  nativeToolsEnabled: boolean;
  defaultModel?: string;
  lastProbe?: { at: string; ok: boolean; error?: string };
}

/** 组合 props：槽位运行时份额（`view`）与注册声明的 locale 注入（`t`）。 */
export type CodexCardProps = PropsRuntime<"plugins.item"> &
  PropsLocale<"settings.codex-cli">;

/** 详情页行布局：标签列固定宽，内容列随 DSW 排版 token 取次级色。 */
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 12,
};
const labelStyle: CSSProperties = {
  flex: "0 0 96px",
  fontSize: 13,
  color: "var(--dsw-alias-label-secondary)",
};
const valueStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
  minWidth: 0,
};
const detailStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--dsw-alias-label-secondary)",
  overflowWrap: "anywhere",
};
const noteStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: "18px",
  color: "var(--dsw-alias-label-secondary)",
};
const actionsStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

/** 状态响应守卫：字段存在且类型正确才采用。 */
function isStatus(value: unknown): value is StatusResponse {
  if (value === null || typeof value !== "object") return false;
  const account = fieldOf(value, "account");
  const version = fieldOf(value, "version");
  return (
    isRecordWith(account, "login", "string") &&
    isRecordWith(version, "ok", "boolean") &&
    typeof fieldOf(value, "nativeToolsEnabled") === "boolean"
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
function accountView(t: CodexCardProps["t"], login: string): {
  text: string;
  tone: TagTone;
} {
  if (login === "signed-in") return { text: t("accountSignedIn"), tone: "success" };
  if (login === "waiting") return { text: t("accountWaiting"), tone: "warning" };
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
    <div style={rowStyle}>
      <span style={labelStyle}>{label}</span>
      <span style={valueStyle}>{children}</span>
    </div>
  );
}

/**
 * 拉取并按请求视图渲染：简介一句话或完整详情。
 * @param props - 槽位传入的 `view` 与 locale 注入的 `t`。
 * @returns 简介文本节点，或完整详情卡片。
 */
export function CodexCard(props: CodexCardProps): JSX.Element {
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
      try {
        await fetch(`/api/codex-cli/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        await refresh();
      } finally {
        setBusy(undefined);
      }
    },
    [refresh],
  );
  if (props.view === "summary") return <>{t("summary")}</>;
  if (status === undefined)
    return (
      <p style={noteStyle}>
        <StateDot state="ongoing" /> {t("loading")}
      </p>
    );
  const account = accountView(t, status.account.login);
  const disabled = busy !== undefined;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
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
          <span style={detailStyle}>{status.version.reason}</span>
        )}
      </Row>
      <Row label={t("accountLabel")}>
        <Tag tone={account.tone}>{account.text}</Tag>
        {status.account.error !== undefined && (
          <span style={detailStyle}>{status.account.error}</span>
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
              <span style={detailStyle}>{status.lastProbe.error}</span>
            )}
          </>
        )}
      </Row>
      <Row label={t("nativeTools")}>
        <Switch
          checked={status.nativeToolsEnabled}
          onChange={(next) => {
            act("config", { nativeToolsEnabled: next }).catch(() => undefined);
          }}
          label={t("nativeTools")}
        />
      </Row>
      <p style={noteStyle}>{t("nativeToolsHint")}</p>
      {status.account.authorizeUrl !== undefined && (
        <div style={actionsStyle}>
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
      <div style={actionsStyle}>
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
      <p style={noteStyle}>{t("logoutNote")}</p>
    </div>
  );
}
