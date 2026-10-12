/** 把团队公开事件接入 DSH 原有 Chat target，私有输入与 child 工具留在执行日志。 */
import type {
  ConversationNodeContext,
  ConversationNodeDefinition,
} from "@deepseek-ai/dsh-client-ui-conversation/client";
import type {
  ChatNode,
  AssistantChatData,
} from "@deepseek-ai/dsh-client-ui-chat/client";
import {
  SubmissionSchema,
  EndedSchema,
  type Actor,
  type Task,
  type TeamConfig,
  type PublicMessage,
  type Outcome,
} from "../protocol/index.ts";

/** 成员公开回复只包含最终正文与署名，工具记录由 child Session 保管。 */
export interface MemberReplyData {
  readonly actor: Extract<Actor, { kind: "member" }>;
  readonly body: string;
  readonly outcome: Outcome;
  readonly notice?: string;
  readonly time: number;
}
declare module "@deepseek-ai/dsh-client-ui-chat/client" {
  interface ChatNodeDataMap {
    "kmh-team-member": MemberReplyData;
  }
}
interface PublicInput {
  readonly message: PublicMessage;
  readonly seq: number;
  readonly time: number;
}
const publicSource = { kind: "kmh-team-public" };

/** @param team - 当前会话团队投影。 @param source - DSH 输入来源。 @returns 是否为已有公开消息对应的 owner 私有执行输入。 */
export function privateTeamInput(
  team: TeamConfig | null | undefined,
  source: unknown,
): boolean {
  return (
    team != null &&
    typeof source === "object" &&
    source !== null &&
    "kind" in source &&
    source.kind === "user"
  );
}

/** @param context - 原事件位置和稳定身份。 @param kind - 原 Chat dispatch。 @param data - 原 renderer 数据。 @returns 交给宿主列表的节点。 */
function node<K extends ChatNode["kind"]>(
  context: ConversationNodeContext,
  kind: K,
  data: ChatNode<K>["data"],
  seq: number,
): ChatNode<K> {
  return {
    key: context.key,
    id: context.id,
    kind,
    target: "chat",
    anchorSeq: seq,
    location: { kind: "session" },
    visibility: "visible",
    data,
  };
}

/** 每个提交立即贡献一条原生用户气泡，owner 与成员共享同一条。 */
export const publicInputDefinition: ConversationNodeDefinition<PublicInput> = {
  kind: "kmh-team-public-input",
  target: "chat",
  match: (event) =>
    event.type === "kmh-team/submission"
      ? {
          id: SubmissionSchema.parse(event.data).userMessage.messageId,
          role: "start",
        }
      : null,
  start: (_context, { event }) => ({
    message: SubmissionSchema.parse(event.data).userMessage,
    seq: event.seq,
    time: event.time,
  }),
  update: (context) => context.state,
  buildViewNode: (context) =>
    context.state === undefined
      ? null
      : node(
          context,
          "user",
          {
            kind: "user",
            seq: context.state.seq,
            time: context.state.time,
            content: [{ type: "text", text: context.state.message.body }],
            source: publicSource,
          },
          context.state.seq,
        ),
};

/** 吸收插件事件并保存任务身份，用于没有正文的成员失败或停止提示。 */
export const taskIndexDefinition: ConversationNodeDefinition<
  ReadonlyMap<string, Task>
> = {
  kind: "kmh-team-task-index",
  match: (event) =>
    event.type.startsWith("kmh-team/") ? { id: "tasks", role: "start" } : null,
  start: (_context, { event }) =>
    new Map(
      event.type === "kmh-team/submission"
        ? SubmissionSchema.parse(event.data).tasks.map((task) => [
            task.taskId,
            task,
          ])
        : [],
    ),
  update: (context, { event }) => {
    if (event.type !== "kmh-team/submission") return context.state;
    const tasks = new Map(context.state);
    for (const task of SubmissionSchema.parse(event.data).tasks)
      tasks.set(task.taskId, task);
    return tasks;
  },
};

/** 成员终态作为新的消息来源接入，owner 继续使用原有流式 Assistant 节点。 */
export const memberReplyDefinition: ConversationNodeDefinition<MemberReplyData | null> =
  {
    kind: "kmh-team-member-reply",
    target: "chat",
    match: (event) =>
      event.type === "kmh-team/task-ended"
        ? { id: EndedSchema.parse(event.data).taskId, role: "start" }
        : null,
    start: (_context, { event }, reader) => {
      const ended = EndedSchema.parse(event.data);
      const actor =
        ended.reply?.sender ??
        reader
          .previous<ReadonlyMap<string, Task>>("kmh-team-task-index")
          ?.state.get(ended.taskId)?.actor;
      if (actor?.kind !== "member") return null;
      return {
        actor,
        body: ended.reply?.body ?? "",
        outcome: ended.outcome,
        time: event.time,
        ...(ended.notice === undefined ? {} : { notice: ended.notice }),
      };
    },
    update: (context) => context.state,
    buildViewNode: (context) =>
      context.state == null || context.start === undefined
        ? null
        : node(
            context,
            "kmh-team-member",
            context.state,
            context.start.event.seq,
          ),
  };

/** @param data - 已保存成员正文。 @returns 原生 Assistant renderer 的最终文本输入。 */
export function memberAssistantData(data: MemberReplyData): AssistantChatData {
  return {
    status: "settled",
    turn: 0,
    step: 0,
    blocks: [{ kind: "text", text: data.body }],
    time: data.time,
  };
}
