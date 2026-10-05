/** 验证 kmh-echo 的真实 Cordis 生命周期、文件追加、配置校验和 profile 接入。 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { Context } from '../../third_party/dsh/vendor/cordis/lib/index.js';
import * as echo from '../../packages/kmh-echo/lib/index.js';
import { root } from '../../scripts/kmh.mjs';

/** 创建测试独占目录和 Cordis 容器，测试结束后等待资源释放再清理目录。 */
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'kmh-echo-test-'));
  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, ctx, file: join(directory, 'nested/events.log') };
}

test('echo 自动建目录，每行保存名字，重复更新和重启后监听保持一份', async t => {
  const { ctx, file } = fixture(t);
  const fiber = ctx.plugin(echo, { file }).ctx.fiber;
  await fiber.await();
  let expected = 'apply\neffect\n';
  assert.equal(readFileSync(file, 'utf8'), expected);
  for (let index = 0; index < 3; index++) {
    fiber.update({ file }, true);
    await fiber.await();
    expected += 'update\nunload\napply\neffect\n';
    assert.equal(readFileSync(file, 'utf8'), expected);
  }
  await fiber.restart();
  expected += 'unload\napply\neffect\n';
  assert.equal(readFileSync(file, 'utf8'), expected);
  await fiber.dispose();
  assert.equal(readFileSync(file, 'utf8'), expected + 'unload\n');
  assert.equal(fiber._hooks['internal/update'].length, 0);
  await fiber.dispose();
  assert.equal(readFileSync(file, 'utf8'), expected + 'unload\n');
});

test('echo 保留已有文件内容，再次创建容器仍追加写入', async t => {
  const { ctx, directory, file } = fixture(t);
  mkdirSync(join(directory, 'nested'));
  writeFileSync(file, 'previous\n');
  const fiber = ctx.plugin(echo, { file }).ctx.fiber;
  await fiber.await();
  await fiber.dispose();
  const second = new Context();
  t.after(() => second.fiber.dispose());
  const again = second.plugin(echo, { file }).ctx.fiber;
  await again.await();
  await again.dispose();
  assert.equal(readFileSync(file, 'utf8'), 'previous\napply\neffect\nunload\napply\neffect\nunload\n');
});

test('echo 更新路径时旧文件记录更新和卸载，新文件记录重新加载', async t => {
  const { ctx, directory, file } = fixture(t);
  const nextFile = join(directory, 'new/events.log');
  const fiber = ctx.plugin(echo, { file }).ctx.fiber;
  await fiber.await();
  fiber.update({ file: nextFile }, true);
  await fiber.await();
  await fiber.dispose();
  assert.equal(readFileSync(file, 'utf8'), 'apply\neffect\nupdate\nunload\n');
  assert.equal(readFileSync(nextFile, 'utf8'), 'apply\neffect\nunload\n');
});

test('echo 配置要求绝对路径，缺失、空路径、相对路径和错误类型在加载时拒绝', async t => {
  assert.throws(() => echo.Config({}), /missing required value/);
  const { ctx, file: validFile } = fixture(t);
  for (const file of ['', 'relative.log', '   ', 123]) {
    const fiber = ctx.plugin(echo, { file }).ctx.fiber;
    await assert.rejects(fiber.await(), /invalid config/);
    await fiber.dispose();
  }
  const active = ctx.plugin(echo, { file: validFile }).ctx.fiber;
  await active.await();
  assert.throws(() => active.update({ file: '' }, true), /invalid config/);
  assert.equal(readFileSync(validFile, 'utf8'), 'apply\neffect\n');
  await active.dispose();
});

test('echo 写入失败时加载报错并保留原文件', async t => {
  const { ctx, directory } = fixture(t);
  const blocker = join(directory, 'blocker');
  writeFileSync(blocker, 'existing');
  const fiber = ctx.plugin(echo, { file: join(blocker, 'events.log') }).ctx.fiber;
  await assert.rejects(fiber.await(), /EEXIST|ENOTDIR/);
  assert.equal(readFileSync(blocker, 'utf8'), 'existing');
  const targetDirectory = join(directory, 'directory-as-file');
  mkdirSync(targetDirectory);
  const wrongTarget = ctx.plugin(echo, { file: targetDirectory }).ctx.fiber;
  await assert.rejects(wrongTarget.await(), /EISDIR/);
});

test('三个公开 profile 合成配置均包含一个 kmh-echo 实例及本地包依赖', t => {
  const directory = mkdtempSync(join(tmpdir(), 'kmh-echo-profile-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  for (const [mode, profile] of [['cli', 'kmh-headless'], ['web', 'kmh-web'], ['sdk', 'kmh-sdk']]) {
    const result = spawnSync(process.execPath, [join(root, 'scripts/kmh.mjs'), mode, '--dump-config'], {
      cwd: directory, env: { ...process.env, KMH_HOME: join(directory, mode) }, encoding: 'utf8', timeout: 60000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.match(/id: kmh-echo\b/g)?.length, 1);
    assert.match(result.stdout, /name: ['"]?@kmh\/kmh-echo/);
    const manifest = JSON.parse(readFileSync(join(root, 'profiles', profile, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies['@kmh/kmh-echo'], 'link:../../packages/kmh-echo');
  }
});

test('公开 SDK 启动加载 echo，JSON-RPC shutdown 后日志保留卸载记录', t => {
  const directory = mkdtempSync(join(tmpdir(), 'kmh-echo-sdk-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'events.log');
  const patch = join(directory, 'echo.patch.yml');
  writeFileSync(patch, `- id: kmh-echo\n  config:\n    file: ${JSON.stringify(file)}\n`);
  const result = spawnSync(process.execPath, [join(root, 'scripts/kmh.mjs'), 'sdk', '--patch', patch], {
    cwd: directory, env: { ...process.env, KMH_HOME: join(directory, 'home'), DSH_TELEMETRY_DISABLED: '1' },
    input: '{"jsonrpc":"2.0","id":1,"method":"shutdown","params":{}}\n', encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const messages = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(messages.find(message => message.id === 1), { jsonrpc: '2.0', id: 1, result: {} });
  assert.equal(readFileSync(file, 'utf8'), 'apply\neffect\nunload\n');
});
