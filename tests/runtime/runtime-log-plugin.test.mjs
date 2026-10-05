/** 验证插件日志记录、导出器释放、路径拒绝和写入失败的错误传播。 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Context } from '../../third_party/dsh/vendor/cordis/lib/index.js';
import * as logging from '../../packages/runtime-log/lib/index.js';

test('info/warn/error/debug 全部记录，重启保持一份导出器，卸载撤回记录', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'kmh-plugin-log-'));
  const file = join(directory, 'logs/plugins.jsonl');
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); rmSync(directory, { recursive: true, force: true }); });
  const fiber = ctx.plugin(logging, { file }).ctx.fiber;
  await fiber.await();
  const logger = ctx.logger('test-producer');
  for (const level of ['info', 'warn', 'error', 'debug']) logger[level]('message %s', level);
  let rows = readFileSync(file, 'utf8').trim().split('\n').map(row => JSON.parse(row));
  assert.deepEqual(rows.map(row => row.level), ['info', 'warn', 'error', 'debug']);
  assert.equal(rows[0].text, 'message info');
  assert.equal(rows[0].name, 'test-producer');
  await fiber.restart();
  logger.warn('after-restart');
  rows = readFileSync(file, 'utf8').trim().split('\n').map(row => JSON.parse(row));
  assert.equal(rows.filter(row => row.text === 'after-restart').length, 1);
  await fiber.dispose();
  const prior = readFileSync(file, 'utf8');
  logger.error('after-unload');
  assert.equal(readFileSync(file, 'utf8'), prior);
});

test('日志路径缺失与相对路径拒绝，写入失败撤回导出器并保留原文件', async t => {
  assert.throws(() => logging.Config({}), /missing required value/);
  assert.throws(() => logging.Config({ file: 'relative' }), /绝对路径/);
  const directory = mkdtempSync(join(tmpdir(), 'kmh-plugin-log-failure-'));
  const file = join(directory, 'blocker');
  const ctx = new Context();
  t.after(async () => { await ctx.fiber.dispose(); rmSync(directory, { recursive: true, force: true }); });
  const fiber = ctx.plugin(logging, { file }).ctx.fiber;
  await fiber.await();
  // 文件父目录仍可写，阻断目标文件，覆盖激活之后发生的写入失败。
  rmSync(directory, { recursive: true });
  writeFileSync(directory, 'existing');
  assert.throws(() => ctx.logger.error('write-failure'), /ENOTDIR/);
  assert.equal(ctx.logger.exporters.size, 1);
  assert.equal(readFileSync(directory, 'utf8'), 'existing');
});
