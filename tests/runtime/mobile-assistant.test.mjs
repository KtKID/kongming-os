/** 移动助手真实 profile 的工具、技能目录和持久会话回归。 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { root } from '../../scripts/kmh.mjs';

test('mobile-assistant profile 加载助手 preset 与精简工具', t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-mobile-assistant-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const result = spawnSync(process.execPath, [join(root, 'scripts/kmh.mjs'), 'dsh', '--profile', 'kmh-mobile-assistant', '--dump-config'], {
    cwd: root, env: { ...process.env, KMH_HOME: home }, encoding: 'utf8', timeout: 30000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /id: mobile-assistant/);
  assert.match(result.stdout, /includeDefaultRoots: false/);
  for (const value of ['@kmh/codex-cli', '@kmh/zcode-cli', 'provider: codex-cli', 'model: gpt-6.1-sol', 'reasoningEffort: medium']) assert.ok(result.stdout.includes(value), value);
  assert.doesNotMatch(result.stdout, /dsh-experimental-computer-use|dsh-browser-use/);
  const catalog = JSON.parse(readFileSync(join(root, 'bundles/mobile-assistant/skills.json'), 'utf8'));
  assert.ok(catalog.skills.includes('mademe-save'));
  assert.ok(catalog.skills.includes('fnos'));
  for (const name of ['x-dev', 'x-req', 'x-spec', 'x-qa-gate', 'x-tech-design', 'x-writer', 'khazix-writer', 'feynman-learn', 'interactive-teaching', 'x-paper-baseread', 'x-paper-reader', 'x-music-mcp', 'xmusic-recommend', 'x-vidkit', 'x-video-aitech']) assert.ok(catalog.skills.includes(name), name);
});

/** 真实启动器和本地模型服务验证 model-visible 工具、技能与跨进程历史恢复。 */
test('移动助手真实 SDK 会话跨进程恢复，并向模型提供精选工具与技能', { timeout: 45000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'kmh-mobile-sdk-'));
  const cwd = join(home, 'workspace');
  mkdirSync(cwd);
  const requests = [];
  const model = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const request = JSON.parse(body);
    requests.push(request);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const scripted = [
      { name: 'skill', input: { name: 'mademe-save' } },
      ...['x-writer', 'feynman-learn', 'x-paper-baseread', 'xmusic-recommend', 'x-vidkit'].map(name => ({ name: 'skill', input: { name } })),
      { name: 'write', input: { file_path: 'assistant-note.txt', content: 'MOBILE_FILE_EVIDENCE\n' } },
      { name: 'read', input: { file_path: 'assistant-note.txt' } },
    ][requests.length - 1];
    const events = [
      { type: 'message_start', message: { id: 'mobile-test', model: 'deepseek-flash', usage: { input_tokens: 10, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: scripted
        ? { type: 'tool_use', id: `mobile-tool-${requests.length}`, ...scripted }
        : { type: 'text', text: '' } },
      ...scripted ? [] : [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '移动助手测试回复' } }],
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: scripted ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 5 } },
      { type: 'message_stop' },
    ];
    res.end(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''));
  });
  model.listen(0, '127.0.0.1');
  await once(model, 'listening');
  t.after(() => new Promise(resolve => model.close(resolve)));
  const port = model.address().port;
  const children = new Set();
  t.after(async () => {
    await Promise.all([...children].map(async child => { const closed = once(child, 'close'); child.kill(); await closed; }));
    rmSync(home, { recursive: true, force: true });
  });
  function start() {
    const child = spawn(process.execPath, [join(root, 'scripts/kmh.mjs'), 'dsh', '--profile', 'kmh-mobile-assistant'], {
      cwd, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, KMH_HOME: home, DEEPSEEK_API_KEY: 'test-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${port}`, DSH_TELEMETRY_DISABLED: '1' },
    });
    children.add(child);
    let stderr = '';
    let nextId = 0;
    const pending = new Map();
    const idleWaiters = new Set();
    child.stderr.on('data', chunk => { stderr += chunk; });
    createInterface({ input: child.stdout }).on('line', line => {
      let frame;
      try { frame = JSON.parse(line); } catch { return; }
      if (frame.id !== undefined) pending.get(frame.id)?.(frame);
      if (frame.method === 'session.event' && frame.params.event.type === 'turn/end') {
        for (const waiter of idleWaiters) {
          if (frame.params.event.data.reason.kind !== 'completed') waiter.reject(new Error(`SDK turn ended: ${JSON.stringify(frame.params.event.data)}`));
          waiter.ended = true;
        }
      }
      if (frame.method === 'session.status' && frame.params.status === 'idle') {
        for (const waiter of idleWaiters) if (waiter.ended) { waiter.resolve(); idleWaiters.delete(waiter); }
      }
    });
    child.on('close', () => { children.delete(child); for (const reject of pending.values()) reject({ error: { message: stderr || 'SDK exited' } }); });
    const request = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => reject(new Error(`${method} timeout: ${stderr}`)), 15000);
      pending.set(id, frame => {
        clearTimeout(timer); pending.delete(id);
        if (frame.error) reject(new Error(frame.error.message + '\n' + stderr)); else resolve(frame.result);
      });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
    return {
      request,
      prompt: async text => {
        const idle = new Promise((resolve, reject) => {
          const waiter = { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); idleWaiters.delete(waiter); reject(error); }, ended: false };
          const timer = setTimeout(() => { idleWaiters.delete(waiter); reject(new Error('idle timeout: ' + stderr)); }, 15000);
          idleWaiters.add(waiter);
        });
        await Promise.all([request('session/prompt', { sessionId: 'mobile-assistant-recovery', contentBlocks: [{ type: 'text', text }] }), idle]);
      },
      close: async () => { const closed = once(child, 'close'); await request('shutdown'); await closed; },
    };
  }
  const first = start();
  await first.request('initialize', { cwd, provider: 'deepseek-official', model: 'deepseek-flash' });
  await first.prompt('MOBILE_FIRST_TURN_EVIDENCE');
  assert.equal(readFileSync(join(cwd, 'assistant-note.txt'), 'utf8'), 'MOBILE_FILE_EVIDENCE\n');
  const loadedSkills = JSON.stringify(requests.at(-1).messages);
  assert.match(loadedSkills, /先选模式/);
  for (const heading of ['# X Writer', '# feynman-learn', '# x-paper-baseread', '# xmusic-recommend', '# x-vidkit']) assert.ok(loadedSkills.includes(heading), heading);
  await first.prompt('MOBILE_SECOND_TURN_EVIDENCE');
  assert.match(JSON.stringify(requests.at(-1).messages), /MOBILE_FIRST_TURN_EVIDENCE/);
  const names = requests[0].tools.map(tool => tool.function?.name ?? tool.name).sort();
  for (const name of ['subagent', 'subagent_fork', 'workflow', 'plugin_manager']) assert.ok(names.includes(name), name);
  assert.equal(names.some(name => /computer|browser|cua/i.test(name)), false);
  assert.deepEqual(names, JSON.parse(readFileSync(join(root, 'tests/runtime/expected/mobile-assistant-tools.json'), 'utf8')));
  const firstRequest = JSON.stringify(requests[0]);
  assert.match(firstRequest, /Kongming 移动助手/);
  assert.doesNotMatch(firstRequest, /x-learn|x-vocal-separate/);
  for (const skill of JSON.parse(readFileSync(join(root, 'bundles/mobile-assistant/skills.json'), 'utf8')).skills) assert.ok(firstRequest.includes(skill), skill);
  await first.close();
  const second = start();
  await second.request('initialize', { cwd, provider: 'deepseek-official', model: 'deepseek-flash' });
  await second.prompt('MOBILE_AFTER_RESTART_EVIDENCE');
  const resumed = JSON.stringify(requests.at(-1).messages);
  assert.match(resumed, /MOBILE_FIRST_TURN_EVIDENCE/);
  assert.match(resumed, /MOBILE_SECOND_TURN_EVIDENCE/);
  await second.close();
});
