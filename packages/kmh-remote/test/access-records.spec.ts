// SAVE-01—08 与 VIEW-05：真实文件、代理及权限边界的参数化场景用例。
import { afterEach, expect, test, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createServer,
  request,
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAccessRecords } from '../host/access-records.ts';
import { MAX_FILE_BYTES, RecordSchema } from '../shared/access-records.ts';
import { createPocketProxy } from '../host/proxy.mjs';
import { installPocketRpc } from '../host/web-rpc.js';
import {
  rejectRemoteRecordsRequest,
  rejectRemoteRecordsUpgrade,
} from '../host/access-records-integration.ts';
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const attempt = (extra = {}) => ({
  peerAddress: '192.0.2.1',
  claimedAddresses: [],
  entryKind: 'public',
  outcome: 'success',
  ...extra,
});
const fixed = () => new Date('2026-10-22T15:08:09.007Z');
async function fixture(options = {}) {
  const home = await fs.mkdtemp(join(tmpdir(), 'kmh-records-'));
  cleanups.push(() => fs.rm(home, { recursive: true, force: true }));
  const store = createAccessRecords({ home, clock: fixed, ...options });
  cleanups.push(() => store.close());
  return { home, store, directory: join(home, 'logs/.kmh-remote') };
}
async function all(store) {
  const records = [];
  let cursor;
  do {
    const page = await store.list(cursor ? { cursor } : {});
    expect(page.ok).toBe(true);
    if (!page.ok) throw Error(page.error.message);
    records.push(...page.value.records);
    cursor = page.value.nextCursor;
  } while (cursor);
  return records;
}
async function proxyFixture(store, options = {}) {
  const upstream = createServer((_req, res) => res.end('upstream-ok'));
  await new Promise<void>((resolve) =>
    upstream.listen(0, '127.0.0.1', resolve),
  );
  cleanups.push(() => new Promise((resolve) => upstream.close(resolve)));
  const port = upstream.address().port;
  const wss = new WebSocketServer({ server: upstream });
  wss.on('connection', (socket) => socket.close());
  cleanups.push(() => new Promise((resolve) => wss.close(resolve)));
  const pending = [];
  const proxy = await createPocketProxy({
    port: 0,
    host: '127.0.0.1',
    upstream: { host: '127.0.0.1', port },
    auth: {
      getToken: () => 'correct88',
      isProtected: () => true,
      sessionKey: 'fixture-session',
    },
    injectHtml: false,
    onPasswordAttempt: (value) => {
      pending.push(store.save(value));
    },
    ...options,
  });
  cleanups.push(() => proxy.close());
  const visit = (
    path = '/',
    pin?: string,
    host = 'remote.example',
    cookie?: string,
    extraHeaders = {},
  ) =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port: proxy.port,
          path,
          method: pin === undefined ? 'GET' : 'POST',
          headers: { host, ...extraHeaders, ...(cookie ? { cookie } : {}) },
        },
        (res) => {
          let body = '';
          res.on('data', (c) => {
            body += c;
          });
          res.on('end', () =>
            resolve({
              status: res.statusCode,
              body,
              cookie: res.headers['set-cookie']?.[0]?.split(';')[0],
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(
        pin === undefined
          ? undefined
          : new URLSearchParams({ token: pin }).toString(),
      );
    });
  return { proxy, visit, pending };
}
async function visitWs(port, path = '/', headers = { host: 'remote.example' }) {
  await new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    socket.on('close', resolve);
    socket.on('error', () => {});
  });
}
test('SAVE-01 每次校验按原结果保存一条', async () => {
  const { store } = await fixture();
  const { visit, pending } = await proxyFixture(store);
  for (const host of ['remote.example', '192.168.1.2']) {
    expect(
      (
        await visit('/pocket-login', 'correct88', host, undefined, {
          'x-forwarded-for': '203.0.113.1, garbage',
          forwarded: 'for="[2001:db8::1]";proto=https',
        })
      ).status,
    ).toBe(302);
    expect((await visit('/pocket-login', 'wrong888', host)).body).toContain(
      '密码错误',
    );
    await visit('/?token=correct88', undefined, host);
    await visit('/?token=wrong888', undefined, host);
  }
  await Promise.all(pending);
  const records = await all(store);
  expect(records).toHaveLength(8);
  expect(records.filter((r) => r.outcome === 'success')).toHaveLength(4);
  expect(new Set(records.map((r) => r.entryKind))).toEqual(
    new Set(['public', 'lan']),
  );
  for (const record of records.filter((r) => r.outcome === 'failure')) {
    expect(record.error.code).toBe('REMOTE_LOGIN_REJECTED');
    expect(record.error.desc).toContain('密码错误');
  }

  const limited = await fixture();
  const limitedProxy = await proxyFixture(limited.store, {
    rateLimit: { maxFailures: 1, windowMs: 60000, lockMs: 60000 },
  });
  await limitedProxy.visit('/pocket-login', 'wrong888');
  await limitedProxy.visit('/pocket-login', 'wrong888');
  await limitedProxy.visit('/?token=wrong888');
  await Promise.all(limitedProxy.pending);
  expect(
    (await all(limited.store)).some(
      (r) => r.outcome === 'failure' && r.error.code === 'REMOTE_LOGIN_LIMITED',
    ),
  ).toBe(true);

  const wsFixture = await fixture();
  const wsProxy = await proxyFixture(wsFixture.store);
  for (const token of ['correct88', 'wrong888'])
    await new Promise((resolve) => {
      const socket = new WebSocket(
        `ws://127.0.0.1:${wsProxy.proxy.port}/?token=${token}`,
        { headers: { host: 'remote.example' } },
      );
      socket.on('close', resolve);
      socket.on('error', () => {});
    });
  await Promise.all(wsProxy.pending);
  expect((await all(wsFixture.store)).map((r) => r.outcome).sort()).toEqual([
    'failure',
    'success',
  ]);
  const large = await fixture();
  const bodyProxy = await proxyFixture(large.store);
  await bodyProxy.visit('/pocket-login', 'x'.repeat(2048)).catch(() => {});
  await Promise.all(bodyProxy.pending);
  expect((await all(large.store))[0].error.code).toBe(
    'REMOTE_LOGIN_BODY_TOO_LARGE',
  );
  const missing = await fixture();
  const missingProxy = await proxyFixture(missing.store);
  missingProxy.proxy.server.prependOnceListener('request', (req) =>
    Object.defineProperty(req.socket, 'remoteAddress', { value: undefined }),
  );
  await missingProxy.visit('/pocket-login', 'correct88');
  await Promise.all(missingProxy.pending);
  expect((await all(missing.store))[0].peerAddress).toBeNull();

  const raced = await fixture();
  const raceProxy = await proxyFixture(raced.store, {
    rateLimit: { maxFailures: 1, lockMs: 60000 },
  });
  let entered;
  const begun = new Promise((resolve) => {
    entered = resolve;
  });
  raceProxy.proxy.server.once('request', () => entered());
  const hanging = new Promise((resolve) => {
    const client = request(
      {
        host: '127.0.0.1',
        port: raceProxy.proxy.port,
        path: '/pocket-login',
        method: 'POST',
        headers: { host: 'remote.example' },
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    client.write('token=wrong888');
    begun.then(async () => {
      await raceProxy.visit('/pocket-login', 'wrong888');
      client.end();
    });
    client.on('error', resolve);
  });
  await hanging;
  await Promise.all(raceProxy.pending);
  expect(
    (await all(raced.store)).some(
      (r) => r.outcome === 'failure' && r.error.code === 'REMOTE_LOGIN_LIMITED',
    ),
  ).toBe(true);
  for (const native of [
    new Error('提交读取原文'),
    Object.assign(new Error('提交读取原文'), { code: 'CUSTOM' }),
  ]) {
    const f = await fixture();
    const q = await proxyFixture(f.store);
    q.proxy.server.prependOnceListener('request', (req) =>
      queueMicrotask(() => req.emit('error', native)),
    );
    await q.visit('/pocket-login', 'correct88');
    await Promise.all(q.pending);
    expect((await all(f.store))[0].error.desc).toBe('提交读取原文');
  }

  const cookieLogin = await wsProxy.visit('/pocket-login', 'correct88');
  await visitWs(wsProxy.proxy.port, '/', {
    host: 'remote.example',
    cookie: cookieLogin.cookie,
  });
  await visitWs(wsProxy.proxy.port, '/?token=correct88', {
    host: '192.168.1.2',
  });
  await visitWs(limitedProxy.proxy.port, '/?token=wrong888');
  await Promise.all(wsProxy.pending);
  await Promise.all(limitedProxy.pending);
  expect(
    (await all(limited.store)).filter(
      (r) => r.outcome === 'failure' && r.error.code === 'REMOTE_LOGIN_LIMITED',
    ).length,
  ).toBeGreaterThan(1);
});
test('SAVE-02 同 IP、同毫秒与并发提交分别保存', async () => {
  const { store } = await fixture();
  const results = await Promise.all(
    Array.from({ length: 21 }, (_, i) =>
      store.save(
        attempt(
          i % 2
            ? { outcome: 'failure', error: { code: 'WRONG', desc: `失败${i}` } }
            : {},
        ),
      ),
    ),
  );
  expect(results.every((r) => r.ok)).toBe(true);
  const records = await all(store);
  expect(records).toHaveLength(21);
  expect(new Set(records.map((r) => r.sequence)).size).toBe(21);
  const concurrent = await fixture();
  const [page, saved] = await Promise.all([
    concurrent.store.list(),
    concurrent.store.save(attempt()),
    concurrent.store.list(),
  ]);
  expect(page.ok).toBe(true);
  expect(saved.ok).toBe(true);
  expect(await all(concurrent.store)).toHaveLength(1);
  const aborted = await fixture();
  const q = await proxyFixture(aborted.store);
  let signal;
  const started = new Promise((resolve) => {
    signal = resolve;
  });
  q.proxy.server.once('request', (req) => {
    signal();
    req.on('aborted', () =>
      req.emit('error', new Error('same attempt second terminal')),
    );
  });
  await new Promise((resolve) => {
    const client = request(
      {
        host: '127.0.0.1',
        port: q.proxy.port,
        path: '/pocket-login',
        method: 'POST',
        headers: { host: 'remote.example' },
      },
      (res) => res.resume(),
    );
    client.on('error', resolve);
    client.write('token=partial');
    started.then(() => client.destroy());
  });
  await vi.waitFor(() => expect(q.pending).toHaveLength(1));
  await Promise.all(q.pending);
  expect((await all(aborted.store))[0].error.code).toBe('REMOTE_LOGIN_ABORTED');
});
test('SAVE-03 自动通过、页面及业务活动保持计数', async () => {
  const { store } = await fixture();
  const { visit, pending } = await proxyFixture(store);
  const login = await visit('/pocket-login', 'correct88');
  await Promise.all(pending);
  expect(await all(store)).toHaveLength(1);
  for (const path of ['/', '/assets/a.js', '/message', '/']) {
    await visit(path, undefined, 'remote.example', login.cookie);
    expect(await all(store)).toHaveLength(1);
  }
  await visit('/pocket-login', 'correct88');
  await Promise.all(pending);
  expect(await all(store)).toHaveLength(2);
});
test('SAVE-04 格式、原始错误、时区及摘要字段完整', async () => {
  const { store, directory } = await fixture();
  const desc = '原始中文\n"引号"\\路径<原文>';
  await store.save(
    attempt({
      outcome: 'failure',
      error: { code: 'ORIGINAL', desc },
      claimedAddresses: [{ address: '203.0.113.1', trust: 'unverified' }],
      password: 'private-pin',
      cookie: 'private-cookie',
    }),
  );
  const [record] = await all(store);
  expect(RecordSchema.parse(record).occurredAt).toMatch(/\.007[+-]\d\d:\d\d$/);
  expect(record.error).toEqual({ code: 'ORIGINAL', desc });
  const raw = (
    await Promise.all(
      (await fs.readdir(directory)).map((f) =>
        fs.readFile(join(directory, f), 'utf8'),
      ),
    )
  ).join('');
  expect(raw).not.toContain('private-pin');
  expect(raw).not.toContain('private-cookie');
  expect(record.claimedAddresses[0].trust).toBe('unverified');

  for (const ms of [0, 1, 999]) {
    const f = await fixture({
      clock: () => new Date(Date.UTC(2026, 9, 22, ms === 0 ? 0 : 23, 1, 2, ms)),
    });
    await f.store.save(
      attempt({ peerAddress: null, sourceNote: '实际访问者来源无法确认' }),
    );
    expect((await all(f.store))[0].occurredAt).toContain(
      '.' + String(ms).padStart(3, '0'),
    );
  }
  const realClock = await fixture();
  const realtime = createAccessRecords({ home: realClock.home });
  cleanups.push(() => realtime.close());
  expect((await realtime.save(attempt())).ok).toBe(true);

  const west = await fixture({
    clock: () => {
      const value = fixed();
      Object.defineProperty(value, 'getTimezoneOffset', { value: () => 300 });
      return value;
    },
  });
  await west.store.save(attempt());
  expect((await all(west.store))[0].occurredAt).toMatch(/-05:00$/);
  const zone = await fixture();
  const moduleUrl = new URL('../host/access-records.ts', import.meta.url).href;
  const child = async (timeZone, save) =>
    JSON.parse(
      (
        await promisify(execFile)(
          process.execPath,
          [
            '--input-type=module',
            '-e',
            `import {createAccessRecords} from ${JSON.stringify(moduleUrl)}; const store=createAccessRecords({home:process.argv[1],clock:()=>new Date('2026-10-22T15:08:09.007Z')}); if(process.argv[2]==='save')await store.save(${JSON.stringify(attempt())}); console.log(JSON.stringify(await store.list())); await store.close();`,
            zone.home,
            save ? 'save' : 'read',
          ],
          { env: { ...process.env, TZ: timeZone } },
        )
      ).stdout,
    );
  const original = await child('Asia/Shanghai', true);
  const after = await child('America/New_York', true);
  expect(original.value.records[0].occurredAt).toBe(
    '2026-10-22T23:08:09.007+08:00',
  );
  expect(after.value.records[1]).toEqual(original.value.records[0]);
  expect(after.value.records[0].occurredAt).toBe(
    '2026-10-22T11:08:09.007-04:00',
  );
  expect(after.value.records[0].timeZone).toBe('America/New_York');
});
test('SAVE-05 全新 Home、重载重启及历史长期保留', async () => {
  const { store, home, directory } = await fixture();
  await store.save(attempt());
  await store.close();
  const originals = await Promise.all(
    (await fs.readdir(directory)).map((f) =>
      fs.readFile(join(directory, f), 'utf8'),
    ),
  );
  const reopened = createAccessRecords({
    home,
    clock: () => new Date('2027-12-23T01:00:00Z'),
  });
  cleanups.push(() => reopened.close());
  expect(await all(reopened)).toHaveLength(1);
  await reopened.save(attempt());
  expect(await all(reopened)).toHaveLength(2);
  const other = await fixture();
  expect(await all(other.store)).toHaveLength(0);
  await other.store.save(attempt());
  expect(await all(other.store)).toHaveLength(1);
  expect(
    (
      await fs.readFile(
        join(directory, (await fs.readdir(directory))[0]),
        'utf8',
      )
    ).startsWith(originals[0]),
  ).toBe(true);

  const catalog = await fixture();
  await fs.mkdir(catalog.directory, { recursive: true });
  const template = {
    version: 1,
    sequence: '1',
    occurredAt: '2026-10-22T23:08:09.007+08:00',
    timeZone: 'Asia/Shanghai',
    event: 'password-attempt',
    ...attempt(),
  };
  for (const [name, seq] of [
    ['2020-01-01.log', '2'],
    ['2020-01-02.log', '1'],
    ['2020-01-03.log', '3'],
  ])
    await fs.writeFile(
      join(catalog.directory, name),
      JSON.stringify({ ...template, sequence: seq }) + '\n',
    );
  await fs.writeFile(join(catalog.directory, 'notes.txt'), '保留');
  await fs.writeFile(join(catalog.directory, '2020-01-04.log'), '');
  await fs.writeFile(join(catalog.directory, '2020-01-05.log'), '');
  const rebuilt = createAccessRecords({ home: catalog.home, clock: fixed });
  cleanups.push(() => rebuilt.close());
  expect((await all(rebuilt)).map((r) => r.sequence)).toEqual(['3', '2', '1']);
  await fs.writeFile(
    join(catalog.directory, '2020-01-06.log'),
    JSON.stringify({ ...template, sequence: '4' }) + '\n' + 'partial',
  );
  const incomplete = createAccessRecords({ home: catalog.home, clock: fixed });
  cleanups.push(() => incomplete.close());
  expect((await incomplete.list()).value.saveError.code).toBe(
    'REMOTE_RECORD_INCOMPLETE',
  );
  expect((await incomplete.save(attempt())).ok).toBe(true);

  const partialOnly = await fixture();
  await fs.mkdir(partialOnly.directory, { recursive: true });
  await fs.writeFile(join(partialOnly.directory, '2020-01-01.log'), 'partial');
  expect((await partialOnly.store.list()).value.records).toHaveLength(0);
  expect((await partialOnly.store.save(attempt())).ok).toBe(true);

  // 实际 Host 挂载及服务生命周期；监听替身仅隔离端口，记录器仍执行真实文件写入。
  const lifecycle = await fixture();
  vi.stubEnv('DSH_HOME', lifecycle.home);
  let created;
  let mounted;
  const disposers = [];
  const { apply, resetPocketState } = await import('../host/index.js');
  apply(
    {
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
      webServer: { port: 1 },
      connection: {
        rpc: {
          handle: (_channel, fn) => {
            mounted = fn;
            return () => {};
          },
        },
      },
      effect: (fn) => disposers.push(fn()),
    },
    {},
    {
      dshPort: 1,
      createProxy: async (options) => {
        created = options;
        return { port: 1, close: async () => {} };
      },
    },
  );
  await vi.waitFor(() => expect(created).toBeTruthy());
  await created.onPasswordAttempt(attempt());
  await created.onPasswordAttempt({});
  const savedBefore = await fs.readFile(
    join(lifecycle.directory, (await fs.readdir(lifecycle.directory))[0]),
  );
  resetPocketState();
  expect(
    await fs.readFile(
      join(lifecycle.directory, (await fs.readdir(lifecycle.directory))[0]),
    ),
  ).toEqual(savedBefore);
  for (const dispose of disposers) await dispose();
  vi.unstubAllEnvs();
  const noHomeDisposers = [];
  vi.stubEnv('DSH_HOME', undefined);
  apply(
    {
      logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
      connection: { rpc: { handle: () => () => {} } },
      effect: (fn) => noHomeDisposers.push(fn()),
    },
    {},
    {
      dshPort: 1,
      service: {
        startProxy: async () => ({ port: 1 }),
        dispose: async () => {},
      },
    },
  );
  for (const dispose of noHomeDisposers) await dispose();
  vi.unstubAllEnvs();
  const { createPocketService } = await import('../host/service.mjs');
  const oldService = createPocketService({
    dshPort: 1,
    internals: {
      createProxy: async (options) => {
        expect(options.onPasswordAttempt).toBeNull();
        return { port: 1, close: async () => {} };
      },
    },
  });
  await oldService.startProxy();
  await oldService.dispose();
});
test('SAVE-06 字节阈值、同日命名、跨日与并发分文件', async () => {
  for (const target of [
    MAX_FILE_BYTES - 1,
    MAX_FILE_BYTES,
    MAX_FILE_BYTES + 1,
  ]) {
    const { store, directory } = await fixture();
    await store.save(attempt());
    const file = join(directory, (await fs.readdir(directory))[0]);
    const old = await fs.readFile(file, 'utf8');
    const first = JSON.parse(old);
    const secondBytes = Buffer.byteLength(
      JSON.stringify({ ...first, sequence: '2' }) + '\n',
    );
    first.sourceNote = '';
    const baseBytes = Buffer.byteLength(JSON.stringify(first) + '\n');
    first.sourceNote = '中'.repeat(
      Math.floor((target - secondBytes - baseBytes) / 3),
    );
    const row = JSON.stringify(first) + '\n';
    const filled =
      row.trimEnd() +
      ' '.repeat(target - secondBytes - Buffer.byteLength(row)) +
      '\n';
    await fs.writeFile(file, filled);
    await store.close();
    const reopened = createAccessRecords({
      home: directory.replace(/\/logs\/\.kmh-remote$/, ''),
      clock: fixed,
    });
    cleanups.push(() => reopened.close());
    await reopened.save(attempt());
    expect((await fs.readdir(directory)).length).toBe(
      target <= MAX_FILE_BYTES ? 1 : 2,
    );
    for (const name of await fs.readdir(directory))
      expect((await fs.stat(join(directory, name))).size).toBeLessThanOrEqual(
        MAX_FILE_BYTES,
      );
  }
  const boundary = await fixture();
  await boundary.store.save(attempt({ sourceNote: '' }));
  const old = (await all(boundary.store))[0];
  const padding =
    MAX_FILE_BYTES - Buffer.byteLength(JSON.stringify(old) + '\n');
  const exact = await fixture();
  const exactAttempt = attempt({ sourceNote: 'x'.repeat(padding) });
  expect((await exact.store.save(exactAttempt)).ok).toBe(true);
  const file = join(exact.directory, (await fs.readdir(exact.directory))[0]);
  expect((await fs.stat(file)).size).toBe(MAX_FILE_BYTES);
  await exact.store.close();
  let date = new Date('2026-10-22T15:08:09.007Z');
  const rotated = createAccessRecords({ home: exact.home, clock: () => date });
  cleanups.push(() => rotated.close());
  expect((await rotated.save(exactAttempt)).ok).toBe(true);
  expect((await fs.readdir(exact.directory)).sort()).toEqual([
    '2026-10-22.log',
    '2026-10-22_1.log',
  ]);
  date = new Date('2026-10-23T15:08:09.007Z');
  await Promise.all([rotated.save(exactAttempt), rotated.save(attempt())]);
  expect((await fs.readdir(exact.directory)).sort()).toEqual([
    '2026-10-22.log',
    '2026-10-22_1.log',
    '2026-10-23.log',
    '2026-10-23_1.log',
  ]);
  date = new Date('2026-10-24T15:08:09.007Z');
  await rotated.save(attempt());
  expect(await fs.readdir(exact.directory)).toHaveLength(4);
  expect(await all(rotated)).toHaveLength(5);
});
test('SAVE-07 超大单条拒绝，随后正常保存', async () => {
  const prototype = await fixture();
  await prototype.store.save(attempt({ sourceNote: '' }));
  const prototypeBytes = Buffer.byteLength(
    JSON.stringify((await all(prototype.store))[0]) + '\n',
  );
  for (const existing of [false, true])
    for (const length of [
      MAX_FILE_BYTES - prototypeBytes + 1,
      MAX_FILE_BYTES,
    ]) {
      const { store, directory } = await fixture();
      if (existing) await store.save(attempt());
      const before = await fs.readdir(directory).catch(() => []);
      const originals = await Promise.all(
        before.map((name) => fs.readFile(join(directory, name))),
      );
      const result = await store.save(
        attempt({ sourceNote: 'x'.repeat(length) }),
      );
      expect(result.ok).toBe(false);
      expect(result.error.code).toBe('REMOTE_RECORD_TOO_LARGE');
      if (length < MAX_FILE_BYTES)
        expect(result.error.desc).toContain('10000001');
      expect(
        await Promise.all(
          before.map((name) => fs.readFile(join(directory, name))),
        ),
      ).toEqual(originals);
      expect(await fs.readdir(directory).catch(() => [])).toEqual(before);
      expect((await store.save(attempt())).ok).toBe(true);
    }
});
test('SAVE-08 保存故障原文可见，恢复保留原历史', async () => {
  let failing = true;
  const injected = {
    ...fs,
    mkdir: (...args) => {
      if (failing)
        return Promise.reject(
          Object.assign(new Error('原始写入错误\n细节'), { code: 'EACCES' }),
        );
      return fs.mkdir(...args);
    },
  };
  const { store } = await fixture({ fs: injected });
  const result = await store.save(attempt());
  expect(result.ok).toBe(false);
  const failed = await store.list({});
  expect(failed.value.saveError).toMatchObject({
    code: 'EACCES',
    desc: '原始写入错误\n细节',
  });
  failing = false;
  expect((await store.save(attempt())).ok).toBe(true);
  const restored = await store.list({});
  expect(restored.value.recovered).toBe(true);
  expect(restored.value.saveError.code).toBe('EACCES');

  for (const native of [
    Object.assign(new Error('native'), { code: 'CUSTOM' }),
    new Error('no code'),
    '原始抛出值',
  ]) {
    let fault = true;
    const f = await fixture({
      fs: {
        ...fs,
        mkdir: (...args) =>
          fault ? Promise.reject(native) : fs.mkdir(...args),
      },
      log: () => {
        throw Error('logger failure');
      },
    });
    expect((await f.store.save(attempt())).ok).toBe(false);
    fault = false;
    expect((await f.store.save(attempt())).ok).toBe(true);
    expect((await f.store.list()).value.saveError.desc).toBe(
      typeof native === 'string' ? native : native.message,
    );
  }
  for (const operation of [
    'open',
    'write',
    'sync',
    'close',
    'zero',
    'short',
    'lstat',
    'lstat-new',
    'readdir',
    'stat',
    'read',
  ]) {
    let fault = false;
    let fired = false;
    const injected = {
      ...fs,
      lstat: async (...args) => {
        if (
          fault &&
          (operation === 'lstat' || (operation === 'lstat-new' && fired))
        )
          return fs.stat(process.execPath);
        if (operation === 'lstat-new') fired = true;
        return fs.lstat(...args);
      },
      readdir: async (...args) => {
        if (fault && operation === 'readdir')
          throw Object.assign(new Error('readdir original'), { code: 'EIO' });
        return fs.readdir(...args);
      },
      open: async (...args) => {
        if (fault && operation === 'open')
          throw Object.assign(new Error('open original'), { code: 'EIO' });
        const h = await fs.open(...args);
        const write = h.write.bind(h),
          sync = h.sync.bind(h),
          close = h.close.bind(h),
          read = h.read.bind(h),
          stat = h.stat.bind(h);
        h.write = async (...values) => {
          if (fault && operation === 'write')
            throw Object.assign(new Error('write original'), { code: 'EIO' });
          if (fault && operation === 'zero')
            return { bytesWritten: 0, buffer: values[0] };
          if (fault && operation === 'short' && !fired) {
            fired = true;
            return write(values[0], values[1], 1, values[3]);
          }
          return write(...values);
        };
        h.sync = async () => {
          if (fault && operation === 'sync') throw Error('sync original');
          return sync();
        };
        h.close = async () => {
          await close();
          if (fault && operation === 'close') throw Error('close original');
        };
        h.read = async (...values) => {
          if (fault && operation === 'read')
            return { bytesRead: 0, buffer: values[0] };
          return read(...values);
        };
        h.stat = async () => {
          if (fault && operation === 'stat') return fs.stat(tmpdir());
          return stat();
        };
        return h;
      },
    };
    const f = await fixture({ fs: injected });
    if (['lstat', 'readdir', 'stat', 'read'].includes(operation)) {
      await fs.mkdir(f.directory, { recursive: true });
      await fs.writeFile(
        join(f.directory, '2020-01-01.log'),
        JSON.stringify({
          version: 1,
          sequence: '1',
          occurredAt: '2026-10-22T23:08:09.007+08:00',
          timeZone: 'Asia/Shanghai',
          event: 'password-attempt',
          ...attempt(),
        }) + '\n',
      );
    }
    fault = true;
    const result = await f.store.save(attempt());
    expect(result.ok).toBe(operation === 'short');
    fault = false;
    expect((await f.store.save(attempt())).ok).toBe(true);
  }
  const afterClose = await fixture();
  await afterClose.store.close();
  expect((await afterClose.store.save(attempt())).ok).toBe(false);
  expect((await afterClose.store.list()).ok).toBe(false);

  for (const asynchronous of [false, true]) {
    const f = await fixture();
    const errors = [];
    const broken = await proxyFixture(f.store, {
      onPasswordAttempt: () => {
        if (asynchronous) return Promise.reject(new Error('callback failed'));
        throw new Error('callback failed');
      },
      log: (message) => errors.push(message),
    });
    expect((await broken.visit('/pocket-login', 'correct88')).status).toBe(302);
    await vi.waitFor(() => expect(errors.length).toBeGreaterThan(0));
  }
  const disabled = await fixture();
  const disabledProxy = await proxyFixture(disabled.store, {
    onPasswordAttempt: null,
  });
  await disabledProxy.visit('/pocket-login', 'correct88');
});
test('VIEW-05 本机授权可读，远程及无上下文拒绝', async () => {
  const source = new Socket();
  const noPath = new IncomingMessage(source);
  noPath.url = undefined;
  const response = new ServerResponse(noPath);
  const upgrade = new PassThrough();
  expect(rejectRemoteRecordsRequest(noPath, response)).toBe(false);
  expect(rejectRemoteRecordsUpgrade(noPath, upgrade)).toBe(false);
  response.destroy();
  source.destroy();
  upgrade.destroy();
  const { store } = await fixture();
  await store.save(attempt());
  const reads = vi.spyOn(store, 'list');
  let handler;
  installPocketRpc(
    {
      connection: {
        rpc: {
          handle: (_channel, callback) => {
            handler = callback;
            return () => {};
          },
        },
      },
    },
    { service: { status: () => ({ state: 'fixture' }) }, records: store },
  );
  const denied = await handler('records.list', {});
  expect(denied.ok).toBe(false);
  expect(denied.error.code).toBe('REMOTE_RECORD_LOCAL_CONTEXT_REQUIRED');
  const { visit } = await proxyFixture(store);
  for (const path of [
    '/kmh-remote/records.list',
    '/kmh-remote/%72ecords.list',
    '/kmh-remote/%2572ecords.list',
    '/kmh-remote/records.list%',
  ]) {
    const response = await visit(path);
    expect(response.status).toBe(403);
    expect(response.body).toContain('REMOTE_RECORD_LOCAL_ONLY');
  }

  expect(reads).not.toHaveBeenCalled();
  for (const symbolic of [false, true]) {
    const f = await fixture();
    await fs.mkdir(f.directory, { recursive: true });
    const file = join(f.directory, '2020-01-01.log');
    if (symbolic) await fs.symlink(process.execPath, file);
    else await fs.mkdir(file);
    const result = await f.store.list();
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe('REMOTE_RECORD_PATH_INVALID');
  }

  for (const configured of [true, false]) {
    let route;
    installPocketRpc(
      {
        webServer: {
          register: (value) => {
            route = value;
            return () => {};
          },
        },
        connection: { requestRejection: () => undefined },
      },
      { service: {}, records: configured ? store : null },
    );
    let override = false;
    let address;
    const host = createServer((req, res) => {
      if (override)
        Object.defineProperty(req.socket, 'remoteAddress', {
          value: address,
          configurable: true,
        });
      route.handler(req, res).catch((error) => {
        res.statusCode = 500;
        res.end(error.message);
      });
    });
    await new Promise((resolve) => host.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => new Promise((resolve) => host.close(resolve)));
    for (const [payload, peer] of [
      [{}, '127.0.0.1'],
      [{}, '::1'],
      [{}, undefined],
      [{}, '203.0.113.1'],
      [{ cursor: 123 }, '127.0.0.1'],
    ]) {
      override = true;
      address = peer;
      const readsBefore = reads.mock.calls.length;
      const response = await fetch(
        `http://127.0.0.1:${host.address().port}/kmh-remote/records.list`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', connection: 'close' },
          body: JSON.stringify({
            rpcId: 'records-fixture',
            method: 'records.list',
            payload,
          }),
        },
      );
      const body = await response.json();
      expect(body.result.ok).toBe(
        configured &&
          typeof payload.cursor !== 'number' &&
          (peer === '127.0.0.1' || peer === '::1'),
      );
      expect(reads.mock.calls.length - readsBefore).toBe(
        body.result.ok ? 1 : 0,
      );
    }
  }
  expect(
    (
      await handler('records.list', {}, undefined, {
        local: false,
        authenticated: true,
      })
    ).error.code,
  ).toBe('REMOTE_RECORD_LOCAL_ONLY');

  for (const body of [
    JSON.stringify({
      rpcId: 'permission-fixture',
      method: 'records.list',
      payload: {},
    }),
    '{}',
    'invalid',
    'x'.repeat(5000),
  ]) {
    const response = await fetch(
      `http://127.0.0.1:${(await proxyFixture(store)).proxy.port}/kmh-remote/records.list`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body },
    );
    const result = await response.json();
    expect(response.status).toBe(200);
    expect(result.result.error).toMatchObject({
      code: 'REMOTE_RECORD_LOCAL_ONLY',
      details: { desc: '访问记录仅供电脑本机查看' },
    });
  }

  expect((await handler('pocket.status', {})).ok).toBe(true);
  const publicProxy = await proxyFixture(store);
  await visitWs(publicProxy.proxy.port, '/kmh-remote/records.list');
  const stream = await proxyFixture(store);
  let entered;
  const dataArrived = new Promise((resolve) => {
    entered = resolve;
  });
  stream.proxy.server.once('request', (req) =>
    req.once('data', () => entered()),
  );
  await new Promise((resolve) => {
    const client = request(
      {
        host: '127.0.0.1',
        port: stream.proxy.port,
        path: '/kmh-remote/records.list',
        method: 'POST',
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    client.write('x'.repeat(5000));
    dataArrived.then(() => client.end('tail'));
    client.on('error', resolve);
  });
  stream.proxy.server.prependOnceListener('request', (req) =>
    queueMicrotask(() => req.emit('error', new Error('query transport error'))),
  );
  await fetch(`http://127.0.0.1:${stream.proxy.port}/kmh-remote/records.list`, {
    method: 'POST',
    body: '{}',
  }).catch(() => {});
  expect(reads).toHaveBeenCalledTimes(2);
});
