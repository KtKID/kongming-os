/** 沿用已注册的宿主消息 renderer，增加成员署名并省略 owner 的内部重复输入。 */
import { createElement, type ComponentType } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type {
  ChatNodeViewProps,
  PresentationInjected,
} from "@deepseek-ai/dsh-client-ui-chat/client";
import type { InjectFace } from "@deepseek-ai/dsh-client-ui-slots";
import { memberAssistantData, privateTeamInput } from "./messages.ts";
import { badge, row } from "./styles.ts";

type AssistantProps = ChatNodeViewProps<"assistant-step"> &
  InjectFace<PresentationInjected>;
type MemberProps = ChatNodeViewProps<"kmh-team-member"> &
  InjectFace<PresentationInjected>;

/** @param ctx - 原 Chat renderer 已加载的插件上下文。 @returns 注册的清理入口；宿主缺少 renderer 时立即报错。 */
export function registerTeamChat(ctx: Context): () => void {
  const entries = ctx.slots.entriesOfSlot("conversation.chat.node");
  const userEntry = entries.find((entry) => entry.options.key === "user");
  const assistantEntry = entries.find(
    (entry) => entry.options.key === "assistant-step",
  );
  if (userEntry === undefined || assistantEntry?.inject === undefined)
    throw Error("native-chat-renderers-unavailable");
  // SlotRegistry 以 unknown 保存组件；对应 dispatch 的公开 Props 恢复其已声明类型。
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SlotRegistry 擦除组件类型，user dispatch 的组件复用公开 Props。
  const NativeUser = userEntry.component as ComponentType<
    ChatNodeViewProps<"user">
  >;
  const NativeAssistant =
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- assistant-step dispatch 的组件类型由原 Chat 插件声明。
    assistantEntry.component as ComponentType<AssistantProps>;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- 原 assistant-step 注册注入的是公开 PresentationInjected；复用其策略来源。
  const assistantInject = assistantEntry.inject as () => PresentationInjected &
    Record<string, unknown>;
  const teamT = ctx.locale.bind("kmh-team");
  const PublicUser = (props: ChatNodeViewProps<"user">) => {
    const team = props.useProjection("kmhTeam");
    return privateTeamInput(team, props.node.data.source)
      ? null
      : createElement(NativeUser, props);
  };
  const Member = (props: MemberProps) => {
    const team = props.useProjection("kmhTeam");
    const data = props.node.data;
    const name =
      team?.members.find((role) => role.roleId === data.actor.roleId)?.name ??
      teamT("invalidMember");
    return (
      <div data-kmh-member-reply={data.actor.roleId}>
        <div
          style={{
            ...row,
            gap: 8,
            marginBottom: 8,
            fontSize: 13,
            color: "var(--dsw-alias-label-secondary)",
          }}
        >
          <span
            style={{ ...badge, width: 26, height: 26, borderRadius: 8 }}
            aria-hidden="true"
          >
            {name.slice(0, 1)}
          </span>
          <strong>{name}</strong>
        </div>
        {data.body !== "" &&
          createElement(NativeAssistant, {
            ...props,
            node: {
              ...props.node,
              kind: "assistant-step",
              data: memberAssistantData(data),
            },
          })}
        {data.outcome !== "completed" && (
          <p role="status">{data.notice ?? teamT("memberFailed")}</p>
        )}
      </div>
    );
  };
  const user = ctx.slots.register(
    {
      name: "conversation.chat.node",
      key: "user",
      priority: -100,
      locale: "chat",
    },
    PublicUser,
  );
  const member = ctx.slots.register(
    {
      name: "conversation.chat.node",
      key: "kmh-team-member",
      locale: "chat",
      inject: assistantInject,
    },
    Member,
  );
  return () => {
    member();
    user();
  };
}
