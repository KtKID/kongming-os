/**
 * 工具开关区块：KMH 工具一列、Codex 原生能力一列；拉清单、乐观切换、
 * 失败回滚与提示、原生读取失败的降级与重新读取。只在 codex-cli 页面渲染。
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
  StateDot,
  Switch,
} from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import {
  ToolSwitchListSchema,
  type ToolSwitch,
  type ToolSwitchList,
} from "@kmh/codex-cli/tool-switches";
import { SWITCHES_PATH } from "../paths.ts";
import { fieldOf, matchesSubject, withSwitch } from "./state.ts";
import type { LocaleKey } from "./locales.ts";

/** 原生能力键 → 本地化标签与说明键；未知键回落原文。 */
const NATIVE_TEXT: Record<string, { label: LocaleKey; desc: LocaleKey }> = {
  "command-execution": {
    label: "native.command-execution",
    desc: "nativeDesc.command-execution",
  },
  "file-change": {
    label: "native.file-change",
    desc: "nativeDesc.file-change",
  },
  "view-image": { label: "native.view-image", desc: "nativeDesc.view-image" },
  "web-search": { label: "native.web-search", desc: "nativeDesc.web-search" },
};

/** 槽位运行时份额（`subject`）与注册声明的 locale 注入（`t`）。 */
export type SwitchPanelProps = PropsRuntime<"plugins.detail.section"> &
  PropsLocale<"settings.cli-tools-selector">;

const sectionStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};
const titleStyle: CSSProperties = { fontSize: 14, fontWeight: 600 };
const noteStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: "18px",
  color: "var(--dsw-alias-label-secondary)",
};
const columnsStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  gap: 16,
};
const columnStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  minWidth: 0,
};
const headerStyle: CSSProperties = {
  fontSize: 13,
  color: "var(--dsw-alias-label-secondary)",
};
const listStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  maxHeight: 360,
  overflowY: "auto",
};
const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
};
const textStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
};
const labelStyle: CSSProperties = { fontSize: 13, lineHeight: "18px" };
const detailStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--dsw-alias-label-secondary)",
  overflowWrap: "anywhere",
};
const actionsStyle: CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  flexWrap: "wrap",
};

/** 从失败响应体提取可读原因；无结构时回落 HTTP 状态。 */
function reasonOf(body: unknown, status: number): string {
  const error = fieldOf(body, "error");
  const reason = fieldOf(body, "reason");
  const errorText = typeof error === "string" ? error : "";
  const reasonText = typeof reason === "string" ? reason : "";
  if (errorText !== "" || reasonText !== "")
    return reasonText === "" ? errorText : `${errorText}: ${reasonText}`;
  return `HTTP ${String(status)}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 拉取并渲染开关清单；非 codex-cli 页面不渲染。
 * @param props - 槽位传入的 `subject` 与 locale 注入的 `t`。
 */
export function SwitchPanel(props: SwitchPanelProps): JSX.Element | null {
  const { subject, t } = props;
  const active = matchesSubject(subject);
  const [list, setList] = useState<ToolSwitchList | undefined>();
  const [failure, setFailure] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const load = useCallback(async (refresh: boolean) => {
    setFailure(undefined);
    try {
      const response = await fetch(
        refresh ? `${SWITCHES_PATH}?refresh=1` : SWITCHES_PATH,
        { cache: "no-store" },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        setFailure(reasonOf(body, response.status));
        return;
      }
      setList(ToolSwitchListSchema.parse(body));
    } catch (error) {
      setFailure(messageOf(error));
    }
  }, []);
  useEffect(() => {
    if (active) load(false).catch(() => undefined);
  }, [active, load]);
  const toggle = useCallback(
    async (row: ToolSwitch, enabled: boolean) => {
      if (list === undefined || busy !== undefined) return;
      const previous = list;
      setList(withSwitch(list, row.id, enabled));
      setBusy(row.id);
      setNotice(undefined);
      try {
        const response = await fetch(SWITCHES_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            id: row.id,
            enabled,
            revision: previous.revision,
          }),
        });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(reasonOf(body, response.status));
        setList(ToolSwitchListSchema.parse(body));
        setNotice(t("saved"));
      } catch (error) {
        setList(previous);
        setNotice(`${t("saveFailed")}${messageOf(error)}`);
      } finally {
        setBusy(undefined);
      }
    },
    [list, busy, t],
  );
  if (!active) return null;
  const nativeText = (row: ToolSwitch): { label: string; desc: string } => {
    const entry = NATIVE_TEXT[row.name];
    return entry === undefined
      ? { label: row.name, desc: row.description }
      : { label: t(entry.label), desc: t(entry.desc) };
  };
  const renderRow = (row: ToolSwitch, native: boolean): ReactNode => {
    const text = native
      ? nativeText(row)
      : { label: row.name, desc: row.description };
    return (
      <span key={row.id} style={rowStyle}>
        <Switch
          checked={row.enabled}
          disabled={busy !== undefined}
          onChange={(next) => {
            toggle(row, next).catch(() => undefined);
          }}
          label={text.label}
        />
        <span style={textStyle}>
          <span style={labelStyle}>{text.label}</span>
          <span style={detailStyle}>
            {native
              ? `${text.desc}（${t("covers")} ${row.covers.join("、")}）`
              : text.desc}
          </span>
        </span>
      </span>
    );
  };
  return (
    <div style={sectionStyle}>
      <span style={titleStyle}>{t("title")}</span>
      <p style={noteStyle}>{t("note")}</p>
      {failure !== undefined ? (
        <div style={actionsStyle}>
          <span style={detailStyle}>
            {t("loadFailed")}
            {failure}
          </span>
          <Button
            variant="outline"
            onClick={() => {
              load(false).catch(() => undefined);
            }}
          >
            {t("retry")}
          </Button>
        </div>
      ) : list === undefined ? (
        <p style={noteStyle}>
          <StateDot state="ongoing" /> {t("loading")}
        </p>
      ) : (
        <div style={columnsStyle}>
          <div style={columnStyle}>
            <span style={headerStyle}>{t("kmhColumn")}</span>
            <div style={listStyle}>
              {list.kmh.map((row) => renderRow(row, false))}
            </div>
          </div>
          <div style={columnStyle}>
            <span style={headerStyle}>{t("nativeColumn")}</span>
            {!list.nativeStatus.ok && (
              <div style={actionsStyle}>
                <span style={detailStyle}>
                  {t("nativeFailed")}
                  {list.nativeStatus.reason}
                </span>
                <Button
                  variant="outline"
                  onClick={() => {
                    load(true).catch(() => undefined);
                  }}
                >
                  {t("refresh")}
                </Button>
              </div>
            )}
            <div style={listStyle}>
              {list.native.map((row) => renderRow(row, true))}
            </div>
          </div>
        </div>
      )}
      {notice !== undefined && <p style={noteStyle}>{notice}</p>}
    </div>
  );
}
