/** 会话底部状态小球：Codex CLI 连接绿/停止灰/异常红（轮询 /api/codex-cli/live）。 */
import { useEffect, useState } from "react";
import type {
  PropsLocale,
  SessionStandardProps,
} from "@deepseek-ai/dsh-client-ui-slots";
// type-only：sessionId 标准座椅的合并声明（ui-session 提供）。
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import { z } from "zod";
import type { LocaleKey } from "./locales.ts";

/** /api/codex-cli/live 返回体（与宿主 SessionLiveState 对应）。 */
const snapshot = z.object({
  sessions: z.array(
    z.object({
      sessionId: z.string(),
      color: z.enum(["green", "gray", "red"]),
      streaming: z.boolean(),
      detail: z.string(),
      updatedAt: z.number(),
    }),
  ),
});
type LiveEntry = z.infer<typeof snapshot>["sessions"][number];

/** 三态小球颜色：状态 token 与 StateDot 同源（success/idle/error）。 */
const BALL_COLORS: Record<LiveEntry["color"], string> = {
  green: "var(--dsw-alias-state-success-primary)",
  gray: "var(--dsw-alias-state-idle-primary)",
  red: "var(--dsw-alias-state-error-primary)",
};

/** 小球纯展示：颜色 + aria 标签；详细原因放 title 提示。 */
export function LiveBallView({
  entry,
  t,
}: {
  entry: LiveEntry;
  t: (key: LocaleKey) => string;
}) {
  const label =
    entry.color === "green"
      ? t("liveGreen")
      : entry.color === "gray"
        ? t("liveGray")
        : t("liveRed");
  return (
    <span
      role="status"
      aria-label={`${t("liveTitle")}：${label}`}
      title={`${t("liveTitle")}：${label}。${entry.detail}`}
      style={{
        display: "inline-block",
        width: "8px",
        height: "8px",
        borderRadius: "50%",
        background: BALL_COLORS[entry.color],
        flex: "none",
      }}
    />
  );
}

/**
 * 轮询本会话的 CLI 连接状态并渲染状态小球：绿=通信已建立（进行中或进程
 * 在线）、灰=已停止、红=停止未确认/回合异常中断。当前会话无记录（未用过
 * codex-cli 或插件重启后尚未开始回合）时不渲染。
 * 输入：GET /api/codex-cli/live 快照；取数失败保持上次内容。
 */
export function LiveBall({
  sessionId,
  t,
}: PropsLocale<"settings.codex-cli"> &
  Pick<SessionStandardProps, "sessionId">) {
  const [entry, setEntry] = useState<LiveEntry | undefined>();
  useEffect(() => {
    let live = true;
    // 轮询失败保留上次状态，下一轮重试。
    const tick = () => {
      fetch("/api/codex-cli/live")
        .then((response) => (response.ok ? response.json() : undefined))
        .then((value: unknown) => {
          if (value === undefined || !live) return;
          const parsed = snapshot.parse(value);
          setEntry(
            parsed.sessions.find((row) => row.sessionId === sessionId),
          );
        })
        .catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [sessionId]);
  if (entry === undefined) return null;
  return <LiveBallView entry={entry} t={t} />;
}
