/** 当前已关联 CLI 文件的读取协调器；缓存和读取代都只存在于内存。 */
import { stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.ts";
import { readBinding } from "./bindings.ts";
import {
  locate,
  readLines,
  readRaw,
  sourceMeta,
  TraceReadError,
  type SourceLine,
} from "./source.ts";
import { project, type Projection } from "./projector.ts";
import {
  DetailSchema,
  SnapshotSchema,
  TimelineSchema,
  type TraceSnapshot,
  type TimelineRequest,
  type TimelinePage,
  type TraceDetail,
} from "./protocol.ts";
import { READER_IDLE_MS } from "./paths.ts";
interface Cache {
  path: string;
  nativeId: string;
  identity: string;
  mtime: number;
  size: number;
  lines: SourceLine[];
  snapshot: TraceSnapshot;
  projection: Projection;
  invalid: boolean;
  access: number;
}
interface Hooks {
  now?: () => Date;
  beforeRead?: () => Promise<void>;
}
/** 文件错误使用稳定类别，保留原始异常作为宿主诊断原因。 */
function mapped(error: unknown): Error {
  return error instanceof TraceReadError ||
    (error instanceof Error && error.message.startsWith("BINDING_"))
    ? error
    : new TraceReadError("SOURCE_UNREADABLE");
}
async function abortable<T>(
  pending: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (signal === undefined) return pending;
  signal.throwIfAborted();
  let abort: () => void = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => {
      const reason: unknown = signal.reason;
      reject(
        reason instanceof Error
          ? reason
          : new DOMException("Request aborted", "AbortError"),
      );
    };
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([pending, stopped]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
export class TraceReader {
  private readonly cache = new Map<string, Cache>();
  private readonly pending = new Map<string, Promise<TraceSnapshot>>();
  private readonly active = new Set<Promise<unknown>>();
  private readonly stop = new AbortController();
  constructor(
    readonly config: Config,
    private readonly hooks: Hooks = {},
  ) {}
  private now(): Date {
    return this.hooks.now?.() ?? new Date();
  }
  private track<T>(work: Promise<T>): Promise<T> {
    const p = work.finally(() => {
      this.active.delete(p);
    });
    this.active.add(p);
    return p;
  }
  /** 合并同一 session 的重叠读取；单个请求取消只取消该请求等待。 */
  async snapshot(
    sessionId: string,
    options: { reload?: boolean; signal?: AbortSignal } = {},
  ): Promise<TraceSnapshot> {
    this.stop.signal.throwIfAborted();
    options.signal?.throwIfAborted();
    let job = this.pending.get(sessionId);
    if (job === undefined) {
      const work = this.track(this.read(sessionId, options.reload === true));
      job = work.finally(() => {
        this.pending.delete(sessionId);
      });
      this.pending.set(sessionId, job);
    }
    return abortable(job, options.signal);
  }
  private blank(sessionId: string, nativeId: string | null): TraceSnapshot {
    return SnapshotSchema.parse({
      sessionId,
      nativeSessionId: nativeId,
      state: nativeId === null ? "unlinked" : "waiting",
      readToken: null,
      readAt: this.now().toISOString(),
      refreshIntervalMs: this.config.refreshIntervalMs,
      source: null,
      turns: [],
      issues: [],
    });
  }
  private async read(
    sessionId: string,
    reload: boolean,
  ): Promise<TraceSnapshot> {
    try {
      const nativeId = await readBinding(this.config.bindingsFile, sessionId);
      this.stop.signal.throwIfAborted();
      if (nativeId === null) {
        this.cache.delete(sessionId);
        return this.blank(sessionId, null);
      }
      let old = this.cache.get(sessionId);
      if (reload || old?.nativeId !== nativeId) {
        this.cache.delete(sessionId);
        old = undefined;
      }
      if (old?.invalid) throw new TraceReadError("READ_CHANGED", 409);
      const location =
        old === undefined
          ? await locate(this.config.codexHome, nativeId)
          : { path: old.path, relativePath: old.snapshot.source?.path ?? "" };
      if (location === null) return this.blank(sessionId, nativeId);
      const current = await stat(location.path);
      this.stop.signal.throwIfAborted();
      const identity = `${current.dev}:${current.ino}`;
      if (
        old !== undefined &&
        (old.identity !== identity ||
          current.size < old.size ||
          (current.size === old.size && current.mtimeMs !== old.mtime))
      ) {
        old.invalid = true;
        throw new TraceReadError("READ_CHANGED", 409);
      }
      if (
        old !== undefined &&
        old.size === current.size &&
        old.mtime === current.mtimeMs
      ) {
        old.access = this.now().getTime();
        return { ...old.snapshot, readAt: this.now().toISOString() };
      }
      await this.hooks.beforeRead?.();
      this.stop.signal.throwIfAborted();
      const start = old?.snapshot.source?.completeByteEnd ?? 0;
      const batch = await readLines(
        location.path,
        start,
        (old?.lines.length ?? 0) + 1,
        this.stop.signal,
        current.size,
      );
      const lines = [...(old?.lines ?? []), ...batch.lines];
      if (lines.length === 0) return this.blank(sessionId, nativeId);
      const meta = sourceMeta(lines, nativeId);
      const projection = project(lines, nativeId);
      const issues = [...projection.issues];
      if (batch.bytes > batch.end)
        issues.push({
          kind: "pending-tail",
          message: "末尾记录正在等待完整保存",
          source: null,
          nativeTurnId: null,
        });
      const snapshot = SnapshotSchema.parse({
        sessionId,
        nativeSessionId: nativeId,
        state: "ready",
        readToken: randomUUID(),
        readAt: this.now().toISOString(),
        refreshIntervalMs: this.config.refreshIntervalMs,
        source: {
          path: location.relativePath,
          cliVersion: meta.cliVersion,
          bytes: batch.bytes,
          completeByteEnd: batch.end,
          pendingTailBytes: batch.bytes - batch.end,
          lineCount: lines.length,
        },
        turns: projection.turns,
        issues,
      });
      this.cache.set(sessionId, {
        path: location.path,
        nativeId,
        identity: batch.identity,
        mtime: batch.mtime,
        size: batch.bytes,
        lines,
        snapshot,
        projection,
        invalid: false,
        access: this.now().getTime(),
      });
      return snapshot;
    } catch (error) {
      throw mapped(error);
    }
  }
  private async current(sessionId: string, token: string): Promise<Cache> {
    this.stop.signal.throwIfAborted();
    const c = this.cache.get(sessionId);
    if (c === undefined || c.invalid || c.snapshot.readToken !== token)
      throw new TraceReadError("READ_CHANGED", 409);
    const nativeId = await readBinding(this.config.bindingsFile, sessionId);
    if (nativeId !== c.nativeId) {
      c.invalid = true;
      throw new TraceReadError("READ_CHANGED", 409);
    }
    const s = await stat(c.path);
    if (
      `${s.dev}:${s.ino}` !== c.identity ||
      s.size < c.size ||
      (s.size === c.size && s.mtimeMs !== c.mtime)
    ) {
      c.invalid = true;
      throw new TraceReadError("READ_CHANGED", 409);
    }
    c.access = this.now().getTime();
    return c;
  }
  /** 条目查询在完整已读事实中执行，显示摘录不影响搜索。 */
  async timeline(
    query: TimelineRequest,
    signal?: AbortSignal,
  ): Promise<TimelinePage> {
    return this.track(
      (async () => {
        signal?.throwIfAborted();
        const c = await this.current(query.sessionId, query.readToken);
        const needle = query.q.toLowerCase();
        const matches = [...c.projection.facts.values()]
          .filter(
            (f) =>
              (f.entry.nativeTurnId === query.nativeTurnId ||
                f.entry.nativeTurnId === null) &&
              (query.category === "all" || f.entry.kind === query.category) &&
              (query.onlyErrors !== "1" || f.entry.status === "failed") &&
              [f.entry.title, f.arguments, f.result, f.text].some((v) =>
                v?.toLowerCase().includes(needle),
              ),
          )
          .map((f) => f.entry)
          .sort(
            (a, b) => (a.sources[0]?.line ?? 0) - (b.sources[0]?.line ?? 0),
          );
        signal?.throwIfAborted();
        const end = query.cursor + query.limit;
        return TimelineSchema.parse({
          entries: matches.slice(query.cursor, end),
          nextCursor: end < matches.length ? end : null,
          total: matches.length,
          readToken: query.readToken,
        });
      })(),
    );
  }
  /** 打开详情时重新读取对应字节并核对摘要。 */
  async entry(
    sessionId: string,
    token: string,
    id: string,
    signal?: AbortSignal,
  ): Promise<TraceDetail> {
    return this.track(
      (async () => {
        const c = await this.current(sessionId, token);
        const f = c.projection.facts.get(id);
        if (f === undefined) throw new TraceReadError("ENTRY_MISSING", 404);
        const combined =
          signal === undefined
            ? this.stop.signal
            : AbortSignal.any([this.stop.signal, signal]);
        const raw = [];
        for (const source of f.entry.sources) {
          const line = c.lines[source.line - 1];
          if (line === undefined) throw new TraceReadError("READ_CHANGED", 409);
          try {
            const bytes = await readRaw(c.path, line, combined);
            raw.push({ source, text: bytes.toString("utf8") });
          } catch (error) {
            if (
              error instanceof TraceReadError &&
              error.code === "READ_CHANGED"
            )
              c.invalid = true;
            throw mapped(error);
          }
        }
        return DetailSchema.parse({
          entry: f.entry,
          arguments: f.arguments,
          result: f.result,
          text: f.text,
          raw,
        });
      })(),
    );
  }
  /** 导出取得当前同一读取代，仅供宿主内部使用。 */
  async capture(sessionId: string, signal?: AbortSignal): Promise<Cache> {
    const s = await this.snapshot(
      sessionId,
      signal === undefined ? {} : { signal },
    );
    if (s.readToken === null)
      throw new TraceReadError("SOURCE_UNAVAILABLE", 404);
    return this.current(sessionId, s.readToken);
  }
  evictIdle(): void {
    const cutoff = this.now().getTime() - READER_IDLE_MS;
    for (const [key, value] of this.cache)
      if (value.access < cutoff && !this.pending.has(key))
        this.cache.delete(key);
  }
  /** 导出流复用插件的取消和等待边界。 */
  get signal(): AbortSignal {
    return this.stop.signal;
  }
  ownExport(work: Promise<void>): void {
    void this.track(work).catch(() => {});
  }
  get diagnostics(): { readers: number; inFlight: number } {
    return { readers: this.cache.size, inFlight: this.active.size };
  }
  async dispose(): Promise<void> {
    this.stop.abort(new TraceReadError("TRACE_CLOSED"));
    await Promise.allSettled(this.active);
    this.cache.clear();
  }
}
