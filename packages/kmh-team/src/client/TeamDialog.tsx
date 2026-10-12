/** owner 固定加入，用户选择模型及额外角色后创建团队。 */
import { useEffect, useRef, useState } from "react";
import { Modal, Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { Context } from "@deepseek-ai/cordis";
import type {
  PropsRuntime,
  PropsLocale,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-workspace/client";
import type {} from "@deepseek-ai/dsh-client-ui-layout/client";
import { SessionId } from "@deepseek-ai/dsh-session/types";
import { ViewSchema } from "../protocol/index.ts";
import { errorReason } from "./locales.ts";
import { initialModelSelection, selectedTeamModel } from "./model.ts";
import { request, BootstrapSchema, type Bootstrap } from "./transport.ts";
import { stack, row, box, field } from "./styles.ts";
export type DialogProps = PropsRuntime<"main"> &
  PropsLocale<"kmh-team"> & { ctx: Context; cancel: () => void };
/** @param props - 当前会话信息、文案及导航。 @returns 配置弹窗。 */
export function TeamDialog({ t, ctx, cancel, useSessions }: DialogProps) {
  const [data, setData] = useState<Bootstrap>();
  const [selected, setSelected] = useState<string[]>([]);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const id = useRef(crypto.randomUUID());
  const cwd = useSessions(
    (s) =>
      Object.values(s.byId).find((v) => (v.retainedBy.mainView ?? 0) > 0)?.cwd,
  );
  useEffect(() => {
    const controller = new AbortController();
    void request("bootstrap", undefined, undefined, controller.signal)
      .then((value) => {
        const bootstrap = BootstrapSchema.parse(value);
        setData(bootstrap);
        const initial = initialModelSelection(bootstrap.catalog);
        setModel(initial);
        if (initial === "")
          setError(
            t(
              bootstrap.catalog.groups.some((g) => g.models.length > 0)
                ? "defaultModelUnavailable"
                : "modelsUnavailable",
            ),
          );
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(errorReason(e, t, "createFailed"));
      });
    return () => controller.abort();
  }, []);
  const choose = (roleId: string) => {
    id.current = crypto.randomUUID();
    setSelected((prev) =>
      prev.includes(roleId)
        ? prev.filter((id) => id !== roleId)
        : [...prev, roleId],
    );
  };
  const confirm = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (data === undefined) throw Error("owner-required");
      const result = ViewSchema.parse(
        await request("create", {
          requestId: id.current,
          cwd: cwd ?? data.cwd,
          memberRoleIds: selected,
          model: selectedTeamModel(data.catalog, model),
        }),
      );
      ctx.layout.selectPanel(null);
      ctx.uiWorkspace.openSession(SessionId(result.team.teamId));
    } catch (e) {
      setError(errorReason(e, t, "createFailed"));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={t("title")}
      closeLabel={t("close")}
      onClose={() => {
        if (!busy) cancel();
      }}
      footer={
        <>
          <Button onClick={cancel} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button
            onClick={() => {
              confirm().catch((e) =>
                setError(errorReason(e, t, "createFailed")),
              );
            }}
            disabled={busy || data === undefined || model === ""}
          >
            {t("confirm")}
          </Button>
        </>
      }
    >
      <div style={stack} data-kmh-team-dialog="">
        <div style={row}>
          <strong>{t("owner")}</strong>
        </div>
        <label style={stack}>
          {t("model")}
          <select
            style={field}
            value={model}
            onChange={(e) => {
              id.current = crypto.randomUUID();
              setModel(e.target.value);
              setError("");
            }}
            disabled={busy}
          >
            <option value="" disabled>
              {t("chooseModel")}
            </option>
            {data?.catalog.groups.flatMap((group) =>
              group.models.map((item) => (
                <option
                  key={`${group.id}:${item.id}`}
                  value={JSON.stringify([group.id, item.id])}
                >
                  {group.name} · {item.name}
                </option>
              )),
            )}
          </select>
        </label>
        <p>{t("choose")}</p>
        <div style={{ ...row, alignItems: "stretch" }}>
          {(["joined", "available"] as const).map((side) => (
            <div style={box} key={side}>
              <strong>{t(side)}</strong>
              {data?.roles
                .filter(
                  (role) =>
                    selected.includes(role.roleId) === (side === "joined"),
                )
                .map((role) => (
                  <Button
                    key={role.roleId}
                    onClick={() => choose(role.roleId)}
                    title={role.instructions}
                    disabled={busy}
                  >
                    {role.name}
                  </Button>
                ))}
              {data?.roles.length === 0 && side === "available" ? (
                <span>{t("empty")}</span>
              ) : null}
            </div>
          ))}
        </div>
        {error && <p role="alert">{t("error", { reason: error })}</p>}
      </div>
    </Modal>
  );
}
