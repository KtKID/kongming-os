/**
 * 验证 Kongming 启动入口：外部 bundle 的真实 DSH 加载、目录冲突和 profile 配置保持。
 * launch 启动公开 CLI；每项测试使用独立 KMH_HOME，退出时清理自己的运行数据。
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
import { linkDirectory, prepareProfiles, readLaunchProfiles, root } from '../../scripts/kmh.mjs';
import { loadOverlayPatches } from '../../third_party/dsh/packages/boot/app-boot/lib/index.js';

/** 调用真实启动入口；输入参数、状态目录及工作目录，输出退出状态与日志。 */
function launch(args, home, cwd = root) {
  return spawnSync(process.execPath, [join(root, 'scripts/kmh.mjs'), ...args], {
    cwd, env: { ...process.env, KMH_HOME: home }, encoding: 'utf8', timeout: 60000,
  });
}

test('profile 注册保持仓库配置，bundle 解析到 Kongming 目录，重复注册保持用户覆盖', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-profile-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const patch = join(root, 'profiles/kmh-headless/cordis.patch.yml');
  const original = readFileSync(patch, 'utf8');
  t.after(() => writeFileSync(patch, original));
  prepareProfiles(home);
  assert.equal(realpathSync(join(home, 'profiles/kmh-headless')), join(root, 'profiles/kmh-headless'));
  assert.equal(realpathSync(join(home, 'profiles/kmh-headless/node_modules/@kmh/bundle-kongming')), join(root, 'bundles/kongming'));
  writeFileSync(patch, '# 用户保留的配置\n[]\n');
  prepareProfiles(home);
  assert.equal(readFileSync(patch, 'utf8'), '# 用户保留的配置\n[]\n');
});

test('注册遇到已有独立目录时保留原内容并报错', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-conflict-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const conflict = join(home, 'profiles/kmh-headless');
  mkdirSync(conflict, { recursive: true });
  writeFileSync(join(conflict, 'sentinel'), 'existing');
  assert.throws(() => prepareProfiles(home), /目录冲突/);
  assert.equal(readFileSync(join(conflict, 'sentinel'), 'utf8'), 'existing');
});

test('链接操作对重复调用保持幂等，冲突目标保留原链接', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-link-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const target = join(root, 'bundles/kongming');
  linkDirectory(join(home, 'link'), target);
  linkDirectory(join(home, 'link'), target);
  assert.throws(() => linkDirectory(join(home, 'link'), join(root, 'profiles')), /目录冲突/);
  assert.equal(realpathSync(join(home, 'link')), target);
});

test('未知启动命令返回失败状态', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-invalid-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = launch(['invalid'], home);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未知命令/);
  const logs = join(home, 'logs');
  const entry = readdirSync(logs).find(name => name.startsWith('launcher-error-'));
  assert.ok(entry);
  assert.match(readFileSync(join(logs, entry, 'stderr.log'), 'utf8'), /未知命令/);
});

for (const mode of ['cli', 'web', 'sdk']) {
  test(`${mode} 从仓库外工作目录启动真实 DSH CLI，加载 Kongming persona 和指定 home 的 profile`, t => {
    const home = mkdtempSync(join(tmpdir(), `kmh-${mode}-`));
    const cwd = mkdtempSync(join(tmpdir(), 'kmh-cwd-'));
    t.after(() => { rmSync(home, { recursive: true, force: true }); rmSync(cwd, { recursive: true, force: true }); });
    const result = launch([mode, '--dump-config'], home, cwd);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    // Web 的 persona 已中文化，headless/SDK（bundles/kongming）仍为英文，两种形态都算加载成功。
    assert.match(result.stdout, /(You are|你是) Kongming/);
    assert.doesNotMatch(result.stderr, /skip.*bundle|cannot resolve profile bundle/i);
    assert.equal(realpathSync(join(home, 'profiles', `kmh-${mode === 'cli' ? 'headless' : mode}`)), join(root, 'profiles', `kmh-${mode === 'cli' ? 'headless' : mode}`));
  });
}

test('Web 完整配置中编辑端口和欢迎版本后，真实 CLI 使用新值', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-web-config-'));
  const patch = join(root, 'profiles/kmh-web/cordis.patch.yml');
  const original = readFileSync(patch, 'utf8');
  t.after(() => { writeFileSync(patch, original); rmSync(home, { recursive: true, force: true }); });
  writeFileSync(patch, original.replace('port: 3080', 'port: 49173').replace('welcomeNoticeVersion: 2026-09-28.1', 'welcomeNoticeVersion: test-edited'));
  const result = launch(['web', '--dump-config'], home);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stderr, /not found|mismatch|skip/i);
  const dump = join(home, 'dump.yml');
  writeFileSync(dump, result.stdout);
  const entries = loadOverlayPatches('test', dump);
  assert.equal(entries.find(entry => entry.id === 'webserver').config.port, 49173);
  assert.equal(entries.find(entry => entry.id === 'ui-settings-general').config.welcomeNoticeVersion, 'test-edited');
  assert.equal(entries.filter(entry => entry.id === 'webserver').length, 1);
  assert.ok(entries.find(entry => entry.id === 'preset-standard'));
});

test('launch.config.json 的 profile 选择控制真实启动入口', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-launch-config-'));
  const file = join(root, 'launch.config.json');
  const original = readFileSync(file, 'utf8');
  t.after(() => { writeFileSync(file, original); rmSync(home, { recursive: true, force: true }); });
  const config = JSON.parse(original);
  config.profiles.web = 'kmh-sdk';
  writeFileSync(file, JSON.stringify(config));
  const result = launch(['web', '--dump-config'], home);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /id: webserver/);
  assert.match(result.stdout, /dsh-sdk-app/);
});

test('启动配置拒绝缺失模式、目录越界、缺失 profile 和拼错命令', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-config-invalid-'));
  const file = join(home, 'launch.config.json');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  for (const [profiles, message] of [
    [[], /映射/],
    [{ web: 'kmh-web' }, /profiles.cli/],
    [{ cli: '../outside', web: 'kmh-web', sdk: 'kmh-sdk' }, /有效的 profile/],
    [{ cli: 'kmh-missing', web: 'kmh-web', sdk: 'kmh-sdk' }, /缺失的 profile/],
    [{ cli: 'kmh-headless', web: 'kmh-web', sdk: 'kmh-sdk', weeb: 'kmh-web' }, /未知命令/],
  ]) {
    writeFileSync(file, JSON.stringify({ profiles }));
    assert.throws(() => readLaunchProfiles(file), message);
  }
});

test('headless 公开启动入口可以加载完整运行时并显示使用说明', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-help-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = launch(['cli', '--help'], home);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--session-id/);
});

test('SDK 公开启动入口处理真实 JSON-RPC shutdown 并返回成功退出状态', { timeout: 30000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-sdk-rpc-'));
  const child = spawn(process.execPath, [join(root, 'scripts/kmh.mjs'), 'sdk'], {
    cwd: root, env: { ...process.env, KMH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => { child.kill(); rmSync(home, { recursive: true, force: true }); });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'shutdown', params: {} }) + '\n');
  assert.equal(await exit, 0, stderr + stdout);
  const messages = stdout.trim().split('\n').map(line => JSON.parse(line));
  const response = messages.find(message => message.id === 1);
  assert.deepEqual(response, { jsonrpc: '2.0', id: 1, result: {} });
});
