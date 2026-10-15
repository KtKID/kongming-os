import test from "node:test";
import assert from "node:assert/strict";
import { fixture, sampleRecords } from "./fixtures.mjs";
import { TraceReader } from "../lib/src/reader.js";
async function run(t, rows) {
  const f = await fixture(t, rows),
    r = new TraceReader(f);
  t.after(() => r.dispose());
  return r.snapshot(f.sessionId);
}
test("T07 response records and turn snapshots reproduce both real sample totals", async (t) => {
  const s = await run(t, sampleRecords());
  assert.deepEqual(
    s.turns.map((x) => [
      x.responseCount,
      x.usage.total,
      x.usage.input,
      x.usage.cached,
      x.usage.output,
      x.usage.reasoning,
    ]),
    [
      [2, 115295, 115230, 56832, 65, 18],
      [5, 307513, 304843, 237568, 2670, 418],
    ],
  );
  assert.ok(s.turns.every((x) => x.usageSources.length > 0));
});
test("T08 response duplication, simultaneous token_count and repeat snapshots count once", async (t) => {
  const rows = sampleRecords();
  rows.push(structuredClone(rows.find((x) => x.type === "token_usage_record")));
  const s = await run(t, rows);
  assert.equal(s.turns[0].responseCount, 2);
  assert.equal(s.turns[0].usage.total, 115295);
  assert.ok(!s.issues.some((x) => x.kind === "usage-conflict"));
});
test("T09 missing fields, explicit zeros, cumulative-only and conflicting totals stay distinct", async (t) => {
  const rows = sampleRecords().filter(
    (x) => x.type !== "token_usage_record" || x.payload.turn_id !== "turn-b",
  );
  for (const x of rows) {
    if (x.type === "token_usage_record") {
      delete x.payload.usage.cache_write_input_tokens;
      delete x.payload.turn_token_usage.cache_write_input_tokens;
    }
  }
  const s = await run(t, rows);
  assert.equal(s.turns[0].usage.cacheWrite, null);
  assert.equal(s.turns[0].usage.coverage, "partial");
  assert.equal(s.turns[1].usage.total, null);
  assert.ok(s.issues.some((x) => x.kind === "partial-usage"));
  const conflict = sampleRecords();
  conflict.find(
    (x) => x.type === "token_usage_record",
  ).payload.usage.total_tokens = 1;
  const c = await run(t, conflict);
  assert.ok(c.issues.some((x) => x.kind === "usage-conflict"));
  assert.equal(c.turns[0].usage.total, 115295);
});
