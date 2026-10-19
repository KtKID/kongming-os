/** 通过真实 KMH Web 入口验证保存源码保持产物、手动编译和同进程插件重载。 */
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { root } from '../../scripts/kmh.mjs';
import { loadOverlayPatches } from '../../third_party/dsh/packages/boot/app-boot/lib/index.js';
const require = createRequire(import.meta.url);

/** 显式运行包的单次构建；编译失败保留诊断，超时按失败报告。 */
function buildPackage(dir, name) {
  const args = name === 'kmh-echo' ? [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'] : ['build.mjs'];
  const result = spawnSync(process.execPath, args, { cwd: join(dir, 'packages', name), encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

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

test('保存源码保持现有代码，手动构建后 Web 连续热重载并更新页面', { timeout: 120000 }, async t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kmh-web-hmr-')));
  const home = join(dir, 'home');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const name of ['scripts', 'third_party', 'packages', 'profiles', 'bundles']) mkdirSync(join(dir, name));
  cpSync(join(root, 'bundles/dsh-web'), join(dir, 'bundles/dsh-web'), { recursive: true });
  symlinkSync(join(root, 'third_party/dsh'), join(dir, 'third_party/dsh'), 'dir');
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
  for (const name of ['kmh.mjs', 'runtime-home.mjs', 'runtime-logs.mjs']) cpSync(join(root, 'scripts', name), join(dir, 'scripts', name));
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
  for (const name of ['codex-cli', 'codex-cli-trace', 'cli-tools-selector', 'runtime-log', 'web-surface-zh', 'kmh-dev-preset', 'kmh-team', 'kmh-mademe', 'kmh-infra', 'aggregated-token-analysis', 'kmh-xmusic']) symlinkSync(join(root, 'packages', name), join(dir, 'packages', name), 'dir');
  const port = await freePort();
  for (const name of ['kmh-web', 'kmh-headless', 'kmh-sdk']) {
    const target = join(dir, 'profiles', name);
    mkdirSync(target);
    const manifest = name === 'kmh-web' ? JSON.parse(readFileSync(join(root, 'profiles/kmh-web/package.json'), 'utf8')) : { name: `@kmh/${name}`, dependencies: {} };
    manifest.dsh = { profile: { bundles: name === 'kmh-web' ? ['@kmh/bundle-dsh-web'] : [] } };
    delete manifest.dependencies['dsh-context'];
    writeFileSync(join(target, 'package.json'), JSON.stringify(manifest));
    writeFileSync(join(target, 'cordis.yml'), '[]\n');
    writeFileSync(join(target, 'cordis.patch.yml'), name === 'kmh-web' ? readFileSync(join(root, 'profiles/kmh-web/cordis.patch.yml'), 'utf8').replace(/port: \d+/, `port: ${port}`) : '[]\n');
  }
  const webRuntime = loadOverlayPatches('test', join(dir, 'bundles/dsh-web/cordis.patch.yml')).flatMap(patch => patch.insert ?? []).find(entry => entry.id === 'web-runtime');
  assert.equal(webRuntime.config.openBrowser.__jsExpr, 'ctx.webStartup.openBrowser', 'Web 配置必须接收 --no-open 的启动值');
  const echoSource = join(dir, 'packages/kmh-echo/src/index.ts');
  const echo = readFileSync(echoSource, 'utf8');
  writeFileSync(echoSource, echo.replaceAll('"apply"', '"apply-v1"'));
  buildPackage(dir, 'kmh-echo');
  buildPackage(dir, 'zcode-cli');
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
  const echoOutput = join(dir, 'packages/kmh-echo/lib/index.js');
  const initialArtifact = readFileSync(echoOutput, 'utf8');
  writeFileSync(echoSource, echo.replaceAll('"apply"', '"apply-v2"'));
  await delay(1800);
  assert.equal(readFileSync(echoOutput, 'utf8'), initialArtifact);
  assert.doesNotMatch(events(), /unload|apply-v2/);
  buildPackage(dir, 'kmh-echo');
  await until(() => events().includes('apply-v2'), () => diagnostics() + events());
  assert.equal(events().match(/unload/g)?.length, 1);
  writeFileSync(echoSource, echo.replaceAll('"apply"', '"apply-v3"'));
  buildPackage(dir, 'kmh-echo');
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
  const pageOutput = join(dir, 'packages/zcode-cli/lib/client.js');
  const initialPage = readFileSync(pageOutput, 'utf8');
  writeFileSync(clientSource, page + '\nexport const kmhHmrProbe = "page-v2";\n');
  await delay(1800);
  assert.equal(readFileSync(pageOutput, 'utf8'), initialPage);
  assert.doesNotMatch(frames, /"type":"rebuilt","id":"@kmh\/zcode-cli"/);
  buildPackage(dir, 'zcode-cli');
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
