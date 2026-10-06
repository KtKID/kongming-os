/** 会话输入栏下方的模型请求状态行：阶段、重试次数与慢请求提示。 */
import { useEffect, useState } from "react";
import type { PropsLocale } from "@deepseek-ai/dsh-client-ui-slots";
import { z } from "zod";
import { RequestStatus } from "../status.ts";
import type { LocaleKey } from "./locales.ts";

const snapshot = z.object({ requests: z.array(RequestStatus) });
/** 纯展示部分：一条请求状态的可见文案；已结束的请求不渲染。 */
export function RequestStatusLine({
  row,
  t,
}: {
  row: z.infer<typeof RequestStatus>;
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
      return <p role="status">{label}</p>;
    }
    return null;
  }
  const parts = [
    row.stage === "starting" ? t("requestStarting") : t("requestWaiting"),
  ];
  if (row.attempt >= 2)
    parts.push(t("requestAttempt").replace("{n}", String(row.attempt)));
  if (row.slow) parts.push(t("requestSlow"));
  return <p role="status">{parts.join(" · ")}</p>;
}

/**
 * 轮询本机请求状态并渲染最值得展示的一条：进行中的请求优先；
 * 无进行中时保留最近一次用户停止的记录，展示正在停止 → 已停止/待确认。
 * 输入、输出：GET /api/zcode-cli/requests 的快照；取数失败保持上次内容。
 */
export function RequestDock({ t }: PropsLocale<"settings.zcode-cli">) {
  const [row, setRow] = useState<z.infer<typeof RequestStatus> | undefined>();
  useEffect(() => {
    let live = true;
    // 轮询失败保留上次状态，下一轮重试。
    const tick = () => {
      fetch("/api/zcode-cli/requests")
        .then((response) => (response.ok ? response.json() : undefined))
        .then((value: unknown) => {
          if (value === undefined || !live) return;
          const requests = snapshot.parse(value).requests;
          const notable =
            requests.find((item) => item.outcome === "running") ??
            requests.find((item) => item.termination?.cause === "user-stop");
          setRow(notable);
        })
        .catch(() => undefined);
    };
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  if (row === undefined) return null;
  return <RequestStatusLine row={row} t={t} />;
}
