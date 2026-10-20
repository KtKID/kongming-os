/** 每个客户端插件实例共享额度读取与宿主已接受配置；组件只登记可见需求。 */
import type { Context } from "@deepseek-ai/cordis";
import type {
  ConfigForm,
  ConfigFormSnapshot,
} from "@deepseek-ai/dsh-client-ui-settings/client";
import type {} from "@deepseek-ai/dsh-api-remotes/client";
import {
  QuotaContext,
  QuotaView,
  emptyQuota,
  QuotaPreferences,
} from "../quota-protocol.ts";
import {
  QUOTA_MIN_INTERVAL_MS,
  QUOTA_HTTP_TIMEOUT_MS,
  QUOTA_HTTP_TIMEOUT_ERROR,
} from "../quota-rules.ts";

export interface QuotaClientSnapshot {
  view: QuotaView;
  loading: boolean;
  now: number;
  error: string | null;
  settings: ConfigFormSnapshot<QuotaPreferences> | null;
  settingsError: string | null;
}
type Fetcher = typeof fetch;
export class QuotaStore {
  private state: QuotaClientSnapshot;
  private readonly listeners = new Set<() => void>();
  private consumers = 0;
  private generation = 0;
  private inFlight: Promise<void> | undefined;
  private aborter: AbortController | undefined;
  private contextAborter: AbortController | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private settingsDispose: (() => void) | undefined;
  private mirrorDispose: (() => void) | undefined;
  private contextDispose: (() => void) | undefined;
  private preferencesDispose: (() => void) | undefined;
  private namespace: string | null = null;
  private context: Context | undefined;
  private disposed = false;
  private retryAt = 0;
  private paused = false;
  private bindingGeneration = 0;

  constructor(
    private readonly fetcher: Fetcher = (...args) => fetch(...args),
    private readonly clock: () => number = Date.now,
  ) {
    this.state = {
      view: emptyQuota(),
      loading: false,
      now: clock(),
      error: null,
      settings: null,
      settingsError: null,
    };
  }
  getSnapshot = (): QuotaClientSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<QuotaClientSnapshot>): void {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
  /** HTTP 截止覆盖响应头与正文；取消与超时均释放等待者，迟到回执失去提交资格。 */
  private async withDeadline<T>(
    aborter: AbortController,
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const signal = aborter.signal;
    signal.throwIfAborted();
    let onAbort = (): void => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => {
        const reason: unknown = signal.reason;
        reject(
          reason instanceof Error
            ? reason
            : new Error("Quota request cancelled"),
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
    const deadline = setTimeout(() => {
      aborter.abort(new Error(QUOTA_HTTP_TIMEOUT_ERROR));
    }, QUOTA_HTTP_TIMEOUT_MS);
    try {
      return await Promise.race([operation(signal), aborted]);
    } finally {
      clearTimeout(deadline);
      signal.removeEventListener("abort", onAbort);
    }
  }
  private async requestJson(
    url: string,
    signal: AbortSignal,
    label: string,
  ): Promise<unknown> {
    const response = await this.fetcher(url, { cache: "no-store", signal });
    if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
    const body: unknown = await response.json();
    return body;
  }
  /** 绑定公开配置镜像；重绑与卸载使旧读取失去提交资格。 */
  async bind(ctx: Context): Promise<void> {
    const bindingGeneration = ++this.bindingGeneration;
    this.contextAborter?.abort();
    const aborter = new AbortController();
    this.contextAborter = aborter;
    this.context = ctx;
    this.contextDispose?.();
    this.contextDispose = ctx.on("connection/reset", () => {
      this.reset();
      this.bind(ctx).catch(() => undefined);
    });
    try {
      await this.withDeadline(aborter, (signal) =>
        this.bindSettings(ctx, bindingGeneration, signal),
      );
    } catch (error) {
      if (this.disposed || bindingGeneration !== this.bindingGeneration) return;
      this.publish({
        settingsError:
          error instanceof Error ? error.message : "Quota settings unavailable",
      });
      throw error;
    } finally {
      if (this.contextAborter === aborter) this.contextAborter = undefined;
    }
  }
  private async bindSettings(
    ctx: Context,
    bindingGeneration: number,
    signal: AbortSignal,
  ): Promise<void> {
    const body = QuotaContext.parse(
      await this.requestJson(
        "/api/codex-cli/quota/context",
        signal,
        "Quota settings",
      ),
    );
    if (this.disposed || bindingGeneration !== this.bindingGeneration) return;
    this.namespace = body.settingsNamespace;
    if (body.settingsNamespace === null) {
      this.publish({ settingsError: "Quota settings are unavailable" });
      return;
    }
    const form: ConfigForm<QuotaPreferences> = ctx.configForms.get(
      body.settingsNamespace,
    );
    const mirror = ctx.configForms.describe();
    this.settingsDispose?.();
    this.mirrorDispose?.();
    const sync = (): void => {
      if (this.disposed || bindingGeneration !== this.bindingGeneration) return;
      const settings = form.getSnapshot();
      const described = mirror.getSnapshot();
      const section = described.view?.namespaces.find(
        (item) => item.ns === body.settingsNamespace,
      );
      // 额度只消费自身四个键；完整 provider schema 的其他字段由各自设置页校验。
      const preferences = QuotaPreferences.safeParse(
        section?.value ?? settings.value,
      );
      const projected: ConfigFormSnapshot<QuotaPreferences> =
        settings.mode === "host" && section !== undefined && preferences.success
          ? {
              ...settings,
              status: "ready",
              value: preferences.data,
              revision: section.revision,
              writable: described.view?.writable ?? settings.writable,
            }
          : settings.mode === "memory" && settings.value === undefined
            ? { ...settings, value: body.preferences }
            : settings;
      this.publish({ settings: projected, settingsError: described.error });
    };
    this.settingsDispose = form.subscribe(sync);
    this.mirrorDispose = mirror.subscribe(sync);
    sync();
    await mirror.ensure();
    if (
      this.disposed ||
      bindingGeneration !== this.bindingGeneration ||
      signal.aborted
    )
      return;
    sync();
    this.preferencesDispose?.();
    if (form.getSnapshot().mode === "memory") {
      this.preferencesDispose = ctx.remote.$on(
        "settings/document-updated",
        () => {
          this.bind(ctx).catch(() => undefined);
        },
      );
    }
  }
  /** 保存只涉及四个额度显示键，使用用户开始编辑时的修订号。 */
  async save(
    value: QuotaPreferences,
    revision: number | undefined,
  ): Promise<void> {
    const ctx = this.context;
    if (
      ctx === undefined ||
      this.namespace === null ||
      !this.state.settings?.writable ||
      this.state.settings.mode !== "host"
    )
      throw new Error("Quota settings are read-only");
    const result = await ctx.remote.settings.mutate(
      this.namespace,
      [
        {
          op: "set",
          path: ["quotaDisplayMode"],
          value: value.quotaDisplayMode,
        },
        {
          op: "set",
          path: ["quotaAlertsEnabled"],
          value: value.quotaAlertsEnabled,
        },
        {
          op: "set",
          path: ["quotaShortThresholdPercent"],
          value: value.quotaShortThresholdPercent,
        },
        {
          op: "set",
          path: ["quotaWeeklyThresholdPercent"],
          value: value.quotaWeeklyThresholdPercent,
        },
      ],
      revision,
    );
    const mirror = ctx.configForms.describe();
    if (result.ok) {
      mirror.acceptView(result.value);
      return;
    }
    try {
      const current = await ctx.remote.settings.describe();
      if (current.ok) {
        const section = current.value.namespaces.find(
          (item) => item.ns === this.namespace,
        );
        if (section !== undefined) mirror.acceptView(section);
      }
    } catch {
      /* 宿主写入原文作为主错误保留。 */
    }
    throw new Error(result.error.message);
  }
  /** 首个可见消费者启动读取；隐藏页面与最后一个消费者离开时暂停调度。 */
  retain(): () => void {
    this.consumers++;
    if (this.consumers === 1) {
      if (typeof document !== "undefined")
        document.addEventListener("visibilitychange", this.visibility);
      this.refresh().catch(() => undefined);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.consumers--;
      if (this.consumers === 0) {
        clearTimeout(this.timer);
        if (typeof document !== "undefined")
          document.removeEventListener("visibilitychange", this.visibility);
      }
    };
  }
  private visible(): boolean {
    return (
      typeof document === "undefined" || document.visibilityState !== "hidden"
    );
  }
  private visibility = (): void => {
    clearTimeout(this.timer);
    if (this.visible()) this.refresh().catch(() => undefined);
  };
  /** 回执代数隔离重连，某组件卸载保持其他消费者的共享请求。 */
  reset(refresh = true): void {
    clearTimeout(this.timer);
    this.retryAt = 0;
    this.paused = !refresh;
    this.generation++;
    this.aborter?.abort();
    this.inFlight = undefined;
    this.publish({ view: emptyQuota(), loading: false, error: null });
    if (refresh && this.consumers > 0) this.refresh().catch(() => undefined);
  }
  refresh = (force = false): Promise<void> => {
    if (this.disposed || this.paused || !this.visible())
      return Promise.resolve();
    if (this.inFlight !== undefined) return this.inFlight;
    const now = this.clock();
    this.publish({ now });
    if (now < Math.max(this.state.view.nextRefreshAtMs, this.retryAt)) {
      this.schedule();
      return Promise.resolve();
    }
    const generation = this.generation;
    const aborter = new AbortController();
    this.aborter = aborter;
    this.publish({ loading: true, error: null });
    this.inFlight = (async () => {
      try {
        const view = QuotaView.parse(
          await this.withDeadline(
            aborter,
            async (signal) =>
              await this.requestJson(
                `/api/codex-cli/quota?detail=full&force=${force ? "1" : "0"}`,
                signal,
                "Quota",
              ),
          ),
        );
        if (generation === this.generation) {
          this.retryAt = Math.max(
            view.nextRefreshAtMs,
            this.clock() +
              (view.nextRefreshAtMs <= this.clock()
                ? QUOTA_MIN_INTERVAL_MS
                : 0),
          );
          this.publish({ view, error: null });
        }
      } catch (error) {
        if (generation === this.generation) {
          this.retryAt = this.clock() + QUOTA_MIN_INTERVAL_MS;
          this.publish({
            error: error instanceof Error ? error.message : "Quota unavailable",
          });
        }
      } finally {
        if (generation === this.generation) {
          this.inFlight = undefined;
          this.publish({ loading: false, now: this.clock() });
          this.schedule();
        }
      }
    })();
    return this.inFlight;
  };
  private schedule(): void {
    clearTimeout(this.timer);
    if (this.disposed || this.paused || this.consumers === 0 || !this.visible())
      return;
    const now = this.clock();
    const next = Math.max(this.state.view.nextRefreshAtMs, this.retryAt);
    const events = this.state.view.groups
      .flatMap((g) => g.windows.map((w) => w.resetsAtMs))
      .filter((at): at is number => at !== null && at > now);
    const stale =
      this.state.view.fetchedAtMs === null
        ? Infinity
        : this.state.view.fetchedAtMs + QUOTA_MIN_INTERVAL_MS + 1;
    if (stale > now) events.push(stale);
    const delay = Math.max(
      50,
      Math.min(60000, next - now, ...events.map((at) => at - now)),
    );
    this.timer = setTimeout(() => {
      this.refresh().catch(() => undefined);
    }, delay);
  }
  dispose(): void {
    this.disposed = true;
    this.generation++;
    this.aborter?.abort();
    this.contextAborter?.abort();
    clearTimeout(this.timer);
    this.settingsDispose?.();
    this.mirrorDispose?.();
    this.contextDispose?.();
    this.preferencesDispose?.();
    this.listeners.clear();
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.visibility);
  }
}
