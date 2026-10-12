/** 注册团队入口、详情页、群聊展示和结构化成员候选菜单。 */
import { createElement } from "react";
import type { Context } from "@deepseek-ai/cordis";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { MainPanelId } from "@deepseek-ai/dsh-client-ui-layout/client";
import type {} from "@deepseek-ai/dsh-client-ui-renderer/client";
import type {} from "@deepseek-ai/dsh-client-locale/client";
import type {} from "@deepseek-ai/dsh-client-ui-sidebar/client";
import type {} from "@deepseek-ai/dsh-client-ui-input-trigger/client";
import { CreatedSchema, ActorSchema, TeamIdSchema } from "../protocol/index.ts";
import { TeamDialog, type DialogProps } from "./TeamDialog.tsx";
import { Detail } from "./Detail.tsx";
import { TeamRoster } from "./TeamRoster.tsx";
import { registerTeamChat } from "./chat.tsx";
import {
  publicInputDefinition,
  taskIndexDefinition,
  memberReplyDefinition,
} from "./messages.ts";
import { zh, en, errorReason } from "./locales.ts";
import { request } from "./transport.ts";
import { draftSubmission } from "./draft.ts";
export const inject = [
  "slots",
  "locale",
  "layout",
  "uiWorkspace",
  "inputTriggers",
  "sessions",
  "uiConversation",
];
const panelId = brandString<MainPanelId>("kmh-team-new");
/** @param ctx - 浏览器插件拥有者。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register("kmh-team", { zh, en }));
  const t = ctx.locale.bind("kmh-team");
  ctx.slots.inject("sidebar.panellist", () =>
    ctx.slots.register(
      {
        name: "sidebar.panellist",
        id: panelId,
        order: -100,
        locale: "kmh-team",
        label: () => t("title"),
      },
      () => createElement("span", { "aria-hidden": true }, "♟"),
    ),
  );
  const Dialog = (props: Omit<DialogProps, "ctx" | "cancel">) =>
    createElement(TeamDialog, {
      ...props,
      ctx,
      cancel: () => ctx.layout.selectPanel(null),
    });
  ctx.slots.inject("main", () =>
    ctx.slots.register(
      { name: "main", key: panelId, locale: "kmh-team" },
      Dialog,
    ),
  );
  ctx.slots.inject("plugins.item", () =>
    ctx.slots.register(
      {
        name: "plugins.item",
        id: "kmh-team",
        order: 15,
        locale: "kmh-team",
        label: () => t("title"),
      },
      Detail,
    ),
  );
  ctx.uiConversation.events.register(publicInputDefinition);
  ctx.uiConversation.events.register(taskIndexDefinition);
  ctx.uiConversation.events.register(memberReplyDefinition);
  ctx.slots.inject("conversation.chat.node", () => registerTeamChat(ctx));
  ctx.slots.inject("conversation.session.header.actions", () =>
    ctx.slots.register(
      {
        name: "conversation.session.header.actions",
        id: "kmh-team",
        order: -20,
        locale: "kmh-team",
      },
      TeamRoster,
    ),
  );
  const names = new Map<string, string>();
  ctx.effect(() =>
    ctx.inputTriggers.registerSource({
      trigger: "@",
      name: "kmh-team",
      order: -100,
      candidates(session, req) {
        const summary = ctx.sessions.list.getSnapshot().byId[session.sessionId];
        const parsed = CreatedSchema.safeParse(
          summary?.projectionValues?.kmhTeam,
        );
        if (!parsed.success) return Promise.resolve([]);
        const config = parsed.data;
        const candidates = [
          { name: t("owner"), value: JSON.stringify({ kind: "team-owner" }) },
          ...config.members.map((role) => ({
            name: role.name,
            value: JSON.stringify({ kind: "member", roleId: role.roleId }),
          })),
        ];
        for (const candidate of candidates)
          names.set(candidate.value, candidate.name);
        return Promise.resolve(
          candidates.filter((candidate) =>
            candidate.name.toLowerCase().includes(req.query.toLowerCase()),
          ),
        );
      },
      onPick(pick) {
        const ref = pick.candidate.value;
        if (ref === undefined) return undefined;
        ActorSchema.parse(JSON.parse(ref));
        return {
          insert: {
            source: "kmh-team",
            ref,
            label: pick.candidate.name,
            clipboardText: `@${pick.candidate.name}`,
          },
        };
      },
      codec: {
        clipboardText: (ref) => `@${names.get(ref) ?? t("owner")}`,
        serialize: (ref) => {
          ActorSchema.parse(JSON.parse(ref));
          return Promise.resolve(`@${names.get(ref) ?? t("owner")}`);
        },
      },
    }),
  );
  ctx.on("conversation/structured-submit", async (input, next) => {
    const summary = ctx.sessions.list.getSnapshot().byId[input.sessionId];
    const parsed = CreatedSchema.safeParse(summary?.projectionValues?.kmhTeam);
    if (!parsed.success) return next();
    try {
      if (input.attachmentIds.length > 0)
        return { kind: "error", text: t("attachments") };
      const submission = draftSubmission(
        TeamIdSchema.parse(input.sessionId),
        input.draft,
        crypto.randomUUID(),
      );
      await request("submit", submission, undefined, input.signal);
      return { kind: "success" };
    } catch (e) {
      return { kind: "error", text: errorReason(e, t, "sendFailed") };
    }
  });
  // 刷新 Host 投影以确认当前团队分类；普通会话继续使用原展示与发送通道。
  void ctx.sessions.refresh().catch(() => {});
}
