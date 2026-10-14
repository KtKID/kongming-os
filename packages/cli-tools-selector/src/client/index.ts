/** 工具开关区块在 Codex 插件详情页的挂载与文案。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import { SwitchPanel } from "./SwitchPanel.tsx";
import { zh, en, type LocaleKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** Tool switch panel copy. */
    "settings.cli-tools-selector": LocaleKey;
  }
}

/** Services needed for the detail-section contribution. */
export const inject = ["slots", "locale"];

/**
 * Register the switch panel section and its dictionaries.
 * @param ctx - Client plugin owner.
 */
export function apply(ctx: Context): void {
  const namespace = "settings.cli-tools-selector";
  ctx.effect(
    () => ctx.locale.register(namespace, { zh, en }),
    "cli-tools-selector: locale",
  );
  ctx.effect(
    () =>
      ctx.slots.inject("plugins.detail.section", () =>
        ctx.slots.register(
          {
            name: "plugins.detail.section",
            id: "cli-tools-selector",
            order: 10,
            locale: namespace,
          },
          SwitchPanel,
        ),
      ),
    "cli-tools-selector: section",
  );
}
