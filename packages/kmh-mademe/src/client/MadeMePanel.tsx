/**
 * MadeMe 中心面板：内嵌网页视口 + 工具栏（地址展示、刷新、在系统浏览器
 * 打开）+ 加载超时提示。地址取自插件配置（configForms 的 settings 体系，
 * 修改后热生效）；面板卸载即销毁 iframe，切回按当前地址重新加载
 * （WebKit 系浏览器搬移 iframe 会重载，保活池在实测中不成立，见
 * task-embed-panel dev-report T2）。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { InjectFace, PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";

/** 服务地址的投影快照。 */
export interface ServiceUrlState {
  status: "loading" | "ready" | "unavailable";
  url: string | undefined;
}

/** 面板注册侧注入的 face：服务地址活快照。 */
export interface MadeMePanelFace {
  hooks: {
    /** 服务地址快照，渲染器绑定为 useMadeMeServiceUrl。 */
    madeMeServiceUrl: SnapshotStore<ServiceUrlState>;
  };
}

/** 面板 props：词典 + 注入 face。 */
export type MadeMePanelProps = PropsLocale<"mademe"> &
  InjectFace<MadeMePanelFace>;

/** 加载超时阈值：此后提示可能无法内嵌打开。 */
const LOAD_TIMEOUT_MS = 8000;

/**
 * 渲染 MadeMe 内嵌网页面板。
 * @param props - 词典与服务地址快照。
 * @returns 面板元素。
 */
export function MadeMePanel(props: MadeMePanelProps): ReactNode {
  const { t } = props;
  const service = props.useMadeMeServiceUrl((snapshot) => snapshot);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  const url = service.status === "ready" ? service.url : undefined;

  // 每次加载（新地址或刷新）启动超时计时；load 事件清零。
  useEffect(() => {
    if (url === undefined) return;
    setTimedOut(false);
    const timer = window.setTimeout(() => {
      setTimedOut(true);
    }, LOAD_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [url, reloadNonce]);

  const onFrameLoad = (): void => {
    setTimedOut(false);
  };

  if (service.status !== "ready" || url === undefined) {
    return <div style={{ padding: 24 }}>{t("panel.waitingConfig")}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderBottom: "1px solid rgba(128,128,128,0.25)",
          flexWrap: "wrap",
        }}
      >
        <span
          role="status"
          style={{
            fontFamily: "monospace",
            fontSize: 12,
            opacity: 0.8,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 360,
          }}
        >
          {url}
        </span>
        <Button
          variant="toolbar"
          size="sm"
          onClick={() => {
            setReloadNonce((nonce) => nonce + 1);
          }}
        >
          {t("panel.reload")}
        </Button>
        <Button
          variant="toolbar"
          size="sm"
          onClick={() => {
            window.open(url, "_blank", "noopener");
          }}
        >
          {t("panel.openExternal")}
        </Button>
      </div>
      {timedOut && (
        <div role="alert" style={{ padding: "8px 12px", fontSize: 13 }}>
          {t("panel.timeoutTitle")}——{t("panel.timeoutHint")}
        </div>
      )}
      <iframe
        key={`${url}#${reloadNonce}`}
        src={url}
        title="MadeMe"
        onLoad={onFrameLoad}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        style={{ flex: 1, width: "100%", border: "none" }}
      />
    </div>
  );
}
