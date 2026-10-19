/**
 * 聚合 Token 分析中心面板：只有内嵌网页视口，没有工具栏（spec 确认记录：
 * 按剃刀法则删去）。地址与加载超时都取自插件配置（configForms 的 settings
 * 体系）：改地址或改超时保存后，面板按新值重新加载，不需要重启。
 *
 * 本插件只展示（C1）：组件内没有任何读取、解析或改写 iframe 页面内容的
 * 代码；页面内容全部由 x-token 提供，x-token 升级页面后本组件无需改动。
 * 面板卸载即销毁 iframe，切回按当前地址重新加载（WebKit 系浏览器搬移
 * iframe 会重载，见 MadeMe 的 task-embed-panel dev-report T2）。
 */
import { useEffect, useState, type ReactNode } from "react";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { InjectFace, PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import { ensureStyles } from "./styles.ts";

ensureStyles();

/** 页面地址与加载超时的投影快照。 */
export interface PageTargetState {
  /** 配置读取状态；ready 表示地址与超时都可用。 */
  status: "loading" | "ready" | "unavailable";
  /** 规范化后的页面地址；未就绪时为 undefined。 */
  url: string | undefined;
  /** 当前生效的加载超时（毫秒），来自配置。 */
  loadTimeoutMs: number | undefined;
}

/** 面板注册侧注入的 face：页面目标的活快照。 */
export interface TokenAnalysisPanelFace {
  hooks: {
    /** 页面目标快照，渲染器绑定为 useTokenPageTarget。 */
    tokenPageTarget: SnapshotStore<PageTargetState>;
  };
}

/** 面板 props：词典 + 注入 face。 */
export type TokenAnalysisPanelProps = PropsLocale<"tokenAnalysis"> &
  InjectFace<TokenAnalysisPanelFace>;

/**
 * 渲染聚合 Token 分析内嵌面板。
 * @param props - 词典与页面目标快照。
 * @returns 面板元素。
 */
export function TokenAnalysisPanel(props: TokenAnalysisPanelProps): ReactNode {
  const { t } = props;
  const target = props.useTokenPageTarget((snapshot) => snapshot);
  const [timedOut, setTimedOut] = useState(false);

  const url = target.status === "ready" ? target.url : undefined;
  const loadTimeoutMs =
    target.status === "ready" ? target.loadTimeoutMs : undefined;

  // 每次加载（新地址或新超时）启动计时；load 事件清零。
  useEffect(() => {
    if (url === undefined || loadTimeoutMs === undefined) return;
    setTimedOut(false);
    const timer = window.setTimeout(() => {
      setTimedOut(true);
    }, loadTimeoutMs);
    return () => {
      window.clearTimeout(timer);
    };
  }, [url, loadTimeoutMs]);

  if (url === undefined || loadTimeoutMs === undefined) {
    // 页面级加载统一在中心显示共享 loader，不放在角落。
    return (
      <div
        className="token-analysis-panel token-analysis-centered"
        role="status"
      >
        <StateDot state="ongoing" />
      </div>
    );
  }

  return (
    <div className="token-analysis-panel">
      {timedOut && (
        <p className="token-analysis-notice" role="alert">
          {t("panel.timeoutTitle")}：{t("panel.timeoutHint")}
          <span className="token-analysis-notice-url">{url}</span>
        </p>
      )}
      <iframe
        key={url}
        src={url}
        title={t("panel")}
        onLoad={() => {
          setTimedOut(false);
        }}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        className="token-analysis-frame"
      />
    </div>
  );
}
