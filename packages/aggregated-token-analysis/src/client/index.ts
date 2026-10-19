/**
 * 聚合 Token 分析视图插件，浏览器半：向现有侧栏注册"Token 分析"入口图标行，
 * 向中心 main 槽注册聚合 Token 分析页的内嵌视口（地址与加载超时取插件配置，
 * 经 configForms/settings 体系热生效），向插件页注册配置表单（bundle 详情页
 * 内联与行详情两处）。注册范式与 ui-plugin-manager 一致，不改动侧栏与布局
 * 的任何现有行为。
 *
 * 与 kmh-mademe、kmh-infra 的差异：不做选中态镜像与刷新恢复（spec 确认
 * 记录按剃刀法则删去），因此不访问也不注入 layout 服务——cordis-client-runner
 * 的守卫按 inject 声明门禁 ctx.<服务> 访问，不用就不声明。
 */
import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import { createSnapshotStore } from "@deepseek-ai/dsh-client-store";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import { en, zh, type TokenAnalysisLocaleKey } from "./locales.ts";
import {
  TokenAnalysisConfigController,
  type TokenAnalysisSettings,
} from "./config-controller.ts";
import { TokenAnalysisConfigForm } from "./ConfigForm.tsx";
import { createConfigWriter } from "./config-write.ts";
import { TokenAnalysisIcon } from "./TokenAnalysisIcon.tsx";
import {
  TokenAnalysisPanel,
  type PageTargetState,
} from "./TokenAnalysisPanel.tsx";

/** 浏览器半依赖的服务：槽注册、词典、配置表单与公开配置写入接口。 */
export const inject = [
  "slots",
  "locale",
  "configForms",
  "remote",
  "remote.settings",
];

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** 聚合 Token 分析面板文案。 */
    tokenAnalysis: TokenAnalysisLocaleKey;
  }
}

/** 本插件拥有的词典命名空间。 */
export const NS = "tokenAnalysis";

/** 侧栏入口与 main 面板共享的面板 id（ui-layout 的 branded 字符串）。 */
export const PANEL_ID = brandString<MainPanelId>("token-analysis");

/** 本包 bundle patch 声明的行 id：settings 配置命名空间即行 id。 */
const ROW_ID = "aggregated-token-analysis";

/** 本包名：插件页 keyed 槽（plugins.row.config）匹配键的组成部分。 */
const BUNDLE_PACKAGE = "@kmh/aggregated-token-analysis";

/** 侧栏顺序：MadeMe 为 10、Infra 为 11，本入口紧随其后。这是界面排序，不是插件行为的功能性数值，不作配置项（技术设计 D01）。 */
const SIDEBAR_ORDER = 12;

/**
 * 注册侧栏入口、中心面板与配置表单，并把配置投影成面板快照。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "aggregated-token-analysis: dictionaries",
  );
  const t = ctx.locale.bind(NS);

  // 面板 face：从共享配置表单投影地址与超时，配置保存后热生效（C2、C5）。
  const configScope = ctx.configForms.get<Record<string, unknown>>(ROW_ID);
  const projectPageTarget = (): PageTargetState => {
    const snapshot = configScope.getSnapshot();
    const value = snapshot.value;
    const url =
      typeof value?.pageUrl === "string" && value.pageUrl !== ""
        ? value.pageUrl
        : undefined;
    const timeout = value?.pageLoadTimeoutMs;
    const loadTimeoutMs =
      typeof timeout === "number" && Number.isFinite(timeout) && timeout > 0
        ? timeout
        : undefined;
    const ready =
      snapshot.status === "ready" &&
      url !== undefined &&
      loadTimeoutMs !== undefined;
    // ready 当且仅当地址与超时都可用；settings 已就绪但值不可用时报 unavailable，
    // 而不是把 settings 的 "ready" 原样抄过来（面板据此显示加载态而非空白）。
    const status: PageTargetState["status"] = ready
      ? "ready"
      : snapshot.status === "ready"
        ? "unavailable"
        : snapshot.status;
    return { status, url, loadTimeoutMs };
  };
  const pageTargetStore =
    createSnapshotStore<PageTargetState>(projectPageTarget());
  ctx.effect(() => {
    const dispose = configScope.subscribe(() => {
      pageTargetStore.set(projectPageTarget());
    });
    return () => {
      dispose();
    };
  }, "aggregated-token-analysis: page target store");

  ctx.slots.inject("main", function* () {
    yield ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ hooks: { tokenPageTarget: pageTargetStore } }),
      },
      TokenAnalysisPanel,
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
      TokenAnalysisIcon,
    ),
  );

  // 配置表单：同时挂在插件详情页（bundle 级槽，key=包名）与组件行详情
  // （row 级槽，key=`包名#行id`）——两处共用一个 controller（ui-settings 的
  // configForms 服务读写，settings 体系，revision 乐观锁，volatile 热提交）。
  const configController = new TokenAnalysisConfigController(
    ctx.configForms.get<TokenAnalysisSettings>(ROW_ID),
    createConfigWriter(ctx, ROW_ID),
  );
  ctx.effect(
    () => () => {
      configController.dispose();
    },
    "aggregated-token-analysis: config controller",
  );
  ctx.slots.inject("plugins.bundle.config", () =>
    ctx.slots.register(
      {
        name: "plugins.bundle.config",
        key: BUNDLE_PACKAGE,
        locale: NS,
        inject: () => configController.inject(),
      },
      TokenAnalysisConfigForm,
    ),
  );
  ctx.slots.inject("plugins.row.config", () =>
    ctx.slots.register(
      {
        name: "plugins.row.config",
        key: `${BUNDLE_PACKAGE}#${ROW_ID}`,
        locale: NS,
        inject: () => configController.inject(),
      },
      TokenAnalysisConfigForm,
    ),
  );
}
