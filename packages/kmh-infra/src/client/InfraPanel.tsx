/**
 * Infra 中心面板：内嵌 x-dash 面板的视口 + 工具栏（地址展示、刷新、在系统
 * 浏览器打开）+ 加载超时提示。
 *
 * 地址与超时都取自插件配置（configForms 的 settings 体系）：改地址或改
 * `panelLoadTimeoutMs` 保存后，面板按新值重新加载，不需要重启。面板卸载即
 * 销毁 iframe，切回按当前地址重新加载（WebKit 系浏览器搬移 iframe 会重载，
 * 保活池在实测中不成立，见 MadeMe 的 task-embed-panel dev-report T2）。
 */
import { useEffect, useState, type ReactNode } from "react";
import { Button, StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { InjectFace, PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import { ensureStyles } from "./styles.ts";

ensureStyles();

/** 面板地址与加载超时的投影快照。 */
export interface DashTargetState {
  /** 配置读取状态；ready 表示地址与超时都可用。 */
  status: "loading" | "ready" | "unavailable";
  /** 规范化后的面板地址；未就绪时为 undefined。 */
  url: string | undefined;
  /** 当前生效的加载超时（毫秒），来自配置。 */
  loadTimeoutMs: number | undefined;
}

/** 面板注册侧注入的 face：面板目标的活快照。 */
export interface InfraPanelFace {
  hooks: {
    /** 面板目标快照，渲染器绑定为 useInfraDashTarget。 */
    infraDashTarget: SnapshotStore<DashTargetState>;
  };
}

/** 面板 props：词典 + 注入 face。 */
export type InfraPanelProps = PropsLocale<"infra"> & InjectFace<InfraPanelFace>;

/**
 * 渲染 Infra 内嵌面板。
 * @param props - 词典与面板目标快照。
 * @returns 面板元素。
 */
export function InfraPanel(props: InfraPanelProps): ReactNode {
  const { t } = props;
  const target = props.useInfraDashTarget((snapshot) => snapshot);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [timedOut, setTimedOut] = useState(false);

  const ready = target.status === "ready";
  const url = ready ? target.url : undefined;
  const loadTimeoutMs = ready ? target.loadTimeoutMs : undefined;

  // 每次加载（新地址、新超时或刷新）启动计时；load 事件清零。
  useEffect(() => {
    if (url === undefined || loadTimeoutMs === undefined) return;
    setTimedOut(false);
    const timer = window.setTimeout(() => {
      setTimedOut(true);
    }, loadTimeoutMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [url, loadTimeoutMs, reloadNonce]);

  if (url === undefined || loadTimeoutMs === undefined) {
    // 页面级加载统一在中心显示共享 loader，不放在角落。
    return (
      <div className="infra-panel infra-centered" role="status">
        <StateDot state="ongoing" />
      </div>
    );
  }

  return (
    <div className="infra-panel">
      <div className="infra-toolbar">
        <span className="infra-address" role="status">
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
        <p className="infra-notice" role="alert">
          {t("panel.timeoutTitle")}：{t("panel.timeoutHint")}
        </p>
      )}
      <iframe
        key={`${url}#${reloadNonce}`}
        src={url}
        title={t("panel")}
        onLoad={() => {
          setTimedOut(false);
        }}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="infra-frame"
      />
    </div>
  );
}
