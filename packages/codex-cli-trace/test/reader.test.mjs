import test from "node:test";
import assert from "node:assert/strict";
import { writeFile, readFile, rename } from "node:fs/promises";
import { fixture, encode } from "./fixtures.mjs";
import { TraceReader } from "../lib/src/reader.js";
const extra = () =>
  encode([
    {
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        id: "appended",
        content: [{ text: "追加中文✅" }],
        internal_chat_message_metadata_passthrough: { turn_id: "turn-b" },
      },
    },
  ]);
test("T19 half UTF8 line waits, then appears once; unchanged source is stable", async (t) => {
  const f = await fixture(t),
    r = new TraceReader(f);
  t.after(() => r.dispose());
  const s = await r.snapshot(f.sessionId),
    bytes = Buffer.from(extra()),
    cut = bytes.indexOf(Buffer.from("中文")) + 1;
  await f.append(bytes.subarray(0, cut));
  const half = await r.snapshot(f.sessionId);
  assert.equal(half.source.lineCount, s.source.lineCount);
  assert.ok(half.source.pendingTailBytes > 0);
  assert.ok(half.issues.some((i) => i.kind === "pending-tail"));
  await f.append(bytes.subarray(cut));
  const full = await r.snapshot(f.sessionId);
  assert.equal(full.source.lineCount, s.source.lineCount + 1);
  assert.equal(full.source.pendingTailBytes, 0);
  assert.deepEqual((await r.snapshot(f.sessionId)).turns, full.turns);
  assert.equal((await r.snapshot(f.sessionId)).readToken, full.readToken);
  const d = await r.entry(f.sessionId, full.readToken, "item:appended");
  assert.equal(d.text, "追加中文✅");
});
test("T21 replacement, truncation and same-size rewrite invalidate old generations", async (t) => {
  for (const mode of ["truncate", "replace", "rewrite"]) {
    const f = await fixture(t),
      r = new TraceReader(f);
    t.after(() => r.dispose());
    const s = await r.snapshot(f.sessionId);
    if (mode === "truncate") await writeFile(f.file, "x");
    if (mode === "replace") {
      await rename(f.file, f.file + ".old");
      await writeFile(f.file, await readFile(f.file + ".old"));
    }
    if (mode === "rewrite") {
      const bytes = await readFile(f.file);
      bytes[bytes.length - 3] = 32;
      await writeFile(f.file, bytes);
    }
    await assert.rejects(() => r.snapshot(f.sessionId), /READ_CHANGED/);
    if (mode !== "truncate")
      assert.equal(
        (await r.snapshot(f.sessionId, { reload: true })).state,
        "ready",
      );
    assert.ok(s.readToken);
  }
});
test("T22 concurrent reads share one operation, caller abort is isolated, dispose drains and idle evicts", async (t) => {
  const f = await fixture(t);
  let release, entered;
  const reached = new Promise((resolve) => (entered = resolve));
  let reads = 0,
    now = 0;
  const r = new TraceReader(f, {
    now: () => new Date(now),
    beforeRead: () => {
      reads++;
      entered();
      return new Promise((resolve) => (release = resolve));
    },
  });
  const abort = new AbortController();
  const a = r.snapshot(f.sessionId, { signal: abort.signal }),
    b = r.snapshot(f.sessionId);
  await reached;
  abort.abort();
  await assert.rejects(a, { name: "AbortError" });
  release();
  await b;
  assert.equal(reads, 1);
  assert.equal(r.diagnostics.readers, 1);
  now = 61000;
  r.evictIdle();
  assert.equal(r.diagnostics.readers, 0);
  await r.dispose();
  assert.deepEqual(r.diagnostics, { readers: 0, inFlight: 0 });
  await assert.rejects(() => r.snapshot(f.sessionId));
});
test("T22 read failure restores on retry and missing end remains pending while idle", async (t) => {
  const f = await fixture(t);
  let fail = true;
  const r = new TraceReader(f, {
    beforeRead: async () => {
      if (fail) throw new Error("injected");
    },
  });
  t.after(() => r.dispose());
  await assert.rejects(() => r.snapshot(f.sessionId), /SOURCE_UNREADABLE/);
  fail = false;
  const s = await r.snapshot(f.sessionId);
  assert.equal(s.state, "ready");
});
import { spawn } from "node:child_process";
test("T22 two isolated processes read independently and release all resources", async (t) => {
  const f = await fixture(t),
    before = await readFile(f.file);
  const readerUrl = new URL("../lib/src/reader.js", import.meta.url).href;
  const config = JSON.stringify({
    codexHome: f.codexHome,
    bindingsFile: f.bindingsFile,
    refreshIntervalMs: 1000,
  });
  const worker = () =>
    new Promise((resolve, reject) => {
      const code = `import {TraceReader} from ${JSON.stringify(readerUrl)};const r=new TraceReader(${config});const s=await r.snapshot('session-a');await r.dispose();console.log(JSON.stringify({pid:process.pid,total:s.turns[1].usage.total,...r.diagnostics}));`;
      const child = spawn(process.execPath, [
        "--input-type=module",
        "-e",
        code,
      ]);
      let output = "",
        error = "";
      child.stdout.on("data", (d) => (output += d));
      child.stderr.on("data", (d) => (error += d));
      child.once("error", reject);
      child.once("close", (code) =>
        code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)),
      );
    });
  const values = await Promise.all([worker(), worker()]);
  assert.notEqual(values[0].pid, values[1].pid);
  for (const v of values) {
    assert.equal(v.total, 307513);
    assert.equal(v.readers, 0);
    assert.equal(v.inFlight, 0);
  }
  assert.deepEqual(await readFile(f.file), before);
});
test("T22 a request cancelled before entry allocates no reader operation", async (t) => {
  const f = await fixture(t),
    r = new TraceReader(f);
  t.after(() => r.dispose());
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    () => r.snapshot(f.sessionId, { signal: abort.signal }),
    { name: "AbortError" },
  );
  assert.equal(r.diagnostics.inFlight, 0);
  assert.equal(r.diagnostics.readers, 0);
});
