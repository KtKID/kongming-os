/** 导出当前关联 session；固定完整行截止范围，两遍校验后提供 JSON 流。 */
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import type { TraceReader } from "./reader.ts";
import { readRaw, TraceReadError } from "./source.ts";
import { sumUsage } from "./projector.ts";
import { ExportRecordSchema, TraceExportSchema } from "./protocol.ts";
/** 文件名只包含安全字符；源 ID 在正文中完整保留。 */
export function exportName(sessionId: string, at: string): string {
  return (
    "codex-cli-trace-" +
    sessionId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100) +
    "-" +
    at.replace(/[^0-9TZ]/g, "") +
    ".json"
  );
}
/** 请求取消或插件卸载均停止读取；输出失败通过流错误传递给下载端。 */
export async function exportTrace(
  reader: TraceReader,
  sessionId: string,
  options: {
    signal?: AbortSignal;
    beforeSecondRead?: () => Promise<void>;
  } = {},
): Promise<Response> {
  const local = new AbortController();
  const signal = AbortSignal.any([
    reader.signal,
    local.signal,
    ...(options.signal === undefined ? [] : [options.signal]),
  ]);
  let finish: () => void = () => {};
  const complete = new Promise<void>((resolve) => {
    finish = resolve;
  });
  reader.ownExport(complete);
  try {
    const cache = await reader.capture(sessionId, signal);
    const snapshot = cache.snapshot;
    const source = snapshot.source;
    if (source === null) throw new TraceReadError("SOURCE_UNAVAILABLE", 404);
    const check = async (): Promise<void> => {
      signal.throwIfAborted();
      const s = await stat(cache.path);
      if (
        `${s.dev}:${s.ino}` !== cache.identity ||
        s.size < source.completeByteEnd
      )
        throw new TraceReadError("READ_CHANGED", 409);
    };
    await check();
    const first = createHash("sha256");
    for (const line of cache.lines)
      first.update(await readRaw(cache.path, line, signal));
    const expected = first.digest("hex");
    const at = new Date().toISOString();
    const header = TraceExportSchema.omit({
      records: true,
      sourceSha256: true,
    }).parse({
      formatVersion: 1,
      exportedAt: at,
      sessionId,
      nativeSessionId: cache.nativeId,
      source,
      turns: snapshot.turns,
      summary: sumUsage(snapshot.turns.map((turn) => turn.usage)),
      issues: snapshot.issues,
    });
    await options.beforeSecondRead?.();
    const encode = new TextEncoder();
    async function* generate(): AsyncGenerator<Uint8Array> {
      try {
        await check();
        yield encode.encode(
          JSON.stringify(header).slice(0, -1) + ',"records":[',
        );
        const second = createHash("sha256");
        let comma = false;
        for (const line of cache.lines) {
          const bytes = await readRaw(cache.path, line, signal);
          second.update(bytes);
          let raw: string,
            encoding: "utf8" | "base64" = "utf8";
          try {
            raw = new TextDecoder("utf-8", {
              fatal: true,
              ignoreBOM: true,
            }).decode(bytes);
          } catch {
            raw = bytes.toString("base64");
            encoding = "base64";
          }
          const record = ExportRecordSchema.parse({
            source: line.source,
            encoding,
            raw,
          });
          yield encode.encode((comma ? "," : "") + JSON.stringify(record));
          comma = true;
        }
        await check();
        if (second.digest("hex") !== expected)
          throw new TraceReadError("READ_CHANGED", 409);
        yield encode.encode(
          '],"sourceSha256":' + JSON.stringify(expected) + "}",
        );
      } finally {
        finish();
      }
    }
    const iterator = generate();
    let detach: () => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const abort = (): void => {
          controller.error(new TraceReadError("EXPORT_CANCELLED"));
          void iterator
            .return(undefined)
            .finally(finish)
            .catch(() => {});
        };
        signal.addEventListener("abort", abort, { once: true });
        detach = () => {
          signal.removeEventListener("abort", abort);
        };
        if (signal.aborted) abort();
      },
      async pull(controller) {
        try {
          const next = await iterator.next();
          if (next.done) {
            detach();
            controller.close();
          } else controller.enqueue(next.value);
        } catch (error) {
          detach();
          finish();
          controller.error(error);
        }
      },
      async cancel() {
        local.abort();
        detach();
        await iterator.return(undefined);
        finish();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="' + exportName(sessionId, at) + '"',
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    finish();
    throw error;
  }
}
