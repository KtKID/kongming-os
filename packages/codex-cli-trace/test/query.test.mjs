import test from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { fixture, sampleRecords } from "./fixtures.mjs";
import { TraceReader } from "../lib/src/reader.js";
const query = (s, extra = {}) => ({
  sessionId: s.sessionId,
  readToken: s.readToken,
  nativeTurnId: "turn-b",
  category: "all",
  q: "",
  onlyErrors: "0",
  cursor: 0,
  limit: 2,
  ...extra,
});
test("T17 full search, error/category intersections and stable pagination", async (t) => {
  const rows = sampleRecords();
  const line = rows.find((r) => r.payload.type === "function_call_output");
  line.payload.output = "中文".repeat(20000) + "全文末尾命中";
  const f = await fixture(t, rows),
    r = new TraceReader(f);
  t.after(() => r.dispose());
  const s = await r.snapshot(f.sessionId);
  const found = await r.timeline(
    query(s, { nativeTurnId: "turn-a", q: "全文末尾命中" }),
  );
  assert.equal(found.total, 1);
  const d = await r.entry(f.sessionId, s.readToken, found.entries[0].entryId);
  assert.ok(d.result.endsWith("全文末尾命中"));
  assert.ok(d.result.length > 8000);
  const errors = await r.timeline(
    query(s, { category: "file", onlyErrors: "1" }),
  );
  assert.equal(errors.total, 1);
  assert.equal(errors.entries[0].status, "failed");
  assert.equal(s.turns[1].toolCount, 4);
  let cursor = 0;
  const ids = [];
  do {
    const p = await r.timeline(query(s, { cursor }));
    ids.push(...p.entries.map((e) => e.entryId));
    cursor = p.nextCursor;
  } while (cursor !== null);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length > 5);
  assert.equal((await r.timeline(query(s, { q: "no-such-value" }))).total, 0);
});
test("T23 details retain exact raw line references and reject changed sources", async (t) => {
  const f = await fixture(t),
    r = new TraceReader(f);
  t.after(() => r.dispose());
  const s = await r.snapshot(f.sessionId);
  const p = await r.timeline(query(s));
  const d = await r.entry(f.sessionId, s.readToken, p.entries[0].entryId);
  assert.ok(d.raw.length > 0);
  for (const raw of d.raw) {
    assert.equal(JSON.parse(raw.text).ordinal, raw.source.ordinal);
    assert.equal(
      Buffer.byteLength(raw.text),
      raw.source.byteEnd - raw.source.byteStart,
    );
  }
  await writeFile(f.file, "changed");
  await assert.rejects(
    () => r.entry(f.sessionId, s.readToken, p.entries[0].entryId),
    /READ_CHANGED/,
  );
});
