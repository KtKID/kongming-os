/** Codex 详情卡片在插件管理区的挂载与文案。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import { CodexCard } from "./DetailCard.tsx";
import { LiveBall, LiveBallView } from "./LiveBall.tsx";
import { zh, en, type LocaleKey } from "./locales.ts";
import { QuotaStore } from "./quota-store.ts";
declare const __codexQuotaStyles: string;
import { ComposerQuota } from "./ComposerQuota.tsx";
import type {} from "@deepseek-ai/dsh-client-ui-model-selection/client";

export { LiveBall, LiveBallView };

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
  const quota = new QuotaStore();
  ctx.effect(() => () => quota.dispose(), "codex-cli: shared quota");
  ctx.effect(() => {
    if (typeof document === "undefined") return () => {};
    const style = document.createElement("style");
    style.textContent = __codexQuotaStyles;
    document.head.append(style);
    return () => style.remove();
  }, "codex-cli: quota styles");
  ctx.inject(["configForms", "remote", "remote.settings"], (scope) => {
    void quota.bind(scope).catch((error) => console.warn(error));
  });
  ctx.inject(
    [
      "modelDirectories",
      "pluginNavigation",
      "sessions",
      "remote",
      "remote.session",
    ],
    (scope) => {
      scope.slots.inject("conversation.input.right", () =>
        scope.slots.register(
          {
            name: "conversation.input.right",
            id: "codex-cli-quota",
            order: 5,
            locale: "settings.codex-cli",
            inject: (sessionId) => ({
              directory: scope.modelDirectories.directoryFor(sessionId),
              quota,
              openSettings: () =>
                scope.pluginNavigation.openBundle("@kmh/codex-cli"),
            }),
          },
          ComposerQuota,
        ),
      );
    },
  );
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
          (props) => CodexCard({ ...props, quota }),
        ),
      ),
    "codex-cli: detail card",
  );
  // 跨插件导航打开包详情；复用同一账号卡，保持输入框的登录入口可达。
  ctx.effect(
    () =>
      ctx.slots.inject("plugins.bundle.config", () =>
        ctx.slots.register(
          {
            name: "plugins.bundle.config",
            key: "@kmh/codex-cli",
            locale: namespace,
          },
          (props) => CodexCard({ ...props, view: "page", quota }),
        ),
      ),
    "codex-cli: bundle detail",
  );
  // 会话底部状态小球（第 n 轮第 n 步统计行最右）：order 2 排在活动/用量
  // 药丸之后；非 codex 会话无记录时组件自身不渲染。
  ctx.effect(
    () =>
      ctx.slots.inject("conversation.composer.dock", () =>
        ctx.slots.register(
          {
            name: "conversation.composer.dock",
            id: "codex-cli-live",
            order: 2,
            label: () => t("liveTitle"),
            locale: namespace,
          },
          LiveBall,
        ),
      ),
    "codex-cli: live ball dock",
  );
}
