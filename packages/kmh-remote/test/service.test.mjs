// frp 接入下的本地代理状态、固定端口与资源生命周期。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createPocketService,
  selectLanIPv4,
  parseIpconfig,
  qrDataUrl,
} from '../lib/service.mjs';
import { installPocketRpc } from '../lib/web-rpc.js';
import { POCKET_ENDPOINTS } from '../client/api.js';

test('固定本地端口与外部 frp 地址分别生成二维码，URL 变化刷新缓存', async (t) => {
  let publicUrl = 'https://remote.example.com/';
  let calls = 0;
  let options;
  const service = createPocketService({
    dshPort: 60000,
    getPublicUrl: () => publicUrl,
    internals: {
      createProxy: async (value) => {
        options = value;
        return { port: value.port, close: async () => {} };
      },
      lanIPv4: () => '192.168.1.8',
      lanCandidates: () => ['192.168.1.8'],
      encodeQr: async (url) => {
        calls++;
        return `qr:${url}`;
      },
    },
  });
  t.after(() => service.dispose());
  await service.startProxy();
  assert.equal(options.port, 60001);
  assert.equal(options.upstream.port, 60000);
  const first = await service.status();
  assert.equal(first.lanUrl, 'http://192.168.1.8:60001');
  assert.equal(first.publicQr, 'qr:https://remote.example.com/');
  await service.status();
  assert.equal(calls, 2);
  publicUrl = 'https://other.example.com/';
  assert.equal(
    (await service.status()).publicQr,
    'qr:https://other.example.com/',
  );
  assert.equal(calls, 3);
  assert.equal('startTunnel' in service, false);
});

test('frp 使用固定端口，冲突时一次失败并保留原始错误', async () => {
  let calls = 0;
  const failure = Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
  const service = createPocketService({
    internals: {
      createProxy: async () => {
        calls++;
        throw failure;
      },
    },
  });
  await assert.rejects(service.startProxy(), (error) => error === failure);
  assert.equal(calls, 1);
  await service.dispose();
});

test('并发启动共享监听，卸载等待在途启动释放，重复卸载只关闭一次', async () => {
  let resolveProxy;
  let calls = 0;
  let closed = 0;
  const ready = new Promise((resolve) => {
    resolveProxy = resolve;
  });
  const service = createPocketService({
    internals: {
      createProxy: () => {
        calls++;
        return ready;
      },
    },
  });
  const first = service.startProxy();
  const second = service.startProxy();
  const outcomes = Promise.allSettled([first, second]);
  await Promise.resolve();
  const disposing = service.dispose();
  resolveProxy({
    port: 60001,
    close: async () => {
      closed++;
    },
  });
  await disposing;
  assert.equal(calls, 1);
  assert.equal(closed, 1);
  assert.ok((await outcomes).every((entry) => entry.status === 'rejected'));
  await service.dispose();
  assert.equal(closed, 1);
  await assert.rejects(service.startProxy(), /卸载/);
});

test('公网 URL RPC 返回完整状态，旧隧道端点保持关闭', async () => {
  let handler;
  let publicUrl = '';
  const ctx = {
    connection: {
      rpc: {
        handle: (_channel, value) => {
          handler = value;
          return () => {};
        },
      },
    },
  };
  const dispose = installPocketRpc(ctx, {
    service: { status: async () => ({ publicUrl }) },
    setPublicUrl: (url) => {
      publicUrl = url;
    },
  });
  const result = await handler(POCKET_ENDPOINTS.publicSetUrl, {
    url: 'https://remote.example.com/',
  });
  assert.equal(result.value.publicUrl, publicUrl);
  assert.equal((await handler('tunnel.start', { disclaimer: true })).ok, false);
  dispose();
});

test('二维码与网卡选择保留原有核心行为', async () => {
  assert.match(
    await qrDataUrl('https://remote.example.com/'),
    /^data:image\/png;base64,/,
  );
  const interfaces = {
    utun0: [{ family: 'IPv4', internal: false, address: '26.1.1.1' }],
    en0: [{ family: 'IPv4', internal: false, address: '192.168.1.8' }],
  };
  assert.equal(selectLanIPv4(interfaces), '192.168.1.8');
  assert.equal(selectLanIPv4({}), null);
  assert.ok(Array.isArray(parseIpconfig('')));
});
