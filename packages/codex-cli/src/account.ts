/** 官方账号状态与登录转发：凭据由官方 CLI 保存于用户 Codex home，插件只读判定。 */
import type { Context } from "@deepseek-ai/cordis";
import { readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { connectCodex, type CodexConnection } from "./connection.ts";
import { Incoming } from "./protocol.ts";

import type { AccountStatus } from "./account-status.ts";
export type { AccountStatus };
/** 用户默认 Codex home 下的凭据文件。 */
function authFilePath(): string {
  return join(homedir(), ".codex", "auth.json");
}

/**
 * 账号操作：状态按本地凭据存在性判定（不发请求）；登录经官方 CLI 的
 * account/login/start 打开授权页并等待完成通知；退出转发 account/logout。
 */
export class CodexAccount {
  private state: AccountStatus = { login: "idle" };
  private active: { connection: CodexConnection; loginId?: string } | undefined;
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}
  /**
   * 当前账号状态：仅检查本地凭据文件存在性与可解析性，不发起任何请求。
   */
  async status(): Promise<AccountStatus> {
    if (this.active !== undefined) return { ...this.state };
    try {
      await stat(authFilePath());
      const text: unknown = await readFile(authFilePath(), "utf8");
      JSON.parse(typeof text === "string" ? text : "");
      this.state = {
        login: "signed-in",
        credentialSource: "~/.codex/auth.json（Codex 原生登录）",
      };
    } catch {
      this.state = { login: "idle" };
    }
    return { ...this.state };
  }
  /**
   * 开始一次官方授权登录；重复调用共享进行中的尝试。
   * @returns 安全状态：含授权链接，等待 account/login/completed。
   */
  async login(): Promise<AccountStatus> {
    if (this.active !== undefined) return { ...this.state };
    this.state = { login: "starting" };
    const signal = AbortSignal.timeout(this.config.loginTimeoutMs);
    try {
      const connection = await connectCodex(
        this.ctx,
        {
          command: this.config.command,
          cwd: this.config.cwd,
          configOverrides: [],
          env: this.config.env,
          graceMs: this.config.graceMs,
          startupTimeoutMs: this.config.startupTimeoutMs,
        },
        signal,
      );
      this.active = { connection };
      const completion = new Promise<AccountStatus>((resolve, reject) => {
        connection.onNotification((method, params) => {
          if (method !== Incoming.accountLoginCompleted) return;
          const success = params.success === true;
          const error =
            typeof params.error === "string" ? params.error : undefined;
          resolve(
            success
              ? {
                  login: "signed-in",
                  credentialSource: "~/.codex/auth.json（Codex 原生登录）",
                }
              : { login: "failed", error: error ?? "CODEX_LOGIN_FAILED" },
          );
        });
        signal.addEventListener("abort", () =>
          reject(new Error("CODEX_LOGIN_TIMEOUT")),
        );
      });
      const raw: unknown = await connection.request(
        "account/login/start",
        { type: "chatgpt" },
        signal,
      );
      const authUrl = extractAuthUrl(raw);
      const loginId = extractLoginId(raw);
      if (authUrl === undefined) throw new Error("CODEX_LOGIN_URL_MISSING");
      if (loginId !== undefined) this.active.loginId = loginId;
      this.state = {
        login: "waiting",
        ...(authUrl === undefined ? {} : { authorizeUrl: authUrl }),
      };
      const final = await completion;
      this.state = final;
      return {
        ...final,
        ...(authUrl === undefined ? {} : { authorizeUrl: authUrl }),
      };
    } catch (error) {
      this.state = {
        login: "failed",
        error: /^CODEX_[A-Z_]+/.test(
          error instanceof Error ? error.message : String(error),
        )
          ? error instanceof Error
            ? error.message
            : String(error)
          : "CODEX_LOGIN_FAILED",
      };
      return { ...this.state };
    } finally {
      const active = this.active;
      this.active = undefined;
      if (active !== undefined)
        await active.connection.stop(this.config.cleanupTimeoutMs);
    }
  }
  /**
   * 取消进行中的登录尝试。
   * @returns 取消后的状态；无进行中尝试时为 no-op。
   */
  async cancel(): Promise<AccountStatus> {
    const active = this.active;
    if (active?.loginId !== undefined) {
      try {
        await active.connection.request(
          "account/login/cancel",
          { loginId: active.loginId },
          AbortSignal.timeout(this.config.cancelReceiptTimeoutMs),
        );
      } catch {
        // 取消失败不阻断：连接随后关闭即终止等待。
      }
    }
    if (this.active !== undefined) {
      this.state = { login: "idle" };
      this.active = undefined;
      await active?.connection.stop(this.config.cleanupTimeoutMs);
    }
    return await this.status();
  }
  /**
   * 退出当前 Codex CLI 账号（作用于用户 Codex home 的登录态）。
   * 验收约定：本操作不执行真实退出验证，仅保证协议调用路径正确。
   */
  async logout(): Promise<AccountStatus> {
    const signal = AbortSignal.timeout(this.config.probeTimeoutMs);
    const connection = await connectCodex(
      this.ctx,
      {
        command: this.config.command,
        cwd: this.config.cwd,
        configOverrides: [],
        env: this.config.env,
        graceMs: this.config.graceMs,
        startupTimeoutMs: this.config.startupTimeoutMs,
      },
      signal,
    );
    try {
      await connection.request("account/logout", {}, signal);
    } finally {
      await connection.stop(this.config.cleanupTimeoutMs);
    }
    return await this.status();
  }
}
/** 从 login/start 响应提取授权链接（chatgpt / chatgptDeviceCode 两形态）。 */
function extractAuthUrl(value: unknown): string | undefined {
  const url = fieldOf(value, "authUrl") ?? fieldOf(value, "verificationUrl");
  return typeof url === "string" && url.length > 0 ? url : undefined;
}
function extractLoginId(value: unknown): string | undefined {
  const id = fieldOf(value, "loginId");
  return typeof id === "string" ? id : undefined;
}
function fieldOf(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  for (const [name, item] of Object.entries(value))
    if (name === key) return item;
  return undefined;
}
