/** 插件详情页保存固定角色和传递上下文数量，失败时保留草稿。 */
import { useEffect, useRef, useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type {
  PropsLocale,
  PropsRuntime,
} from "@deepseek-ai/dsh-client-ui-slots";
import type {} from "@deepseek-ai/dsh-client-ui-plugin-manager/client";
import { ConfigViewSchema, RoleSchema } from "../protocol/index.ts";
import { errorReason } from "./locales.ts";
import { request } from "./transport.ts";
import { stack, row, field } from "./styles.ts";
export type DetailProps = PropsRuntime<"plugins.item"> &
  PropsLocale<"kmh-team">;
/** @param props - 列表摘要或详情模式。 @returns 当前插件详情内容。 */
export function Detail({ view, t }: DetailProps) {
  const [config, setConfig] =
    useState<ReturnType<typeof ConfigViewSchema.parse>>();
  const [count, setCount] = useState("20");
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState("");
  const [roles, setRoles] = useState<ReturnType<typeof RoleSchema.parse>[]>([]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [retryKind, setRetryKind] = useState<"load" | "count" | "role">("load");
  const createId = useRef(crypto.randomUUID());
  const load = async () => {
    const [cfg, records] = await Promise.all([
      request("config"),
      request("roles"),
    ]);
    const c = ConfigViewSchema.parse(cfg);
    setConfig(c);
    setCount(String(c.contextMessageCount));
    setRoles(RoleSchema.array().parse(records));
  };
  useEffect(() => {
    if (view === "page")
      void load().catch((e) => setError(errorReason(e, t, "saveFailed")));
  }, [view]);
  if (view === "summary") return <>{t("summary")}</>;
  const saveCount = async (refresh = false) => {
    setRetryKind("count");
    setError("");
    const value = Number(count);
    if (count.trim() === "" || !Number.isSafeInteger(value) || value < 1) {
      setError(t("invalidCount"));
      return;
    }
    setBusy(true);
    try {
      const current = refresh
        ? ConfigViewSchema.parse(await request("config"))
        : config;
      if (current === undefined) throw Error("settings-unavailable");
      const next = ConfigViewSchema.parse(
        await request("config", {
          contextMessageCount: value,
          revision: current.revision,
        }),
      );
      setConfig(next);
      setCount(String(next.contextMessageCount));
      setStatus(t("saved"));
    } catch (e) {
      setError(errorReason(e, t, "saveFailed"));
      setStatus(t("pending"));
    } finally {
      setBusy(false);
    }
  };
  const createRole = async () => {
    setRetryKind("role");
    setError("");
    if (!name.trim() || !instructions.trim()) {
      setError(t("required"));
      return;
    }
    setBusy(true);
    try {
      const role = RoleSchema.parse(
        await request("roles", {
          requestId: createId.current,
          name,
          instructions,
        }),
      );
      setRoles((prev) => [
        ...prev.filter((r) => r.roleId !== role.roleId),
        role,
      ]);
      createId.current = crypto.randomUUID();
      setName("");
      setInstructions("");
      setStatus(t("saved"));
    } catch (e) {
      setError(errorReason(e, t, "saveFailed"));
      setStatus(t("pending"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ ...stack, maxWidth: 650 }} data-kmh-team-detail="">
      <label style={stack}>
        {t("contextCount")}
        <input
          style={field}
          type="number"
          min="1"
          step="1"
          value={count}
          onChange={(e) => setCount(e.target.value)}
        />
      </label>
      <span>{t("countHint")}</span>
      <Button
        onClick={() => {
          saveCount().catch((e) => setError(errorReason(e, t, "saveFailed")));
        }}
        disabled={busy}
      >
        {t("save")}
      </Button>
      <strong>{t("roles")}</strong>
      {roles.map((role) => (
        <div key={role.roleId}>
          <b>{role.name}</b>
          <p>{role.instructions}</p>
        </div>
      ))}
      <label style={stack}>
        {t("name")}
        <input
          style={field}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label style={stack}>
        {t("instructions")}
        <textarea
          style={field}
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </label>
      <div style={row}>
        <Button
          onClick={() => {
            createRole().catch((e) =>
              setError(errorReason(e, t, "saveFailed")),
            );
          }}
          disabled={busy}
        >
          {t("createRole")}
        </Button>
        <span role="status">{status}</span>
      </div>
      {error && (
        <div role="alert">
          {t("error", { reason: error })}
          <Button
            onClick={() => {
              const operation =
                retryKind === "count"
                  ? saveCount(true)
                  : retryKind === "role"
                    ? createRole()
                    : load();
              operation.catch((e) => setError(errorReason(e, t, "saveFailed")));
            }}
          >
            {t("retry")}
          </Button>
        </div>
      )}
    </div>
  );
}
