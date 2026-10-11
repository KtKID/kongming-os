/** 验证手动构建模式下的真实帮助和配置导出入口。 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { root } from '../../scripts/kmh.mjs';
import { loadOverlayPatches } from '../../third_party/dsh/packages/boot/app-boot/lib/index.js';

test('Web 帮助与配置导出使用已有构建产物并正常结束', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-manual-build-config-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [join(root, 'scripts/kmh.mjs'), 'web', '--dump-config'], {
    env: { ...process.env, KMH_HOME: home }, cwd: home, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  const file = join(home, 'dump.yml');
  writeFileSync(file, result.stdout);
  const config = loadOverlayPatches('test', file).find(entry => entry.id === 'hmr').config;
  assert.match(config.root.__jsExpr, /KMH_PLUGIN_WATCH_ROOTS/);
  assert.doesNotMatch(result.stderr, /编译监听|插件监听就绪/);
  const help = spawnSync(process.execPath, [join(root, 'scripts/kmh.mjs'), 'help'], {
    env: { ...process.env, KMH_HOME: home }, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(help.status, 0, help.stderr);
  assert.doesNotMatch(help.stdout, /--no-watch|默认监听自有插件源码/);
  assert.ok(readFileSync(file, 'utf8').length > 0);
});
