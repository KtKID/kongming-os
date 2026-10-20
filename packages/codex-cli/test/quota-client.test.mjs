/** 浏览器组件与宿主配置默认值的隔离测试。 */
import test from "node:test";
import assert from "node:assert/strict";
import { quotaHostFixture } from "./quota-browser-harness.mjs";
import { Config } from "../lib/src/config.js";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chmod, readFile } from "node:fs/promises";
const pkg = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(new URL("../package.json", import.meta.url));
const dshRequire = createRequire(
  new URL("../../../third_party/dsh/package.json", import.meta.url),
);
const { JSDOM } = dshRequire("jsdom");
const { window } = new JSDOM("<!doctype html><div id='root'></div>", {
  url: "http://localhost",
  pretendToBeVisual: true,
});
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  MutationObserver: window.MutationObserver,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const uiRequire = createRequire(
  new URL(
    "../../../third_party/dsh/packages/client/ui-primitives/package.json",
    import.meta.url,
  ),
);
const React = uiRequire("react");
const { createRoot } = uiRequire("react-dom/client");
const { act } = React;
const out = await build({
  stdin: {
    contents: `export {QuotaStore} from './src/client/quota-store.ts';export {QuotaCard} from './src/client/QuotaCard.tsx';export {zh} from './src/client/locales.ts';export {ComposerQuota} from './src/client/ComposerQuota.tsx';export {QuotaDisplaySettings} from './src/client/QuotaDisplaySettings.tsx';export {ConfigFormController} from '@deepseek-ai/dsh-client-ui-settings/src/client/config-form.ts';export {SettingsDescribeMirror} from '@deepseek-ai/dsh-client-ui-settings/src/client/settings-mirror.ts';export {SettingsSchemaService} from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts';export {Context} from '@deepseek-ai/cordis';export {ModelDirectory} from '@deepseek-ai/dsh-client-ui-model-selection/src/client/directory.ts';export {CodexCard} from './src/client/DetailCard.tsx';`,
    resolveDir: pkg,
    loader: "tsx",
  },
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime", "react-dom"],
  loader: { ".css": "empty", ".module.css": "empty" },
  plugins: [
    {
      name: "public-primitives",
      setup(b) {
        b.onResolve(
          { filter: /^@deepseek-ai\/dsh-client-ui-primitives$/ },
          () => ({ path: "public-atoms", namespace: "quota" }),
        );
        b.onLoad({ filter: /.*/, namespace: "quota" }, () => ({
          contents: `export {Button} from ${JSON.stringify(resolve(pkg, "../../third_party/dsh/packages/client/ui-primitives/src/Button.tsx"))};export {Switch} from ${JSON.stringify(resolve(pkg, "../../third_party/dsh/packages/client/ui-primitives/src/Switch.tsx"))};export {StateDot} from ${JSON.stringify(resolve(pkg, "../../third_party/dsh/packages/client/ui-primitives/src/StateDot.tsx"))};export {Tag} from ${JSON.stringify(resolve(pkg, "../../third_party/dsh/packages/client/ui-primitives/src/Tag.tsx"))};export {Input} from ${JSON.stringify(resolve(pkg, "../../third_party/dsh/packages/client/ui-primitives/src/Input.tsx"))};export {useAnchoredPosition} from ${JSON.stringify(resolve(pkg, "../../third_party/dsh/packages/client/ui-primitives/src/useAnchoredPosition.ts"))};export {useDismissOnOutsidePointer} from ${JSON.stringify(resolve(pkg, "../../third_party/dsh/packages/client/ui-primitives/src/useDismissOnOutsidePointer.ts"))};export {Menu} from ${JSON.stringify(resolve(pkg, "../../third_party/dsh/packages/client/ui-primitives/src/Menu.tsx"))};export {Tooltip} from ${JSON.stringify(resolve(pkg, "../../third_party/dsh/packages/client/ui-primitives/src/Tooltip.tsx"))};export {IconCloseOutlineRegular,IconChevronDownOutlineRegular} from ${JSON.stringify(resolve(pkg, "../../third_party/dsh/packages/client/ui-primitives/src/icons/index.tsx"))};export const IconRightUpOutlineRegular=()=>null;`,
          resolveDir: pkg,
        }));
      },
    },
  ],
});
const mod = { exports: {} };
new Function("require", "module", "exports", out.outputFiles[0].text)(
  (name) => (/^react($|\/)/.test(name) ? uiRequire(name) : require(name)),
  mod,
  mod.exports,
);
const {
  QuotaStore,
  QuotaCard,
  CodexCard,
  ComposerQuota,
  QuotaDisplaySettings,
  ModelDirectory,
  ConfigFormController,
  SettingsDescribeMirror,
  SettingsSchemaService,
  Context,
  zh,
} = mod.exports;
const t = (key) => zh[key];
const baseTime = 1800000000000;
const stores = new Set();
let currentRoot;
test.afterEach(async () => {
  if (currentRoot) {
    await act(() => currentRoot.unmount());
    currentRoot = undefined;
  }
  for (const store of stores) store.dispose();
  stores.clear();
});
const preferences = {
  quotaDisplayMode: "percent",
  quotaAlertsEnabled: true,
  quotaShortThresholdPercent: 20,
  quotaWeeklyThresholdPercent: 20,
};
function fixtureView() {
  return {
    accountEpoch: 0,
    state: "ready",
    fetchedAtMs: baseTime,
    nextRefreshAtMs: baseTime + 300000,
    groups: [
      {
        id: "codex",
        name: null,
        windows: [
          {
            usedPercent: 81,
            remainingPercent: 19,
            windowMinutes: 300,
            resetsAtMs: baseTime + 3600000,
          },
          {
            usedPercent: 50,
            remainingPercent: 50,
            windowMinutes: 10080,
            resetsAtMs: baseTime + 86400000,
          },
        ],
      },
    ],
    credits: { hasCredits: true, unlimited: false, balance: "0" },
    creditsAtMs: baseTime,
    spend: null,
    spendAtMs: baseTime,
    resets: { availableCount: 0, cards: null },
    resetsAtMs: baseTime,
    errors: [],
  };
}
function fixtureStore() {
  let view = fixtureView(),
    now = baseTime,
    block,
    reads = 0;
  const store = new QuotaStore(
    async (url) => {
      if (String(url).endsWith("context"))
        return Response.json({
          settingsNamespace: "kmh-codex-cli",
          preferences,
        });
      reads++;
      if (block) await block;
      return Response.json(view);
    },
    () => now,
  );
  stores.add(store);
  let config = {
    status: "ready",
    value: preferences,
    revision: 1,
    writable: true,
    mode: "host",
    base: {},
    user: {},
  };
  const listeners = new Set();
  const publish = () => {
    for (const fn of listeners) fn();
  };
  const ctx = {
    on: () => () => {},
    configForms: {
      get: () => ({
        getSnapshot: () => config,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      }),
      describe: () => ({
        getSnapshot: () => ({
          status: "ready",
          error: null,
          view: {
            writable: config.writable,
            hasDocument: true,
            namespaces: [{ ns: "kmh-codex-cli", ...config }],
          },
        }),
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        ensure: async () => {},
        acceptView: (view) => {
          config = { ...config, ...view };
          publish();
        },
      }),
    },
    remote: {
      settings: {
        mutate: async (ns, ops, revision) => ({
          ok: true,
          value: {
            revision: revision + 1,
            value: Object.fromEntries(ops.map((op) => [op.path[0], op.value])),
          },
        }),
        describe: async () => ({
          ok: true,
          value: { namespaces: [{ ns: "kmh-codex-cli", ...config }] },
        }),
      },
    },
  };
  return {
    store,
    ctx,
    bind: () => store.bind(ctx),
    get reads() {
      return reads;
    },
    view: (v) => {
      view = v;
    },
    time: (v) => {
      now = v;
    },
    block: (p) => {
      block = p;
    },
    settings: (v, patch = {}) => {
      config = { ...config, ...patch, value: v };
      publish();
    },
  };
}
async function render(element) {
  const root = createRoot(document.getElementById("root"));
  currentRoot = root;
  await act(async () => {
    root.render(element);
  });
  return {
    root,
    close: () => {
      currentRoot = undefined;
      return act(() => root.unmount());
    },
  };
}

test("T14 默认百分比、提醒开启、两周期各20%", () => {
  const config = Config({
    cwd: "/private/tmp",
    dataDir: "/private/tmp/kmh-quota-unused",
  });
  assert.equal(config.quotaDisplayMode?.get(), "percent");
  assert.equal(config.quotaAlertsEnabled?.get(), true);
  assert.equal(config.quotaShortThresholdPercent?.get(), 20);
  assert.equal(config.quotaWeeklyThresholdPercent?.get(), 20);
});

test("T01/T05/T06 真实详情组件显示两周期、零余额和重置卡未知详情", async () => {
  const f = fixtureStore();
  await f.bind();
  await f.store.refresh();
  const ui = await render(
    React.createElement(QuotaCard, { store: f.store, t }),
  );
  const text = document.body.textContent;
  assert.match(text, /短周期/);
  assert.match(text, /每周/);
  assert.match(text, /19%/);
  assert.match(text, /额外 Credits0/);
  assert.match(text, /可用重置卡0/);
  assert.match(text, /详情暂不可用/);
  assert.equal(
    document.querySelectorAll('progress[data-low="true"]').length,
    1,
  );
  assert.equal(document.querySelector("progress").value, 19);
  assert.equal(f.reads, 1);
  await act(async () => {
    f.settings({ ...preferences, quotaAlertsEnabled: false });
  });
  assert.equal(
    document.querySelectorAll('progress[data-low="true"]').length,
    0,
  );
  await ui.close();
  f.store.dispose();
});

test("T01/T19 插件 summary 卡片保持简介且零额度读取", async () => {
  const f = fixtureStore();
  const ui = await render(
    React.createElement(CodexCard, { view: "summary", quota: f.store, t }),
  );
  assert.match(document.body.textContent, /官方 Codex CLI/);
  assert.equal(f.reads, 0);
  await ui.close();
  f.store.dispose();
});

test("T04/T19 客户端消费者与高频刷新共享本地冷却", async () => {
  const f = fixtureStore();
  const releases = [f.store.retain(), f.store.retain()];
  await f.store.refresh();
  await Promise.all(Array.from({ length: 50 }, () => f.store.refresh(true)));
  assert.equal(f.reads, 1);
  releases.forEach((fn) => fn());
  f.store.dispose();
});

function observable(initial) {
  let value = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => value,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    set: (next) => {
      value = next;
      for (const fn of listeners) fn();
    },
    get size() {
      return listeners.size;
    },
  };
}
function directory(provider = "codex-cli", model = "gpt-5", sessionId = "a") {
  const projected = observable(
    provider === null ? undefined : { next: { provider, model } },
  );
  const catalogValue = {
    default: { provider: "codex-cli", model: "gpt-5" },
    groups: [
      {
        id: "codex-cli",
        name: "Codex",
        models: [
          { id: "gpt-5", name: "GPT" },
          { id: "gpt-spark", name: "Spark" },
          { id: "gpt-reserve", name: "Reserve" },
        ],
      },
      {
        id: "zcode-cli",
        name: "ZCode",
        models: [{ id: "gpt-5", name: "GPT" }],
      },
    ],
    failures: [],
  };
  const catalog = {
    store: observable({ status: "ready", value: catalogValue, error: null }),
    reasoningFor: () => undefined,
    load: async () => catalogValue,
  };
  let outcome = { ok: true, value: undefined },
    gate;
  const instance = new ModelDirectory(
    {
      selectModel: async (args) => {
        if (gate) await gate;
        if (outcome.ok)
          projected.set({
            next: { provider: args.provider, model: args.model },
          });
        return outcome;
      },
    },
    sessionId,
    () => true,
    catalog,
    projected,
    () => false,
  );
  return {
    instance,
    projected,
    catalog,
    confirm: (p, m = "gpt-5") =>
      projected.set({ next: { provider: p, model: m } }),
    fail: (v) => {
      outcome = v;
    },
    gate: (p) => {
      gate = p;
    },
  };
}

test("T08/T09/T12 真实模型目录：首次显示、同名跨来源、pending和失败保留", async () => {
  const f = fixtureStore();
  await f.bind();
  await f.store.refresh();
  const d = directory();
  const ui = await render(
    React.createElement(ComposerQuota, {
      directory: d.instance,
      quota: f.store,
      t,
    }),
  );
  assert.match(
    document.querySelector("[data-codex-quota-composer]").textContent,
    /19%/,
  );
  let release;
  d.gate(
    new Promise((r) => {
      release = r;
    }),
  );
  d.fail({ ok: false, error: { code: "denied", message: "failed" } });
  let selecting;
  await act(async () => {
    selecting = d.instance.select({ provider: "zcode-cli", model: "gpt-5" });
  });
  assert.ok(
    document.querySelector("[data-codex-quota-composer]"),
    "pending 继续采用已确认 Codex",
  );
  await act(async () => {
    release();
    await selecting;
  });
  assert.ok(document.querySelector("[data-codex-quota-composer]"));
  d.gate(null);
  d.fail({ ok: true, value: undefined });
  await act(async () => {
    await d.instance.select({ provider: "zcode-cli", model: "gpt-5" });
  });
  assert.equal(document.querySelector("[data-codex-quota-composer]"), null);
  await act(async () => {
    await d.instance.select({ provider: "codex-cli", model: "gpt-5" });
  });
  assert.ok(document.querySelector("[data-codex-quota-composer]"));
  assert.equal(f.reads, 1);
  await ui.close();
  d.instance.dispose();
  f.store.dispose();
});

test("T10/T11/T13 不同会话、独立组、未知来源与晚回执隔离", async () => {
  const f = fixtureStore();
  await f.bind();
  let release;
  f.block(
    new Promise((r) => {
      release = r;
    }),
  );
  const a = directory(),
    b = directory("zcode-cli", "gpt-5", "b"),
    unknown = directory(null, "gpt-5", "c");
  const ui = await render(
    React.createElement(
      "div",
      {},
      [a, b, unknown].map((d, i) =>
        React.createElement(
          "section",
          { key: i, "data-session": i },
          React.createElement(ComposerQuota, {
            directory: d.instance,
            quota: f.store,
            t,
          }),
        ),
      ),
    ),
  );
  assert.equal(
    document.querySelectorAll("[data-codex-quota-composer]").length,
    1,
  );
  await act(async () => {
    a.confirm("zcode-cli");
    b.confirm("codex-cli");
    release();
    await f.store.refresh();
  });
  assert.equal(
    document.querySelector('[data-session="0"] [data-codex-quota-composer]'),
    null,
  );
  assert.match(document.querySelector('[data-session="1"]').textContent, /19%/);
  await act(async () => {
    b.confirm("codex-cli", "gpt-reserve");
  });
  assert.ok(
    !document.querySelector('[data-session="1"]').textContent.includes("19%"),
  );
  await act(async () => {
    unknown.confirm("codex-cli");
  });
  assert.equal(
    document.querySelectorAll("[data-codex-quota-composer]").length,
    2,
  );
  await ui.close();
  [a, b, unknown].forEach((d) => {
    d.instance.dispose();
    assert.equal(d.projected.size, 0);
  });
  f.store.dispose();
});

test("T11/T19 连接重建淘汰旧 HTTP 回执，保留新代数结果", async () => {
  let resolveOld;
  let calls = 0;
  const old = fixtureView();
  old.accountEpoch = 1;
  const fresh = fixtureView();
  fresh.accountEpoch = 2;
  const store = new QuotaStore(
    async () => {
      calls++;
      if (calls === 1)
        return new Promise((r) => {
          resolveOld = () => r(Response.json(old));
        });
      return Response.json(fresh);
    },
    () => baseTime,
  );
  const pending = store.refresh();
  store.reset();
  await store.refresh();
  resolveOld();
  await pending;
  assert.equal(store.getSnapshot().view.accountEpoch, 2);
  store.dispose();
});

test("T03 客户端账号失效立即清空旧值并读取宿主冷却内的新状态", async () => {
  const f = fixtureStore();
  await f.bind();
  await f.store.refresh();
  const empty = {
    ...fixtureView(),
    accountEpoch: 1,
    state: "signed-out",
    fetchedAtMs: null,
    groups: [],
    credits: null,
    resets: null,
  };
  f.view(empty);
  f.store.reset();
  await f.store.refresh();
  assert.equal(f.store.getSnapshot().view.state, "signed-out");
  assert.equal(f.store.getSnapshot().view.groups.length, 0);
});

async function input(label, value) {
  const element = document.querySelector(`input[aria-label="${label}"]`);
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    ).set.call(element, value);
    uiRequire("react-dom/test-utils").Simulate.change(element, {
      target: { value },
    });
  });
}
async function clickSave() {
  await act(async () => {
    document
      .querySelector('[data-codex-quota="settings"] > div:last-child button')
      .click();
  });
}

test("T14/T16/T17 设置保存同步双端颜色，非法草稿保留原阈值", async () => {
  const f = fixtureStore();
  await f.bind();
  await f.store.refresh();
  const d = directory();
  const ui = await render(
    React.createElement(
      "div",
      {},
      React.createElement(QuotaDisplaySettings, { store: f.store, t }),
      React.createElement(QuotaCard, { store: f.store, t }),
      React.createElement(ComposerQuota, {
        directory: d.instance,
        quota: f.store,
        t,
      }),
    ),
  );
  await input("短周期剩余额度低于", "19");
  await clickSave();
  assert.equal(
    f.store.getSnapshot().settings.value.quotaShortThresholdPercent,
    19,
  );
  assert.equal(
    document.querySelectorAll('[data-low="true"]').length,
    0,
    "相等阈值保持普通色",
  );
  await input("短周期剩余额度低于", "0");
  assert.match(document.body.textContent, /请输入 1–100/);
  assert.equal(
    document.querySelector(
      '[data-codex-quota="settings"] > div:last-child button',
    ).disabled,
    true,
  );
  assert.equal(
    f.store.getSnapshot().settings.value.quotaShortThresholdPercent,
    19,
  );
  await input("短周期剩余额度低于", "21");
  await clickSave();
  assert.ok(
    document.querySelector('[data-codex-quota-composer] [data-low="true"]'),
  );
  assert.ok(document.querySelector('progress[data-low="true"]'));
  await ui.close();
  d.instance.dispose();
  f.store.dispose();
});

test("T18 宿主原文错误与草稿保留，恢复修订后可重试", async () => {
  const f = fixtureStore();
  await f.bind();
  const message =
    'Configuration for "kmh-codex-cli" is overridden by a home patch';
  f.ctx.remote.settings.mutate = async () => ({
    ok: false,
    error: { message },
  });
  f.ctx.remote.settings.describe = async () => ({
    ok: true,
    value: {
      namespaces: [{ ns: "kmh-codex-cli", value: preferences, revision: 8 }],
    },
  });
  const ui = await render(
    React.createElement(QuotaDisplaySettings, { store: f.store, t }),
  );
  await input("每周剩余额度低于", "45");
  await clickSave();
  assert.equal(document.querySelector('[role="alert"]').textContent, message);
  assert.equal(
    document.querySelector('input[aria-label="每周剩余额度低于"]').value,
    "45",
  );
  assert.equal(
    f.store.getSnapshot().settings.value.quotaWeeklyThresholdPercent,
    20,
  );
  f.ctx.remote.settings.mutate = async (ns, ops, revision) => {
    assert.equal(revision, 8);
    return {
      ok: true,
      value: {
        revision: 9,
        value: { ...preferences, quotaWeeklyThresholdPercent: 45 },
      },
    };
  };
  await clickSave();
  assert.equal(
    f.store.getSnapshot().settings.value.quotaWeeklyThresholdPercent,
    45,
  );
  await act(async () => {
    f.settings({ ...preferences }, { writable: false });
  });
  assert.equal(
    document.querySelector(
      '[data-codex-quota="settings"] > div:last-child button',
    ).disabled,
    true,
  );
  await ui.close();
  f.store.dispose();
});

test("T14/T18 真实宿主持久化、双客户端冲突恢复、重启读取与 schema 边界", async (t) => {
  const host = await quotaHostFixture();
  t.after(() => host.close());
  const clients = [];
  for (let i = 0; i < 2; i++) {
    const ctx = { on: () => () => {}, remote: { settings: host.remote } };
    const mirror = new SettingsDescribeMirror(ctx);
    const form = new ConfigFormController(
      ctx,
      { namespace: "kmh-codex-cli" },
      mirror,
      "host",
      new SettingsSchemaService(new Context()),
    );
    ctx.configForms = { get: () => form, describe: () => mirror };
    await mirror.ensure();
    const store = new QuotaStore(async () =>
      Response.json({ settingsNamespace: "kmh-codex-cli", preferences }),
    );
    stores.add(store);
    await store.bind(ctx);
    clients.push({ store, mirror, form });
    t.after(() => form.dispose());
  }
  const [a, b] = clients;
  const revision = b.store.getSnapshot().settings.revision;
  const value = {
    ...preferences,
    quotaDisplayMode: "bar",
    quotaShortThresholdPercent: 31,
  };
  await a.store.save(value, a.store.getSnapshot().settings.revision);
  assert.equal(a.store.getSnapshot().settings.value.quotaDisplayMode, "bar");
  await assert.rejects(
    () => b.store.save({ ...value, quotaShortThresholdPercent: 32 }, revision),
    /changed since|revision/,
  );
  assert.equal(
    b.store.getSnapshot().settings.value.quotaShortThresholdPercent,
    31,
    "冲突恢复读取真实持久化值",
  );
  await b.store.save(
    { ...value, quotaShortThresholdPercent: 32 },
    b.store.getSnapshot().settings.revision,
  );
  assert.equal(host.descriptor().value.quotaShortThresholdPercent, 32);
  assert.equal(host.config.quotaShortThresholdPercent.get(), 32);
  const bad = await host.remote.mutate(
    "kmh-codex-cli",
    [{ op: "set", path: ["quotaShortThresholdPercent"], value: 0 }],
    host.descriptor().revision,
  );
  assert.equal(bad.ok, false);
  assert.equal(host.descriptor().value.quotaShortThresholdPercent, 32);
  await host.restart();
  assert.equal(host.descriptor().value.quotaDisplayMode, "bar");
  assert.equal(host.descriptor().value.quotaShortThresholdPercent, 32);
});

test("T14/T18 远程只读配置采用宿主显示值，保存保持禁用", async () => {
  const store = new QuotaStore(
    async (url) =>
      Response.json(
        String(url).endsWith("context")
          ? {
              settingsNamespace: "kmh-codex-cli",
              preferences: { ...preferences, quotaShortThresholdPercent: 35 },
            }
          : fixtureView(),
      ),
    () => baseTime,
  );
  stores.add(store);
  const snapshot = {
    status: "unavailable",
    mode: "memory",
    writable: false,
    value: undefined,
    revision: undefined,
  };
  await store.bind({
    on: () => () => {},
    configForms: {
      get: () => ({ getSnapshot: () => snapshot, subscribe: () => () => {} }),
      describe: () => ({
        getSnapshot: () => ({
          status: "unavailable",
          error: null,
          view: undefined,
        }),
        subscribe: () => () => {},
        ensure: async () => {},
      }),
    },
    remote: { $on: () => () => {} },
  });
  const d = directory();
  const ui = await render(
    React.createElement(
      "div",
      {},
      React.createElement(QuotaDisplaySettings, { store, t }),
      React.createElement(ComposerQuota, {
        directory: d.instance,
        quota: store,
        t,
      }),
    ),
  );
  assert.match(document.body.textContent, /当前连接的显示设置为只读/);
  assert.equal(
    document.querySelector('input[aria-label="短周期剩余额度低于"]').value,
    "35",
  );
  assert.equal(document.querySelector("input").disabled, true);
  assert.match(
    document.querySelector("[data-codex-quota-composer]").textContent,
    /19%/,
  );
  await assert.rejects(() => store.save(preferences, undefined), /read-only/);
  await ui.close();
  d.instance.dispose();
});

test("T18 真实配置目录拒绝写入时保留原值与原文件", async (t) => {
  const host = await quotaHostFixture();
  t.after(() => host.close());
  const before = await readFile(host.profile.patchPath, "utf8");
  const revision = host.descriptor().revision;
  await chmod(host.profile.dir, 0o500);
  try {
    const result = await host.remote.mutate(
      "kmh-codex-cli",
      [{ op: "set", path: ["quotaShortThresholdPercent"], value: 44 }],
      revision,
    );
    assert.equal(result.ok, false);
    assert.match(result.error.message, /EACCES|permission|denied/i);
    assert.equal(host.descriptor().value.quotaShortThresholdPercent, 20);
    assert.equal(await readFile(host.profile.patchPath, "utf8"), before);
  } finally {
    await chmod(host.profile.dir, 0o700);
  }
});

test("T05 Credits 缺失余额、已知零值和无限额分别展示", async () => {
  for (const [credits, expected] of [
    [{ hasCredits: false, unlimited: false, balance: null }, "余额暂未提供"],
    [{ hasCredits: false, unlimited: false, balance: "0" }, "0"],
    [{ hasCredits: true, unlimited: true, balance: null }, "无限额"],
  ]) {
    const f = fixtureStore();
    f.view({ ...fixtureView(), credits });
    await f.bind();
    await f.store.refresh();
    const ui = await render(
      React.createElement(QuotaCard, { store: f.store, t }),
    );
    const area = [...document.querySelectorAll("[data-quota-area]")].find(
      (e) => e.querySelector("h4")?.textContent === "额外 Credits",
    );
    assert.equal(area.querySelector("p").textContent, expected);
    await ui.close();
    f.store.dispose();
  }
});

test("B1 额度 HTTP 挂起在30秒退出，失败冷却内共享读取，冷却后可恢复", async (t) => {
  const f = fixtureStore();
  await f.bind();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  f.block(new Promise(() => {}));
  const pending = f.store.refresh();
  f.time(baseTime + 30000);
  t.mock.timers.tick(30000);
  await new Promise(setImmediate);
  assert.equal(f.store.getSnapshot().loading, false);
  assert.equal(f.store.getSnapshot().error, "QUOTA_HTTP_TIMEOUT");
  await pending;
  await Promise.all(Array.from({ length: 100 }, () => f.store.refresh(true)));
  assert.equal(f.reads, 1);
  f.block(null);
  f.time(baseTime + 330000);
  await f.store.refresh();
  assert.equal(f.reads, 2);
  assert.equal(f.store.getSnapshot().error, null);
});

test("B1 收到 HTTP 头后响应正文挂起仍遵守30秒总截止", async (t) => {
  const f = fixtureStore();
  const store = new QuotaStore(
    async (url) =>
      String(url).endsWith("context")
        ? Response.json({ settingsNamespace: "kmh-codex-cli", preferences })
        : { ok: true, json: () => new Promise(() => {}) },
    () => baseTime,
  );
  stores.add(store);
  await store.bind(f.ctx);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const pending = store.refresh();
  await new Promise(setImmediate);
  t.mock.timers.tick(30000);
  await new Promise(setImmediate);
  assert.equal(store.getSnapshot().loading, false);
  assert.equal(store.getSnapshot().error, "QUOTA_HTTP_TIMEOUT");
  await pending;
});

test("B1 配置上下文 HTTP 超时结束绑定，重连后恢复设置", async (t) => {
  const f = fixtureStore();
  let hang = true;
  let resetConnection;
  f.ctx.on = (event, listener) => {
    assert.equal(event, "connection/reset");
    resetConnection = listener;
    return () => {};
  };
  const store = new QuotaStore(
    () =>
      hang
        ? new Promise(() => {})
        : Promise.resolve(
            Response.json({ settingsNamespace: "kmh-codex-cli", preferences }),
          ),
    () => baseTime,
  );
  stores.add(store);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let failure;
  const binding = store.bind(f.ctx).catch((error) => {
    failure = error;
  });
  t.mock.timers.tick(30000);
  await new Promise(setImmediate);
  assert.equal(store.getSnapshot().settingsError, "QUOTA_HTTP_TIMEOUT");
  assert.equal(failure?.message, "QUOTA_HTTP_TIMEOUT");
  await binding;
  assert.equal(typeof resetConnection, "function");
  hang = false;
  resetConnection();
  await new Promise(setImmediate);
  assert.equal(store.getSnapshot().settingsError, null);
  assert.deepEqual(store.getSnapshot().settings.value, preferences);
});

test("B2 冷却内的空快照显示待更新，输入框和详情页均退出读取文案", async () => {
  const f = fixtureStore();
  f.view({
    ...fixtureView(),
    state: "loading",
    fetchedAtMs: null,
    groups: [],
    credits: null,
    resets: null,
  });
  await f.bind();
  await f.store.refresh();
  const d = directory();
  const ui = await render(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(ComposerQuota, {
        directory: d.instance,
        quota: f.store,
        t,
      }),
      React.createElement(QuotaCard, { store: f.store, t }),
    ),
  );
  assert.equal(f.store.getSnapshot().loading, false);
  assert.match(
    document.querySelector("[data-codex-quota-composer]").textContent,
    /状态待更新/,
  );
  assert.doesNotMatch(document.body.textContent, /正在读取额度/);
  assert.match(
    document.querySelector('[data-codex-quota="overview"]').textContent,
    /状态待更新/,
  );
  await ui.close();
  d.instance.dispose();
});

test("B1 设置镜像等待也受30秒绑定总截止保护", async (t) => {
  const f = fixtureStore();
  const original = f.ctx.configForms.describe;
  f.ctx.configForms.describe = () => ({
    ...original(),
    ensure: () => new Promise(() => {}),
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let failure;
  const binding = f.bind().catch((error) => {
    failure = error;
  });
  await new Promise(setImmediate);
  t.mock.timers.tick(30000);
  await new Promise(setImmediate);
  assert.equal(failure?.message, "QUOTA_HTTP_TIMEOUT");
  assert.equal(f.store.getSnapshot().settingsError, "QUOTA_HTTP_TIMEOUT");
  await binding;
});

test("B2 额度设置从公开宿主镜像投影四键，完整配置表单未就绪时仍可展示", async () => {
  const f = fixtureStore();
  const raw = {
    ns: "kmh-codex-cli",
    revision: 7,
    value: { command: "codex", toolPolicy: {}, ...preferences },
  };
  f.ctx.configForms.get = () => ({
    getSnapshot: () => ({
      mode: "host",
      status: "loading",
      value: undefined,
      writable: false,
    }),
    subscribe: () => () => {},
  });
  f.ctx.configForms.describe = () => ({
    getSnapshot: () => ({
      status: "ready",
      error: null,
      view: { writable: true, namespaces: [raw] },
    }),
    subscribe: () => () => {},
    ensure: async () => {},
  });
  await f.bind();
  assert.deepEqual(f.store.getSnapshot().settings.value, preferences);
  assert.equal(f.store.getSnapshot().settings.revision, 7);
  assert.equal(f.store.getSnapshot().settings.writable, true);
  const ui = await render(
    React.createElement(QuotaDisplaySettings, { store: f.store, t }),
  );
  assert.doesNotMatch(document.body.textContent, /正在读取显示设置/);
  assert.equal(document.querySelectorAll('input[type="number"]').length, 2);
  await ui.close();
});
