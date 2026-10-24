// 核对 KMH 包身份、源码迁入清单与本地维护边界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { apply, name, inject } from '../lib/index.js';
import { POCKET_ENDPOINTS, POCKET_RPC_CHANNEL } from '../client/api.js';

test('客户端使用正式槽位注册设置页与两种插件详情', () => {
  const require = createRequire(import.meta.url);
  const entries = [];
  let exported;
  const source = readFileSync(
    new URL('../lib/client.js', import.meta.url),
    'utf8',
  );
  const body = { setAttribute() {} };
  vm.runInNewContext(source, {
    URL,
    document: { body },
    window: {
      location: { href: 'http://localhost/' },
      matchMedia: () => ({ matches: false }),
      __ModuleLoader__: {
        load: ({ factory }) => {
          exported = factory((name) =>
            name === '@deepseek-ai/dsh-client-ui-primitives'
              ? {}
              : require(name),
          );
        },
      },
    },
  });
  exported.apply({
    connection: { rpc: { call() {} } },
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (effect) => effect(),
    slots: {
      inject: (_name, mount) => mount(),
      register: (entry, component) => {
        entries.push({ entry, component });
      },
    },
  });
  const bundle = entries.find(
    ({ entry }) => entry.name === 'plugins.bundle.config',
  );
  const row = entries.find(({ entry }) => entry.name === 'plugins.row.config');
  assert.equal(bundle.entry.key, '@kmh/remote');
  assert.equal(row.entry.key, '@kmh/remote#kmh-remote');
  assert.equal(bundle.component({ view: 'summary' }), null);
  assert.ok(bundle.component({ view: 'page' }));
  assert.equal(
    entries.find(({ entry }) => entry.name === 'settings.section').entry.id,
    'kmh-remote',
  );
});

test('包身份与模块工厂使用同一 @kmh/remote 标识', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.name, '@kmh/remote');
  assert.equal(name, manifest.name);
  assert.deepEqual(inject, ['connection', 'webServer']);
  let loaderId;
  const source = readFileSync(
    new URL('../lib/client.js', import.meta.url),
    'utf8',
  );
  vm.runInNewContext(source, {
    window: {
      __ModuleLoader__: {
        load: ({ id }) => {
          loaderId = id;
        },
      },
    },
  });
  assert.equal(loaderId, manifest.name);
  assert.equal(POCKET_RPC_CHANNEL, '/kmh-remote');
});

test('迁入清单保留手写源码，构建产物由 lib 导出', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../upstream-source.json', import.meta.url), 'utf8'),
  );
  assert.equal(manifest.version, '2.12.0');
  assert.match(manifest.commit, /^[0-9a-f]{40}$/);
  for (const file of manifest.files) {
    assert.match(file.sha256, /^[0-9a-f]{64}$/);
    assert.ok(
      existsSync(new URL(`../${file.destination}`, import.meta.url)),
      file.destination,
    );
  }
  assert.equal(
    existsSync(new URL('../client/client.js', import.meta.url)),
    false,
  );
  assert.ok(existsSync(new URL('../lib/client.js', import.meta.url)));
});

test('插件挂载后由 KMH 管理更新与重启，卸载释放服务', async () => {
  let handler;
  let cleanup;
  let disposed = 0;
  const service = {
    startProxy: async () => ({ port: 60001 }),
    dispose: async () => {
      disposed += 1;
    },
  };
  const ctx = {
    webServer: { port: 60000 },
    connection: {
      rpc: {
        handle: (_channel, fn) => {
          handler = fn;
          return () => {};
        },
      },
    },
    logger: () => ({ info() {}, warn() {}, error() {} }),
    effect: (effect) => {
      cleanup = effect();
    },
  };
  apply(ctx, {}, { service });
  for (const endpoint of ['pocket.update', 'pocket.restart', 'tunnel.start']) {
    const result = await handler(endpoint, {});
    assert.equal(result.ok, false);
  }
  await cleanup();
  assert.equal(disposed, 1);
});
