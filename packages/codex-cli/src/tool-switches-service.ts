/**
 * 工具开关清单的拼装与切换行映射：本插件自报"我的开关"，详情页选择器只消费。
 * listToolSwitches 读目录与配置拼清单；applyToolSwitch 把一次切换映射为
 * toolSelection 的行并经公开 settings 服务带修订号写入，失败原样抛出。
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-settings";
import type { CodexCli } from "./index.ts";
import type { CodexToolPolicy } from "./tool-policy.ts";
import {
  choiceEnabled,
  type CliToolCatalog,
  type ReadonlyToolSelection,
  type ToolSelection,
} from "./tool-selection.ts";
import {
  NativeSwitchId,
  ToolSwitchListSchema,
  type ToolSwitch,
  type ToolSwitchList,
  type ToolSwitchUpdate,
} from "./tool-switches.ts";

const NATIVE_SOURCE = "codex/native";
const KMH_ID_PREFIX = "kmh:";
/** 原生能力覆盖的 Codex 工具名；命令执行三者共用一个 -c 覆盖，必须一起写。 */
const NATIVE_COVERS: Record<NativeSwitchId, readonly string[]> = {
  "native:command-execution": ["exec_command", "write_stdin", "shell_command"],
  "native:file-change": ["apply_patch"],
  "native:view-image": ["view_image"],
  "native:web-search": ["web_search"],
};

function requirePolicy(runtime: CodexCli): CodexToolPolicy {
  if (runtime.toolPolicy === undefined)
    throw new Error("CODEX_TOOL_POLICY_UNAVAILABLE");
  return runtime.toolPolicy;
}

function revisionOf(ctx: Context, targetId: string): number {
  const settings = ctx.get("settings");
  if (settings === undefined)
    throw new Error("CODEX_TOOL_SWITCHES_NEED_PROFILE_SETTINGS");
  const descriptor = settings
    .describe()
    .find((row) => String(row.ns) === targetId);
  if (descriptor === undefined)
    throw new Error("CODEX_TOOL_SWITCHES_NEED_WRITABLE_PROFILE");
  return descriptor.revision;
}

/** 原生能力的当前值：取其首个覆盖行；web_search 行尚不存在时回落旧设置。 */
function nativeEnabled(
  runtime: CodexCli,
  choices: ReadonlyToolSelection,
  id: NativeSwitchId,
): boolean {
  const name = NATIVE_COVERS[id][0];
  const row = choices.native.find(
    (item) => item.source === NATIVE_SOURCE && item.name === name,
  );
  if (row !== undefined) return row.enabled;
  return id === "native:web-search"
    ? runtime.settings.selection.webSearch
    : false;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function assemble(
  runtime: CodexCli,
  ctx: Context,
  targetId: string,
  catalog: CliToolCatalog,
  choices: ReadonlyToolSelection,
): ToolSwitchList {
  const kmh: ToolSwitch[] = catalog.tools
    .filter((row) => row.side === "harness")
    .sort((a, b) => compare(a.name, b.name))
    .map((row) => ({
      id: KMH_ID_PREFIX + row.name,
      name: row.name,
      description: row.description,
      enabled: choiceEnabled(choices, row),
      covers: [],
    }));
  const native: ToolSwitch[] = NativeSwitchId.options.map((id) => ({
    id,
    name: id.slice("native:".length),
    description:
      catalog.tools.find(
        (row) => row.side === "native" && row.name === NATIVE_COVERS[id][0],
      )?.description ?? "",
    enabled: nativeEnabled(runtime, choices, id),
    covers: [...NATIVE_COVERS[id]],
  }));
  return ToolSwitchListSchema.parse({
    target: "codex-cli",
    revision: revisionOf(ctx, targetId),
    kmh,
    native,
    nativeStatus:
      catalog.diagnostics?.native === undefined
        ? { ok: true }
        : { ok: false, reason: catalog.diagnostics.native },
  });
}

/**
 * 读取当前开关清单。
 * @param runtime 插件运行时。
 * @param ctx 插件上下文（取 settings 修订号）。
 * @param signal 取消信号。
 * @param refresh 是否清除原生目录缓存重新发现（详情页"重新读取"）。
 * @returns 经契约校验的清单；原生诊断进入 nativeStatus 而不抛错。
 * @throws CODEX_TOOL_SELECTION_UNINITIALIZED 首次导入失败、配置仍为空。
 */
export async function listToolSwitches(
  runtime: CodexCli,
  ctx: Context,
  signal: AbortSignal,
  refresh: boolean,
): Promise<ToolSwitchList> {
  const policy = requirePolicy(runtime);
  const catalog = await policy.catalog(signal, refresh);
  const choices = runtime.config.toolSelection.get();
  if (choices === undefined)
    throw new Error(
      `CODEX_TOOL_SELECTION_UNINITIALIZED${catalog.diagnostics?.harness === undefined ? "" : `: ${catalog.diagnostics.harness}`}`,
    );
  return assemble(runtime, ctx, String(policy.targetId), catalog, choices);
}

function upsert(
  rows: ToolSelection["harness"],
  source: string,
  name: string,
  enabled: boolean,
  matchSource: boolean,
): void {
  const row = rows.find(
    (item) => item.name === name && (!matchSource || item.source === source),
  );
  if (row === undefined) rows.push({ source, name, enabled });
  else row.enabled = enabled;
}

/**
 * 应用一次切换：映射为 toolSelection 的行并写入 profile 配置，返回新清单。
 * @throws CLI_TOOL_SWITCH_UNKNOWN 身份不在当前清单内。
 * @throws SettingsConflictError 修订号与当前不符（由 settings 服务抛出）。
 */
export async function applyToolSwitch(
  runtime: CodexCli,
  ctx: Context,
  update: ToolSwitchUpdate,
  signal: AbortSignal,
): Promise<ToolSwitchList> {
  const policy = requirePolicy(runtime);
  const catalog = await policy.catalog(signal, false);
  const current = runtime.config.toolSelection.get();
  if (current === undefined)
    throw new Error("CODEX_TOOL_SELECTION_UNINITIALIZED");
  const next: ToolSelection = {
    version: 1,
    harness: current.harness.map((row) => ({ ...row })),
    native: current.native.map((row) => ({ ...row })),
  };
  if (update.id.startsWith(KMH_ID_PREFIX)) {
    const name = update.id.slice(KMH_ID_PREFIX.length);
    const known = catalog.tools.some(
      (row) => row.side === "harness" && row.name === name,
    );
    if (!known) throw new Error(`CLI_TOOL_SWITCH_UNKNOWN: ${update.id}`);
    // KMH 行按名称匹配：旧配置可能带其他来源 id，保留原行只改状态。
    upsert(next.harness, "harness", name, update.enabled, false);
  } else {
    const parsed = NativeSwitchId.safeParse(update.id);
    if (!parsed.success)
      throw new Error(`CLI_TOOL_SWITCH_UNKNOWN: ${update.id}`);
    for (const name of NATIVE_COVERS[parsed.data])
      upsert(next.native, NATIVE_SOURCE, name, update.enabled, true);
  }
  const settings = ctx.get("settings");
  if (settings === undefined)
    throw new Error("CODEX_TOOL_SWITCHES_NEED_PROFILE_SETTINGS");
  await settings.update(
    String(policy.targetId),
    { toolSelection: next },
    update.revision,
  );
  return listToolSwitches(runtime, ctx, signal, false);
}
