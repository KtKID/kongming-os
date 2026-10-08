/** Host 与 Client 共用的会话连接状态响应。 */
import { z } from "zod";

/** CLI 连接状态；重试期间 streaming 保持 true。 */
export const SessionLiveState = z.object({
  color: z.enum(["green", "gray", "red"]),
  streaming: z.boolean(),
  retrying: z.boolean().default(false),
  detail: z.string(),
  updatedAt: z.number(),
});
/** 已校验的 CLI 连接状态。 */
export type SessionLiveState = z.infer<typeof SessionLiveState>;
/** /api/codex-cli/live 响应；旧 Host 缺少 retrying 时按空闲重试状态读取。 */
export const LiveSnapshot = z.object({
  sessions: z.array(SessionLiveState.extend({ sessionId: z.string() })),
});
