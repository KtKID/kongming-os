/** KMH 会话权限选择与 ZCode 原生协作模式。 */
import type { Context } from "@deepseek-ai/cordis";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import type {} from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-permission-presets";
import { z } from "zod";

/** 官方 Session 协议的用户可选模式。 */
export const ZcodePermissionMode = z.enum(["plan", "build", "edit", "yolo"]);
export type ZcodePermissionMode = z.infer<typeof ZcodePermissionMode>;

/** CLI 在 session.updated 中分别记录基础权限和计划开关。 */
export const ZcodeExecutionState = z.object({
  mode: z.enum(["build", "edit", "yolo", "auto"]),
  planEnabled: z.boolean(),
});
export type ZcodeExecutionState = z.infer<typeof ZcodeExecutionState>;

/** session/setMode 的会话状态回执。 */
export const SessionModeResult = z.object({
  session: z.object({ sessionId: z.string(), mode: ZcodePermissionMode }),
});

/**
 * 将 KMH 权限预设转换为 ZCode 原生模式。
 * @param preset - 宿主权限服务解析出的当前预设。
 * @returns 对应的官方模式。
 * @throws ZCODE_PERMISSION_MODE_UNSUPPORTED 宿主使用插件尚未支持的预设。
 */
export function zcodeModeForPreset(preset: string): ZcodePermissionMode {
  switch (preset) {
    case "read-only":
      return "plan";
    case "workspace-write":
      return "build";
    case "workspace-write-auto":
      return "edit";
    case "danger-full-access":
      return "yolo";
    default:
      throw new Error("ZCODE_PERMISSION_MODE_UNSUPPORTED");
  }
}

/**
 * 读取请求会话的当前权限；独立宿主缺少会话或权限服务时使用变更前确认。
 * @param ctx - 拥有会话和权限服务的插件作用域。
 * @param sessionId - KMH 会话身份；临时请求可省略。
 * @returns 本次操作应采用的 ZCode 模式。
 */
export function resolveZcodeMode(
  ctx: Context,
  sessionId: GenerateOptions["sessionId"],
): ZcodePermissionMode {
  const session =
    sessionId === undefined ? undefined : ctx.get("sessions")?.get(sessionId);
  const permissions = ctx.get("permissionPresets");
  if (session === undefined || permissions === undefined) return "build";
  return zcodeModeForPreset(permissions.current(session));
}
