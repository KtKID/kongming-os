/** 验证自有插件的真实编译监听、错误恢复与停止资源释放。 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync, copyFileSync, realpathSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { root } from '../../scripts/kmh.mjs';
import { loadOverlayPatches } from '../../third_party/dsh/packages/boot/app-boot/lib/index.js';


/** 等待文件满足断言；超时保留实际内容以便定位失败。 */
async function waitFor(file, predicate) {
  for (let i = 0; i < 100; i++) {
    let value = '';
    try { value = readFileSync(file, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (predicate(value)) return value;
    await delay(100);
  }
  assert.fail(`等待更新超时：${file}`);
}

/** 准备独立源码目录，复用已安装的编译器类型依赖。 */
function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kmh-watch-')));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const pkg = join(dir, 'packages/probe');
  mkdirSync(join(pkg, 'src'), { recursive: true });
  symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir');
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@kmh/probe', type: 'module', exports: { '.': { default: './lib/index.js' } }, scripts: { build: 'tsc -p tsconfig.json' } }));
  writeFileSync(join(pkg, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'NodeNext', rootDir: 'src', outDir: 'lib', strict: true, skipLibCheck: true, types: [] }, include: ['src/**/*.ts'] }));
  writeFileSync(join(pkg, 'src/index.ts'), 'export const value: string = "v1";\n');
  return { dir, pkg };
}

test('插件发现覆盖自有构建包、空目录和缺失编译配置', async t => {
  const { discoverWatchPackages } = await import('../../scripts/plugin-watch.mjs');
  const { dir, pkg } = fixture(t);
  assert.deepEqual(discoverWatchPackages(dir).map(p => p.dir), [pkg]);
  assert.deepEqual(discoverWatchPackages(root).map(p => p.name).sort(), ['@kmh/codex-cli', '@kmh/kmh-echo', '@kmh/runtime-log', '@kmh/web-surface-zh', '@kmh/zcode-cli']);
  rmSync(join(pkg, 'tsconfig.json'));
  assert.throws(() => discoverWatchPackages(dir), /tsconfig/);
  rmSync(join(dir, 'packages'), { recursive: true });
  mkdirSync(join(dir, 'packages'));
  assert.deepEqual(discoverWatchPackages(dir), []);
});

test('真实源码监听支持连续修改、类型错误恢复和停止', { timeout: 30000 }, async t => {
  const { startPluginWatchers } = await import('../../scripts/plugin-watch.mjs');
  const { dir, pkg } = fixture(t);
  const diagnostics = [];
  const watcher = await startPluginWatchers(await discover(dir), { report: message => diagnostics.push(message) });
  t.after(() => watcher.close());
  const source = join(pkg, 'src/index.ts');
  const output = join(pkg, 'lib/index.js');
  await waitFor(output, value => value.includes('v1'));
  writeFileSync(source, 'export const value: string = "v2";\n');
  await waitFor(output, value => value.includes('v2'));
  writeFileSync(source, 'export const value: string = 3;\n');
  for (let i = 0; i < 50 && !diagnostics.some(value => value.includes('2322')); i++) await delay(100);
  assert.ok(diagnostics.some(value => value.includes('2322')), diagnostics.join('\n'));
  assert.match(readFileSync(output, 'utf8'), /v2/);
  writeFileSync(source, 'export const value: string = "v3";\n');
  await waitFor(output, value => value.includes('v3'));
  await watcher.close();
  writeFileSync(source, 'export const value: string = "v4";\n');
  await delay(600);
  assert.match(readFileSync(output, 'utf8'), /v3/);
});

test('真实启动入口配置导出、构建产物选项和帮助保持单次操作', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-watch-config-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const disabled of [false, true]) {
    const result = spawnSync(process.execPath, [join(root, 'scripts/kmh.mjs'), 'web', ...disabled ? ['--no-watch'] : [], '--dump-config'], {
      env: { ...process.env, KMH_HOME: home }, cwd: home, encoding: 'utf8', timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr);
    const file = join(home, 'dump.yml');
    writeFileSync(file, result.stdout);
    const config = loadOverlayPatches('test', file).find(entry => entry.id === 'hmr').config;
    assert.match(config.root.__jsExpr, /KMH_PLUGIN_WATCH_ROOTS/);
    assert.doesNotMatch(result.stderr, /插件监听就绪/);
  }
  const help = spawnSync(process.execPath, [join(root, 'scripts/kmh.mjs'), 'web', '--help'], {
    env: { ...process.env, KMH_HOME: home }, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.doesNotMatch(help.stderr, /插件监听就绪/);
});

test('初始编译失败释放已建立的监听', { timeout: 30000 }, async t => {
  const { discoverWatchPackages, startPluginWatchers } = await import('../../scripts/plugin-watch.mjs');
  const { dir, pkg } = fixture(t);
  const bad = join(dir, 'packages/z-bad');
  mkdirSync(join(bad, 'src'), { recursive: true });
  copyFileSync(join(pkg, 'package.json'), join(bad, 'package.json'));
  copyFileSync(join(pkg, 'tsconfig.json'), join(bad, 'tsconfig.json'));
  writeFileSync(join(bad, 'src/index.ts'), 'export const value: string = 1;\n');
  await assert.rejects(startPluginWatchers(discoverWatchPackages(dir), { report() {} }), /初始编译失败/);
  writeFileSync(join(pkg, 'src/index.ts'), 'export const value: string = "after-failure";\n');
  await delay(600);
  assert.match(readFileSync(join(pkg, 'lib/index.js'), 'utf8'), /v1/);
});

test('包内真实页面构建器支持源码更新和关闭', { timeout: 30000 }, async t => {
  const { discoverWatchPackages, startPluginWatchers } = await import('../../scripts/plugin-watch.mjs');
  const { dir, pkg } = fixture(t);
  mkdirSync(join(pkg, 'src/client'));
  symlinkSync(join(root, 'packages/codex-cli/node_modules'), join(pkg, 'node_modules'), 'dir');
  copyFileSync(join(root, 'packages/codex-cli/build.mjs'), join(pkg, 'build.mjs'));
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  manifest.dsh = { client: { platform: 'web' } };
  writeFileSync(join(pkg, 'package.json'), JSON.stringify(manifest));
  const source = join(pkg, 'src/client/index.ts');
  const output = join(pkg, 'lib/client.js');
  const watchesBefore = process.getActiveResourcesInfo().filter(name => name === 'StatWatcher').length;
  writeFileSync(source, 'export const text = "page-v1";\n');
  const watcher = await startPluginWatchers(discoverWatchPackages(dir), { report() {} });
  t.after(() => watcher.close());
  await waitFor(output, value => value.includes('page-v1'));
  writeFileSync(source, 'export const text = "page-v2";\n');
  await waitFor(output, value => value.includes('page-v2'));
  await watcher.close();
  writeFileSync(source, 'export const text = "page-v3";\n');
  await delay(600);
  assert.match(readFileSync(output, 'utf8'), /page-v2/);
  assert.equal(process.getActiveResourcesInfo().filter(name => name === 'StatWatcher').length, watchesBefore);
});

/** 从同一发现入口取得待监听包，保持测试与真实启动一致。 */
async function discover(dir) {
  const { discoverWatchPackages } = await import('../../scripts/plugin-watch.mjs');
  return discoverWatchPackages(dir);
}
