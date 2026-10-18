/**
 * x-music 中心面板：只有一个内嵌 x-music Web 端的 iframe，没有工具栏、没有
 * 加载超时提示、没有系统浏览器兜底（2026-10-18 拍板：面板打不开不做特殊处理，
 * 面板内就是浏览器对该 iframe 的原生呈现）。地址取自插件配置（configForms 的
 * settings 体系），配置就绪前显示共享加载点。
 *
 * 本插件只展示：组件内没有任何读取、解析或改写 iframe 页面内容的代码，面板
 * 里的搜歌、点播、听歌数据全部由 x-music 提供。面板卸载即销毁 iframe，切回
 * 按当前地址重新加载（feat02 场景2；WebKit 系浏览器搬移 iframe 必定重载）。
 */
import type { ReactNode } from "react";
import { StateDot } from "@deepseek-ai/dsh-client-ui-primitives";
import type { SnapshotStore } from "@deepseek-ai/dsh-client-store";
import type { InjectFace, PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";

/** 面板地址的投影快照。 */
export interface BoardUrlState {
  /** 配置读取状态；ready 表示地址可用。 */
  status: "loading" | "ready" | "unavailable";
  /** 面板地址；未就绪时为 undefined。 */
  url: string | undefined;
}

/** 面板注册侧注入的 face：面板地址的活快照。 */
export interface XmusicPanelFace {
  hooks: {
    /** 面板地址快照，渲染器绑定为 useXmusicBoardUrl。 */
    xmusicBoardUrl: SnapshotStore<BoardUrlState>;
  };
}

/** 面板 props：词典 + 注入 face。 */
export type XmusicPanelProps = PropsLocale<"xmusic"> &
  InjectFace<XmusicPanelFace>;

/**
 * 渲染 x-music 内嵌面板。
 * @param props - 词典与面板地址快照。
 * @returns 面板元素。
 */
export function XmusicPanel(props: XmusicPanelProps): ReactNode {
  const { t } = props;
  const board = props.useXmusicBoardUrl((snapshot) => snapshot);
  const url = board.status === "ready" ? board.url : undefined;

  if (url === undefined) {
    // 配置就绪前在中心显示共享加载点，不放在角落。
    return (
      <div
        role="status"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
        }}
      >
        <StateDot state="ongoing" />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <iframe
        key={url}
        src={url}
        title={t("panel")}
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        style={{ flex: 1, width: "100%", border: "none" }}
      />
    </div>
  );
}
