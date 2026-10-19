/**
 * 聚合 Token 分析视图浏览器半的行为测试：把构建产物当作模块加载器工厂加载，
 * 注入一个最小的假 Cordis 上下文，断言侧栏入口、中心面板、配置表单的实际
 * 注册行为与配置投影。假上下文刻意不提供 layout 服务——本插件不做选中态
 * 记忆，设计上不注入 layout（技术设计 D02），代码一旦访问 ctx.layout 即在
 * 此失败。不渲染界面，因此不覆盖视觉与 iframe 加载（由真实浏览器验证承担）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const CLIENT_BUNDLE = join(root, "../lib/client.js");
const PACKAGE_ID = "@kmh/aggregated-token-analysis";
const ROW_ID = "aggregated-token-analysis";
const NS = "tokenAnalysis";
const PANEL_ID = "token-analysis";
const PANEL_LABEL = "Token 分析";

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
 * 会被调用到的两处：数值字段助手与表单模型，语义与上游实现一致。
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
        if (property === "SettingsFormModel") {
          return class {
            constructor(scope, specs) {
              this.scope = scope;
              this.specs = specs;
            }
            bind(project) {
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
              return {
                text: spec.format(value),
                overridden: false,
                dirty: false,
              };
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
  const previousWindow = globalThis.window;
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        captured = { id, factory };
      },
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
  };
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
    restore: () => {
      globalThis.window = previousWindow;
    },
  };
}

/**
 * 记录注册与订阅的最小假上下文。configForms 的快照可变，subscribe 的
 * 监听器被收集起来，供测试模拟"配置保存后投影重算"。
 * @param initial - 配置快照的初始值。
 */
function createContext(initial) {
  const registered = [];
  const injected = [];
  const listeners = new Set();
  let value = initial;
  const ctx = {
    effect: (fn) => {
      fn();
    },
    locale: {
      register: (ns, dictionaries) => {
        registered.push({ kind: "locale", ns, dictionaries });
        return () => {};
      },
      bind: (ns) => (key) => (ns === NS && key === "panel" ? PANEL_LABEL : key),
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
    configForms: {
      describe: () => ({ acceptView: () => {} }),
      get: (rowId) => {
        assert.equal(rowId, ROW_ID, "配置命名空间必须是 bundle patch 的行 id");
        return {
          getSnapshot: () => ({
            status: "ready",
            value,
            base: {},
            user: {},
            writable: true,
            revision: 1,
          }),
          subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
          },
          mutate: async () => true,
        };
      },
    },
  };
  return {
    ctx,
    registered,
    injected,
    setValue: (next) => {
      value = next;
      for (const listener of listeners) listener();
    },
  };
}

const READY_VALUE = {
  pageUrl: "http://example.test/page/",
  pageLoadTimeoutMs: 5000,
};

test("产物带本包 id，并注册词典、侧栏入口与中心面板；不访问 layout", () => {
  const loaded = loadClientBundle();
  try {
    assert.equal(loaded.id, PACKAGE_ID);
    const harness = createContext(READY_VALUE);
    loaded.moduleExports.apply(harness.ctx);

    const locale = harness.registered.find((entry) => entry.kind === "locale");
    assert.equal(locale.ns, NS);
    assert.equal(locale.dictionaries.zh.panel, PANEL_LABEL);
    assert.equal(locale.dictionaries.en.panel, "Token Analysis");

    const sidebar = harness.registered.find(
      (entry) => entry.options?.name === "sidebar.panellist",
    );
    assert.ok(sidebar, "必须注册 sidebar.panellist");
    assert.equal(sidebar.options.id, PANEL_ID);
    assert.equal(sidebar.options.order, 12, "排在 MadeMe(10)、Infra(11) 之后");
    assert.equal(sidebar.options.label(), PANEL_LABEL);

    const main = harness.registered.find(
      (entry) => entry.options?.name === "main",
    );
    assert.ok(main, "必须注册 main 面板");
    assert.equal(main.options.key, PANEL_ID);
  } finally {
    loaded.restore();
  }
});

test("侧栏与中心面板共享同一个面板 id，且只注入四个槽", () => {
  const loaded = loadClientBundle();
  try {
    const harness = createContext(READY_VALUE);
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

test("面板快照从配置投影地址与超时，配置变化后重算（C2、C5）", () => {
  const loaded = loadClientBundle();
  try {
    const harness = createContext(READY_VALUE);
    loaded.moduleExports.apply(harness.ctx);
    const main = harness.registered.find(
      (entry) => entry.options?.name === "main",
    );
    const store = main.options.inject().hooks.tokenPageTarget;
    assert.deepEqual(store.getSnapshot(), {
      status: "ready",
      url: READY_VALUE.pageUrl,
      loadTimeoutMs: READY_VALUE.pageLoadTimeoutMs,
    });

    harness.setValue({
      pageUrl: "http://other.test/",
      pageLoadTimeoutMs: 2500,
    });
    assert.deepEqual(store.getSnapshot(), {
      status: "ready",
      url: "http://other.test/",
      loadTimeoutMs: 2500,
    });
  } finally {
    loaded.restore();
  }
});

test("地址为空或超时非正数时面板不就绪，而不是用写死的值兜底（C5）", () => {
  const loaded = loadClientBundle();
  try {
    const harness = createContext({ pageUrl: "", pageLoadTimeoutMs: 5000 });
    loaded.moduleExports.apply(harness.ctx);
    const main = harness.registered.find(
      (entry) => entry.options?.name === "main",
    );
    const store = main.options.inject().hooks.tokenPageTarget;
    assert.notEqual(store.getSnapshot().status, "ready");
    assert.equal(store.getSnapshot().url, undefined);

    harness.setValue({ pageUrl: "http://example.test/", pageLoadTimeoutMs: 0 });
    assert.notEqual(store.getSnapshot().status, "ready");
    assert.equal(store.getSnapshot().loadTimeoutMs, undefined);
  } finally {
    loaded.restore();
  }
});

test("配置表单同时注册在插件详情页与组件行详情两处，键指向本包与本行，值取自配置", () => {
  const loaded = loadClientBundle();
  try {
    const harness = createContext(READY_VALUE);
    loaded.moduleExports.apply(harness.ctx);
    const bundleForm = harness.registered.find(
      (entry) => entry.options?.name === "plugins.bundle.config",
    );
    const rowForm = harness.registered.find(
      (entry) => entry.options?.name === "plugins.row.config",
    );
    assert.equal(bundleForm.options.key, PACKAGE_ID);
    assert.equal(rowForm.options.key, `${PACKAGE_ID}#${ROW_ID}`);

    const face = rowForm.options.inject();
    for (const action of ["edit", "resetField", "save", "discard"]) {
      assert.equal(typeof face[action], "function", `${action} 必须可注入`);
    }
    const snapshot = face.hooks.tokenAnalysisConfig.getSnapshot();
    assert.equal(snapshot.pageUrl.text, READY_VALUE.pageUrl, "表单从配置取值");
    assert.equal(snapshot.pageLoadTimeoutMs.text, "5000");
  } finally {
    loaded.restore();
  }
});
