import test from "node:test";
import assert from "node:assert/strict";
import { fixture, sampleRecords, nativeId } from "./fixtures.mjs";
import { TraceReader } from "../lib/src/reader.js";
async function open(t, rows) {
  const f = await fixture(t, rows);
  const r = new TraceReader(f);
  t.after(() => r.dispose?.());
  const s = await r.snapshot(f.sessionId);
  assert.equal(s.state, "ready");
  return { f, r, s };
}
async function timeline(x, nativeTurnId = "turn-b", extra = {}) {
  return x.r.timeline({
    sessionId: x.f.sessionId,
    readToken: x.s.readToken,
    nativeTurnId,
    category: "all",
    q: "",
    onlyErrors: "0",
    cursor: 0,
    limit: 500,
    ...extra,
  });
}
test("T05 T11 saved turns retain source model, effort and independent results", async (t) => {
  const { s } = await open(t);
  assert.deepEqual(
    s.turns.map((x) => [x.nativeTurnId, x.model, x.effort, x.status]),
    [
      ["turn-a", "gpt-5.6-luna", "low", "completed"],
      ["turn-b", "gpt-5.6-luna", "high", "completed"],
    ],
  );
});
test("T10 T12 canonical calls preserve order, failure and successful recovery", async (t) => {
  const x = await open(t);
  const p = await timeline(x);
  const calls = p.entries.filter((e) => e.callId);
  assert.equal(calls.length, 4);
  assert.deepEqual(
    calls.map((e) => e.status),
    ["failed", "completed", "completed", "completed"],
  );
  assert.equal(new Set(calls.map((e) => e.entryId)).size, 4);
  assert.deepEqual(
    calls.map((e) => e.sources[0].line),
    calls.map((e) => e.sources[0].line).toSorted((a, b) => a - b),
  );
});
test("T14 skill invocation and skill file operations remain distinct", async (t) => {
  const x = await open(t);
  const a = await timeline(x, "turn-a"),
    b = await timeline(x);
  assert.equal(a.entries.filter((e) => e.kind === "skill").length, 1);
  assert.equal(b.entries.filter((e) => e.kind === "skill").length, 0);
  assert.equal(b.entries.filter((e) => e.kind === "file").length, 4);
  const e = a.entries.find((e) => e.kind === "skill");
  const d = await x.r.entry(x.f.sessionId, x.s.readToken, e.entryId);
  assert.match(d.arguments, /using-superpowers/);
  assert.match(d.result, /中文内容/);
  assert.ok(d.raw.length >= 2);
});
test("T13 unknown types and visible summaries have provenance", async (t) => {
  const rows = sampleRecords();
  rows.push({
    type: "response_item",
    payload: {
      type: "reasoning",
      id: "rs-summary",
      summary: [{ text: "可见摘要" }],
      internal_chat_message_metadata_passthrough: { turn_id: "turn-b" },
    },
  });
  rows.push({ type: "future_type", payload: { novel: true } });
  const x = await open(t, rows);
  const p = await timeline(x);
  assert.ok(p.entries.some((e) => e.kind === "unknown"));
  const e = p.entries.find((e) => e.kind === "reasoning");
  const d = await x.r.entry(x.f.sessionId, x.s.readToken, e.entryId);
  assert.match(d.text, /可见摘要/);
  assert.ok(x.s.issues.some((i) => i.kind === "unknown"));
});
test("T15 long unicode result, empty and absent output remain observable", async (t) => {
  const rows = sampleRecords();
  const out = rows.find((x) => x.payload.type === "function_call_output");
  out.payload.output = "中文".repeat(6000) + "needle尾部";
  const x = await open(t, rows);
  const p = await timeline(x, "turn-a");
  const e = p.entries.find((e) => e.callId);
  const d = await x.r.entry(x.f.sessionId, x.s.readToken, e.entryId);
  assert.equal(d.result, out.payload.output);
  assert.ok(d.result.length > 8000);
  assert.ok(d.raw.some((x) => x.text.includes("needle尾部")));
});
test("T16 recorded durations retain zero and distinguish missing timings", async (t) => {
  const x = await open(t);
  assert.equal(x.s.turns[0].durationMs, 14812);
  assert.equal(x.s.turns[0].ttftMs, 11571);
  assert.equal(x.s.turns[1].durationMs, 37341);
  assert.equal(x.s.turns[1].ttftMs, 9904);
  const p = await timeline(x, "turn-a");
  assert.equal(p.entries.find((e) => e.callId).durationMs, 57.526375);
  assert.equal(p.entries.find((e) => e.kind === "response").durationMs, null);
});
test("T06 T12 missing ending and return do not become success", async (t) => {
  const rows = sampleRecords().filter(
    (x) =>
      !(x.payload.type === "task_complete" && x.payload.turn_id === "turn-b") &&
      !(
        x.payload.type === "item_completed" &&
        x.payload.item?.id === "turn-b-call-3"
      ) &&
      !(
        x.payload.type === "function_call_output" &&
        x.payload.call_id === "turn-b-call-3"
      ),
  );
  const x = await open(t, rows);
  assert.equal(x.s.turns[1].status, "pending");
  const p = await timeline(x);
  assert.equal(
    p.entries.find((e) => e.callId === "turn-b-call-3").status,
    "pending",
  );
  assert.ok(x.s.issues.some((i) => i.kind === "missing"));
});
test("T24 explicit foreign thread ids are excluded from statistics", async (t) => {
  const rows = sampleRecords();
  const usage = structuredClone(
    rows.find((x) => x.type === "token_usage_record"),
  );
  usage.payload.response_id = "foreign-response";
  usage.payload.thread_id = "foreign";
  rows.push(usage);
  const x = await open(t, rows);
  assert.ok(x.s.issues.some((i) => i.kind === "source-mismatch"));
  assert.equal(x.s.turns[0].responseCount, 2);
  assert.equal(nativeId, "native-a");
});
test("T05 conversation title follows the actual user message after context input", async (t) => {
  const rows = sampleRecords();
  const i = rows.findIndex((x) => x.payload.id === "turn-a-user");
  rows.splice(i, 0, {
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      id: "context",
      content: [{ text: "# AGENTS.md instructions" }],
      internal_chat_message_metadata_passthrough: { turn_id: "turn-a" },
    },
  });
  const x = await open(t, rows);
  assert.equal(x.s.turns[0].title, "这是测试调用codex-cli插件，你好");
});
test("T16 zero timings and conflicting saved values are retained with an issue", async (t) => {
  const rows = sampleRecords();
  const complete = rows.find((x) => x.payload.type === "task_complete");
  complete.payload.duration_ms = 0;
  complete.payload.time_to_first_token_ms = 0;
  rows.push(structuredClone(complete));
  rows.at(-1).payload.duration_ms = 100;
  const x = await open(t, rows);
  assert.equal(x.s.turns[0].durationMs, 0);
  assert.equal(x.s.turns[0].ttftMs, 0);
  assert.ok(x.s.issues.some((i) => i.kind === "duration-conflict"));
});
test("T10 context roles stay explicit and records after a completed turn remain unassigned", async (t) => {
  const rows = sampleRecords();
  rows.splice(1, 0, {
    type: "response_item",
    payload: {
      type: "message",
      role: "developer",
      id: "dev-context",
      content: [{ text: "上下文说明" }],
    },
  });
  rows.push({ type: "future_type", payload: { idle: true } });
  const x = await open(t, rows);
  const context = await x.r.entry(
    x.f.sessionId,
    x.s.readToken,
    "item:dev-context",
  );
  assert.equal(context.entry.title, "开发者消息");
  const end = await x.r.entry(
    x.f.sessionId,
    x.s.readToken,
    "raw:" + rows.length,
  );
  assert.equal(end.entry.nativeTurnId, null);
});
