/** 工具与技能隔离：允许清单式裁剪模型目录、按选择关闭原生能力、生成进程 -c 覆盖。 */
import type { Context } from "@deepseek-ai/cordis";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config } from "./config.ts";
import { selectionFromLegacy, type NativeSelection } from "./capabilities.ts";
import { connectCodex, type CodexConnection } from "./connection.ts";
import { ModelListResult, fieldOf, shallowCopy } from "./protocol.ts";

/** 隔离准备结果：-c 覆盖数组与裁剪目录路径。 */
export interface IsolationPlan {
  configOverrides: string[];
  catalogPath: string;
  /** 本轮发现并关闭的原生技能路径。 */
  disabledSkills: string[];
}

/** 隔离输入。 */
export interface IsolationInput {
  cwd: string;
  signal: AbortSignal;
  /** 逐项选择覆盖；缺省按部署旧开关迁移。 */
  selection?: NativeSelection | undefined;
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
/** probe 验证过的每模型基础裁剪字段：工具模式直通、未开放的原生工具清空。 */
const BASE_PRUNED_MODEL_FIELDS: Record<string, unknown> = {
  tool_mode: "direct",
  experimental_supported_tools: [],
  multi_agent_version: "disabled",
  use_responses_lite: false,
  include_apps_usage_instructions: false,
  include_plugin_usage_instructions: false,
};
/** 各选择项未开放时追加的裁剪字段（允许清单：关一项裁一项）。 */
const ITEM_PRUNED_MODEL_FIELDS: readonly {
  key: keyof NativeSelection;
  fields: Record<string, unknown>;
}[] = [
  { key: "commandExecution", fields: { shell_type: "disabled" } },
  { key: "fileChange", fields: { apply_patch_tool_type: null } },
  { key: "webSearch", fields: { supports_search_tool: false } },
  { key: "skills", fields: { include_skills_usage_instructions: false } },
];
/**
 * 官方 CLI `-c` 进程参数的基础功能关闭集合（probe 与冒烟验证过）。
 * 基础隔离不随选择开放：多 agent、apps、插件、目标、Code Mode 等始终关闭；
 * 逐项可开放的（shell_tool、view_image）按选择条件注入。每项对应
 * `features.<名称>=false`：只影响本次进程，不落任何配置文件。
 */
const FEATURE_OFF_BASE = [
  // 关闭多 agent 编排（两代开关都关）。
  "multi_agent",
  "multi_agent_v2",
  // 关闭 Codex 应用（apps）能力。
  "apps",
  // 关闭插件市场装载（dynamic tools 不受影响）。
  "plugins",
  // 关闭目标（goals）能力。
  "goals",
  // 关闭 token 预算控制：用量统计由 KMH 侧完成。
  "token_budget",
  // 关闭记忆（memories）读写。
  "memories",
  // 关闭 Code Mode 嵌套 agent 与其独占模式。
  "code_mode",
  "code_mode_only",
  // 关闭休眠定时工具。
  "sleep_tool",
  // 关闭当前时间提醒注入。
  "current_time_reminder",
] as const;
/** 逐项可开放的功能开关：选择项关闭时才注入对应 features.<名>=false。 */
const ITEM_FEATURE_OFF: readonly {
  key: keyof NativeSelection;
  features: string[];
}[] = [
  { key: "commandExecution", features: ["shell_tool"] },
  { key: "viewImage", features: ["view_image"] },
];

/** 探针发现结果：技能路径与用户/项目级钩子 key。 */
interface Discovery {
  skills: string[];
  hookKeys: string[];
}
/**
 * 探针进程上发现会话范围的原生技能路径与用户钩子。
 * 钩子 key 形如 `<hooks.json 路径>:<事件>:<组序>:<项序>`，是
 * `hooks.state` 禁用配置的键；user/project 来源都收集（KMH 回合
 * 不应触发用户本机钩子）。
 * @param ctx - 宿主上下文。
 * @param config - 插件配置。
 * @param input - 会话工作目录与中止信号。
 * @throws CODEX_SKILLS_DISCOVERY_FAILED 发现请求失败。
 */
async function discoverUserCapabilities(
  ctx: Context,
  config: Config,
  input: IsolationInput,
): Promise<Discovery> {
  const connection: CodexConnection = await connectCodex(
    ctx,
    {
      command: config.command,
      cwd: input.cwd,
      configOverrides: [],
      env: config.env,
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
    const rawHooks: unknown = await connection.request(
      "hooks/list",
      { cwds: [input.cwd] },
      input.signal,
    );
    const hookKeys: string[] = [];
    for (const entry of HooksListResult.parse(rawHooks).data)
      for (const hook of entry.hooks)
        if (
          hook.enabled &&
          (hook.source === "user" || hook.source === "project") &&
          !hookKeys.includes(hook.key)
        )
          hookKeys.push(hook.key);
    return { skills: paths, hookKeys };
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
/** hooks/list 响应形态（只取禁用所需字段）。 */
const HooksListResult = z.object({
  data: z.array(
    z.object({
      hooks: z.array(
        z.object({
          key: z.string(),
          source: z.string(),
          enabled: z.boolean(),
        }),
      ),
    }),
  ),
});

/**
 * 按选择计算每模型裁剪字段（允许清单：基础 + 未开放项的追加）。
 * @param selection - 逐项选择。
 * @returns 将覆盖到目录每个模型上的字段表。
 */
export function prunedFieldsFor(
  selection: NativeSelection,
): Record<string, unknown> {
  const fields: Record<string, unknown> = { ...BASE_PRUNED_MODEL_FIELDS };
  for (const item of ITEM_PRUNED_MODEL_FIELDS)
    if (!selection[item.key]) Object.assign(fields, item.fields);
  return fields;
}
/**
 * 按选择计算功能关闭集合（基础始终关闭 + 未开放项的条件关闭）。
 * @param selection - 逐项选择。
 * @returns 将注入 `features.<名>=false` 的功能名列表。
 */
export function featureOffFor(selection: NativeSelection): string[] {
  const features: string[] = [...FEATURE_OFF_BASE];
  for (const item of ITEM_FEATURE_OFF)
    if (!selection[item.key]) features.push(...item.features);
  return features;
}
/**
 * 生成隔离计划（允许清单式）：基础隔离始终保留，未选择的项维持关闭、
 * 选中的项开放（目录字段与功能开关按项条件注入），改写 vendored 目录
 * 为裁剪目录并落盘，汇总全部 -c 覆盖。
 * @param ctx - 宿主上下文。
 * @param config - 插件配置；selection 未提供时按旧开关迁移。
 * @param input - 会话工作目录、选择与中止信号。
 * @returns 进程启动参数所需的覆盖数组。
 * @throws CODEX_CATALOG_PRUNE_FAILED 目录读取或改写失败。
 */
export async function prepareIsolation(
  ctx: Context,
  config: Config,
  input: IsolationInput,
): Promise<IsolationPlan> {
  const selection =
    input.selection ?? selectionFromLegacy(config.nativeToolsEnabled);
  const discovered = await discoverUserCapabilities(ctx, config, input);
  const disabledSkills = selection.skills ? [] : discovered.skills;
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
  const prunedFields = prunedFieldsFor(selection);
  const pruned = shallowCopy(
    catalog,
    "CODEX_CATALOG_PRUNE_FAILED: malformed vendored catalog",
  );
  pruned.models = models.map((model) => ({
    ...shallowCopy(model, "CODEX_CATALOG_PRUNE_FAILED: malformed model entry"),
    ...prunedFields,
  }));
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const catalogPath = join(config.dataDir, "kmh-models.json");
  await writeFile(catalogPath, JSON.stringify(pruned));
  // 禁止修改任何 Codex 配置文件：隔离全部经进程 -c 参数注入，只影响本次调用。
  // CODEX_HOME 沿用用户默认（~/.codex）：登录共享、无需额外登录；
  // 用户配置的 MCP 设备随之可见（已拍板接受）。
  const featureOff = featureOffFor(selection);
  const overrides: string[] = [
    // 模型目录指向插件裁剪副本：未开放项的工具能力字段被改写为关闭形态，
    // 选中项保持 vendored 原生值。
    `model_catalog_json=${tomlString(catalogPath)}`,
    // 启动时不检查更新，避免额外网络请求。
    "check_for_update_on_startup=false",
    // 项目说明文档（AGENTS.md 类）注入字节数归零：提示由 KMH 统一提供。
    "project_doc_max_bytes=0",
    // 逐项关闭基础功能（含义见 FEATURE_OFF_BASE 注释）。
    ...featureOff.map((feature) => `features.${feature}=false`),
    // 关闭计划工具（update_plan）：任务规划由 KMH 侧完成。
    "tools.update_plan.enabled=false",
    // 关闭实验性用户输入工具：用户交互走 KMH。
    "tools.experimental_request_user_input.enabled=false",
    // 关闭编排器的技能与 MCP 装载（基础隔离，不随选择开放）。
    "orchestrator.skills.enabled=false",
    "orchestrator.mcp.enabled=false",
    // 关闭遥测分析上报。
    "analytics.enabled=false",
  ];
  if (!selection.webSearch)
    // 关闭联网搜索工具（选中时不注入，保持原生可用）。
    overrides.push(`web_search=${tomlString("disabled")}`);
  if (!selection.skills) {
    overrides.push(
      // 不向模型注入技能使用说明。
      "skills.include_instructions=false",
      // 关闭官方捆绑技能。
      "skills.bundled.enabled=false",
    );
    if (disabledSkills.length > 0)
      overrides.push(
        // 按路径逐个关闭原生技能：堵住 `$技能名` 显式调用触发原生技能的
        // 路径；每回合启动前重新发现（技能目录可能变化）。
        `skills.config=[${disabledSkills
          .map((path) => `{path=${tomlString(path)},enabled=false}`)
          .join(",")}]`,
      );
  }
  if (discovered.hookKeys.length > 0)
    overrides.push(
      // 逐个禁用用户/项目级钩子（hooks.json）：共享 ~/.codex 的连带，
      // KMH 回合不应触发用户本机钩子（userPromptSubmit/stop 等）。
      `hooks.state={${discovered.hookKeys
        .map((key) => `${tomlString(key)}={enabled=false}`)
        .join(",")}}`,
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
