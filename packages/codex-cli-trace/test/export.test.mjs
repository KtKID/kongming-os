import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fixture, sampleRecords, encode } from "./fixtures.mjs";
import { TraceReader } from "../lib/src/reader.js";
import { exportTrace } from "../lib/src/export.js";
import { TraceExportSchema } from "../lib/src/protocol.js";
function reconstruct(e) {
  return Buffer.concat(
    e.records.map((x) =>
      Buffer.from(x.raw, x.encoding === "base64" ? "base64" : "utf8"),
    ),
  );
}
test("T25 export includes all turns, long raw records and reproducible digest", async (t) => {
  const rows = sampleRecords();
  rows.find((x) => x.payload.type === "function_call_output").payload.output =
    "<script>中文原文</script>".repeat(5000);
  const f = await fixture(t, rows),
    r = new TraceReader(f);
  t.after(() => r.dispose());
  const res = await exportTrace(r, f.sessionId);
  const e = TraceExportSchema.parse(await res.json());
  assert.equal(e.turns.length, 2);
  assert.equal(e.summary.total, 422808);
  assert.deepEqual(reconstruct(e), await readFile(f.file));
  assert.equal(
    createHash("sha256").update(reconstruct(e)).digest("hex"),
    e.sourceSha256,
  );
  assert.match(res.headers.get("content-disposition"), /attachment/);
});
test("T26 fixed cutoff excludes concurrent append, retains damaged complete lines and partial tail", async (t) => {
  const f = await fixture(t),
    r = new TraceReader(f);
  t.after(() => r.dispose());
  await f.append(Buffer.from([255, 10]));
  await f.append('{"partial":"中');
  const source = await readFile(f.file);
  const res = await exportTrace(r, f.sessionId, {
    beforeSecondRead: async () => {
      await f.append(
        '文"}\n' + encode([{ type: "future_type", payload: { extra: 1 } }]),
      );
    },
  });
  const e = TraceExportSchema.parse(await res.json());
  assert.ok(e.source.pendingTailBytes > 0);
  assert.ok(e.issues.some((x) => x.kind === "pending-tail"));
  assert.ok(e.records.some((x) => x.encoding === "base64"));
  assert.deepEqual(
    reconstruct(e),
    source.subarray(0, e.source.completeByteEnd),
  );
  assert.equal(e.records.length, e.source.lineCount);
});
test("T27 export rejects missing association, changed prefix and request cancellation", async (t) => {
  const f = await fixture(t),
    r = new TraceReader(f);
  t.after(() => r.dispose());
  await assert.rejects(() => exportTrace(r, "absent"), /SOURCE_UNAVAILABLE/);
  const response = await exportTrace(r, f.sessionId, {
    beforeSecondRead: async () => {
      await writeFile(f.file, "changed");
    },
  });
  await assert.rejects(() => response.text(), /READ_CHANGED/);
  const fresh = await fixture(t),
    reader = new TraceReader(fresh);
  t.after(() => reader.dispose());
  const abort = new AbortController();
  const stream = await exportTrace(reader, fresh.sessionId, {
    signal: abort.signal,
  });
  abort.abort();
  await assert.rejects(() => stream.text());
});
test("T27 plugin dispose waits for an export blocked before its stream opens", async (t) => {
  const f = await fixture(t),
    r = new TraceReader(f);
  let release, entered;
  const barrier = new Promise((resolve) => (entered = resolve));
  const exporting = exportTrace(r, f.sessionId, {
    beforeSecondRead: () => {
      entered();
      return new Promise((resolve) => (release = resolve));
    },
  });
  await barrier;
  let disposed = false;
  const disposing = r.dispose().then(() => (disposed = true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(disposed, false);
  release();
  const response = await exporting;
  await assert.rejects(() => response.text());
  await disposing;
  assert.deepEqual(r.diagnostics, { readers: 0, inFlight: 0 });
});
test("T26 UTF8 BOM bytes remain reconstructable in raw export", async (t) => {
  const f = await fixture(t);
  await writeFile(
    f.file,
    Buffer.concat([Buffer.from([239, 187, 191]), await readFile(f.file)]),
  );
  const r = new TraceReader(f);
  t.after(() => r.dispose());
  const e = TraceExportSchema.parse(
    await (await exportTrace(r, f.sessionId)).json(),
  );
  assert.deepEqual(reconstruct(e), await readFile(f.file));
});
