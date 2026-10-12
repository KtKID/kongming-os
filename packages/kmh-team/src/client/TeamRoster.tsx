/** 会话头部成员与实时工作标记；消息列表由宿主 Chat 插件呈现。 */
import { useEffect, useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  PropsRuntime,
  PropsLocale,
} from "@deepseek-ai/dsh-client-ui-slots";
import { actorKey, type Actor, type TeamView } from "../protocol/index.ts";
import { errorReason } from "./locales.ts";
import { watch, request } from "./transport.ts";
import { badge, row } from "./styles.ts";

type RosterProps = PropsRuntime<"conversation.session.header.actions"> &
  PropsLocale<"kmh-team">;

/** @param props - 当前会话及团队文案。 @returns 头像下方的真实执行状态与停止入口。 */
export function TeamRoster({ sessionId, useProjection, t }: RosterProps) {
  const team = useProjection("kmhTeam");
  return team == null ? null : (
    <Roster key={sessionId} sessionId={sessionId} t={t} />
  );
}
function Roster({ sessionId, t }: Pick<RosterProps, "sessionId" | "t">) {
  const [view, setView] = useState<TeamView>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [stopping, setStopping] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    void watch(sessionId, controller.signal, setView).catch((error) => {
      if (!controller.signal.aborted)
        setError(errorReason(error, t, "readError"));
    });
    return () => controller.abort();
  }, [sessionId, version]);
  useEffect(() => {
    if (view?.working.length === 0) setStopping(false);
  }, [view?.working.length]);
  if (view === undefined)
    return error === "" ? null : (
      <Button onClick={() => setVersion((v) => v + 1)}>{t("retry")}</Button>
    );
  const actors: Actor[] = [
    { kind: "team-owner" },
    ...view.team.members.map((role) => ({
      kind: "member" as const,
      roleId: role.roleId,
    })),
  ];
  const working = new Set(view.working.map(actorKey));
  return (
    <div
      style={{ ...row, gap: 14, alignItems: "flex-start" }}
      data-kmh-team-roster=""
    >
      {actors.map((actor) => {
        const name =
          actor.kind === "team-owner"
            ? t("owner")
            : (view.team.members.find((role) => role.roleId === actor.roleId)
                ?.name ?? t("invalidMember"));
        return (
          <div
            key={actorKey(actor)}
            data-kmh-actor={actorKey(actor)}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
            }}
          >
            <span style={badge} aria-hidden="true">
              {name.slice(0, 1)}
            </span>
            <small>{name}</small>
            {working.has(actorKey(actor)) && (
              <small
                role="status"
                style={{ color: "var(--dsw-alias-state-business-primary)" }}
              >
                {t("working")}
              </small>
            )}
          </div>
        );
      })}
      {working.size > 0 && (
        <Button
          disabled={stopping}
          onClick={() => {
            setStopping(true);
            void request("stop", {}, sessionId).catch((error) => {
              setStopping(false);
              setError(errorReason(error, t, "readError"));
            });
          }}
        >
          {stopping ? t("stopping") : t("stop")}
        </Button>
      )}
      {(error !== "" || view.error !== undefined) && (
        <div role="alert">
          {error || t("saveFailed")}
          <Button
            onClick={() => {
              void request("retry", {}, sessionId)
                .then(() => setVersion((v) => v + 1))
                .catch((error) => setError(errorReason(error, t, "readError")));
            }}
          >
            {t("retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
