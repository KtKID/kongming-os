/** 工具与技能隔离：裁剪模型目录、发现并关闭原生技能、生成进程 -c 覆盖。 */
import type { Context } from "@deepseek-ai/cordis";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config } from "./config.ts";
import { connectCodex, type CodexConnection } from "./connection.ts";
import { ModelListResult, fieldOf, shallowCopy } from "./protocol.ts";

/** 隔离准备结果：-c 覆盖数组与裁剪目录路径。 */
export interface IsolationPlan {
  configOverrides: string[];
  catalogPath: string;
  /** 本轮发现并关闭的原生技能路径。 */
  disabledSkills: string[];
}
/** Codex 数据目录：位于 KMH 会话数据目录下，与 KMH 当前 home 一致。 */
export function codexHomeDir(config: Config): string {
  return join(config.dataDir, "codex-home");
}
/** 进程环境：CODEX_HOME 指向 KMH 数据目录下的 Codex home，叠加用户配置。 */
export function codexEnv(config: Config): Record<string, string | undefined> {
  return { CODEX_HOME: codexHomeDir(config), ...config.env };
}
/** 隔离输入。 */
export interface IsolationInput {
  cwd: string;
  signal: AbortSignal;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));
/** 包内随附的官方基线目录（未修改的 vendored 副本）。 */
function vendoredCatalogPath(): string {
  return join(moduleDir, "..", "..", "vendor", "codex", "models.json");
}
/** TOML 基本字符串。 */
function tomlString(value: string): string {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}
/** probe 验证过的每模型裁剪字段：工具模式直通、原生工具清空。 */
const PRUNED_MODEL_FIELDS: Record<string, unknown> = {
  tool_mode: "direct",
  shell_type: "disabled",
  apply_patch_tool_type: null,
  experimental_supported_tools: [],
  multi_agent_version: "disabled",
  use_responses_lite: false,
  supports_search_tool: false,
  include_skills_usage_instructions: false,
  include_apps_usage_instructions: false,
  include_plugin_usage_instructions: false,
};
/** probe 验证过的功能关闭集合。 */
const FEATURE_OFF = [
  "shell_tool",
  "view_image",
  "multi_agent",
  "multi_agent_v2",
  "apps",
  "plugins",
  "goals",
  "token_budget",
  "memories",
  "code_mode",
  "code_mode_only",
  "sleep_tool",
  "current_time_reminder",
] as const;

/**
 * 探针进程上发现会话范围的原生技能路径。
 * @param ctx - 宿主上下文。
 * @param config - 插件配置。
 * @param input - 会话工作目录与中止信号。
 * @returns 全部已启用技能的绝对路径；无技能时为空数组。
 * @throws CODEX_SKILLS_DISCOVERY_FAILED 发现请求失败。
 */
async function discoverSkillPaths(
  ctx: Context,
  config: Config,
  input: IsolationInput,
): Promise<string[]> {
  const connection: CodexConnection = await connectCodex(
    ctx,
    {
      command: config.command,
      cwd: input.cwd,
      configOverrides: [],
      env: codexEnv(config),
      graceMs: config.graceMs,
      startupTimeoutMs: config.startupTimeoutMs,
    },
    input.signal,
  );
  try {
    const raw: unknown = await connection.request(
      "skills/list",
      { cwds: [input.cwd], forceReload: false },
      input.signal,
    );
    const entries = SkillListResult.parse(raw);
    const paths: string[] = [];
    for (const entry of entries.data)
      for (const skill of entry.skills)
        if (skill.enabled && !paths.includes(skill.path))
          paths.push(skill.path);
    return paths;
  } catch (error) {
    throw new Error(
      `CODEX_SKILLS_DISCOVERY_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await connection.stop(config.cleanupTimeoutMs);
  }
}
/** skills/list 响应形态。 */
const SkillListResult = z.object({
  data: z.array(
    z.object({
      skills: z.array(z.object({ path: z.string(), enabled: z.boolean() })),
    }),
  ),
});

/**
 * 生成隔离计划：改写 vendored 目录为裁剪目录并落盘，汇总全部 -c 覆盖。
 * @param ctx - 宿主上下文。
 * @param config - 插件配置；nativeToolsEnabled 为 true 时返回空覆盖。
 * @param input - 会话工作目录与中止信号。
 * @returns 进程启动参数所需的覆盖数组。
 * @throws CODEX_CATALOG_PRUNE_FAILED 目录读取或改写失败。
 */
export async function prepareIsolation(
  ctx: Context,
  config: Config,
  input: IsolationInput,
): Promise<IsolationPlan> {
  if (config.nativeToolsEnabled)
    return { configOverrides: [], catalogPath: "", disabledSkills: [] };
  // CLI 启动即校验 CODEX_HOME 存在：先建目录再起探针。
  await mkdir(codexHomeDir(config), { recursive: true, mode: 0o700 });
  const disabledSkills = await discoverSkillPaths(ctx, config, input);
  let catalog: unknown;
  try {
    const text: unknown = await readFile(vendoredCatalogPath(), "utf8");
    catalog = JSON.parse(typeof text === "string" ? text : "");
  } catch (error) {
    throw new Error(
      `CODEX_CATALOG_PRUNE_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const models = fieldOf(catalog, "models");
  if (!Array.isArray(models))
    throw new Error("CODEX_CATALOG_PRUNE_FAILED: malformed vendored catalog");
  const pruned = shallowCopy(
    catalog,
    "CODEX_CATALOG_PRUNE_FAILED: malformed vendored catalog",
  );
  pruned.models = models.map((model) => ({
    ...shallowCopy(model, "CODEX_CATALOG_PRUNE_FAILED: malformed model entry"),
    ...PRUNED_MODEL_FIELDS,
  }));
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const catalogPath = join(config.dataDir, "kmh-models.json");
  await writeFile(catalogPath, JSON.stringify(pruned));
  // 禁止修改任何 Codex 配置文件：隔离全部经进程 -c 参数注入，只影响本次调用。
  // 独立 CODEX_HOME 为空配置，用户 MCP 设备与内置 MCP 工具从源头不存在。
  const overrides: string[] = [
    `model_catalog_json=${tomlString(catalogPath)}`,
    `web_search=${tomlString("disabled")}`,
    "check_for_update_on_startup=false",
    "project_doc_max_bytes=0",
    ...FEATURE_OFF.map((feature) => `features.${feature}=false`),
    "tools.update_plan.enabled=false",
    "tools.experimental_request_user_input.enabled=false",
    "skills.include_instructions=false",
    "skills.bundled.enabled=false",
    "orchestrator.skills.enabled=false",
    "orchestrator.mcp.enabled=false",
    "analytics.enabled=false",
  ];
  if (disabledSkills.length > 0)
    overrides.push(
      `skills.config=[${disabledSkills
        .map((path) => `{path=${tomlString(path)},enabled=false}`)
        .join(",")}]`,
    );
  return { configOverrides: overrides, catalogPath, disabledSkills };
}

/**
 * 隔离生效核对：正式进程目录必须来自裁剪文件。
 * @param connection - 已带隔离覆盖启动的连接。
 * @param plan - 本次隔离计划。
 * @param signal - 中止信号。
 * @throws CODEX_ISOLATION_FAILED 目录与裁剪文件不一致。
 */
export async function verifyIsolation(
  connection: CodexConnection,
  plan: IsolationPlan,
  signal: AbortSignal,
): Promise<void> {
  if (plan.catalogPath === "") return;
  const raw: unknown = await connection.request(
    "model/list",
    { includeHidden: false },
    signal,
  );
  const live = ModelListResult.parse(raw);
  let prunedIds: Set<string>;
  try {
    const text: unknown = await readFile(plan.catalogPath, "utf8");
    const catalog: unknown = JSON.parse(typeof text === "string" ? text : "");
    const models = fieldOf(catalog, "models");
    prunedIds = new Set(
      (Array.isArray(models) ? models : [])
        .map((model) => fieldOf(model, "slug"))
        .filter((slug): slug is string => typeof slug === "string"),
    );
  } catch {
    throw new Error("CODEX_ISOLATION_FAILED: unreadable pruned catalog");
  }
  for (const entry of live.data)
    if (!prunedIds.has(entry.id))
      throw new Error(
        `CODEX_ISOLATION_FAILED: live catalog has ${entry.id} outside pruned set`,
      );
}
