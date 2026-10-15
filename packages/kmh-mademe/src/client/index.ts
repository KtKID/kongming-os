/**
 * MadeMe 服务插件，浏览器半：向现有侧栏注册 MadeMe 入口图标行，向中心
 * main 槽注册 MadeMe 内嵌网页面板（地址取插件配置，configForms/settings
 * 体系热生效），向插件页注册 MadeMe 配置表单（bundle 详情页内联与行详情
 * 两处），并把选中态镜像到 localStorage 以支持刷新恢复。注册范式与
 * ui-plugin-manager 一致，不改动侧栏与布局的任何现有行为。
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
import { en, zh, type MadeMeLocaleKey } from "./locales.ts";
import { MadeMeConfigController } from "./config-controller.ts";
import { MadeMeConfigForm } from "./ConfigForm.tsx";
import { MadeMeIcon } from "./MadeMeIcon.tsx";
import { MadeMePanel, type ServiceUrlState } from "./MadeMePanel.tsx";

/** 浏览器半依赖的服务：槽注册、词典、布局（选中/恢复）与配置表单。 */
export const inject = ["slots", "locale", "layout", "configForms"];

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** MadeMe 面板文案。 */
    mademe: MadeMeLocaleKey;
  }
}

/** 本插件拥有的词典命名空间。 */
export const NS = "mademe";

/** 侧栏入口与 main 面板共享的面板 id（ui-layout 的 branded 字符串）。 */
export const PANEL_ID = brandString<MainPanelId>("mademe");

/** 本包名：插件页 keyed 槽（plugins.row.config）匹配键的组成部分。 */
const BUNDLE_PACKAGE = "@kmh/mademe";

/** 本包 bundle patch 声明的行 id：settings 配置命名空间即行 id。 */
const ROW_ID = "kmh-mademe";

/** 刷新恢复标记的 localStorage 键。 */
const ACTIVE_KEY = "kmh-mademe:active";

/**
 * 注册侧栏入口、中心面板与选中态镜像，并按 localStorage 标记恢复选中。
 * @param ctx - 浏览器插件上下文。
 */
export function apply(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "kmh-mademe: dictionaries",
  );
  const t = ctx.locale.bind(NS);

  // 面板 face：从共享配置表单投影服务地址，配置保存后热生效。
  const configScope =
    ctx.configForms.get<Record<string, unknown>>("kmh-mademe");
  const projectServiceUrl = (): ServiceUrlState => {
    const snapshot = configScope.getSnapshot();
    const url =
      typeof snapshot.value?.serviceUrl === "string" &&
      snapshot.value.serviceUrl !== ""
        ? snapshot.value.serviceUrl
        : undefined;
    return {
      status:
        snapshot.status === "ready" && url !== undefined
          ? "ready"
          : snapshot.status,
      url,
    };
  };
  const serviceUrlStore =
    createSnapshotStore<ServiceUrlState>(projectServiceUrl());
  ctx.effect(() => {
    const dispose = configScope.subscribe(() => {
      serviceUrlStore.set(projectServiceUrl());
    });
    return () => {
      dispose();
    };
  }, "kmh-mademe: service url store");

  ctx.slots.inject("main", function* () {
    yield ctx.slots.register(
      {
        name: "main",
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ hooks: { madeMeServiceUrl: serviceUrlStore } }),
      },
      MadeMePanel,
    );
  });
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 10,
        label: () => t("panel"),
        locale: NS,
      },
      MadeMeIcon,
    ),
  );
  // 配置表单：同时挂在插件详情页（bundle 级槽，key=包名）与组件行详情
  // （row 级槽，key=`包名#行id`）——两处共用一个 controller（ui-settings 的
  // configForms 服务读写，settings 体系，revision 乐观锁，volatile 热提交）。
  const configController = new MadeMeConfigController(
    ctx.configForms.get("kmh-mademe"),
  );
  ctx.effect(
    () => () => {
      configController.dispose();
    },
    "kmh-mademe: config controller",
  );
  ctx.slots.inject("plugins.bundle.config", () =>
    ctx.slots.register(
      {
        name: "plugins.bundle.config",
        key: BUNDLE_PACKAGE,
        locale: NS,
        inject: () => configController.inject(),
      },
      MadeMeConfigForm,
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
      MadeMeConfigForm,
    ),
  );

  // 选中态镜像：面板被选中时落标记，切走即清除；插件卸载时一并清除
  // 残留标记，避免重新启用后把上一次的选中强加给刷新恢复。
  ctx.effect(() => {
    const dispose = ctx.layout.panelInfo.subscribe(() => {
      if (ctx.layout.panelInfo.getSnapshot().activePanelId === PANEL_ID) {
        window.localStorage.setItem(ACTIVE_KEY, "1");
      } else {
        window.localStorage.removeItem(ACTIVE_KEY);
      }
    });
    return () => {
      dispose();
      window.localStorage.removeItem(ACTIVE_KEY);
    };
  }, "kmh-mademe: selection mirror");

  // 刷新恢复：微任务中尝试恢复，面板注册未完成时仅告警不阻断启动。
  if (window.localStorage.getItem(ACTIVE_KEY) === "1") {
    queueMicrotask(() => {
      try {
        ctx.layout.selectPanel(PANEL_ID);
      } catch (error) {
        console.warn("kmh-mademe: 刷新恢复面板选中失败", error);
      }
    });
  }
}
