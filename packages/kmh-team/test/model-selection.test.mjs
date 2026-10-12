import test from "node:test";
import assert from "node:assert/strict";
import {
  initialModelSelection,
  selectedTeamModel,
} from "../lib/browser-types/src/client/model.js";
import { errorReason, zh } from "../lib/browser-types/src/client/locales.js";

const catalog = () => ({
  default: {
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    reasoningEffort: "high",
  },
  groups: [
    {
      id: "deepseek-official",
      name: "DeepSeek",
      models: [{ id: "deepseek-flash", name: "DeepSeek-V41-Flash" }],
    },
    {
      id: "codex-cli",
      name: "KMH / Codex CLI",
      models: [{ id: "gpt-6.1-sol", name: "GPT-6.1-Sol" }],
    },
  ],
  failures: [{ id: "zcode-cli", name: "ZCode", message: "fetch failed" }],
  routableProviders: ["deepseek-official", "codex-cli", "zcode-cli"],
});

test("feat02 场景3,7: unavailable deployment default waits for an explicit available selection", () => {
  const data = catalog();
  assert.equal(initialModelSelection(data), "");
  assert.throws(() => selectedTeamModel(data, ""), /model-unavailable/);
  assert.throws(
    () =>
      selectedTeamModel(data, JSON.stringify(["zcode-cli", "glm-5.3-flash"])),
    /model-unavailable/,
  );
  assert.deepEqual(
    selectedTeamModel(data, JSON.stringify(["codex-cli", "gpt-6.1-sol"])),
    { provider: "codex-cli", model: "gpt-6.1-sol" },
  );
});

test("feat02 场景3: available default keeps its reasoning setting and checks the provider/model pair", () => {
  const data = catalog();
  data.groups.push({
    id: "zcode-cli",
    name: "ZCode",
    models: [{ id: "glm-5.3-flash", name: "GLM-5.3-Flash" }],
  });
  assert.deepEqual(
    selectedTeamModel(data, initialModelSelection(data)),
    data.default,
  );
  assert.throws(
    () =>
      selectedTeamModel(data, JSON.stringify(["codex-cli", "glm-5.3-flash"])),
    /model-unavailable/,
  );
});

test("feat02 场景7: an empty catalog keeps creation waiting and failures name the required recovery", () => {
  const data = { ...catalog(), groups: [] };
  assert.equal(initialModelSelection(data), "");
  assert.throws(
    () => selectedTeamModel(data, JSON.stringify(["codex-cli", "gpt-6.1-sol"])),
    /model-unavailable/,
  );
  const t = (key) => zh[key];
  assert.equal(
    errorReason(Error("model-unavailable"), t, "createFailed"),
    zh.modelUnavailable,
  );
  assert.equal(
    errorReason(
      Error('cannot get property "llm" without inject'),
      t,
      "createFailed",
    ),
    zh.serviceUnavailable,
  );
});
