/** Profile Loader, settings document, real Agent loop and official Codex executor. */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { boot, initProfile, readProfilePatches } from '../../../../third_party/dsh/packages/boot/app-boot/lib/index.js';
import ConfigEditor from '../../../../third_party/dsh/packages/boot/config-editor/lib/index.js';
import DefaultModel from '../../../../third_party/dsh/packages/core/agent-default-model/lib/index.js';
import Settings from '../../../../third_party/dsh/packages/settings/settings/lib/index.js';
import Llm, { createUserMessage } from '../../../../third_party/dsh/packages/llm/llm/lib/index.js';
import Sessions, { buildForkSeed } from '../../../../third_party/dsh/packages/core/session/lib/index.js';
import Projection from '../../../../third_party/dsh/packages/session/session-projection/lib/index.js';
import Prompt from '../../../../third_party/dsh/packages/core/system-prompt/lib/index.js';
import Tools, { defineContentToolFixture } from '../../../../third_party/dsh/packages/core/tools/lib/index.js';
import Agents from '../../../../third_party/dsh/packages/core/agent/lib/index.js';
import Loop from '../../../../third_party/dsh/packages/core/agent-loop/lib/index.js';
import Persistence from '../../../../third_party/dsh/packages/session/session-persistence-jsonl/lib/index.js';
import { LocalSubprocessRuntime } from '../../../../third_party/dsh/packages/subprocess/subprocess-local/lib/index.js';
import * as Codex from '../../lib/src/index.js';
import { startModelServer } from './model-server.mjs';
import { until } from './harness.mjs';

/** Build one actual profile; CODEX_HOME and all writes stay inside its temporary directory. */
export async function profileHarness(t, options = {}) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'codex-profile-')));
  const dir = join(home, 'profiles', 'test');
  const cwd = join(home, 'workspace');
  const codexHome = join(home, 'codex-home');
  mkdirSync(cwd); mkdirSync(codexHome);
  let command = process.env.KMH_CODEX_BINARY ?? Codex.Config({ cwd, dataDir: home }).command;
  const versionGate = join(home, 'native-version-ready');
  if (options.versionGate) {
    const wrapper = join(home, 'codex-version-gate');
    const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
    writeFileSync(wrapper, `#!/bin/sh\nif [ "$1" = "--version" ] && [ ! -f ${quote(versionGate)} ]; then echo 'codex-cli 0.0.0-selector-fixture'; exit 0; fi\nexec ${quote(command)} "$@"\n`, { mode: 0o700 });
    command = wrapper;
  }
  const server = await startModelServer(join(home, 'upstream.jsonl'), false, options);
  let ctx;
  t.after(async () => { server.finish(); await ctx?.fiber.dispose(); await server.close(); });
  writeFileSync(join(codexHome, 'config.toml'), [
    'model="gpt-6-sol"', 'model_provider="fixture"', 'model_reasoning_summary="none"',
    '[model_providers.fixture]', 'name="Fixture"', `base_url="${server.base}"`, 'env_key="KMH_CODEX_TEST_KEY"',
    'wire_api="responses"', 'requires_openai_auth=false', 'supports_websockets=false', 'request_max_retries=0',
  ].join('\n'));
  writeFileSync(join(home, 'package.json'), '{"name":"profile-fixture"}\n');
  initProfile(dir, ['test-bundle']);
  writeFileSync(join(dir, 'cordis.yml'), '[]\n');
  const bundle = join(dir, 'node_modules', 'test-bundle'); mkdirSync(bundle, { recursive: true });
  writeFileSync(join(bundle, 'package.json'), JSON.stringify({ name: 'test-bundle', version: '1.0.0', dsh: { bundle: { patch: 'cordis.patch.yml' } } }));
  const config = { command, cwd, dataDir: join(home, 'data'), reasoningSummary: 'none', startupTimeoutMs: 10000, probeTimeoutMs: 20000, cleanupTimeoutMs: 2000, requestTimeoutMs: 30000, ...options.config, env: { CODEX_HOME: codexHome, KMH_CODEX_TEST_KEY: 'fixture-key', HTTP_PROXY: '', HTTPS_PROXY: '', ALL_PROXY: '', NO_PROXY: '127.0.0.1,localhost' } };
  const rows = [
    ['editor', 'editor'], ['settings', 'settings'], ['llm', 'llm'], ['session', 'sessions'], ['projection', 'projection'],
    ['prompt', 'prompt'], ['tools', 'tools'], ['agents', 'agents'], ['agent-loop', 'loop'], ['subprocess', 'subprocess'],
  ].map(([id, name]) => ({ id, name: `cordis:${name}`, ...(name === 'loop' ? { config: { agents: [] } } : {}) }));
  if (options.persistence) rows.push({ required: true, id: 'persistence', name: 'cordis:persistence', config: { root: join(home, 'sessions'), compression: 'none' } });
  rows.push({ id: 'default-model', name: 'cordis:defaultModel', config: { provider: 'codex-cli', model: 'gpt-6-sol' } });
  rows.forEach(row => { row.required = true; });
  rows.push({ required: true, id: 'codex-entry', name: 'cordis:codex', config });
  writeFileSync(join(bundle, 'cordis.patch.yml'), JSON.stringify([{ insert: rows }]));
  const profile = { name: 'test', startedBundles: ['test-bundle'], dir, patchPath: join(dir, 'cordis.patch.yml'), installAnchor: join(home, 'package.json'), cwd: home, home, overlays: [], telemetryDisabledEnv: undefined };
  let executions = 0;
  const rpcs = []; const notifications = []; const children = [];
  async function bootProfile() {
  ctx = await boot('test', join(dir, 'cordis.yml'), readProfilePatches('test', profile), ctx => {
    ctx.provide('profileContext', profile);
    ctx.provide('appReady', { onReady(listener) { listener(); return () => {}; } });
    Object.assign(ctx.loader.builtins, {
      editor: ConfigEditor, settings: Settings, defaultModel: DefaultModel, llm: Llm, sessions: Sessions, projection: Projection, prompt: Prompt,
      tools: Tools, agents: Agents, loop: Loop, persistence: Persistence, subprocess: LocalSubprocessRuntime,
      // Text/tool-policy qualification supplies the exact runtime's consumed services.
      codex: { Config: Codex.Config, inject: ['llm', 'subprocess', 'agents', 'tools'], apply: Codex.apply },
    });
  });
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess);
  ctx.subprocess.spawn = spec => {
    const child = spawn(spec); children.push(child);
    if (child.stdin) {
      const write = child.stdin.write.bind(child.stdin);
      child.stdin.write = (chunk, ...args) => {
        for (const line of String(chunk).split('\n').filter(Boolean)) {
          const frame = JSON.parse(line); rpcs.push(frame);
          appendFileSync(join(home, 'rpc.jsonl'), JSON.stringify(frame) + '\n');
          options.beforeRpc?.(frame);
        }
        return write(chunk, ...args);
      };
    }
    let pending = '';
    child.stdout.on('data', data => {
      if (spec.argv.includes('--version')) return;
      pending += String(data); const lines = pending.split('\n'); pending = lines.pop();
      for (const line of lines.filter(Boolean)) { const frame = JSON.parse(line); if (frame.method) notifications.push(frame); }
    });
    return child;
  };
  ctx.tools.register(defineContentToolFixture({ name: 'fixture_a', description: 'Selected fixture', parameters: {}, async execute() { executions++; return [{ type: 'text', text: 'executed' }]; } }));
  ctx.tools.register(defineContentToolFixture({ name: 'fixture_b', description: 'Other fixture', parameters: {}, async execute() { executions++; return []; } }));
  if (options.extraFixtures) for (const name of ['fixture_c', 'fixture_d']) ctx.tools.register(defineContentToolFixture({ name, description: name, parameters: {}, async execute() { executions++; return [{ type: 'text', text: name + '-executed' }]; } }));
  }
  await bootProfile();
  await options.beforeCreate?.(ctx);
  t.diagnostic(`profile artifacts: ${home}`);
  let agent = await ctx.agentLoop.create('codex-profile-session', { provider: 'codex-cli', model: 'gpt-6-sol' });
  return { get ctx() { return ctx; }, get agent() { return agent; }, server, home, profile, rpcs, notifications, children,
    async restart() { await ctx.sessions.flush(agent.session); await ctx.fiber.dispose(); await bootProfile(); const handle = await ctx.agents.resume({ resumeSessionId: agent.session.id, agentOptions: { provider: 'codex-cli', model: 'gpt-6-sol' } }); agent = handle.agent; },
    async fork(id, source = agent, boundary = source.session.snapshotEvents().findLast(row => row.type === 'turn/end').seq) {
      const seed = boundary < 0 ? [] : buildForkSeed(source.session.snapshotEvents(), boundary);
      const handle = await ctx.agents.create({ sessionId: id, seed, inheritedEventCount: boundary + 1, meta: { parentSession: source.session.id, isSeeded: true, cwd: source.session.header.cwd ?? cwd }, agentOptions: { provider: 'codex-cli', model: 'gpt-6-sol' } });
      return handle.agent;
    },
    async create(id) { return await ctx.agentLoop.create(id, { provider: 'codex-cli', model: 'gpt-6-sol' }); }, releaseNativeVersion: () => writeFileSync(versionGate, ''), executions: () => executions,
    async send(text, target = agent) {
      const ended = target.session.snapshotEvents().filter(event => event.type === 'turn/end').length;
      target.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }));
      await until(() => target.status === 'idle' && target.session.snapshotEvents().filter(event => event.type === 'turn/end').length > ended, 'profile loop idle', 45000);
      const failure = target.session.snapshotEvents().findLast(event => event.type === 'turn/end');
      if (failure.data.finishKind === 'error') t.diagnostic('turn error: ' + JSON.stringify(target.session.snapshotEvents().slice(-4)));
    },
  };
}
