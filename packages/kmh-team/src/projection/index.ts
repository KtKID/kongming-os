/** 团队分类由群聊创建事件推导，供会话列表与正文入口复用。 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-session-projection";
import { SessionPresentationSchema } from "@deepseek-ai/dsh-session-projection/presentation";
import { CreatedSchema } from "../protocol/index.ts";
/** @param ctx - 拥有投影注册的插件上下文。 */
export function mountProjection(ctx: Context): void {
  const schema = CreatedSchema.nullable();
  ctx.effect(() =>
    ctx.sessionProjections.register({
      key: "kmhTeam",
      stateVersion: 1,
      stateSchema: schema,
      init: () => null,
      apply: (state, event) =>
        event.type === "kmh-team/created"
          ? CreatedSchema.parse(event.data)
          : state,
      wire: { viewSchema: schema, view: (state) => state },
    }),
  );
  ctx.effect(() =>
    ctx.sessionProjections.register({
      key: "sessionPresentation",
      stateVersion: 1,
      stateSchema: SessionPresentationSchema,
      init: () => null,
      apply: (state, event) =>
        event.type === "kmh-team/created"
          ? { kind: "kmh-team", keepBlankVisible: true }
          : state,
      wire: { viewSchema: SessionPresentationSchema, view: (state) => state },
    }),
  );
}
