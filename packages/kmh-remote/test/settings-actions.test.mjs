// 设置页通过真实 RPC 处理器保存局域网开关，再读取完整状态。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { installPocketRpc } from '../lib/web-rpc.js';
import { POCKET_ENDPOINTS, RemoteStatusSchema } from '../client/api.js';

/** 在实例内模拟 React 状态与宿主设置；返回可操作的组件树和 RPC 记录。 */
async function settingsFixture() {
  const values = { lan: false };
  let handler;
  installPocketRpc(
    { connection: { rpc: { handle: (_channel, fn) => (handler = fn) } } },
    {
      service: {
        status: async () => ({
          proxyRunning: true,
          proxyPort: 60001,
          dshPort: 60000,
          lanUrl: 'http://192.168.1.2:60001',
          lanQr: 'data:image/png;base64,fixture',
          lanCandidates: ['192.168.1.2'],
        }),
      },
      getLanEnabled: () => values.lan,
      setLanEnabled: (on) => (values.lan = on),
    },
  );
  const initial = await handler(POCKET_ENDPOINTS.status);
  const state = [RemoteStatusSchema.parse(initial.value)];
  const calls = [];
  const events = [];
  const require = createRequire(import.meta.url);
  let cursor = 0;
  const react = {
    ...require('react'),
    useEffect() {},
    useState(initialValue) {
      const index = cursor++;
      if (!(index in state)) state[index] = initialValue;
      return [state[index], (value) => (state[index] = value)];
    },
  };
  let exported;
  vm.runInNewContext(
    readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'),
    {
      URL,
      CustomEvent: class {
        constructor(type, options) {
          this.type = type;
          this.detail = options.detail;
        }
      },
      document: { body: { setAttribute() {} } },
      window: {
        location: { href: 'http://localhost/' },
        matchMedia: () => ({ matches: false }),
        dispatchEvent: (event) => events.push(event),
        __ModuleLoader__: {
          load: ({ factory }) => {
            exported = factory((name) =>
              name === 'react'
                ? react
                : name === '@deepseek-ai/dsh-client-ui-primitives'
                  ? Object.fromEntries(
                      ['Button', 'Input', 'Switch', 'Modal', 'Toast'].map(
                        (name) => [name, name],
                      ),
                    )
                  : require(name),
            );
          },
        },
      },
    },
  );
  let settings;
  exported.apply({
    connection: { rpc: { call() {} } },
    locale: { bind: () => (key) => key, register: () => () => {} },
    effect: (effect) => effect(),
    slots: {
      inject: (_name, mount) => mount(),
      register: (entry, component) => {
        if (entry.name === 'settings.section') settings = component;
      },
    },
  });
  return {
    values,
    state,
    calls,
    events,
    render() {
      cursor = 0;
      return settings({
        t: (key) => key,
        rpcCall: async (endpoint, payload) => {
          calls.push({ endpoint, payload });
          return handler(endpoint, payload);
        },
      });
    },
  };
}

/** 按组件属性在 React 元素树中查找控件，保留实际点击回调。 */
function controls(node, predicate) {
  if (Array.isArray(node))
    return node.flatMap((child) => controls(child, predicate));
  if (!node || typeof node !== 'object') return [];
  return [
    ...(predicate(node) ? [node] : []),
    ...controls(node.props?.children, predicate),
  ];
}

test('设置页局域网访问保存双向开关并保留完整状态', async () => {
  const fixture = await settingsFixture();
  for (const enabled of [true, false]) {
    const [control] = controls(
      fixture.render(),
      (node) => node.props?.label === 'lanAccess',
    );
    await control.props.onChange(enabled);
    assert.equal(fixture.state[1], '', '保存完成后没有校验错误');
    assert.equal(fixture.state[0].lanEnabled, enabled);
    RemoteStatusSchema.parse(fixture.state[0]);
    assert.deepEqual(
      fixture.calls.slice(-2).map((call) => call.endpoint),
      [POCKET_ENDPOINTS.lanSetEnabled, POCKET_ENDPOINTS.status],
    );
    assert.equal(fixture.calls.at(-2).payload.on, enabled);
  }
});
