/** 验证 KMH 数据根目录和临时目录独立于父进程的 DSH、ZCode 与临时路径。 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { resolveKmhHome, runtimeEnvironment } from '../../scripts/runtime-home.mjs';

test('默认数据根为用户 home 下的 .kmh，空值使用默认，显式路径直接使用且支持 ~', () => {
  const absent = join(tmpdir(), 'kmh-absent-local.env');
  assert.equal(resolveKmhHome({ HOME: '/fake-parent-home', DSH_HOME: '/fake-dsh-home' }, absent), join(userInfo().homedir, '.kmh'));
  assert.equal(resolveKmhHome({ KMH_HOME: '  ' }, absent), join(homedir(), '.kmh'));
  assert.equal(resolveKmhHome({ KMH_HOME: '/tmp/kmh-explicit' }, absent), '/tmp/kmh-explicit');
  assert.equal(resolveKmhHome({ KMH_HOME: '~/.kmh-custom' }, absent), join(homedir(), '.kmh-custom'));
  assert.throws(() => resolveKmhHome({ KMH_HOME: './relative-home' }, absent), /绝对路径/);
});

test('环境变量优先于本地覆盖文件，覆盖文件支持 ~ 展开与整行注释，其余回到默认', t => {
  const directory = mkdtempSync(join(tmpdir(), 'kmh-local-home-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const localFile = join(directory, '.env.local');
  writeFileSync(localFile, 'KMH_HOME=/tmp/from-local\n');
  assert.equal(resolveKmhHome({ KMH_HOME: '/tmp/kmh-explicit' }, localFile), '/tmp/kmh-explicit');
  assert.equal(resolveKmhHome({ KMH_HOME: '  ' }, localFile), '/tmp/from-local');
  writeFileSync(localFile, '# KMH_HOME=/tmp/commented\n\nKMH_HOME=~/.kmh-dev\nOTHER=1\n');
  assert.equal(resolveKmhHome({}, localFile), join(homedir(), '.kmh-dev'));
  writeFileSync(localFile, 'KMH_HOME=\n');
  assert.equal(resolveKmhHome({}, localFile), join(homedir(), '.kmh'));
  writeFileSync(localFile, 'KMH_HOME=./relative\n');
  assert.throws(() => resolveKmhHome({}, localFile), /绝对路径/);
  assert.equal(resolveKmhHome({}, join(directory, 'absent')), join(homedir(), '.kmh'));
  assert.throws(() => resolveKmhHome({}, directory), { code: 'EISDIR' });
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
