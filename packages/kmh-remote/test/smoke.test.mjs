// 真实链路冒烟测试：不注入任何 stub，验证「真实代理转发 + polyfill 注入 + 状态快照 + RPC」。
// 之前的教训：测试全用 stub 会漏掉真实环境才出现的 bug（如 require 崩溃、未处理 rejection）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createPocketService } from '../lib/service.mjs';
import { installPocketRpc } from '../lib/web-rpc.js';
import { POCKET_RPC_CHANNEL, POCKET_ENDPOINTS } from '../client/api.js';

/** 假 dsh web：返回一个简单 HTML 文档（走真实 qrcode / 真实代理，无 stub）。 */
async function fakeUpstream() {
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      '<!doctype html><html><head><title>dsh</title></head><body>real-dsh</body></html>',
    );
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

function fakeCtxConnection() {
  let handler = null;
  const handle = (channel, fn) => {
    assert.equal(channel, POCKET_RPC_CHANNEL);
    handler = fn;
    return () => {
      handler = null;
    };
  };
  return {
    rpc: { handle },
    get handler() {
      return handler;
    },
  };
}

/** 假 dsh web（压缩版）：浏览器若接受 gzip 就返回 gzip 的 HTML —— 复刻 dsh web 的真实行为
 *  （实测首页 41KB 压到 7.5KB）。用来验证注入不会因为上游压缩而整体静默失效。 */
async function fakeCompressingUpstream(seen) {
  const server = createServer((req, res) => {
    const acceptEncoding = String(req.headers['accept-encoding'] ?? '');
    seen.push({
      url: req.url,
      acceptEncoding,
      accept: String(req.headers.accept ?? ''),
    });
    const isAsset = /\.(?:js|css|woff2?)$/i.test(String(req.url));
    const body = Buffer.from(
      isAsset
        ? 'console.log("asset")'
        : '<!doctype html><html><head><title>dsh</title></head><body>real-dsh-gzip</body></html>',
    );
    const type = isAsset
      ? 'application/javascript; charset=utf-8'
      : 'text/html; charset=utf-8';
    if (!isAsset && /\bgzip\b/.test(acceptEncoding)) {
      const gz = gzipSync(body);
      res.writeHead(200, {
        'content-type': type,
        'content-encoding': 'gzip',
        'content-length': String(gz.length),
      });
      res.end(gz);
      return;
    }
    res.writeHead(200, {
      'content-type': type,
      'content-length': String(body.length),
    });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return server;
}

test('真实链路：上游压缩的 HTML 也照样注入（issue #58 的前置条件）', async () => {
  const seen = [];
  const up = await fakeCompressingUpstream(seen);
  const home = await mkdtemp(join(tmpdir(), 'smoke-gzip-'));
  const service = createPocketService({
    dshPort: up.address().port,
    port: 0,
    home,
  });
  try {
    await service.startProxy();
    const st = await service.status();

    // 浏览器文档请求：带 text/html + gzip。上游本会压缩，代理必须先把它降级成 identity，
    // 否则 injectHtml 分支（!isCompressed 才注入）整段跳过 —— polyfill / transport 兜底 /
    // 页内信任声明全都到不了浏览器。
    const doc = await fetch(`http://127.0.0.1:${st.proxyPort}/`, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-encoding': 'gzip, deflate, br',
      },
    });
    const html = await doc.text();
    assert.equal(doc.status, 200);
    assert.ok(html.includes('real-dsh-gzip'), '代理转发到上游');
    assert.ok(html.includes('randomUUID'), '压缩上游下 polyfill 仍被注入');
    const docSeen = seen.find((s) => s.accept.includes('text/html'));
    assert.equal(
      docSeen.acceptEncoding,
      'identity',
      'HTML 文档请求向上游要未压缩形态',
    );

    // 资源请求：不带 text/html → 压缩通道保持不动
    const asset = await fetch(`http://127.0.0.1:${st.proxyPort}/app.js`, {
      headers: { accept: '*/*', 'accept-encoding': 'gzip, deflate, br' },
    });
    await asset.arrayBuffer();
    const assetSeen = seen.find((s) => s.url === '/app.js');
    assert.match(assetSeen.acceptEncoding, /gzip/, 'JS/CSS 资源照常走压缩');
  } finally {
    await service.dispose();
    await new Promise((r) => up.close(r));
    await rm(home, { recursive: true, force: true });
  }
});

test('真实链路：代理转发 + polyfill 注入 + 状态快照（无 stub）', async () => {
  const up = await fakeUpstream();
  const home = await mkdtemp(join(tmpdir(), 'smoke-'));
  const service = createPocketService({
    dshPort: up.address().port,
    port: 0,
    home,
  });
  try {
    await service.startProxy();
    const st = await service.status();
    assert.equal(st.proxyRunning, true);
    assert.ok(st.proxyPort > 0, '拿到真实监听端口');

    // 真实代理转发到假 dsh web，且 HTML 被注入 randomUUID polyfill
    const res = await fetch(`http://127.0.0.1:${st.proxyPort}/`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.ok(html.includes('real-dsh'), '代理转发到上游');
    assert.ok(html.includes('randomUUID'), '非安全上下文 polyfill 已注入');

    // 状态快照：局域网 URL + 真实 qrcode 生成的二维码
    assert.ok(st.lanUrl.startsWith('http://'), '局域网 URL');
    assert.ok(
      st.lanQr.startsWith('data:image/png;base64,'),
      '真实 qrcode 生成的二维码',
    );
  } finally {
    await service.dispose();
    await new Promise((r) => up.close(r));
    await rm(home, { recursive: true, force: true });
  }
});

test('真实链路：RPC status 走真实 service', async () => {
  const up = await fakeUpstream();
  const home = await mkdtemp(join(tmpdir(), 'smoke-rpc-'));
  const service = createPocketService({
    dshPort: up.address().port,
    port: 0,
    home,
  });
  const conn = fakeCtxConnection();
  installPocketRpc(
    { connection: conn },
    { service, log: { error() {}, warn() {} } },
  );
  try {
    await service.startProxy();
    const r = await conn.handler(POCKET_ENDPOINTS.status, {});
    assert.equal(r.ok, true);
    assert.equal(r.value.proxyRunning, true);
    assert.ok(r.value.proxyPort > 0);
    assert.ok(
      r.value.lanQr.startsWith('data:image/png;base64,'),
      'RPC 返回真实二维码',
    );
  } finally {
    await service.dispose();
    await new Promise((r) => up.close(r));
    await rm(home, { recursive: true, force: true });
  }
});

test('client factory 使用宿主 React 模块完成加载', async () => {
  const { readFileSync } = await import('node:fs');
  const { createRequire } = await import('node:module');
  const { runInNewContext } = await import('node:vm');
  const require = createRequire(import.meta.url);
  const source = readFileSync(
    new URL('../lib/client.js', import.meta.url),
    'utf8',
  );
  let exported;
  runInNewContext(source, {
    window: {
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
  assert.equal(exported.name, '@kmh/remote');
  assert.equal(typeof exported.apply, 'function');
});

test('设置页首次读取状态前可正常渲染', async () => {
  const { createRequire } = await import('node:module');
  const { readFileSync } = await import('node:fs');
  const { runInNewContext } = await import('node:vm');
  const require = createRequire(import.meta.url);
  const react = {
    ...require('react'),
    useState: (value) => [value, () => {}],
    useEffect() {},
  };
  let exported;
  runInNewContext(
    readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'),
    {
      URL,
      document: { body: { setAttribute() {} } },
      window: {
        location: { href: 'http://localhost/' },
        matchMedia: () => ({ matches: false }),
        __ModuleLoader__: {
          load: ({ factory }) => {
            exported = factory((name) =>
              name === 'react'
                ? react
                : name === '@deepseek-ai/dsh-client-ui-primitives'
                  ? {}
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
  const initial = settings({ rpcCall() {}, t: (key) => key });
  assert.equal(initial.props.role, 'status');
  assert.equal(initial.props.children, 'loading');
});

test('移动导航 backdrop（issue #38）：点击穿透不抢抽屉内点击 + 抽屉外点击关闭保留', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../lib/client.js', import.meta.url),
    'utf8',
  );
  // CSS：backdrop 必须 pointer-events: none（纯压暗层，不接收点击）
  const css = src.match(/\[data-mobile-nav="backdrop"\][^}]*}/)?.[0] ?? '';
  assert.ok(css.includes('pointer-events: none'), 'backdrop 点击穿透');
  // JSX：backdrop 是纯视觉 div（无 role/onClick）
  assert.ok(
    src.includes('"data-mobile-nav": "backdrop"'),
    'backdrop 纯视觉渲染',
  );
  // 关闭逻辑：抽屉内导航关闭 + 抽屉外点击关闭（两套 document capture contains 处理）
  assert.ok(
    (src.match(/contains\(target\)/g) || []).length >= 2,
    '存在抽屉内外两套点击处理',
  );
  // 抽屉层级（PR #42 / issue #67）：必须高于第三方插件对 shell overlay 层的
  // 抬升（500），也要压过 @linxin666/dsh-web-ui-all 的移动端层（sidebar pane
  // 1100、details pane 1000、frame ::after 全屏遮罩 1050）。
  // 直接断言 bundle 中抽屉规则的 z-index: 1200（若退回 40/600 则此处失败）
  assert.ok(
    src.includes('z-index: 1200 !important'),
    '抽屉 z-index 1200（高于 overlay 抬升 500 与 web-ui-all 的 1100/1050）',
  );
  assert.ok(
    !src.includes('z-index: 40 !important'),
    '不再用 40（会被第三方抬升的 overlay 盖住）',
  );
  assert.ok(
    !src.includes('z-index: 600 !important'),
    '不再用 600（会被 web-ui-all 的 1050 遮罩盖住）',
  );
});

test('文件浏览（issue #48）：宿主无 aionui explorer 时隐藏入口；点 Files 关抽屉', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('../lib/client.js', import.meta.url),
    'utf8',
  );
  // 检测逻辑：frame 打 data-mobile-nav-explorer 标记
  assert.ok(
    src.includes('data-mobile-nav-explorer'),
    '存在 explorer 可用性检测标记',
  );
  // 隐藏 CSS：无 explorer 时隐藏 files/explorer 入口
  assert.ok(
    src.includes('[data-mobile-nav-explorer="0"] [data-mobile-nav="files"]'),
    '无 explorer 隐藏 header Files',
  );
  assert.ok(
    src.includes('[data-mobile-nav-explorer="0"] [data-mobile-nav="explorer"]'),
    '无 explorer 隐藏 drawer 入口',
  );
  // 点 Files 关闭抽屉（抽屉 z600 会盖住 explorer sheet，且 sheet 外点击会被吃掉）
  assert.ok(
    src.includes('[data-mobile-nav="files"]'),
    'Files 纳入抽屉内导航关闭',
  );
});
