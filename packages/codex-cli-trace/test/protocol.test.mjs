import test from "node:test";
import assert from "node:assert/strict";
import { SessionRequestSchema } from "../lib/src/protocol.js";
import { EnvelopeSchema } from "../lib/src/rollout-schema.js";
test("shared requests reject empty ids and arbitrary path fields", () => {
  assert.equal(
    SessionRequestSchema.safeParse({ sessionId: "" }).success,
    false,
  );
  assert.equal(
    SessionRequestSchema.safeParse({ sessionId: "s", path: "/etc/passwd" })
      .success,
    false,
  );
  assert.deepEqual(SessionRequestSchema.parse({ sessionId: "session-a" }), {
    sessionId: "session-a",
  });
});
test("external envelope keeps unknown fields and rejects malformed boundaries", () => {
  assert.equal(
    EnvelopeSchema.safeParse({ type: 4, payload: {} }).success,
    false,
  );
  assert.equal(
    EnvelopeSchema.safeParse({ type: "future", payload: {}, timestamp: 1 })
      .success,
    false,
  );
  assert.equal(
    EnvelopeSchema.parse({
      type: "future",
      payload: { newField: 1 },
      future: true,
    }).future,
    true,
  );
});
import { Config } from "../lib/src/config.js";
test("configuration rejects relative sources and overflowing polling intervals", () => {
  assert.throws(() => Config({ bindingsFile: "relative" }));
  assert.throws(() =>
    Config({ bindingsFile: "/tmp/bindings", refreshIntervalMs: 2147483648 }),
  );
  assert.equal(
    Config({ bindingsFile: "/tmp/bindings" }).refreshIntervalMs,
    1000,
  );
});
