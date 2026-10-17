/** C7 / T20：实际 Agent 在官方 Codex 停止后继续原会话。 */
import assert from "node:assert/strict";
import test from "node:test";
import { createUserMessage } from "../../../third_party/dsh/packages/llm/llm/lib/index.js";
import { profileHarness } from "./support/profile-harness.mjs";
import { until } from "./support/harness.mjs";
import { diffIncrement, emptySnapshot } from "../lib/src/cursor.js";

test("runtime context after a real user input remains a valid increment", () => {
  const input = [
    { role: "user", content: [{ type: "text", text: "next" }] },
    { role: "system", content: [{ type: "text", text: "runtime context" }] },
  ];
  const result = diffIncrement(input, emptySnapshot());
  assert.equal(result.kind, "new-input");
  assert.equal(result.text, "next\n\nruntime context");
  assert.equal(
    diffIncrement(
      [
        ...input,
        { role: "assistant", content: [{ type: "text", text: "foreign" }] },
      ],
      emptySnapshot(),
    ).kind,
    "baseline-lost",
  );
});

test(
  "official stop preserves accepted input and next Agent question across restart",
  { timeout: 90000 },
  async (t) => {
    // Hold the first model request before output, then stop the actual Agent.
    const h = await profileHarness(t, { persistence: true, holdFirst: true });
    h.agent.followup(
      createUserMessage({
        content: [{ type: "text", text: "cancel accepted request" }],
        source: { kind: "user" },
      }),
    );
    await until(
      () => h.server.requests.length === 1,
      "first native request accepted",
      30000,
    );
    h.agent.cancel({ kind: "user" }, { keepInbox: true });
    await h.agent.whenIdle();
    assert.equal(
      h.agent.session.snapshotEvents().findLast((e) => e.type === "turn/end")
        .data.reason.kind,
      "aborted",
    );
    h.server.advanceFirst();
    h.server.advanceReasoning();
    h.server.advance();
    h.server.finish();
    await h.send("next after confirmed stop");
    assert.equal(
      h.agent.session.snapshotEvents().findLast((e) => e.type === "turn/end")
        .data.reason.kind,
      "completed",
    );
    assert.equal(h.server.requests.length, 2);
    const starts = h.rpcs.filter((f) => f.method === "turn/start");
    assert.equal(starts.length, 2);
    assert.match(
      JSON.stringify(starts[1].params.input),
      /next after confirmed stop/,
    );
    assert.doesNotMatch(
      JSON.stringify(starts[1].params.input),
      /cancel accepted request/,
    );
    await h.restart();
    await h.send("third after restart");
    assert.equal(
      h.agent.session.snapshotEvents().findLast((e) => e.type === "turn/end")
        .data.reason.kind,
      "completed",
    );
    assert.equal(h.server.requests.length, 3);
  },
);

import { harness, run } from "./support/harness.mjs";
test(
  "partial output survives native consumer stop and the next input is delivered once",
  { timeout: 45000 },
  async (t) => {
    const h = await harness(t, "partial-stop-next", {
      gated: true,
      summary: "none",
    });
    h.server.advanceReasoning();
    const first = {
      role: "user",
      content: [{ type: "text", text: "first partial answer" }],
    };
    const iterator = h.adapter.stream({
      provider: "codex-cli",
      model: "gpt-6-sol",
      sessionId: "partial-stop-next",
      tools: [],
      messages: [first],
      signal: AbortSignal.timeout(30000),
    });
    let text = "";
    while (text === "") {
      const next = await iterator.next();
      assert.equal(next.done, false);
      if (next.value.type === "text-delta") text += next.value.text;
    }
    await iterator.return();
    const record = await h.runtime.bindingRecord("partial-stop-next");
    assert.equal(record.fingerprints.length, 1);
    assert.equal(record.delivered.length, 1);
    assert.ok(record.lastTurnId);
    h.server.advance();
    h.server.finish();
    const result = await run(h.adapter, {
      sessionId: "partial-stop-next",
      messages: [
        first,
        { role: "assistant", content: [{ type: "text", text }] },
        {
          role: "user",
          content: [{ type: "text", text: "next after partial" }],
        },
      ],
    });
    assert.equal(
      result.message.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join(""),
      "FIRST SECOND",
    );
    assert.equal(h.server.requests.length, 2);
  },
);
