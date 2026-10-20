/** 官方 CLI 只读额度读取：共享请求、五分钟冷却、账号代数及分区投影。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Config } from "./config.ts";
import { connectCodex, type CodexConnection } from "./connection.ts";
import {
  Method,
  fieldOf,
  QuotaAccountResult,
  NativeQuotaResult,
  NativeQuotaSnapshot,
  NativeQuotaWindow,
  NativeCredits,
  NativeSpendLimit,
  NativeResetCredits,
} from "./protocol.ts";
import {
  emptyQuota,
  QuotaView,
  type QuotaError,
  type QuotaGroup,
} from "./quota-protocol.ts";
import { QUOTA_MIN_INTERVAL_MS } from "./quota-rules.ts";

export type QuotaConnection = Pick<
  CodexConnection,
  "request" | "stop" | "onNotification"
>;
export interface QuotaDependencies {
  now?: () => number;
  connect?: (signal: AbortSignal) => Promise<QuotaConnection>;
}
/** errors 中只发送稳定文案，原始 RPC 错误与账号标识保留在宿主。 */
function failure(
  area: QuotaError["area"],
  code: QuotaError["code"] = "invalid-data",
): QuotaError {
  return {
    area,
    code,
    message:
      code === "unsupported"
        ? "This CLI version does not support quota reads"
        : code === "read-failed"
          ? "Quota read failed; retry after the cooldown"
          : "This quota section is temporarily unavailable",
  };
}

export class CodexQuotaService {
  private view = emptyQuota();
  private inFlight: Promise<QuotaView> | undefined;
  private controller: AbortController | undefined;
  private identity: string | undefined;
  private accountKey: string | undefined;
  private disposed = false;
  private readonly now: () => number;
  private readonly connect: (signal: AbortSignal) => Promise<QuotaConnection>;

  constructor(
    ctx: Context,
    private readonly config: Config,
    dependencies: QuotaDependencies = {},
  ) {
    this.now = dependencies.now ?? Date.now;
    this.connect =
      dependencies.connect ??
      ((signal) =>
        connectCodex(
          ctx,
          {
            command: config.command,
            cwd: config.cwd,
            env: config.env,
            configOverrides: [],
            graceMs: config.graceMs,
            startupTimeoutMs: config.startupTimeoutMs,
          },
          signal,
        ));
  }
  /** 返回副本，消费者无法修改共享缓存。 */
  snapshot(): QuotaView {
    return structuredClone(this.view);
  }
  /** 账号变化立即淘汰所有区域；冷却时间保留，旧请求失去提交资格。 */
  invalidate(state: "loading" | "signed-out" = "loading"): void {
    this.view = emptyQuota(
      this.view.accountEpoch + 1,
      this.view.nextRefreshAtMs,
    );
    this.view.state = state;
    this.identity = undefined;
    this.accountKey = undefined;
    this.controller?.abort();
  }
  /** 插件卸载中止读取；共享等待者仍由同一回收路径完成。 */
  dispose(): void {
    this.disposed = true;
    this.invalidate();
  }
  /** 自动读取与 force 均共享同一冷却；force 只表达刷新意图。 */
  read(): Promise<QuotaView> {
    if (this.inFlight !== undefined)
      return this.inFlight.then(() => this.snapshot());
    if (this.disposed || this.now() < this.view.nextRefreshAtMs)
      return Promise.resolve(this.snapshot());
    this.view.nextRefreshAtMs = this.now() + QUOTA_MIN_INTERVAL_MS;
    const epoch = this.view.accountEpoch;
    const controller = new AbortController();
    this.controller = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(this.config.probeTimeoutMs),
    ]);
    this.inFlight = this.load(epoch, signal).finally(() => {
      this.inFlight = undefined;
      this.controller = undefined;
    });
    return this.inFlight.then(() => this.snapshot());
  }
  private async load(epoch: number, signal: AbortSignal): Promise<QuotaView> {
    let connection: QuotaConnection | undefined;
    let activeEpoch = epoch;
    let readingAccount = true;
    try {
      connection = await this.connect(signal);
      connection.onNotification((method) => {
        // CLI 在 account/read 回执前公布初始元数据；该阶段用回执核对账号身份。
        if (method === "account/updated" && !readingAccount) this.invalidate();
      });
      const { account } = QuotaAccountResult.parse(
        await connection.request(
          Method.accountRead,
          { refreshToken: false },
          signal,
        ),
      );
      readingAccount = false;
      if (activeEpoch !== this.view.accountEpoch || signal.aborted)
        return this.snapshot();
      const identity = JSON.stringify(account);
      if (this.identity !== undefined && this.identity !== identity) {
        this.view = emptyQuota(
          this.view.accountEpoch + 1,
          this.view.nextRefreshAtMs,
        );
      }
      this.identity = identity;
      activeEpoch = this.view.accountEpoch;
      if (account === null || account.type !== "chatgpt") {
        this.view = {
          ...emptyQuota(this.view.accountEpoch, this.view.nextRefreshAtMs),
          state: account === null ? "signed-out" : "unsupported",
        };
        return this.snapshot();
      }
      const raw = NativeQuotaResult.parse(
        await connection.request(
          Method.accountRateLimitsRead,
          { excludeResetCreditDetails: false },
          signal,
        ),
      );
      if (activeEpoch !== this.view.accountEpoch || signal.aborted)
        return this.snapshot();
      if (
        raw.accountId != null &&
        this.accountKey !== undefined &&
        this.accountKey !== raw.accountId
      ) {
        this.view = emptyQuota(
          this.view.accountEpoch + 1,
          this.view.nextRefreshAtMs,
        );
      }
      this.accountKey = raw.accountId ?? identity;
      this.project(raw);
    } catch (error) {
      if (
        activeEpoch === this.view.accountEpoch &&
        !this.controller?.signal.aborted
      ) {
        const unsupported =
          fieldOf(error, "code") === -32601 ||
          (error instanceof Error &&
            /method not found|unsupported|-32601/iu.test(error.message));
        this.view = {
          ...this.view,
          state: unsupported ? "unsupported" : "error",
          errors: [
            failure("account", unsupported ? "unsupported" : "read-failed"),
          ],
        };
      }
    } finally {
      if (connection !== undefined)
        await connection
          .stop(this.config.cleanupTimeoutMs)
          .catch(() => undefined);
    }
    return this.snapshot();
  }
  private project(raw: ReturnType<typeof NativeQuotaResult.parse>): void {
    const at = this.now();
    const errors: QuotaError[] = [];
    const groups: QuotaGroup[] = [];
    const entries =
      raw.rateLimitsByLimitId === null ||
      raw.rateLimitsByLimitId === undefined ||
      Object.keys(raw.rateLimitsByLimitId).length === 0
        ? [["codex", raw.rateLimits]]
        : Object.entries(raw.rateLimitsByLimitId);
    for (const [key, value] of entries) {
      const parsed = NativeQuotaSnapshot.safeParse(value);
      if (!parsed.success) {
        errors.push(failure("windows"));
        continue;
      }
      const group = parsed.data;
      const windows: QuotaGroup["windows"] = [];
      for (const value of [group.primary, group.secondary]) {
        if (value == null) continue;
        const window = NativeQuotaWindow.safeParse(value);
        if (!window.success) {
          errors.push(failure("windows"));
          continue;
        }
        windows.push({
          usedPercent: window.data.usedPercent,
          remainingPercent: 100 - window.data.usedPercent,
          windowMinutes: window.data.windowDurationMins,
          resetsAtMs:
            window.data.resetsAt === null ? null : window.data.resetsAt * 1000,
        });
      }
      windows.sort(
        (a, b) => (a.windowMinutes ?? Infinity) - (b.windowMinutes ?? Infinity),
      );
      groups.push({
        id: group.limitId ?? String(key),
        name: group.limitName ?? null,
        windows,
      });
    }
    const main = NativeQuotaSnapshot.safeParse(raw.rateLimits);
    const credits = NativeCredits.nullish().safeParse(
      main.success ? main.data.credits : {},
    );
    const spend = NativeSpendLimit.nullish().safeParse(
      main.success ? main.data.individualLimit : {},
    );
    const resets = NativeResetCredits.nullish().safeParse(
      raw.rateLimitResetCredits,
    );
    if (!credits.success) errors.push(failure("credits"));
    if (!spend.success) errors.push(failure("spend"));
    if (!resets.success) errors.push(failure("resets"));
    this.view = QuotaView.parse({
      ...this.view,
      state: "ready",
      errors,
      ...(groups.some((group) => group.windows.length > 0) ||
      !errors.some((e) => e.area === "windows")
        ? { groups, fetchedAtMs: at }
        : {}),
      ...(credits.success
        ? { credits: credits.data ?? null, creditsAtMs: at }
        : {}),
      ...(spend.success
        ? {
            spend:
              spend.data == null
                ? null
                : { ...spend.data, resetsAtMs: spend.data.resetsAt * 1000 },
            spendAtMs: at,
          }
        : {}),
      ...(resets.success
        ? {
            resets:
              resets.data == null
                ? null
                : {
                    availableCount: resets.data.availableCount,
                    cards:
                      resets.data.credits?.map((c) => ({
                        id: c.id,
                        title: c.title,
                        description: c.description,
                        status: c.status,
                        expiresAtMs:
                          c.expiresAt === null ? null : c.expiresAt * 1000,
                      })) ?? null,
                  },
            resetsAtMs: at,
          }
        : {}),
    });
  }
}
