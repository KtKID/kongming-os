import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cliToolDefinition, preparationDefinition } from '../lib/browser-types/src/client/ToolRecords.js';

const event = (kind, data, seq = 2) => ({ type: kind, data, seq, time: 0 });
const match = event => ({ event, role: 'start', location: { kind: 'unresolved' } });
const context = (state, start) => ({ key: 'record', id: 'call', kind: 'cli-tool', matches: [start], start, state, current: new Map() });
test('keeps disabled status, source and result in one replayable native record', () => {
  const start = match(event('cli-tools/tool-observed', { target: 'codex', turn: 1, callId: 'attempt', source: 'codex/native', name: 'exec_command', kind: 'blocked', data: { arguments: '{"cmd":"touch forbidden"}' } }));
  const state = cliToolDefinition.start(context(undefined, start), start);
  const ended = cliToolDefinition.update(context(state, start), match(event('cli-tools/tool-observed', { ...start.event.data, kind: 'result', data: { output: 'unsupported' } }, 3)));
  assert.equal(ended.blocked, true);
  assert.equal(ended.source, 'codex/native');
  assert.equal(ended.name, 'exec_command');
  assert.deepEqual(ended.result, { output: 'unsupported' });
  assert.equal(cliToolDefinition.buildViewNode(context(ended, start)).data.blocked, true);
});
test('preparation failure displays until the same turn and step are prepared', () => {
  const start = match(event('cli-tools/preparation-waiting', { target: 'codex', turn: 2, step: 1, reason: 'version unverified' }));
  const state = preparationDefinition.start(context(undefined, start), start);
  assert.equal(preparationDefinition.buildViewNode(context(state, start)).data.reason, 'version unverified');
  const next = preparationDefinition.update(context(state, start), match(event('cli-tools/turn-prepared', { target: 'codex', turn: 2, step: 1 })));
  assert.equal(preparationDefinition.buildViewNode(context(next, start)), null);
});
