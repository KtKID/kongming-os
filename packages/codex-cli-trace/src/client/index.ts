/** 通过公开会话槽位登记 Codex Trace，标签随插件生命周期卸载。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import { notices } from "./state.ts";
import { TraceView, TraceToast } from "./TraceView.tsx";
import { NS, zh, en, type LocaleKey } from "./locales.ts";
declare module "@deepseek-ai/dsh-client-ui-slots" {
  interface LocaleNamespaceMap {
    "codex-cli-trace": LocaleKey;
  }
}
export const inject = ["slots", "locale"];
export function apply(ctx: Context): void {
  ctx.effect(
    () =>
      ctx.slots.inject("shell.overlay", () =>
        ctx.slots.register(
          { name: "shell.overlay", id: "codex-cli-trace.notice" },
          TraceToast,
        ),
      ),
    "codex-cli-trace: notice",
  );
  ctx.effect(
    () => () => {
      notices.clear();
    },
    "codex-cli-trace: notice cleanup",
  );
  ctx.effect(
    () => ctx.locale.register(NS, { zh, en }),
    "codex-cli-trace: locale",
  );
  const t = ctx.locale.bind(NS);
  ctx.effect(
    () =>
      ctx.slots.inject("conversation.view", () =>
        ctx.slots.register(
          {
            name: "conversation.view",
            id: "codex-cli-trace",
            order: 30,
            locale: NS,
            label: () => t("tab"),
          },
          TraceView,
        ),
      ),
    "codex-cli-trace: tab",
  );
}
