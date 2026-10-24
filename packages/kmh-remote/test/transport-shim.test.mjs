// issue #96：dsh 0.1.1-rc.2 起，宿主注入的 @deepseek-ai/dsh-client-connection 会调
//   const api = fixtureClient ?? transport?.createApiClient() ?? new WebApiClient()
// transport = globalThis.__DSH_TRANSPORT__。经 kmh-remote 代理（手机 / 局域网 / 隧道）
// 访问时宿主给的 transport 不带 createApiClient → TypeError 整页崩。
// 本测试验证代理注入的兜底脚本 TRANSPORT_API_CLIENT_SHIM：
//   - 方法缺失时补一个返回 null 的实现（触发宿主 ?? new WebApiClient() 兜底）
//   - 宿主自己有实现时不覆盖
//   - shim 在宿主赋值之前/之后执行都能生效
//
// issue #58：同一个注入点还承担「远程页面主机信任声明」——远程（局域网 / 公网）页面
// hostname 永远不是回环、又拿不到 Electron 外壳的 transport，DSH 客户端据此把设置
// 镜像退化成 memory，设置→模型 页只剩「settings are unavailable in this browser」。
// 这里同时验证 shim 补上的 ownsHost 能让 DSH 的 isLoopback 判定链得到 true。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContext, runInContext } from 'node:vm';

const { TRANSPORT_API_CLIENT_SHIM, DEFAULT_INJECT } =
  await import('../lib/proxy.mjs');

/** 提取 script 体（vm 只接受纯 JS）。 */
function shimJs() {
  return (
    TRANSPORT_API_CLIENT_SHIM.match(/<script[^>]*>([\s\S]*)<\/script>/)?.[1] ??
    TRANSPORT_API_CLIENT_SHIM
  );
}

/** 建一个模拟浏览器全局（globalThis 指向自身 + 常用内建），先执行 shim。 */
function freshContext() {
  const ctx = { Object, console, Array, Error, TypeError, String, Number };
  ctx.globalThis = ctx;
  ctx.window = ctx;
  createContext(ctx);
  runInContext(shimJs(), ctx);
  return ctx;
}

test('shim：注入内容带判重标记，且已进入默认注入集合', () => {
  assert.ok(
    TRANSPORT_API_CLIENT_SHIM.includes('data-kmh-remote-transport-shim="1"'),
    '带注入判重标记',
  );
  assert.ok(
    DEFAULT_INJECT.includes('data-kmh-remote-transport-shim="1"'),
    '进入 DEFAULT_INJECT',
  );
  assert.ok(
    DEFAULT_INJECT.includes('data-kmh-remote-polyfill="1"'),
    'polyfill 仍保留',
  );
});

test('shim（issue #96）：宿主之后赋值的 transport 缺 createApiClient 时补兜底', () => {
  const ctx = freshContext();
  runInContext('globalThis.__DSH_TRANSPORT__ = { foo: 1 };', ctx); // 宿主模块后跑
  const t = ctx.__DSH_TRANSPORT__;

  assert.equal(t.foo, 1, '不破坏宿主原有属性');
  assert.equal(typeof t.createApiClient, 'function', '补上 createApiClient');
  assert.equal(
    t.createApiClient(),
    null,
    '返回 null → 触发 ?? new WebApiClient()',
  );
  // 模拟宿主那行：fixtureClient ?? transport?.createApiClient() ?? new WebApiClient()
  assert.equal(
    t.createApiClient() ?? 'WebApiClient',
    'WebApiClient',
    '连接层回落到 WebApiClient',
  );
});

test('shim（issue #96）：宿主自带 createApiClient 时绝不覆盖', () => {
  const ctx = freshContext();
  runInContext(
    'globalThis.__DSH_TRANSPORT__ = { createApiClient: function(){ return "REAL"; } };',
    ctx,
  );
  assert.equal(ctx.__DSH_TRANSPORT__.createApiClient(), 'REAL', '保留宿主实现');
});

test('shim（issue #96）：shim 晚于宿主赋值时，已存在的 transport 也会被补', () => {
  const ctx = { Object, console };
  ctx.globalThis = ctx;
  createContext(ctx);
  runInContext('globalThis.__DSH_TRANSPORT__ = { bar: 2 };', ctx); // 宿主先赋值
  runInContext(shimJs(), ctx);
  assert.equal(
    typeof ctx.__DSH_TRANSPORT__.createApiClient,
    'function',
    '补上兜底',
  );
  assert.equal(ctx.__DSH_TRANSPORT__.createApiClient(), null, '返回 null');
});

test('shim（issue #96）：transport 为 undefined / 非对象时不报错', () => {
  const ctx = freshContext();
  assert.equal(
    ctx.__DSH_TRANSPORT__.ownsHost,
    true,
    '未赋值时补一个只声明 ownsHost 的最小 transport',
  );
  assert.equal(
    typeof ctx.__DSH_TRANSPORT__.createApiClient,
    'function',
    'createApiClient 兜底同在',
  );
  runInContext('globalThis.__DSH_TRANSPORT__ = null;', ctx);
  assert.equal(ctx.__DSH_TRANSPORT__, null, 'null 原样透传不抛错');
  runInContext('globalThis.__DSH_TRANSPORT__ = 42;', ctx);
  assert.equal(ctx.__DSH_TRANSPORT__, 42, '非对象不处理');
});

// issue #58：远程（局域网 / 隧道）页面打不开「设置→模型」，因为 DSH 客户端把设置可写
// 与否绑在页面是否 loopback 上，而 isLoopback 的唯一来源就是 transport.ownsHost。
test('shim（issue #58）：远程页面声明 ownsHost，DSH 判定链得到 isLoopback=true', () => {
  const ctx = freshContext();
  const transport = ctx.__DSH_TRANSPORT__;
  assert.equal(transport.ownsHost, true, '宿主没给 transport 时补上 ownsHost');

  // 复刻 @deepseek-ai/dsh-client-connection 的判定（宿主源码原式）：
  //   transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(hostname)
  const decision = runInContext(
    `(() => {
    const isLoopbackHostname = (hostname) => {
      if (hostname === 'localhost' || hostname === '[::1]') return true;
      const parts = hostname.split('.');
      return parts.length === 4 && parts[0] === '127' && parts.every((p) => /^\\d{1,3}$/.test(p) && Number(p) <= 255);
    };
    const transport = globalThis.__DSH_TRANSPORT__;
    const pageLocation = { hostname: '192.168.1.50' }; // 手机 / 隧道进来的页面
    return transport?.ownsHost === true || pageLocation === void 0 || isLoopbackHostname(pageLocation.hostname);
  })()`,
    ctx,
  );
  assert.equal(
    decision,
    true,
    '非回环页面的 isLoopback 为 true（否则设置镜像退化成 memory）',
  );
});

test('shim（issue #58）：宿主自带 transport 时补上 ownsHost 且不动其它字段', () => {
  const ctx = freshContext();
  runInContext(
    'globalThis.__DSH_TRANSPORT__ = { streamBaseUrl: "http://127.0.0.1:3080" };',
    ctx,
  );
  const t = ctx.__DSH_TRANSPORT__;
  assert.equal(t.ownsHost, true, '补上 ownsHost');
  assert.equal(t.streamBaseUrl, 'http://127.0.0.1:3080', '保留宿主原有字段');
  assert.equal(
    typeof t.createApiClient,
    'function',
    'createApiClient 兜底仍在',
  );
});

test('shim（issue #58）：宿主已声明 ownsHost=true 时保持不动（不重复定义）', () => {
  const ctx = freshContext();
  runInContext(
    'globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl: "http://127.0.0.1:3080" };',
    ctx,
  );
  const t = ctx.__DSH_TRANSPORT__;
  assert.equal(t.ownsHost, true, 'ownsHost 仍为 true');
  assert.equal(
    Object.getOwnPropertyDescriptor(t, 'ownsHost').value,
    true,
    '仍是宿主写入的那个值',
  );
});
