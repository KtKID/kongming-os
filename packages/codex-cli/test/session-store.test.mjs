/** 会话工具与原生编号的实际文件保存、恢复和写入失败。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexSessionStore } from '../lib/src/session-store.js';

const policy = () => ({ version: 1, target: 'codex-entry', choices: { version: 1, harness: [], native: [] }, inventory: [], nativeExecution: { commandExecution: false, fileChange: true, viewImage: false, webSearch: false } });
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'codex-bindings-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, file: join(dir, 'codex-bindings.json'), store: new CodexSessionStore(dir) };
}

test('creation tools survive restart before a native session id exists', async t => {
  const { dir, store } = await fixture(t);
  const original = policy();
  await store.put('new', { fingerprints: [], toolPolicy: original });
  original.nativeExecution.fileChange = false;
  const restored = await new CodexSessionStore(dir).get('new');
  assert.ok(restored, 'creation record must remain available');
  assert.equal(restored.threadId, undefined);
  assert.equal(restored.toolPolicy.nativeExecution.fileChange, true);
  assert.equal((await store.get('new')).toolPolicy.nativeExecution.fileChange, true);
});

test('corrupt and incomplete durable bindings fail instead of becoming new sessions', async t => {
  const { dir, file } = await fixture(t);
  for (const value of ['{broken', JSON.stringify({ old: { fingerprints: [], toolPolicy: { version: 42 } } })]) {
    await writeFile(file, value);
    await assert.rejects(new CodexSessionStore(dir).get('old'), /CODEX_SESSION_STATE_CORRUPT/);
    assert.equal(await readFile(file, 'utf8'), value);
  }
});

test('failed replacement preserves accepted memory and file; queued writes keep both sessions', async t => {
  const { store, file } = await fixture(t);
  await store.put('a', { threadId: 'original-id', fingerprints: [], toolPolicy: policy() });
  const accepted = await readFile(file, 'utf8');
  const backup = file + '.saved';
  await rename(file, backup);
  await mkdir(file);
  await assert.rejects(store.put('a', { threadId: 'replacement-id', fingerprints: [], toolPolicy: policy() }));
  assert.equal((await store.get('a')).threadId, 'original-id');
  assert.equal(await readFile(backup, 'utf8'), accepted);
  await rm(file, { recursive: true });
  await rename(backup, file);
  await Promise.all([
    store.put('b', { threadId: 'id-b', fingerprints: [], toolPolicy: policy() }),
    store.put('c', { threadId: 'id-c', fingerprints: [], toolPolicy: policy() }),
  ]);
  const records = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(Object.keys(records).sort(), ['a', 'b', 'c']);
});
