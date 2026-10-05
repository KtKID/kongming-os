/** 验证启动输出双写、SDK 原样传输、文件权限、退出状态和信号转发。 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { runLogged } from '../../scripts/runtime-logs.mjs';

function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'kmh-runtime-logs-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '', err = '';
  stdout.on('data', chunk => { out += chunk; });
  stderr.on('data', chunk => { err += chunk; });
  return { home, options: { home, label: 'sdk', cwd: home, env: process.env, stdout, stderr }, output: () => ({ out, err }) };
}

test('分别双写 stdout/stderr，记录退出码，保留 JSON-RPC 原始字节及已有运行日志', async t => {
  const { home, options, output } = fixture(t);
  const code = 'process.stdout.write(\'{"jsonrpc":"2.0","id":1,"result":{}}\\n\'); process.stderr.write("warning\\n"); process.exitCode = 7;';
  const first = await runLogged(process.execPath, ['-e', code], options);
  assert.equal(first.status, 7);
  assert.deepEqual(output(), { out: '{"jsonrpc":"2.0","id":1,"result":{}}\n', err: 'warning\n' });
  assert.equal(readFileSync(join(first.logDir, 'stdout.log'), 'utf8'), output().out);
  assert.equal(readFileSync(join(first.logDir, 'stderr.log'), 'utf8'), output().err);
  const second = await runLogged(process.execPath, ['-e', 'process.stdout.write("next")'], options);
  assert.notEqual(first.logDir, second.logDir);
  assert.equal(readFileSync(join(first.logDir, 'stdout.log'), 'utf8'), output().out.replace('next', ''));
  assert.ok(first.logDir.startsWith(join(home, 'logs')));
  if (process.platform !== 'win32') {
    assert.equal(statSync(first.logDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(first.logDir, 'stdout.log')).mode & 0o777, 0o600);
  }
  const record = JSON.parse(readFileSync(join(first.logDir, 'exit.json'), 'utf8'));
  assert.equal(record.status, 7);
});

test('日志目录写入失败在启动子进程前报错，启动失败保留错误记录', async t => {
  const { home, options } = fixture(t);
  writeFileSync(join(home, 'logs'), 'blocker');
  await assert.rejects(runLogged(process.execPath, ['-e', ''], options), /EEXIST|ENOTDIR/);
  rmSync(join(home, 'logs'));
  await assert.rejects(runLogged(join(home, 'missing-executable'), [], options), /ENOENT/);
});

test('父进程停止信号转发给子进程，并清理信号监听', async t => {
  const { options } = fixture(t);
  const before = process.listenerCount('SIGTERM');
  const promise = runLogged(process.execPath, ['-e', 'process.on("SIGTERM", () => { process.stderr.write("stopped"); process.exit(0); }); process.stdout.write("ready"); setInterval(() => {}, 1000);'], options);
  await new Promise(resolve => options.stdout.once('data', resolve));
  process.emit('SIGTERM');
  const result = await promise;
  assert.equal(result.status, 0);
  assert.equal(readFileSync(join(result.logDir, 'stderr.log'), 'utf8'), 'stopped');
  assert.equal(process.listenerCount('SIGTERM'), before);
});
