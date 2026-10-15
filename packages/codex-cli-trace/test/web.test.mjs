import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fixture } from "./fixtures.mjs";
import { TraceReader } from "../lib/src/reader.js";
import { mountRoutes } from "../lib/src/web.js";
export function routeHarness(reader) {
  const routes = new Map();
  const dispose = mountRoutes(
    {
      connection: {
        fetch: {
          register(route) {
            routes.set(route.path, route);
            return async () => {
              routes.delete(route.path);
            };
          },
        },
      },
    },
    reader,
  );
  return {
    dispose,
    routes,
    request: async (action, params = {}, signal) => {
      const req = new Request(
        "http://localhost/api/codex-cli-trace/" +
          action +
          "?" +
          new URLSearchParams(params),
        { signal },
      );
      return routes.get("/api/codex-cli-trace/" + action).fetch(req);
    },
  };
}
test("T01 T04 T23 independent Host routes validate requests, preserve files and dispose", async (t) => {
  const f = await fixture(t),
    before = await readFile(f.file),
    r = new TraceReader(f),
    h = routeHarness(r);
  t.after(async () => {
    await h.dispose();
    await r.dispose();
  });
  assert.equal(
    (
      await h.request("snapshot", {
        sessionId: "session-a",
        path: "/etc/passwd",
      })
    ).status,
    400,
  );
  const response = await h.request("snapshot", { sessionId: f.sessionId });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const s = await response.json();
  assert.equal(s.state, "ready");
  assert.equal(s.turns.length, 2);
  const page = await (
    await h.request("timeline", {
      sessionId: f.sessionId,
      readToken: s.readToken,
      nativeTurnId: "turn-b",
    })
  ).json();
  const detail = await (
    await h.request("entry", {
      sessionId: f.sessionId,
      readToken: s.readToken,
      entryId: page.entries[0].entryId,
    })
  ).json();
  assert.ok(detail.raw.length);
  assert.deepEqual(await readFile(f.file), before);
  await h.dispose();
  await r.dispose();
  assert.equal(h.routes.size, 0);
  assert.deepEqual(r.diagnostics, { readers: 0, inFlight: 0 });
});
