import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./fixtures.mjs";
import { TraceReader } from "../lib/src/reader.js";
test("locates the saved native session without the execution plugin", async (t) => {
  const f = await fixture(t);
  const r = new TraceReader(f);
  t.after(() => r.dispose?.());
  const s = await r.snapshot(f.sessionId);
  assert.equal(s.state, "ready");
  assert.equal(s.nativeSessionId, "native-a");
  assert.equal(s.turns.length, 2);
});
test("T24 bad middle line retains later complete turns and a raw entry", async (t) => {
  const f = await fixture(t);
  const text = await readFile(f.file, "utf8"),
    lines = text.split("\n");
  lines.splice(5, 0, "{invalid json");
  await writeFile(f.file, lines.join("\n"));
  const r = new TraceReader(f);
  t.after(() => r.dispose());
  const s = await r.snapshot(f.sessionId);
  assert.equal(s.turns.length, 2);
  assert.equal(s.turns[1].toolCount, 4);
  assert.ok(s.issues.some((i) => i.kind === "damaged" && i.source.line === 6));
  const d = await r.entry(f.sessionId, s.readToken, "raw:6");
  assert.equal(d.raw[0].text, "{invalid json\n");
});
test("T03 D02 owned protocol distinguishes native turns from KMH sessions", async (t) => {
  const f = await fixture(t),
    r = new TraceReader(f);
  t.after(() => r.dispose());
  const s = await r.snapshot(f.sessionId);
  assert.equal(s.sessionId, "session-a");
  assert.equal(s.nativeSessionId, "native-a");
  assert.equal(s.turns[0].nativeTurnId, "turn-a");
});
