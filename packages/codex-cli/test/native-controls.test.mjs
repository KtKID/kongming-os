/** Actual native schema omission, execution denial and raw attempt observability. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { harness, run } from './support/harness.mjs';
import { configResponse, discoverNativeTools } from '../lib/src/native-tools/catalog.js';

test('native discovery resolves config/read into adjustable native tools', async t => {
  const h = await harness(t, 'native-nullable-config');
  const catalog = await discoverNativeTools(h.ctx, h.config, h.runtime.settings.selection, AbortSignal.timeout(20000), h.config.cwd);
  assert.equal(catalog.diagnostic, undefined);
  assert.equal(catalog.rows.find(row => row.name === 'apply_patch')?.control.kind, 'adjustable');
});

test('config/read accepts unresolved feature flags and rejects malformed values', () => {
  const response = { config: { features: { network_proxy: null, unified_exec: true } } };
  assert.deepEqual(configResponse.parse(response), response);
  assert.throws(() => configResponse.parse({ config: { features: { unified_exec: 'false' } } }));
});

const attempts = [
  ['exec_command', 'function_call', '{"cmd":"touch native-canary"}'],
  ['write_stdin', 'function_call', '{"session_id":123,"chars":"touch native-canary"}'],
  ['shell_command', 'function_call', '{"command":"touch native-canary"}'],
  ['apply_patch', 'custom_tool_call', '*** Begin Patch\n*** Add File: native-canary\n+unexpected\n*** End Patch'],
  ['view_image', 'function_call', '{"path":"native-canary"}'],
];
for (const [name, type, argumentsOrInput] of attempts) {
  test(`native ${name}: omitted, refused and observable`, async t => {
    const toolCall = type === 'custom_tool_call' ? { type, name, input: argumentsOrInput } : { type, name, arguments: argumentsOrInput };
    const h = await harness(t, `native-control-${name}`, { toolCall });
    await run(h.adapter, { messages: [{ role: 'user', content: [{ type: 'text', text: 'Run the fixture.' }] }] });
    assert.equal(existsSync(h.config.cwd + '/native-canary'), false);
    assert.equal(h.server.requests[0].tools.some(tool => (tool.name ?? tool.type) === name), false);
    const output = h.server.requests[1].input.find(item => item.call_id === 'forced-call' && item.type.endsWith('_output'));
    assert.ok(output, 'upstream receives a refusal');
    assert.match(JSON.stringify(output), /unsupported.*call/);
    const raw = h.notifications.filter(item => item.method === 'rawResponseItem/completed').map(item => item.params.item);
    assert.ok(raw.some(item => item.call_id === 'forced-call' && item.name === name), 'actual failed tool attempt is observable');
    assert.ok(raw.some(item => item.call_id === 'forced-call' && item.type.endsWith('_output')), 'actual executor refusal is observable');
  });
}

test('verified version catalog captures actual enabled native declarations', async t => {
  const h = await harness(t, 'native-catalog');
  h.runtime.settings.selection = { commandExecution: true, fileChange: true, viewImage: true, webSearch: true, skills: false };
  await run(h.adapter, { messages: [{ role: 'user', content: [{ type: 'text', text: 'Describe the fixture.' }] }] });
  const manifest = JSON.parse(readFileSync(new URL('../vendor/native-tools/0.162.0-alpha.17.2.json', import.meta.url), 'utf8'));
  assert.deepEqual(h.server.requests[0].tools, manifest.declarations);
});
