/**
 * x-music 服务插件，浏览器半：向现有侧栏注册 x-music 入口图标行，向中心 main
 * 槽注册内嵌打开 x-music Web 端的面板（地址取插件配置，经 configForms/settings
 * 体系热生效）。注册范式与 ui-plugin-manager 一致，不改动侧栏与布局的任何现有
 * 行为：入口随插件启停出现与消失、点击切换与选中态都由框架承担。
 *
 * 第一阶段按剃刀法则只做这两处注册：没有配置表单（feat04）、没有加载超时提示
 * 与系统浏览器兜底（feat02 场景3）、没有刷新恢复选中态；不访问也不注入 layout
 * 服务——cordis-client-runner 按 inject 声明门禁 ctx.<服务> 访问，不用就不声明。
 */
import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import { en, zh, type XmusicLocaleKey } from "./locales.ts";
import { XmusicIcon } from "./XmusicIcon.tsx";
import { XmusicPanel, type BoardUrlState } from "./XmusicPanel.tsx";

/** 浏览器半依赖的服务：槽注册、词典与配置投影（不用 layout）。 */
export const inject = ["slots", "locale", "configForms"];

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** x-music 面板文案。 */
    xmusic: XmusicLocaleKey;
  }
}

/** 本插件拥有的词典命名空间。 */
export const NS = "xmusic";

/** 侧栏入口与 main 面板共享的面板 id（ui-layout 的 branded 字符串）。 */
export const PANEL_ID = brandString<MainPanelId>("xmusic");

/** 本包 bundle patch 声明的行 id：settings 配置命名空间即行 id。 */
const ROW_ID = "kmh-xmusic";

/**
 * 侧栏顺序：MadeMe 10、Infra 11、Token 分析 12，本入口排在现有服务插件之后
 * （feat01 场景1）。这是界面排序，不是插件行为的功能性数值，不作配置项。
 */
const SIDEBAR_ORDER = 13;

/**
 * 注册侧栏入口与中心面板，并把配置投影成面板快照。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "kmh-xmusic: dictionaries",
  );
  const t = ctx.locale.bind(NS);

  // 面板 face：从共享配置投影面板地址，配置变更后热生效。
  const configScope = ctx.configForms.get<Record<string, unknown>>(ROW_ID);
  const projectBoardUrl = (): BoardUrlState => {
    const snapshot = configScope.getSnapshot();
    const value = snapshot.value;
    const url =
      typeof value?.boardUrl === "string" && value.boardUrl !== ""
        ? value.boardUrl
        : undefined;
    // ready 当且仅当地址可用；settings 已就绪但值不可用时报 unavailable，
    // 而不是把 settings 的 "ready" 原样抄过来。
    const status: BoardUrlState["status"] =
      snapshot.status === "ready"
        ? url !== undefined
          ? "ready"
          : "unavailable"
        : snapshot.status;
    return { status, url };
  };
  const boardUrlStore = createSnapshotStore<BoardUrlState>(projectBoardUrl());
  ctx.effect(() => {
    const dispose = configScope.subscribe(() => {
      boardUrlStore.set(projectBoardUrl());
    });
    return () => {
      dispose();
    };
  }, "kmh-xmusic: board url store");

  ctx.slots.inject("main", function* () {
    yield ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ hooks: { xmusicBoardUrl: boardUrlStore } }),
      },
      XmusicPanel,
    );
  });
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: SIDEBAR_ORDER,
        label: () => t("panel"),
        locale: NS,
      },
      XmusicIcon,
    ),
  );
}
