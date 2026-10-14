/** 依据已验证的 CLI 版本解析原生工具；未知版本保留待核实状态。 */
import type { Context } from '@deepseek-ai/cordis';
import { ToolSourceId, type CliToolRow } from '../tool-selection.ts';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Config } from '../config.ts';
import type { NativeSelection } from '../capabilities.ts';
import { connectCodex } from '../connection.ts';

/** 当前版本的工具目录及独立诊断。 */
export interface NativeCatalog {
  version: string;
  rows: CliToolRow[];
  overrides: string[];
  diagnostic?: string;
}
const declaration = z.object({ type: z.string(), name: z.string().optional(), description: z.string().optional() }).passthrough();
const manifestSchema = z.object({ version: z.string(), declarations: z.array(declaration) });
/** Codex config/read returns null for feature flags without a resolved boolean. */
export const configResponse = z.object({ config: z.object({ features: z.record(z.string(), z.boolean().nullable()).optional() }).passthrough() });
const mcpResponse = z.object({ data: z.array(z.object({ name: z.string(), tools: z.record(z.string(), z.object({ name: z.string(), description: z.string().optional() }).passthrough()) })), nextCursor: z.string().nullable().optional() });
const source = ToolSourceId('codex/native');

/** 通过受管子进程读取实际版本，完成或取消均等待进程退出。 */
async function versionOf(ctx: Context, config: Config, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  const executable = await ctx.subprocess.resolveExecutable(config.command, config.env, signal);
  signal.throwIfAborted();
  const child = ctx.subprocess.spawn({ argv: [executable, '--version'], cwd: config.cwd, env: config.env, graceMs: config.graceMs, stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' } });
  const stop = (): void => { child.terminate(); };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  try {
    let text = '';
    for await (const chunk of child.stdout ?? []) {
      text += String(chunk);
      if (text.length > 8192) throw new Error('CODEX_VERSION_OUTPUT_TOO_LARGE');
    }
    await child.done;
    signal.throwIfAborted();
    const version = /^codex-cli ([^\s]+)$/m.exec(text)?.[1];
    if (version === undefined) throw new Error('CODEX_VERSION_UNKNOWN');
    return version;
  } finally {
    signal.removeEventListener('abort', stop);
    child.terminate();
    await child.done.catch(() => undefined);
  }
}

/**
 * 发现实际版本和 MCP 名称；可调整项只来自通过执行拒绝测试的版本。
 * @param ctx 提供受管 subprocess 的插件上下文。
 * @param config CLI 部署配置。
 * @param legacy 原生技能及固定工具既有状态。
 * @param signal 本次发现的取消信号。
 * @param cwd 本次会话工作目录。
 * @returns 完整已确认目录、诊断和进程配置覆盖。
 */
export async function discoverNativeTools(ctx: Context, config: Config, legacy: NativeSelection, signal: AbortSignal, cwd: string): Promise<NativeCatalog> {
  const version = await versionOf(ctx, config, signal);
  let manifest: z.infer<typeof manifestSchema>;
  try {
    const path = join(dirname(fileURLToPath(import.meta.url)), '../../../vendor/native-tools', `${version}.json`);
    manifest = manifestSchema.parse(JSON.parse(await readFile(path, 'utf8')));
  } catch (error) {
    return { version, rows: [], overrides: [], diagnostic: `CODEX_NATIVE_VERSION_UNVERIFIED: ${version}; ${error instanceof Error ? error.message : String(error)}` };
  }
  const rows: CliToolRow[] = manifest.declarations.map(item => {
    const name = item.name ?? item.type;
    const control = name === 'exec_command' || name === 'write_stdin'
      ? { kind: 'linked' as const, group: 'command-execution' }
      : name === 'apply_patch' || name === 'view_image' || name === 'web_search'
        ? { kind: 'adjustable' as const }
        : { kind: 'fixed' as const, enabled: legacy.webSearch, reason: 'Provider-side execution control is unverified; the existing choice is retained.' };
    const captured = z.json().parse(item);
    return { side: 'native', source, name, description: item.description ?? '', declaration: captured, control };
  });
  rows.push({ side: 'native', source, name: 'shell_command', description: 'Legacy command handler registered with unified exec.', control: { kind: 'linked', group: 'command-execution' } });
  rows.push({ side: 'native', source, name: 'update_plan', description: 'Plan handler retained by Codex.', control: { kind: 'fixed', enabled: true, reason: 'Codex keeps the plan handler registered independently of its visible declaration.' } });
  const connection = await connectCodex(ctx, { command: config.command, cwd, configOverrides: [], env: config.env, graceMs: config.graceMs, startupTimeoutMs: config.startupTimeoutMs }, signal);
  try {
    const effective = configResponse.parse(await connection.request('config/read', { cwd, includeLayers: false }, signal));
    if (effective.config.features?.['unified_exec'] === false) {
      return { version, rows: rows.map(row => ({ ...row, control: { kind: 'unverified', reason: 'The effective unified_exec=false configuration needs its own compatibility fixture.' } })), overrides: [], diagnostic: 'CODEX_NATIVE_CONFIG_UNVERIFIED: unified_exec=false' };
    }
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const response = mcpResponse.parse(await connection.request('mcpServerStatus/list', { ...(cursor === undefined ? {} : { cursor }), detail: 'toolsAndAuthOnly' }, signal));
      for (const server of response.data) {
        for (const [name, tool] of Object.entries(server.tools)) {
          rows.push({ side: 'native', source: ToolSourceId(`codex/mcp/${server.name}`), sourceLabel: server.name, name, description: tool.description ?? '', control: { kind: 'fixed', enabled: true, reason: 'MCP per-tool execution control needs a verified fixture; the current server remains active.' } });
        }
      }
      cursor = response.nextCursor ?? undefined;
      if (cursor !== undefined && cursors.has(cursor)) throw new Error('CODEX_MCP_CURSOR_REPEATED');
      if (cursor !== undefined) cursors.add(cursor);
    } while (cursor !== undefined);
    return { version, rows, overrides: [] };
  } finally { await connection.stop(config.cleanupTimeoutMs); }
}
