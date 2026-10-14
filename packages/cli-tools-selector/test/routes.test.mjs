/** 路由状态码与契约：伪造 connection 注册表与 codexCli 服务，不经真实宿主。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mountRoutes, SWITCHES_PATH } from "../lib/src/web.js";

const sample = {
  target: "codex-cli",
  revision: 3,
  kmh: [{ id: "kmh:kmh-a", name: "kmh-a", description: "A", enabled: true, covers: [] }],
  native: [
    { id: "native:command-execution", name: "command-execution", description: "", enabled: false, covers: ["exec_command", "write_stdin", "shell_command"] },
    { id: "native:file-change", name: "file-change", description: "", enabled: false, covers: ["apply_patch"] },
    { id: "native:view-image", name: "view-image", description: "", enabled: false, covers: ["view_image"] },
    { id: "native:web-search", name: "web-search", description: "", enabled: false, covers: ["web_search"] },
  ],
  nativeStatus: { ok: true },
};

/** 组装一个只带 connection 注册表与可选 codexCli 的上下文。 */
function harness(codex) {
  const routes = [];
  const ctx = {
    connection: { fetch: { register: (route) => { routes.push(route); } } },
    get: (name) => (name === "codexCli" ? codex : undefined),
  };
  mountRoutes(ctx);
  const route = routes.find((item) => item.path === SWITCHES_PATH);
  assert.ok(route, "route registered");
  const call = (init = {}, query = "") => route.fetch(new Request(`http://kmh.local${SWITCHES_PATH}${query}`, init));
  return { call, routes };
}

test("GET returns the codex-cli list and forwards refresh", async () => {
  const calls = [];
  const { call } = harness({ toolSwitches: async (_signal, refresh) => { calls.push(refresh); return sample; } });
  const plain = await call();
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get("cache-control"), "no-store");
  assert.deepEqual(await plain.json(), sample);
  const refreshed = await call({}, "?refresh=1");
  assert.equal(refreshed.status, 200);
  assert.deepEqual(calls, [false, true]);
});

test("GET without codex-cli answers 503 CODEX_CLI_UNAVAILABLE", async () => {
  const { call } = harness(undefined);
  const response = await call();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "CODEX_CLI_UNAVAILABLE");
});

test("POST validates the body, maps unknown ids to 400 and conflicts to 409", async () => {
  const seen = [];
  const { call } = harness({
    toolSwitches: async () => sample,
    setToolSwitch: async (update) => {
      seen.push(update);
      if (update.id === "nope") throw new Error("CLI_TOOL_SWITCH_UNKNOWN: nope");
      if (update.revision !== 3) { const error = new Error("changed since it was read"); error.name = "SettingsConflictError"; throw error; }
      return { ...sample, revision: 4, kmh: [{ ...sample.kmh[0], enabled: update.enabled }] };
    },
  });
  const post = (body) => call({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const invalid = await post({ id: "kmh:kmh-a" });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error, "INVALID_BODY");
  const unknown = await post({ id: "nope", enabled: true, revision: 3 });
  assert.equal(unknown.status, 400);
  assert.equal((await unknown.json()).error, "CLI_TOOL_SWITCH_UNKNOWN");
  const stale = await post({ id: "kmh:kmh-a", enabled: false, revision: 1 });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error, "SETTINGS_CONFLICT");
  const ok = await post({ id: "kmh:kmh-a", enabled: false, revision: 3 });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.revision, 4);
  assert.equal(body.kmh[0].enabled, false);
  assert.deepEqual(seen.map((update) => update.id), ["nope", "kmh:kmh-a", "kmh:kmh-a"]);
});

test("unexpected failures answer 500 with the reason", async () => {
  const { call } = harness({ toolSwitches: async () => { throw new Error("CODEX_TOOL_SELECTION_UNINITIALIZED: boom"); } });
  const response = await call();
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error, "CLI_TOOL_SWITCHES_FAILED");
  assert.match(body.reason, /UNINITIALIZED/);
});
