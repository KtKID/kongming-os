/**
 * 保存回归：用实际配置组合函数检查唯一挂载，用真实 SettingsFormModel 验证
 * KMH 写入适配、错误原文、草稿保留、revision 转发和成功后的共享镜像更新。
 * esbuild 只在测试内把 primitive 入口指向纯表单模型，便于 Node 加载无 CSS 的实现。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import {
  loadProfileDirectory,
  composeEntries,
} from "../../../third_party/dsh/packages/boot/app-boot/lib/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const namespace = "aggregated-token-analysis";
const { outputFiles } = buildSync({
  stdin: {
    contents: `export { TokenAnalysisConfigController } from './src/client/config-controller.ts';
export { createConfigWriter } from './src/client/config-write.ts';`,
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  alias: {
    "@deepseek-ai/dsh-client-ui-primitives": `${repo}third_party/dsh/packages/client/ui-primitives/src/settings-form/form-model.ts`,
  },
});
const { TokenAnalysisConfigController, createConfigWriter } = await import(
  `data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

function harness(mutate, recover) {
  let snapshot = {
    status: "ready",
    value: { pageUrl: "http://example.test/", pageLoadTimeoutMs: 8000 },
    base: { pageUrl: "http://example.test/", pageLoadTimeoutMs: 8000 },
    user: {},
    writable: true,
    revision: 7,
  };
  const listeners = new Set();
  const scope = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const ctx = {
    remote: {
      settings: {
        mutate,
        describe: async () => ({
          ok: true,
          value: { namespaces: recover ? [recover] : [] },
        }),
      },
    },
    configForms: {
      describe: () => ({
        acceptView: (view) => {
          snapshot = { ...snapshot, ...view };
          for (const listener of listeners) listener();
        },
      }),
    },
  };
  const controller = new TokenAnalysisConfigController(
    scope,
    createConfigWriter(ctx, namespace),
  );
  const face = controller.inject();
  const state = () => face.hooks.tokenAnalysisConfig.getSnapshot();
  // 等待真实表单发布 saving=false，以验证用户看到的终态。
  const save = () =>
    new Promise((resolve) => {
      const off = face.hooks.tokenAnalysisConfig.subscribe(() => {
        if (!state().saving) {
          off();
          resolve();
        }
      });
      face.save();
    });
  return { face, state, save, dispose: () => controller.dispose() };
}

test("最终组合只有一个 Token 分析条目，profile 覆盖与候选保存命中同一条目", () => {
  const loaded = loadProfileDirectory("dsh", `${repo}profiles/kmh-web`, repo);
  const next = { pageUrl: "http://127.0.0.1:60009/", pageLoadTimeoutMs: 9100 };
  const rows = composeEntries([
    ...loaded.layers.map((layer) => layer.patches),
    loaded.patches,
    [{ id: namespace, config: next }],
  ]).filter((row) => row.id === namespace);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].config, next);
  assert.equal(
    loaded.patches.some((patch) => patch.id === namespace && !patch.insert),
    true,
  );
});

test("宿主拒绝原文进入表单快照，恢复读取后草稿保留且继续显示失败", async () => {
  const message =
    'Configuration for "aggregated-token-analysis" is overridden by a home patch or command-line overlay';
  const h = harness(
    async (ns, ops, revision) => {
      assert.equal(ns, namespace);
      assert.equal(revision, 7);
      assert.deepEqual(ops, [
        { op: "set", path: ["pageUrl"], value: "http://127.0.0.1:60009/" },
      ]);
      return { ok: false, error: { message } };
    },
    {
      revision: 8,
      value: { pageUrl: "http://other.test/", pageLoadTimeoutMs: 8000 },
    },
  );
  h.face.edit("pageUrl", "http://127.0.0.1:60009/");
  await h.save();
  assert.equal(h.state().errorMessage, message);
  assert.equal(h.state().failed, true);
  assert.equal(h.state().pageUrl.text, "http://127.0.0.1:60009/");
  h.face.edit("pageUrl", "http://retry.test/");
  assert.equal(h.state().failed, false);
  h.dispose();
});

test("传输异常保留原文，后续成功保存清除错误并回填宿主接受值", async () => {
  let calls = 0;
  const h = harness(async (_ns, ops, revision) => {
    calls++;
    assert.equal(revision, 7);
    if (calls === 1) throw new Error("transport disconnected: original detail");
    return {
      ok: true,
      value: {
        ns: namespace,
        revision: 8,
        value: { pageUrl: ops[0].value, pageLoadTimeoutMs: 8000 },
        user: { pageUrl: ops[0].value },
      },
    };
  });
  h.face.edit("pageUrl", "http://saved.test/");
  await h.save();
  assert.equal(
    h.state().errorMessage,
    "transport disconnected: original detail",
  );
  assert.equal(h.state().failed, true);
  await h.save();
  assert.equal(h.state().errorMessage, undefined);
  assert.equal(h.state().failed, false);
  assert.equal(h.state().dirty, false);
  assert.equal(h.state().pageUrl.text, "http://saved.test/");
  h.dispose();
});
