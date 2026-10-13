/** Actual profile Config, frozen schemas, main loop and native attempt attribution. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { profileHarness } from './support/profile-harness.mjs';
import Schema from '@deepseek-ai/schemastery';
import { until } from './support/harness.mjs';

test('profile imports choices once and Config selection reaches the actual Codex request', async t => {
  const h = await profileHarness(t);
  const provider = h.ctx.cliTools.get('codex-entry');
  const catalog = await provider.catalog(new AbortController().signal);
  const descriptor = h.ctx.settings.describe().find(row => row.ns === 'codex-entry');
  assert.ok(descriptor.value.toolSelection);
  const choices = descriptor.value.toolSelection;
  assert.deepEqual(new Schema(JSON.parse(JSON.stringify(descriptor.schema)))(descriptor.value), descriptor.value);
  assert.equal(choices.harness.length, 2);
  assert.equal(choices.harness.every(row => row.enabled), true);
  assert.equal(choices.native.every(row => !row.enabled), true);
  const selected = { ...choices, harness: choices.harness.map(row => ({ ...row, enabled: row.name === 'kmh-fixture_a' })) };
  await h.ctx.settings.update('codex-entry', { toolSelection: selected }, descriptor.revision);
  assert.match(readFileSync(h.profile.patchPath, 'utf8'), /toolSelection:/);
  const fresh = await h.create('selected-tools-fresh');
  await h.send('Use selected tools.', fresh);
  assert.deepEqual(h.server.requests[0].tools.map(row => row.name ?? row.type), ['kmh-fixture_a']);
  const prepared = fresh.session.snapshotEvents().filter(event => event.type === 'cli-tools/turn-prepared');
  assert.equal(prepared.length, 1);
  assert.deepEqual(prepared[0].data.harness.map(tool => tool.name), ['fixture_a']);
  assert.equal(prepared[0].data.cliVersion, '0.162.0-alpha.17.2');
  assert.equal(catalog.tools.some(row => row.name === 'shell_command'), true);
});

test('saved changes keep existing conversations frozen and enter only a newly created conversation', async t => {
  const h = await profileHarness(t, { holdFirst: true });
  await h.ctx.cliTools.get('codex-entry').catalog(new AbortController().signal);
  const running = h.send('First turn with the original tools.');
  await until(() => h.server.requests.length === 1, 'first request');
  const descriptor = h.ctx.settings.describe().find(row => row.ns === 'codex-entry');
  const next = { ...descriptor.value.toolSelection, harness: descriptor.value.toolSelection.harness.map(row => ({ ...row, enabled: row.name === 'kmh-fixture_b' })) };
  await h.ctx.settings.update('codex-entry', { toolSelection: next }, descriptor.revision);
  h.server.advanceFirst();
  await running;
  await h.send('Second turn with the saved selection.');
  assert.deepEqual(h.server.requests[0].tools.map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b']);
  assert.deepEqual(h.server.requests.at(-1).tools.map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b']);
  assert.match(JSON.stringify(h.server.requests.at(-1).input), /First turn with the original tools/);
  const prepared = h.agent.session.snapshotEvents().filter(event => event.type === 'cli-tools/turn-prepared');
  assert.deepEqual(prepared.map(event => event.data.harness.map(tool => tool.name)), [['fixture_a', 'fixture_b'], ['fixture_a', 'fixture_b']]);
  const fresh = await h.create('saved-selection-fresh');
  await h.send('New conversation with saved selection', fresh);
  assert.deepEqual(h.server.requests.at(-1).tools.map(row => row.name), ['kmh-fixture_b']);
});

test('closed native attempts are attributed and refused through an actual profile loop', async t => {
  const h = await profileHarness(t, { toolCall: { type: 'function_call', name: 'exec_command', arguments: '{"cmd":"touch native-canary"}' } });
  await h.send('Run the fixture.');
  const observed = h.agent.session.snapshotEvents().filter(event => event.type === 'cli-tools/tool-observed');
  assert.ok(observed.some(event => event.data.name === 'exec_command' && event.data.source === 'codex/native' && event.data.kind === 'blocked'));
  assert.ok(observed.some(event => event.data.name === 'exec_command' && event.data.kind === 'result'));
  assert.equal(h.executions(), 0);
});


test('unknown native version reports a bounded error and the normal retry keeps creation tools', async t => {
  const h = await profileHarness(t, { versionGate: true });
  await h.send('Continue after native verification.');
  assert.equal(h.server.requests.length, 0);
  assert.equal(h.agent.status, 'idle');
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, undefined);
  h.releaseNativeVersion();
  await h.send('Retry after the runtime condition is corrected');
  assert.equal(h.server.requests.length, 1);
  assert.equal(h.agent.session.snapshotEvents().filter(event => event.type === 'turn/start').length, 2);
});

test('forced disabled Harness calls retain their source and leave the executor untouched', async t => {
  const h = await profileHarness(t, { toolCall: { type: 'function_call', name: 'kmh-fixture_b', arguments: '{}' }, beforeCreate: ctx => editChoices(ctx, row => row.name === 'kmh-fixture_a') });
  await h.ctx.cliTools.get('codex-entry').catalog(new AbortController().signal);
  const descriptor = h.ctx.settings.describe().find(row => row.ns === 'codex-entry');
  const selected = { ...descriptor.value.toolSelection, harness: descriptor.value.toolSelection.harness.map(row => ({ ...row, enabled: row.name === 'kmh-fixture_a' })) };
  await h.ctx.settings.update('codex-entry', { toolSelection: selected }, descriptor.revision);
  await h.send('Run the fixture.');
  assert.equal(h.executions(), 0);
  const blocked = h.agent.session.snapshotEvents().find(event => event.type === 'cli-tools/tool-observed' && event.data.name === 'kmh-fixture_b' && event.data.kind === 'blocked');
  assert.ok(blocked);
  assert.ok(blocked.data.source);
});

/** 创建之前编辑真实 Config；执行与工具策略保持生产代码。 */
async function editChoices(ctx, pick) {
  await ctx.codexCli.toolPolicy.catalog(new AbortController().signal);
  const descriptor = ctx.settings.describe().find(row => row.ns === 'codex-entry');
  const current = descriptor.value.toolSelection;
  const changed = { ...current, harness: current.harness.map(row => ({ ...row, enabled: pick(row) })), native: current.native.map(row => ({ ...row })) };
  await ctx.settings.update('codex-entry', { toolSelection: changed }, descriptor.revision);
}

test('ordinary resume retains its native id and original tools through Config changes and process exits', async t => {
  const h = await profileHarness(t, { extraFixtures: true,
    toolCallFor: (_body, sequence) => sequence === 2 ? { type: 'function_call', name: 'kmh-fixture_c', arguments: '{}' } : sequence === 4 ? { type: 'function_call', name: 'kmh-fixture_d', arguments: '{}' } : undefined,
    beforeCreate: ctx => editChoices(ctx, row => row.name !== 'kmh-fixture_d') });
  await h.send('Original native conversation marker');
  const first = await h.ctx.codexCli.bindingRecord(h.agent.session.id);
  assert.ok(first.threadId);
  const snapshot = { original: h.server.requests.at(-1).tools.filter(row => row.name?.startsWith('kmh-')).map(row => row.name) };
  await editChoices(h.ctx, row => row.name === 'kmh-fixture_d');
  await h.send('Continue after switches changed');
  const next = await h.ctx.codexCli.bindingRecord(h.agent.session.id);
  assert.equal(next.threadId, first.threadId, 'same KMH conversation must resume the original native id');
  assert.equal(h.executions(), 1, 'C still executes using the original policy');
  snapshot.after_edit = h.server.requests.at(-1).tools.filter(row => row.name?.startsWith('kmh-')).map(row => row.name);
  snapshot.resumed_same_id = next.threadId === first.threadId;
  assert.deepEqual(h.server.requests.at(-1).tools.filter(row => row.name?.startsWith('kmh-')).map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b', 'kmh-fixture_c']);
  await h.send('Force originally closed D while the current defaults enable D');
  assert.equal(h.executions(), 1, 'originally closed D stays closed while current defaults enable it');
  await editChoices(h.ctx, () => false);
  await h.send('Continue after every switch is off');
  assert.equal(h.executions(), 1);
  snapshot.after_all_closed = h.server.requests.at(-1).tools.filter(row => row.name?.startsWith('kmh-')).map(row => row.name);
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, first.threadId);
  assert.equal(h.rpcs.filter(row => row.method === 'thread/resume' && row.params.threadId === first.threadId).length, 3);
  const child = await h.create('new-config-session');
  await h.send('New conversation observes closed switches', child);
  const second = await h.ctx.codexCli.bindingRecord(child.session.id);
  assert.notEqual(second.threadId, first.threadId);
  snapshot.fresh_different_id = second.threadId !== first.threadId;
  snapshot.fresh = h.server.requests.at(-1).tools.filter(row => row.name?.startsWith('kmh-')).map(row => row.name);
  assert.deepEqual(snapshot, JSON.parse(readFileSync(new URL('./fixtures/session-tools.expected.json', import.meta.url), 'utf8')));
  assert.deepEqual(h.server.requests.at(-1).tools.filter(row => row.name?.startsWith('kmh-')), []);
});

test('creation freezes tools before the first message and saves the native id before sending business input', async t => {
  let earlyId; let h;
  h = await profileHarness(t, { onRequest: () => { earlyId = JSON.parse(readFileSync(join(h.home, 'data/codex-bindings.json'), 'utf8'))[h.agent.session.id]?.threadId; } });
  await editChoices(h.ctx, () => false);
  await h.send('First message after switches changed');
  assert.deepEqual(h.server.requests[0].tools.filter(row => row.name?.startsWith('kmh-')).map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b']);
  const turnStart = h.rpcs.find(row => row.method === 'turn/start');
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, turnStart.params.threadId);
  assert.equal(earlyId, turnStart.params.threadId, 'binding is durable before the model receives the first task');
});


test('native file changes keep their creation setting on resumed sessions while new sessions omit them', async t => {
  const h = await profileHarness(t, {
    beforeCreate: async ctx => {
      await ctx.codexCli.toolPolicy.catalog(new AbortController().signal);
      const descriptor = ctx.settings.describe().find(row => row.ns === 'codex-entry');
      const current = descriptor.value.toolSelection;
      await ctx.settings.update('codex-entry', { toolSelection: { ...current, native: current.native.map(row => ({ ...row, enabled: row.name === 'apply_patch' })) } }, descriptor.revision);
    },
    toolCallFor: (_body, sequence) => sequence === 2 ? { type: 'custom_tool_call', name: 'apply_patch', input: '*** Begin Patch\n*** Add File: native-frozen-canary\n+created-through-original-session\n*** End Patch' } : undefined,
  });
  await h.send('Start with native file change enabled');
  const first = await h.ctx.codexCli.bindingRecord(h.agent.session.id);
  const descriptor = h.ctx.settings.describe().find(row => row.ns === 'codex-entry');
  const choices = descriptor.value.toolSelection;
  await h.ctx.settings.update('codex-entry', { toolSelection: { ...choices, native: choices.native.map(row => ({ ...row, enabled: false })) } }, descriptor.revision);
  await h.send('Use the original native file change after its default is closed');
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, first.threadId);
  assert.equal(existsSync(join(h.home, 'workspace/native-frozen-canary')), true);
  assert.match(readFileSync(join(h.home, 'workspace/native-frozen-canary'), 'utf8'), /created-through-original-session/);
  const fresh = await h.create('fresh-without-file-change');
  await h.send('New session with file change disabled', fresh);
  assert.equal(h.server.requests.at(-1).tools.some(row => row.name === 'apply_patch'), false);
});


test('original native id and tools survive a real KMH persistence restart with no selector catalog', async t => {
  const h = await profileHarness(t, { persistence: true, withoutCatalog: true });
  assert.equal(h.ctx.get('cliTools'), undefined);
  await h.send('Persisted original input');
  const original = await h.ctx.codexCli.bindingRecord(h.agent.session.id);
  const descriptor = h.ctx.settings.describe().find(row => row.ns === 'codex-entry');
  const choices = descriptor.value.toolSelection;
  await h.ctx.settings.update('codex-entry', { toolSelection: { ...choices, harness: choices.harness.map(row => ({ ...row, enabled: false })) } }, descriptor.revision);
  await h.restart();
  await h.send('Continue after real host restart');
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, original.threadId);
  assert.deepEqual(h.server.requests.at(-1).tools.filter(row => row.name?.startsWith('kmh-')).map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b']);
  assert.equal(JSON.stringify(h.server.requests.at(-1).input).split('Persisted original input').length - 1, 1);
  const long = 'long-content-'.repeat(80) + 'FULL_TAIL_MUST_ARRIVE';
  await h.send(long);
  assert.match(JSON.stringify(h.server.requests.at(-1).input), /FULL_TAIL_MUST_ARRIVE/);
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, original.threadId);
});


test('native fork inherits creation tools and history once while preserving the parent binding', async t => {
  const h = await profileHarness(t);
  await h.send('Parent-marker-one');
  await h.send('Parent-marker-two');
  const parent = await h.ctx.codexCli.bindingRecord(h.agent.session.id);
  await editChoices(h.ctx, () => false);
  const child = await h.fork('forked-with-original-tools');
  await h.send('Child-marker-only', child);
  const binding = await h.ctx.codexCli.bindingRecord(child.session.id);
  assert.notEqual(binding.threadId, parent.threadId);
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, parent.threadId);
  assert.deepEqual(h.server.requests.at(-1).tools.filter(row => row.name?.startsWith('kmh-')).map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b']);
  const input = JSON.stringify(h.server.requests.at(-1).input);
  for (const marker of ['Parent-marker-one', 'Parent-marker-two', 'Child-marker-only']) assert.equal(input.split(marker).length - 1, 1, marker);
  const fork = h.rpcs.find(row => row.method === 'thread/fork');
  assert.equal(fork.params.threadId, parent.threadId);
  assert.equal(fork.params.lastTurnId, parent.lastTurnId);
});

test('editing the first input forks before its native turn and sends the replacement in full once', async t => {
  const h = await profileHarness(t);
  await h.send('Original-first-marker');
  const parent = await h.ctx.codexCli.bindingRecord(h.agent.session.id);
  await editChoices(h.ctx, () => false);
  const events = h.agent.session.snapshotEvents();
  const originalTurn = events.find(row => row.type === 'turn/start');
  const boundary = events.findLast(row => row.seq < originalTurn.seq && row.type === 'agent/created')?.seq;
  const child = await h.fork('edited-first-input', h.agent, boundary ?? -1);
  const replacement = 'replacement-'.repeat(80) + 'EDITED_FULL_TAIL';
  await h.send(replacement, child);
  const binding = await h.ctx.codexCli.bindingRecord(child.session.id);
  assert.ok(binding.threadId);
  assert.notEqual(binding.threadId, parent.threadId);
  const input = JSON.stringify(h.server.requests.at(-1).input);
  assert.equal(input.includes('Original-first-marker'), false);
  assert.equal(input.split('EDITED_FULL_TAIL').length - 1, 1);
  assert.deepEqual(h.server.requests.at(-1).tools.filter(row => row.name?.startsWith('kmh-')).map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b']);
  const fork = h.rpcs.find(row => row.method === 'thread/fork');
  assert.equal(fork.params.beforeTurnId, parent.turns[0].turnId);
  assert.equal(fork.params.lastTurnId, undefined);
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, parent.threadId);
});


test('a missing native session reports recovery failure without creating a replacement', async t => {
  const h = await profileHarness(t);
  await h.send('Original session to preserve');
  const original = await h.ctx.codexCli.bindingRecord(h.agent.session.id);
  const files = (await import('node:fs/promises')).readdir;
  const { rm } = await import('node:fs/promises');
  async function removeSession(dir) {
    for (const entry of await files(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await removeSession(path);
      else if (entry.name.includes(original.threadId)) await rm(path);
    }
  }
  await removeSession(join(h.home, 'codex-home/sessions'));
  const starts = h.rpcs.filter(row => row.method === 'thread/start').length;
  const requests = h.server.requests.length;
  await h.send('Continue after native file is missing');
  assert.equal(h.server.requests.length, requests);
  assert.equal(h.rpcs.filter(row => row.method === 'thread/start').length, starts);
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, original.threadId);
  assert.equal(h.ctx.codexCli.liveSnapshot().sessions.at(-1).color, 'red');
});


test('saving the first native id must succeed before any business turn starts', async t => {
  let accepted;
  const h = await profileHarness(t, { beforeRpc(frame) {
    if (frame.method !== 'thread/start') return;
    const file = join(h.home, 'data/codex-bindings.json');
    accepted = readFileSync(file, 'utf8');
    renameSync(file, file + '.accepted');
    mkdirSync(file);
  } });
  const { rename, rm } = await import('node:fs/promises');
  const file = join(h.home, 'data/codex-bindings.json');
  const backup = file + '.accepted';
  t.after(async () => { if (accepted !== undefined) { await rm(file, { recursive: true }); await rename(backup, file); } });
  await h.send('Business input whose saved id fails');
  assert.equal(h.rpcs.filter(row => row.method === 'thread/start').length, 1);
  assert.equal(h.rpcs.filter(row => row.method === 'turn/start').length, 0);
  assert.equal(h.server.requests.length, 0);
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, undefined);
  assert.equal(readFileSync(backup, 'utf8'), accepted);
  assert.equal(h.ctx.codexCli.liveSnapshot().sessions.at(-1).color, 'red');
});

test('resuming an old binding without creation tools fails and preserves its native id', async t => {
  const h = await profileHarness(t, { persistence: true });
  await h.send('Original tools must be recoverable');
  const { writeFile } = await import('node:fs/promises');
  const file = join(h.home, 'data/codex-bindings.json');
  const records = JSON.parse(readFileSync(file, 'utf8'));
  const original = records[h.agent.session.id].threadId;
  delete records[h.agent.session.id].toolPolicy;
  const legacy = JSON.stringify(records);
  await writeFile(file, legacy);
  const starts = h.rpcs.filter(row => row.method === 'thread/start').length;
  const requests = h.server.requests.length;
  await assert.rejects(h.restart(), /CODEX_SESSION_STATE_INCOMPLETE/);
  assert.equal(h.rpcs.filter(row => row.method === 'thread/start').length, starts);
  assert.equal(h.server.requests.length, requests);
  assert.equal(readFileSync(file, 'utf8'), legacy);
  assert.equal(JSON.parse(legacy)[h.agent.session.id].threadId, original);
});


test('the actual Selector can unload and reload while Codex preserves old tools and accepts new defaults', async t => {
  const h = await profileHarness(t, { withSelector: true });
  await h.send('Original conversation before disabling Selector');
  const original = await h.ctx.codexCli.bindingRecord(h.agent.session.id);
  const codexEntry = h.ctx.configEditor.entries().find(row => row.options.id === 'codex-entry');
  const codexOwner = codexEntry.fiber;
  const controller = h.ctx.configEditor.entries().find(row => row.options.id === 'selector-controller');
  const ui = h.ctx.configEditor.entries().find(row => row.options.id === 'selector-ui');
  assert.ok(h.ctx.cliToolsController.targets().entries.some(row => row.id === 'codex-entry'));
  await controller.update({ disabled: true });
  await ui.update({ disabled: true });
  await h.ctx.loader.await();
  assert.equal(h.ctx.get('cliToolsController'), undefined);
  assert.equal(codexEntry.fiber, codexOwner);
  await editChoices(h.ctx, row => row.name === 'kmh-fixture_b');
  await h.send('Continue original conversation while Selector is disabled');
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, original.threadId);
  assert.deepEqual(h.server.requests.at(-1).tools.map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b']);
  const fresh = await h.create('selector-disabled-fresh');
  await h.send('New conversation while Selector is disabled', fresh);
  assert.deepEqual(h.server.requests.at(-1).tools.map(row => row.name), ['kmh-fixture_b']);
  await controller.update({ disabled: false });
  await ui.update({ disabled: false });
  await h.ctx.loader.await();
  assert.ok(h.ctx.cliToolsController.targets().entries.some(row => row.id === 'codex-entry'));
  const descriptor = h.ctx.settings.describe().find(row => row.ns === 'codex-entry');
  assert.deepEqual(descriptor.value.toolSelection.harness.filter(row => row.enabled).map(row => row.name), ['kmh-fixture_b']);
  assert.equal(codexEntry.fiber, codexOwner);
});

test('closing C gives a new session only A and B while the original session retains A B C', async t => {
  const h = await profileHarness(t, { extraFixtures: true, beforeCreate: ctx => editChoices(ctx, row => row.name !== 'kmh-fixture_d') });
  await h.send('Original A B C conversation');
  const original = await h.ctx.codexCli.bindingRecord(h.agent.session.id);
  await editChoices(h.ctx, row => row.name === 'kmh-fixture_a' || row.name === 'kmh-fixture_b');
  const fresh = await h.create('new-with-a-b');
  await h.send('New A B conversation', fresh);
  assert.deepEqual(h.server.requests.at(-1).tools.map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b']);
  const created = await h.ctx.codexCli.bindingRecord(fresh.session.id);
  assert.notEqual(created.threadId, original.threadId);
  await h.send('Continue original A B C conversation');
  assert.equal((await h.ctx.codexCli.bindingRecord(h.agent.session.id)).threadId, original.threadId);
  assert.deepEqual(h.server.requests.at(-1).tools.map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b', 'kmh-fixture_c']);
  const starts = h.rpcs.filter(row => row.method === 'thread/start');
  assert.equal(starts.length, 2);
  assert.deepEqual(starts[1].params.dynamicTools.map(row => row.name), ['kmh-fixture_a', 'kmh-fixture_b']);
  assert.equal(h.rpcs.some(row => row.method === 'thread/fork'), false);
});
