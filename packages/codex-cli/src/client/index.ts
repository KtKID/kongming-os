/** Codex 详情卡片在插件管理区的挂载与文案。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import { CodexCard } from "./DetailCard.tsx";
import { zh, en, type LocaleKey } from "./locales.ts";

declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    /** Codex account and connection copy. */
    "settings.codex-cli": LocaleKey;
  }
}

/** Services needed for the Plugins contribution. */
export const inject = ["slots", "locale"];
/**
 * Register the Codex detail card and dictionaries.
 * @param ctx - Client plugin owner.
 */
export function apply(ctx: Context): void {
  const namespace = "settings.codex-cli";
  const t = ctx.locale.bind(namespace);
  ctx.effect(
    () => ctx.locale.register(namespace, { zh, en }),
    "codex-cli: locale",
  );
  ctx.effect(
    () =>
      ctx.slots.inject("plugins.item", () =>
        ctx.slots.register(
          {
            name: "plugins.item",
            id: "codex-cli",
            order: 16,
            label: () => t("title"),
            locale: namespace,
          },
          CodexCard,
        ),
      ),
    "codex-cli: detail card",
  );
}
