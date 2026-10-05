/** 验证 KMH 数据根目录和临时目录独立于父进程的 DSH、ZCode 与临时路径。 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveKmhHome, runtimeEnvironment } from '../../scripts/runtime-home.mjs';

test('默认数据根为用户 home 下的 .kmh，空值使用默认，显式路径直接使用且支持 ~', () => {
  assert.equal(resolveKmhHome({ HOME: '/fake-parent-home', DSH_HOME: '/fake-dsh-home' }), join(userInfo().homedir, '.kmh'));
  assert.equal(resolveKmhHome({ KMH_HOME: '  ' }), join(homedir(), '.kmh'));
  assert.equal(resolveKmhHome({ KMH_HOME: '/tmp/kmh-explicit' }), '/tmp/kmh-explicit');
  assert.equal(resolveKmhHome({ KMH_HOME: '~/.kmh-custom' }), join(homedir(), '.kmh-custom'));
  assert.throws(() => resolveKmhHome({ KMH_HOME: './relative-home' }), /绝对路径/);
});

test('数据与临时目录由 KMH 固定，工作目录、凭据、代理和 PATH 按调用环境保留', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-runtime-env-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const inherited = { HOME: homedir(), DSH_HOME: '/other/dsh', ZCODE_DATA_BASE_DIR: '/other/zcode',
    TMPDIR: '/other/tmp', TEMP: '/other/temp', TMP: '/other/tmp2', PATH: '/tools', HTTPS_PROXY: 'http://proxy',
    DEEPSEEK_API_KEY: 'test-placeholder', DSH_PERMISSION_MODE: 'read-only' };
  const env = runtimeEnvironment(home, inherited);
  assert.equal(env.KMH_HOME, home);
  assert.equal(env.DSH_HOME, home);
  assert.equal(env.ZCODE_DATA_BASE_DIR, join(home, 'zcode-cli'));
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) assert.equal(env[key], join(home, 'tmp'));
  for (const key of ['HOME', 'PATH', 'HTTPS_PROXY', 'DEEPSEEK_API_KEY', 'DSH_PERMISSION_MODE']) assert.equal(env[key], inherited[key]);
  assert.equal(inherited.DSH_HOME, '/other/dsh');
});
