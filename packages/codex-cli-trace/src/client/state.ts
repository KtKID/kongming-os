/** 当前会话的选择和请求有效性；跨会话响应在状态边界拒绝。 */
import type { z } from "zod";
import { TraceExportSchema, ErrorSchema, type TraceTurn } from "../protocol.ts";
export function chooseTurn(
  turns: readonly TraceTurn[],
  previous: string | null,
): string | null {
  if (previous !== null && turns.some((t) => t.nativeTurnId === previous))
    return previous;
  return (
    turns.findLast((t) => t.status === "pending")?.nativeTurnId ??
    turns.at(-1)?.nativeTurnId ??
    null
  );
}
export class RequestFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
/** 只接收 JSON 协议定义内的值，HTTP 错误采用共享结构。 */
export async function fetchJson<T>(
  url: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  const input: unknown = await response.json();
  if (!response.ok) {
    const error = ErrorSchema.safeParse(input);
    throw new RequestFailure(
      error.success ? error.data.error : "READ_FAILED",
      error.success ? error.data.reason : "读取失败，请重试",
    );
  }
  return schema.parse(input);
}
/** 跨标签生命周期的短提示，由 shell.overlay 持有渲染。 */
let notice: { id: number; text: string } | null = null;
let noticeId = 0;
const noticeListeners = new Set<() => void>();
export const notices = {
  getSnapshot: () => notice,
  subscribe: (listener: () => void) => {
    noticeListeners.add(listener);
    return () => {
      noticeListeners.delete(listener);
    };
  },
  show: (text: string) => {
    notice = { id: ++noticeId, text };
    for (const listener of noticeListeners) listener();
  },
  clear: () => {
    notice = null;
    for (const listener of noticeListeners) listener();
  },
};
/** 串行轮询的时间源便于在测试中控制时钟。 */
interface PollClock {
  set: (callback: () => void, ms: number) => unknown;
  clear: (id: unknown) => void;
}
const browserClock: PollClock = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (id) => {
    if (typeof id === "number") clearTimeout(id);
  },
};
/** 活跃页面串行读取；停止会取消请求和后续定时器。 */
export function poll(
  options: {
    run: (signal: AbortSignal) => Promise<void>;
    interval: () => number;
    visible: () => boolean;
    onError: (error: unknown) => void;
  },
  clock: PollClock = browserClock,
): { wake: () => void; stop: () => void } {
  const abort = new AbortController();
  let running = false;
  let timer: unknown;
  const tick = (): void => {
    if (running || abort.signal.aborted) return;
    clock.clear(timer);
    if (!options.visible()) {
      timer = clock.set(tick, options.interval());
      return;
    }
    running = true;
    options
      .run(abort.signal)
      .catch((error) => {
        if (!abort.signal.aborted) options.onError(error);
      })
      .finally(() => {
        running = false;
        if (!abort.signal.aborted) timer = clock.set(tick, options.interval());
      })
      .catch(() => {});
  };
  tick();
  return {
    wake: tick,
    stop: () => {
      abort.abort();
      clock.clear(timer);
    },
  };
}
/** 完整接收并校验之后才生成可保存的文件，HTTP 或流失败直接向调用者报告。 */
export async function receiveExport(
  sessionId: string,
  signal: AbortSignal,
): Promise<{ blob: Blob; name: string }> {
  const response = await fetch(
    "/api/codex-cli-trace/export?" +
      new URLSearchParams({ sessionId }).toString(),
    { signal, cache: "no-store", credentials: "same-origin" },
  );
  const text = await response.text();
  const input: unknown = JSON.parse(text);
  if (!response.ok) {
    const error = ErrorSchema.safeParse(input);
    throw new RequestFailure(
      error.success ? error.data.error : "EXPORT_FAILED",
      error.success ? error.data.reason : "导出失败，请重试",
    );
  }
  const value = TraceExportSchema.parse(input);
  if (
    value.sessionId !== sessionId ||
    value.records.length !== value.source.lineCount
  )
    throw new RequestFailure("EXPORT_MISMATCH", "导出范围与当前会话不符");
  signal.throwIfAborted();
  return {
    blob: new Blob([text], { type: "application/json;charset=utf-8" }),
    name:
      "codex-cli-trace-" +
      sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) +
      "-" +
      value.exportedAt.replace(/[^0-9TZ]/g, "") +
      ".json",
  };
}
