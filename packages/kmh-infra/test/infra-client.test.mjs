/**
 * kmh-infra 浏览器半的行为测试：把构建产物当作模块加载器工厂加载，注入一个
 * 最小的假 Cordis 上下文，断言侧栏入口、中心面板、选中态镜像与刷新恢复的
 * 实际注册行为。不渲染界面，因此不覆盖视觉与 iframe 加载（那两条由真实
 * 浏览器验证承担）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const CLIENT_BUNDLE = join(root, "../lib/client.js");
const NS = "infra";
const PANEL_ID = "infra";
const ACTIVE_KEY = "kmh-infra:active";

/** 任意属性的占位实现：宿主组件在被渲染前不会真的被调用。 */
function stubModule() {
  return new Proxy(
    {},
    {
      get: (_target, property) =>
        property === "__esModule" ? true : (..._args) => undefined,
    },
  );
}

/**
 * 宿主组件库的最小替身。真实的 ui-primitives 在 Node 里加载不了（构建产物
 * 带 CSS 导入），渲染与字段语义由浏览器验证覆盖；这里只补齐模块加载期真正
 * 会被调用到的三处：两个字段助手与表单模型，字段助手的语义与上游实现一致。
 */
function primitivesStub() {
  const generic = stubModule();
  return new Proxy(
    {},
    {
      get: (_target, property) => {
        if (property === "settingsNumberField") {
          return (field) => ({
            field,
            format: (value) => (typeof value === "number" ? String(value) : ""),
            parse: (text) => {
              const trimmed = text.trim();
              if (trimmed === "") return { kind: "clear" };
              const parsed = Number(trimmed);
              return Number.isFinite(parsed)
                ? { kind: "set", value: parsed }
                : undefined;
            },
          });
        }
        if (property === "settingsTextField") {
          return (field) => ({
            field,
            format: (value) => (typeof value === "string" ? value : ""),
            parse: (text) =>
              text.trim() === ""
                ? { kind: "clear" }
                : { kind: "set", value: text },
          });
        }
        if (property === "SettingsFormModel") {
          return class {
            constructor(scope, specs) {
              this.scope = scope;
              this.specs = specs;
            }
            bind(project) {
              this.project = project;
              return {
                getSnapshot: () => project(),
                subscribe: () => () => {},
              };
            }
            shell() {
              return { status: "ready", writable: true, fields: new Set() };
            }
            field(name) {
              const spec = this.specs.find((entry) => entry.field === name);
              const value = this.scope.getSnapshot().value?.[name];
              return { text: spec.format(value), overridden: false, dirty: false };
            }
            actions() {
              return {
                edit: () => {},
                resetField: () => {},
                save: () => {},
                discard: () => {},
              };
            }
            dispose() {}
          };
        }
        return generic[property];
      },
    },
  );
}

/** 建立一次 window 与模块加载器环境，返回加载到的浏览器半模块。 */
function loadClientBundle() {
  let captured;
  const storage = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        captured = { id, factory };
      },
    },
    localStorage: {
      getItem: (key) => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
  // 产物是 CJS 工厂包在模块加载器外壳里；此处只执行外壳，取出 factory。
  const source = readFileSync(CLIENT_BUNDLE, "utf8");
  const evaluate = new Function("window", `${source}\nreturn undefined;`);
  evaluate(globalThis.window);
  assert.ok(captured, "产物必须调用 window.__ModuleLoader__.load");
  const moduleExports = captured.factory((name) =>
    name === "@deepseek-ai/dsh-client-ui-primitives"
      ? primitivesStub()
      : stubModule(),
  );
  return {
    id: captured.id,
    moduleExports,
    storage,
    restore: () => {
      globalThis.window = previousWindow;
    },
  };
}

/** 记录注册与订阅的最小假上下文。 */
function createContext() {
  const registered = [];
  const effects = [];
  const panelListeners = new Set();
  const injected = [];
  const state = { activePanelId: "thread", selected: [] };
  const ctx = {
    effect: (fn, name) => {
      const dispose = fn();
      effects.push({
        name,
        dispose: typeof dispose === "function" ? dispose : () => {},
      });
    },
    locale: {
      register: (ns, dictionaries) => {
        registered.push({ kind: "locale", ns, dictionaries });
        return () => {};
      },
      bind: (ns) => (key) => (ns === NS && key === "panel" ? "Infra" : key),
    },
    slots: {
      inject: (name, provider) => {
        injected.push(name);
        const produced = provider();
        const isGenerator =
          produced !== null &&
          typeof produced === "object" &&
          typeof produced.next === "function";
        if (isGenerator) {
          for (const item of produced) {
            registered.push({ kind: "slot", name, options: item });
          }
        } else {
          registered.push({ kind: "slot", name, options: produced });
        }
      },
      register: (options) => options,
    },
    layout: {
      panelInfo: {
        subscribe: (listener) => {
          panelListeners.add(listener);
          return () => panelListeners.delete(listener);
        },
        getSnapshot: () => ({ activePanelId: state.activePanelId }),
      },
      selectPanel: (id) => {
        state.selected.push(id);
      },
    },
    configForms: {
      get: () => ({
        getSnapshot: () => ({
          status: "ready",
          value: {
            dashUrl: "http://127.0.0.1:60010",
            panelLoadTimeoutMs: 8000,
          },
          base: {},
          user: {},
          writable: true,
          revision: 1,
        }),
        subscribe: () => () => {},
        mutate: async () => true,
      }),
    },
  };
  return {
    ctx,
    registered,
    effects,
    injected,
    state,
    notifyPanelChange: (activePanelId) => {
      state.activePanelId = activePanelId;
      for (const listener of panelListeners) listener();
    },
  };
}

test("产物带本包 id，并注册侧栏入口与中心面板", () => {
  const loaded = loadClientBundle();
  try {
    assert.equal(loaded.id, "@kmh/kmh-infra");
    const harness = createContext();
    loaded.moduleExports.apply(harness.ctx);

    const locale = harness.registered.find((entry) => entry.kind === "locale");
    assert.equal(locale.ns, NS);
    assert.equal(locale.dictionaries.zh.panel, "Infra");

    const sidebar = harness.registered.find(
      (entry) => entry.options?.name === "sidebar.panellist",
    );
    assert.ok(sidebar, "必须注册 sidebar.panellist");
    assert.equal(sidebar.options.id, PANEL_ID);
    assert.equal(sidebar.options.order, 11);
    assert.equal(sidebar.options.label(), "Infra");
    assert.equal(typeof sidebar.options.locale, "string");

    const main = harness.registered.find(
      (entry) => entry.options?.name === "main",
    );
    assert.ok(main, "必须注册 main 面板");
    assert.equal(main.options.key, PANEL_ID);
    const face = main.options.inject();
    assert.equal(typeof face.hooks.infraDashTarget.getSnapshot, "function");
  } finally {
    loaded.restore();
  }
});

test("侧栏与中心面板共享同一个面板 id（点侧栏切主区的前提）", () => {
  const loaded = loadClientBundle();
  try {
    const harness = createContext();
    loaded.moduleExports.apply(harness.ctx);
    const ids = harness.registered
      .filter(
        (entry) =>
          entry.kind === "slot" &&
          (entry.options.name === "main" ||
            entry.options.name === "sidebar.panellist"),
      )
      .map((entry) => entry.options.id ?? entry.options.key);
    assert.deepEqual([...new Set(ids)], [PANEL_ID]);
    assert.deepEqual(harness.injected, [
      "main",
      "sidebar.panellist",
      "plugins.bundle.config",
      "plugins.row.config",
    ]);
  } finally {
    loaded.restore();
  }
});

test("配置表单同时注册在插件详情页与组件行详情两处，键指向本包与本行", () => {
  const loaded = loadClientBundle();
  try {
    const harness = createContext();
    loaded.moduleExports.apply(harness.ctx);
    const bundleForm = harness.registered.find(
      (entry) => entry.options?.name === "plugins.bundle.config",
    );
    const rowForm = harness.registered.find(
      (entry) => entry.options?.name === "plugins.row.config",
    );
    assert.equal(bundleForm.options.key, "@kmh/kmh-infra");
    assert.equal(rowForm.options.key, "@kmh/kmh-infra#kmh-infra");

    const face = rowForm.options.inject();
    assert.equal(typeof face.hooks.infraConfig.getSnapshot, "function");
    for (const action of ["edit", "resetField", "save", "discard"]) {
      assert.equal(typeof face[action], "function", `${action} 必须可注入`);
    }
    const snapshot = face.hooks.infraConfig.getSnapshot();
    assert.equal(snapshot.dashUrl.text, "http://127.0.0.1:60010", "表单从配置取值");
    assert.equal(snapshot.panelLoadTimeoutMs.text, "8000");
  } finally {
    loaded.restore();
  }
});

test("选中态镜像：选中落标记、切走清除、卸载清残留", () => {
  const loaded = loadClientBundle();
  try {
    const harness = createContext();
    loaded.moduleExports.apply(harness.ctx);

    harness.notifyPanelChange(PANEL_ID);
    assert.equal(loaded.storage.get(ACTIVE_KEY), "1");

    harness.notifyPanelChange("thread");
    assert.equal(loaded.storage.has(ACTIVE_KEY), false);

    harness.notifyPanelChange(PANEL_ID);
    const mirror = harness.effects.find((entry) =>
      entry.name.includes("selection mirror"),
    );
    mirror.dispose();
    assert.equal(
      loaded.storage.has(ACTIVE_KEY),
      false,
      "卸载时必须清掉残留标记，避免把上一次的选中强加给刷新恢复",
    );
  } finally {
    loaded.restore();
  }
});

test("刷新恢复：有标记时恢复面板选中，无标记时不打扰主区", async () => {
  const first = loadClientBundle();
  let harness;
  try {
    harness = createContext();
    first.moduleExports.apply(harness.ctx);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    assert.deepEqual(
      harness.state.selected,
      [],
      "没有标记时不得抢占主区",
    );
  } finally {
    first.restore();
  }

  const second = loadClientBundle();
  try {
    second.storage.set(ACTIVE_KEY, "1");
    const restored = createContext();
    second.moduleExports.apply(restored.ctx);
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });
    assert.deepEqual(restored.state.selected, [PANEL_ID]);
  } finally {
    second.restore();
  }
});
