/** 通过真实 KMH Web 入口验证源码编译、同进程插件重载和页面 rebuilt 通知。 */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { root } from '../../scripts/kmh.mjs';
import { loadOverlayPatches } from '../../third_party/dsh/packages/boot/app-boot/lib/index.js';

/** 等待可观察状态；超时抛出本次断言的说明。 */
async function until(check, message) {
  for (let i = 0; i < 600; i++) {
    const value = check();
    if (value) return value;
    await delay(100);
  }
  assert.fail(message());
}

/** 向主机申请空闲本地端口；失败向调用者传播。 */
async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('真实 Web 连续应用插件源码并推送页面更新，服务 PID 保持一致', { timeout: 120000 }, async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kmh-web-hmr-')));
  const home = join(dir, 'home');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['scripts', 'third_party', 'packages', 'profiles']) mkdirSync(join(dir, name));
  symlinkSync(join(root, 'third_party/dsh'), join(dir, 'third_party/dsh'), 'dir');
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
  for (const name of ['kmh.mjs', 'plugin-watch.mjs', 'runtime-home.mjs', 'runtime-logs.mjs']) cpSync(join(root, 'scripts', name), join(dir, 'scripts', name));
  cpSync(join(root, 'launch.config.json'), join(dir, 'launch.config.json'));
  for (const name of ['kmh-echo', 'zcode-cli']) {
    const source = join(root, 'packages', name);
    const target = join(dir, 'packages', name);
    mkdirSync(target);
    for (const file of ['src', 'vendor', 'package.json', 'tsconfig.json', 'tsconfig.host.json', 'tsconfig.browser.json', 'build.mjs']) {
      if (existsSync(join(source, file))) cpSync(join(source, file), join(target, file), { recursive: true });
    }
    symlinkSync(join(source, 'node_modules'), join(target, 'node_modules'), 'dir');
  }
  for (const name of ['codex-cli', 'runtime-log', 'web-surface-zh', 'kmh-dev-preset']) symlinkSync(join(root, 'packages', name), join(dir, 'packages', name), 'dir');
  const port = await freePort();
  for (const name of ['kmh-web', 'kmh-headless', 'kmh-sdk']) {
    const target = join(dir, 'profiles', name);
    mkdirSync(target);
    const manifest = name === 'kmh-web' ? JSON.parse(readFileSync(join(root, 'profiles/kmh-web/package.json'), 'utf8')) : { name: `@kmh/${name}`, dependencies: {} };
    manifest.dsh = { profile: { bundles: [] } };
    delete manifest.dependencies['dsh-context'];
    writeFileSync(join(target, 'package.json'), JSON.stringify(manifest));
    writeFileSync(join(target, 'cordis.yml'), '[]\n');
    writeFileSync(join(target, 'cordis.patch.yml'), name === 'kmh-web' ? readFileSync(join(root, 'profiles/kmh-web/cordis.patch.yml'), 'utf8').replace('port: 3080', `port: ${port}`) : '[]\n');
  }
  const webRuntime = loadOverlayPatches('test', join(dir, 'profiles/kmh-web/cordis.patch.yml')).flatMap(patch => patch.insert ?? []).find(entry => entry.id === 'web-runtime');
  assert.equal(webRuntime.config.openBrowser.__jsExpr, 'ctx.webStartup.openBrowser', 'Web 配置必须接收 --no-open 的启动值');
  const echoSource = join(dir, 'packages/kmh-echo/src/index.ts');
  const echo = readFileSync(echoSource, 'utf8');
  writeFileSync(echoSource, echo.replaceAll('"apply"', '"apply-v1"'));
  const child = spawn(process.execPath, [join(dir, 'scripts/kmh.mjs'), 'web', '--no-open'], {
    cwd: dir, env: { ...process.env, KMH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const exited = new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal })));
  t.after(async () => { child.kill('SIGTERM'); await exited; });
  const diagnostics = () => output.replace(/token=[^\s]+/g, 'token=<redacted>');
  await until(() => output.match(/dsh web: (http:\/\/[^\s]+)/)?.[1], () => diagnostics());
  const logDir = join(home, 'logs/kmh-echo');
  const log = await until(() => existsSync(logDir) && readdirSync(logDir).find(name => name.startsWith('events-')), () => diagnostics());
  const events = () => readFileSync(join(logDir, log), 'utf8');
  assert.match(events(), /apply-v1/);
  const pid = Number(log.match(/events-(\d+)/)[1]);
  writeFileSync(echoSource, echo.replaceAll('"apply"', '"apply-v2"'));
  await until(() => events().includes('apply-v2'), () => diagnostics() + events());
  assert.equal(events().match(/unload/g)?.length, 1);
  writeFileSync(echoSource, echo.replaceAll('"apply"', '"apply-v3"'));
  await until(() => events().includes('apply-v3'), () => diagnostics() + events());
  assert.equal(events().match(/unload/g)?.length, 2);
  assert.deepEqual(readdirSync(logDir), [log]);
  process.kill(pid, 0);

  const url = new URL(output.match(/dsh web: (http:\/\/[^\s]+)/)[1]);
  url.pathname = '/plugins/events';
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(url, { signal: controller.signal });
  assert.equal(response.status, 200);
  let frames = '';
  const stream = (async () => { try { for await (const data of response.body) frames += new TextDecoder().decode(data); } catch (error) { if (!controller.signal.aborted) throw error; } })();
  await until(() => frames.includes('"type":"graph"'), () => frames);
  const clientSource = join(dir, 'packages/zcode-cli/src/client/index.ts');
  const page = readFileSync(clientSource, 'utf8');
  writeFileSync(clientSource, page + '\nexport const kmhHmrProbe = "page-v2";\n');
  await until(() => frames.includes('"type":"rebuilt","id":"@kmh/zcode-cli"'), () => diagnostics() + frames);
  assert.match(readFileSync(join(dir, 'packages/zcode-cli/lib/client.js'), 'utf8'), /page-v2/);
  controller.abort();
  await stream;
  child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 0, signal: null });
  assert.doesNotMatch(output, /dsh web: opening the default browser/);
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  const artifact = readFileSync(join(dir, 'packages/kmh-echo/lib/index.js'), 'utf8');
  writeFileSync(echoSource, echo.replaceAll('"apply"', '"after-stop"'));
  await delay(600);
  assert.equal(readFileSync(join(dir, 'packages/kmh-echo/lib/index.js'), 'utf8'), artifact);
});
