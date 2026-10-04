/** Account controls contributed to the existing Plugins UI. */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import { AccountCard } from "./AccountCard.tsx";
import { zh, en, type LocaleKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** ZCode account and connection copy. */
    "settings.zcode-cli": LocaleKey;
  }
}

/** Services needed for the Plugins contribution. */
export const inject = ["slots", "locale"];
/**
 * Register the account card and dictionaries for the lifetime of this plugin.
 * @param ctx - Client plugin owner.
 */
export function apply(ctx: Context): void {
  const namespace = "settings.zcode-cli";
  const t = ctx.locale.bind(namespace);
  ctx.effect(
    () => ctx.locale.register(namespace, { zh, en }),
    "zcode-cli: locale",
  );
  ctx.effect(
    () =>
      ctx.slots.inject("plugins.item", () =>
        ctx.slots.register(
          {
            name: "plugins.item",
            id: "zcode-cli",
            order: 15,
            label: () => t("title"),
            locale: namespace,
          },
          AccountCard,
        ),
      ),
    "zcode-cli: account card",
  );
}
