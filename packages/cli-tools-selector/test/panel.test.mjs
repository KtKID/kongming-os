/** 区块纯逻辑：主题判定与乐观切换/回滚，不渲染 DOM。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesSubject, withSwitch } from "../lib/browser-types/src/client/state.js";

const list = {
  target: "codex-cli",
  revision: 1,
  kmh: [
    { id: "kmh:kmh-a", name: "kmh-a", description: "", enabled: true, covers: [] },
    { id: "kmh:kmh-b", name: "kmh-b", description: "", enabled: false, covers: [] },
  ],
  native: [{ id: "native:web-search", name: "web-search", description: "", enabled: false, covers: ["web_search"] }],
  nativeStatus: { ok: true },
};

test("only the codex-cli official plugin page matches", () => {
  assert.equal(matchesSubject({ kind: "item", id: "codex-cli" }), true);
  assert.equal(matchesSubject({ kind: "item", id: "zcode-cli" }), false);
  assert.equal(matchesSubject({ kind: "bundle", pkg: { name: "@kmh/codex-cli" } }), false);
  assert.equal(matchesSubject({ kind: "row", pkg: {}, row: { rowId: "codex-cli" } }), false);
  assert.equal(matchesSubject(undefined), false);
});

test("withSwitch flips one row immutably and reverting restores the original", () => {
  const next = withSwitch(list, "kmh:kmh-b", true);
  assert.equal(next.kmh[1].enabled, true);
  assert.equal(list.kmh[1].enabled, false, "original untouched");
  assert.equal(next.kmh[0].enabled, true);
  const native = withSwitch(list, "native:web-search", true);
  assert.equal(native.native[0].enabled, true);
  assert.deepEqual(withSwitch(next, "kmh:kmh-b", false), list);
  assert.deepEqual(withSwitch(list, "kmh:missing", true), list);
});
