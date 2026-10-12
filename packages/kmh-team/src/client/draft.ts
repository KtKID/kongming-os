/** 仅候选菜单产生的有效结构化引用获得收件人身份。 */
import type { DraftSnapshot } from "@deepseek-ai/dsh-client-ui-conversation/client";
import {
  ActorSchema,
  type Submit,
  type TeamId,
  RequestIdSchema,
} from "../protocol/index.ts";
/** @param id - 本团队。 @param draft - 原始编辑器文档。 @param requestId - 一次提交身份。 @returns 待 Host 校验的团队提交。 */
export function draftSubmission(
  id: TeamId,
  draft: DraftSnapshot,
  requestId: string,
): Submit {
  const mentions = draft.references
    .filter((r) => r.source === "kmh-team")
    .map((r) => {
      if (r.invalid === true) throw Error("mention-invalid");
      return {
        actor: ActorSchema.parse(JSON.parse(r.ref)),
        offset: r.offset,
        length: r.length,
      };
    });
  return {
    teamId: id,
    requestId: RequestIdSchema.parse(requestId),
    body: draft.text,
    mentions,
  };
}
