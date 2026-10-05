/** 通过公开 SDK 入口验证会话、插件日志、进程输出和临时路径使用同一 KMH_HOME。 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import test from 'node:test';
import { root } from '../../scripts/kmh.mjs';

test('真实 SDK 启动覆盖父进程数据路径，在 KMH_HOME 保存会话和所有已配置记录', { timeout: 30000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'kmh-home-smoke-'));
  const home = join(directory, 'home');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const patch = join(directory, 'smoke.patch.yml');
  writeFileSync(patch, '- insert:\n    - id: runtime-home-smoke\n      name: ' +
    JSON.stringify(join(root, 'tests/runtime/fixtures/runtime-home-smoke.mjs')) + '\n' +
    '- id: session-persistence-jsonl\n  config:\n    root: !!js dshHomePath(\'sessions\')\n    compression: none\n');
  const child = spawn(process.execPath, [join(root, 'scripts/kmh.mjs'), 'sdk', '--patch', patch], {
    cwd: directory, env: { ...process.env, KMH_HOME: home, DSH_HOME: join(directory, 'foreign-dsh'),
      ZCODE_DATA_BASE_DIR: join(directory, 'foreign-zcode'), TMPDIR: join(directory, 'foreign-tmp'), DSH_TELEMETRY_DISABLED: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  const result = { stdout: '', stderr: '', status: null };
  child.stdout.on('data', chunk => { result.stdout += chunk; });
  const exit = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', status => { result.status = status; resolve(); }); });
  await new Promise((resolve, reject) => {
    child.stderr.on('data', chunk => { result.stderr += chunk; if (result.stderr.includes('KMH_HOME_SMOKE ')) resolve(); });
    child.once('close', () => reject(new Error(result.stderr)));
    child.once('error', reject);
  });
  child.stdin.end('{"jsonrpc":"2.0","id":1,"method":"shutdown","params":{}}\n');
  await exit;
  assert.equal(result.status, 0, result.stderr);
  const reportLine = result.stderr.split('\n').find(line => line.startsWith('KMH_HOME_SMOKE '));
  const pluginFiles = readdirSync(join(home, 'logs/plugins'));
  assert.ok(reportLine, result.stderr + pluginFiles.map(file => readFileSync(join(home, 'logs/plugins', file), 'utf8')).join('\n'));
  const report = JSON.parse(reportLine.slice(15));
  assert.equal(report.home, home);
  assert.equal(report.zcode, join(home, 'zcode-cli'));
  assert.equal(realpathSync(report.cwd), realpathSync(directory));
  assert.equal(realpathSync(report.tmp), realpathSync(join(home, 'tmp')));
  const files = ['sessions', 'logs'].flatMap(folder => readdirSync(join(home, folder), { recursive: true }).map(file => join(folder, file)));
  assert.ok(files.some(file => file.startsWith('sessions/') && file.endsWith('.jsonl')));
  const sessionFiles = files.filter(file => file.startsWith('sessions/') && file.endsWith('.jsonl'));
  assert.ok(sessionFiles.some(file => readFileSync(join(home, file), 'utf8').includes(report.sessionId)));
  const logs = files.filter(file => file.endsWith('stdout.log'));
  assert.equal(logs.length, 1);
  assert.equal(readFileSync(join(home, logs[0]), 'utf8'), result.stdout);
  assert.ok(files.some(file => file.startsWith('logs/kmh-echo/') && file.endsWith('.log')));
  const pluginLogs = files.filter(file => file.startsWith('logs/plugins/') && file.endsWith('.jsonl'));
  assert.ok(pluginLogs.some(file => readFileSync(join(home, file), 'utf8').includes('runtime-home-smoke')));
  const messages = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(messages.find(message => message.id === 1), { jsonrpc: '2.0', id: 1, result: {} });
});
