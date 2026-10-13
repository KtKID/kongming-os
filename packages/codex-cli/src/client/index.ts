/** Codex 详情卡片在插件管理区的挂载与文案。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from '@deepseek-ai/dsh-client-ui-chat/client';
import { cliToolDefinition, preparationDefinition, ToolRecord, PreparationRecord } from './ToolRecords.tsx';
import { CodexCard } from "./DetailCard.tsx";
import { LiveBall, LiveBallView } from "./LiveBall.tsx";
import { zh, en, type LocaleKey } from "./locales.ts";

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
  ctx.inject(['uiConversation'], ctx => {
    ctx.uiConversation.events.register(cliToolDefinition);
    ctx.uiConversation.events.register(preparationDefinition);
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'cli-tool', locale: namespace }, ToolRecord));
    ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({ name: 'conversation.chat.node', key: 'cli-preparation', locale: namespace }, PreparationRecord));
  });
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
