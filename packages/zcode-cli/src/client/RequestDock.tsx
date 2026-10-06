/** 会话输入栏下方的模型请求状态行：阶段、重试次数与慢请求提示。 */
import { useEffect, useState } from "react";
import type {
  PropsLocale,
  SessionStandardProps,
} from "@deepseek-ai/dsh-client-ui-slots";
// type-only：sessionId 标准座椅的合并声明（ui-session 提供）。
import type {} from "@deepseek-ai/dsh-client-ui-session/client";
import { z } from "zod";
import { RequestStatus } from "../status.ts";
import type { LocaleKey } from "./locales.ts";

const snapshot = z.object({ requests: z.array(RequestStatus) });
type Row = z.infer<typeof RequestStatus>;

// 与输入区统计药丸（ContextMeter）同款排版：12px 主题次要文本色。
const hintStyle = {
  fontSize: "12px",
  lineHeight: "20px",
  color: "var(--dsw-alias-label-tertiary)",
  margin: 0,
} as const;

/**
 * 选取当前会话最值得展示的一条请求：进行中优先，其次最近一次用户停止。
 * 状态行属于 zcode-cli 插件且只描述本会话经 zcode-cli 的请求——其他会话
 * 的记录与无会话身份的探测（sessionId 为 null）都不进入会话视图。
 * @param requests - 宿主请求快照（按更新时间倒序）。
 * @param sessionId - 当前会话身份。
 * @returns 命中的记录；无则 undefined。
 */
export function pickNotable(
  requests: readonly Row[],
  sessionId: string,
): Row | undefined {
  const mine = requests.filter((row) => row.sessionId === sessionId);
  return (
    mine.find((row) => row.outcome === "running") ??
    mine.find((row) => row.termination?.cause === "user-stop")
  );
}

/** 纯展示部分：一条请求状态的可见文案；已结束的请求不渲染。 */
export function RequestStatusLine({
  row,
  t,
}: {
  row: Row;
  t: (key: LocaleKey) => string;
}) {
  if (row.outcome !== "running") {
    // 用户停止的两段式展示：正在停止 → 已停止 / 待确认（feat02 场景1/3）。
    if (row.termination?.cause === "user-stop" && row.stop !== undefined) {
      const label =
        row.stop.exitConfirmed === undefined
          ? t("requestStopping")
          : row.stop.exitConfirmed
            ? t("requestStopped")
            : t("stopUnconfirmed");
      return (
        <p role="status" style={hintStyle}>
          {label}
        </p>
      );
    }
    return null;
  }
  const parts = [
    row.stage === "starting" ? t("requestStarting") : t("requestWaiting"),
  ];
  if (row.attempt >= 2)
    parts.push(t("requestAttempt").replace("{n}", String(row.attempt)));
  if (row.slow) parts.push(t("requestSlow"));
  return (
    <p role="status" style={hintStyle}>
      {parts.join(" · ")}
    </p>
  );
}

/**
 * 轮询本机请求状态并渲染当前会话最值得展示的一条：进行中的请求优先；
 * 无进行中时保留最近一次用户停止的记录，展示正在停止 → 已停止/待确认。
 * 输入、输出：GET /api/zcode-cli/requests 的快照；取数失败保持上次内容。
 */
export function RequestDock({
  sessionId,
  t,
}: PropsLocale<"settings.zcode-cli"> &
  Pick<SessionStandardProps, "sessionId">) {
  const [row, setRow] = useState<Row | undefined>();
  useEffect(() => {
    let live = true;
    // 轮询失败保留上次状态，下一轮重试。
    const tick = () => {
      fetch("/api/zcode-cli/requests")
        .then((response) => (response.ok ? response.json() : undefined))
        .then((value: unknown) => {
          if (value === undefined || !live) return;
          setRow(pickNotable(snapshot.parse(value).requests, sessionId));
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
  if (row === undefined) return null;
  return <RequestStatusLine row={row} t={t} />;
}
