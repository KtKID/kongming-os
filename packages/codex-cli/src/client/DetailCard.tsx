/** Codex 详情卡片：账号、版本、开关与测试连接（贡献到现有插件管理区）。 */
import { useCallback, useEffect, useState } from "react";

/** 状态接口形态（与 Host 侧 status 路由一致）。 */
interface StatusResponse {
  account: {
    login: string;
    credentialSource?: string;
    authorizeUrl?: string;
    error?: string;
  };
  version: { version?: string; ok: boolean; reason?: string };
  nativeToolsEnabled: boolean;
  defaultModel?: string;
  lastProbe?: { at: string; ok: boolean; error?: string };
}

/** 状态响应守卫：字段存在且类型正确才采用。 */
function isStatus(value: unknown): value is StatusResponse {
  if (value === null || typeof value !== "object") return false;
  const account = fieldOf(value, "account");
  const version = fieldOf(value, "version");
  return (
    isRecordWith(account, "login", "string") &&
    isRecordWith(version, "ok", "boolean") &&
    typeof fieldOf(value, "nativeToolsEnabled") === "boolean"
  );
}
function fieldOf(value: object, key: string): unknown {
  for (const [name, item] of Object.entries(value))
    if (name === key) return item;
  return undefined;
}
function isRecordWith(
  value: unknown,
  key: string,
  kind: "string" | "boolean",
): boolean {
  if (value === null || typeof value !== "object") return false;
  const field = fieldOf(value, key);
  return typeof field === kind;
}

/** 拉取并渲染插件详情卡片。 */
export function CodexCard(): JSX.Element {
  const [status, setStatus] = useState<StatusResponse | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/codex-cli/status", {
        cache: "no-store",
      });
      const body: unknown = await response.json();
      if (isStatus(body)) setStatus(body);
    } catch {
      setStatus(undefined);
    }
  }, []);
  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);
  const act = useCallback(
    async (action: string, body?: unknown) => {
      setBusy(action);
      try {
        await fetch(`/api/codex-cli/${action}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body ?? {}),
        });
        await refresh();
      } finally {
        setBusy(undefined);
      }
    },
    [refresh],
  );
  if (status === undefined)
    return <div className="codex-cli-card">Codex CLI：状态加载中…</div>;
  const login =
    status.account.login === "signed-in"
      ? "已登录"
      : status.account.login === "waiting"
        ? "等待授权"
        : status.account.login === "starting"
          ? "发起登录中"
          : status.account.login === "failed"
            ? `登录失败${status.account.error ? `：${status.account.error}` : ""}`
            : "未登录";
  return (
    <div className="codex-cli-card">
      <div>Codex CLI</div>
      <dl>
        <dt>CLI 版本</dt>
        <dd>
          {status.version.version ?? "未检测到"}（
          {status.version.ok
            ? `受支持，基线 0.160.0`
            : `不受支持：${status.version.reason ?? "未知原因"}`}
          ）
        </dd>
        <dt>账号状态</dt>
        <dd>{login}</dd>
        {status.account.credentialSource !== undefined && (
          <>
            <dt>凭据来源</dt>
            <dd>{status.account.credentialSource}</dd>
          </>
        )}
        <dt>默认模型</dt>
        <dd>{status.defaultModel ?? "目录首选"}</dd>
        <dt>最近连接测试</dt>
        <dd>
          {status.lastProbe === undefined
            ? "未测试"
            : `${status.lastProbe.at} ${
                status.lastProbe.ok ? "通过" : `失败：${status.lastProbe.error}`
              }`}
        </dd>
      </dl>
      <label>
        <input
          type="checkbox"
          checked={status.nativeToolsEnabled}
          onChange={(event) => {
            act("config", {
              nativeToolsEnabled: event.target.checked,
            }).catch(() => undefined);
          }}
        />
        使用原生 Codex 工具与技能（默认关闭，仅用 KMH
        的；进行中的回合不受影响，下一回合生效）
      </label>
      {status.account.authorizeUrl !== undefined && (
        <a href={status.account.authorizeUrl} target="_blank" rel="noreferrer">
          打开官方授权页
        </a>
      )}
      <div>
        {status.account.login === "signed-in" ? (
          <button
            disabled={busy !== undefined}
            onClick={() => {
              act("logout").catch(() => undefined);
            }}
          >
            退出账号
          </button>
        ) : (
          <>
            <button
              disabled={busy !== undefined}
              onClick={() => {
                act("login").catch(() => undefined);
              }}
            >
              登录
            </button>
            <button
              disabled={busy !== undefined}
              onClick={() => {
                act("cancel").catch(() => undefined);
              }}
            >
              取消登录
            </button>
          </>
        )}
        <button
          disabled={busy !== undefined || status.defaultModel === undefined}
          onClick={() => {
            act("probe", {
              model: status.defaultModel ?? "gpt-6-sol",
            }).catch(() => undefined);
          }}
        >
          测试连接
        </button>
      </div>
      <small>退出账号作用于本机官方 Codex CLI 的登录态（~/.codex）。</small>
    </div>
  );
}
