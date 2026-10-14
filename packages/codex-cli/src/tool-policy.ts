/** CLI 自有工具策略：profile Config 首次导入、回合冻结和执行器拒绝。 */
import type { Entry } from "@deepseek-ai/cordis-plugin-loader";
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/dsh-tools";
import type { Agent, SessionStartSource } from "@deepseek-ai/dsh-agent";
import type { GenerateOptions } from "@deepseek-ai/dsh-llm";
import {
  CliTargetId,
  ToolSourceId,
  choiceEnabled,
  type CliToolCatalog,
  type CliToolRow,
  type SavedInventoryEntry,
  type ToolSelection,
  type ReadonlyToolSelection,
} from "./tool-selection.ts";
import { deepFreeze } from "@deepseek-ai/dsh-util-values";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  discoverNativeTools,
  type NativeCatalog,
} from "./native-tools/catalog.ts";
import type { CodexCli } from "./index.ts";
import type { NativeSelection } from "./capabilities.ts";
import { connectCodex } from "./connection.ts";
import { prepareIsolation, verifyIsolation } from "./isolation.ts";
import { SavedToolPolicySchema } from "./session-store.ts";
import { KMH_TOOL_PREFIX } from "./tool-registry.ts";

/** 一个回合冻结的工具策略：保存的选择、目录、原生开关与进入请求的 Harness 工具名。 */
export interface PreparedPolicy {
  readonly turn: number;
  readonly choices: ReadonlyToolSelection;
  readonly catalog: CliToolCatalog;
  readonly native: NativeSelection;
  readonly version: string;
  readonly fingerprint: string;
  readonly names: readonly string[];
  readonly inventory: readonly SavedInventoryEntry[];
}
const legacySchema = z.object({
  selection: z.object({
    commandExecution: z.boolean(),
    fileChange: z.boolean(),
    viewImage: z.boolean(),
    webSearch: z.boolean(),
    skills: z.boolean(),
  }),
});

/** 保存一次实际路由的工具状态，并把根调用身份固定到该状态。 */
export class CodexToolPolicy {
  private readonly lifetime = new AbortController();
  private readonly turns = new WeakMap<Agent, PreparedPolicy>();
  private readonly sessions = new Map<string, PreparedPolicy>();
  private readonly roots = new Map<string, PreparedPolicy>();
  private readonly work = new Set<Promise<unknown>>();
  private migration: Promise<void> | undefined;
  private nativeCache:
    { key: string; value: Promise<NativeCatalog> } | undefined;
  readonly targetId;

  constructor(
    private readonly ctx: Context,
    private readonly runtime: CodexCli,
  ) {
    const entry: Entry | undefined = ctx.fiber.entry;
    if (entry === undefined)
      throw new Error("CODEX_TOOL_POLICY_REQUIRES_PROFILE_ENTRY");
    this.targetId = CliTargetId(entry.options.id);
    ctx.on("settings/document-updated", (ns) => {
      if (ns === entry.options.id) this.nativeCache = undefined;
    });
    ctx.on("agent/created", async ({ agent, source, signal }) => {
      const pending = this.capture(
        agent,
        source,
        signal ?? this.lifetime.signal,
      );
      this.work.add(pending);
      try {
        await pending;
      } finally {
        this.work.delete(pending);
      }
    });
    // 在请求配置冻结阶段准备本回合策略：此时用户消息尚未提交，准备失败
    // 不会把未投递的输入留在历史里，修正运行条件后可重试原会话。
    ctx.on("agent/request", async ({ agent, turn, signal }, next) => {
      const config = await next();
      if (config.provider !== "codex-cli") {
        this.sessions.delete(agent.session.id);
        return config;
      }
      let prepared = this.turns.get(agent);
      if (prepared?.turn !== turn) {
        const pending = this.untilPrepared(
          agent.session.id,
          turn,
          config.model,
          signal,
        );
        this.work.add(pending);
        try {
          prepared = await pending;
        } finally {
          this.work.delete(pending);
        }
        this.turns.set(agent, prepared);
      }
      this.sessions.set(agent.session.id, prepared);
      return config;
    });
    ctx.on("session/event", (session, event) => {
      if (event.type === "tool/call") {
        const prepared = this.sessions.get(session.id);
        if (prepared !== undefined)
          this.roots.set(
            JSON.stringify([session.id, event.data.callId]),
            prepared,
          );
      } else if (event.type === "turn/end") {
        this.sessions.delete(session.id);
        for (const key of this.roots.keys())
          if (key.startsWith(JSON.stringify([session.id]).slice(0, -1) + ","))
            this.roots.delete(key);
      }
    });
    ctx.tools.guard((exec) => {
      const session = exec.agent?.session;
      if (session === undefined || exec.name === "run_code") return undefined;
      const policy =
        this.roots.get(JSON.stringify([session.id, exec.rootCallId])) ??
        this.sessions.get(session.id);
      if (policy === undefined) return undefined;
      const row = policy.catalog.tools.find(
        (tool) => tool.side === "harness" && tool.registryName === exec.name,
      );
      const current = ctx.tools.get(exec.name, exec.agent);
      const saved = policy.inventory.find(
        (item) => item.schema.name === exec.name,
      );
      if (
        row !== undefined &&
        saved !== undefined &&
        current !== undefined &&
        fingerprint(current.parameters) ===
          fingerprint(saved.schema.parameters) &&
        choiceEnabled(policy.choices, row)
      )
        return undefined;
      const source = row?.source ?? ToolSourceId("harness/unregistered");
      return `TOOL_DISABLED: ${source}/${row?.name ?? exec.name}`;
    });
    ctx.effect(() => async () => {
      this.lifetime.abort();
      await Promise.allSettled([...this.work]);
      this.sessions.clear();
      this.roots.clear();
    });
  }

  private async capture(
    agent: Agent,
    source: SessionStartSource,
    signal: AbortSignal,
  ): Promise<void> {
    signal.throwIfAborted();
    const record = await this.runtime.bindingRecord(agent.session.id);
    if (record?.toolPolicy !== undefined) {
      if (record.toolPolicy.target !== this.targetId)
        throw new Error(
          "CODEX_SESSION_STATE_INCOMPATIBLE: CLI profile entry changed",
        );
      return;
    }
    const parentId = agent.session.header.parentSession;
    if (parentId !== undefined) {
      const parent = await this.runtime.bindingRecord(parentId);
      if (parent?.toolPolicy === undefined)
        throw new Error(
          "CODEX_SESSION_STATE_INCOMPLETE: source tools are unavailable",
        );
      await this.runtime.saveToolPolicy(agent.session.id, parent.toolPolicy);
      return;
    }
    if (record?.threadId !== undefined || source !== "startup") {
      if (record !== undefined || agent.options.provider === "codex-cli")
        throw new Error(
          "CODEX_SESSION_STATE_INCOMPLETE: original tools are unavailable",
        );
      return;
    }
    await this.initialize(this.harnessRows(agent));
    const current = this.runtime.config.toolSelection.get();
    if (current === undefined)
      throw new Error("CODEX_TOOL_SELECTION_UNINITIALIZED");
    const enabled = (name: string): boolean =>
      current.native.some(
        (row) =>
          row.source === "codex/native" && row.name === name && row.enabled,
      );
    // web_search 行由首次导入或详情页切换写入；旧配置尚无该行时沿用旧设置。
    const webSearchRow = current.native.find(
      (row) => row.source === "codex/native" && row.name === "web_search",
    );
    const snapshot = SavedToolPolicySchema.parse({
      version: 1,
      target: this.targetId,
      choices: current,
      inventory: this.snapshotInventory(agent),
      nativeExecution: {
        commandExecution: enabled("exec_command"),
        fileChange: enabled("apply_patch"),
        viewImage: enabled("view_image"),
        webSearch:
          webSearchRow === undefined
            ? this.runtime.settings.selection.webSearch
            : webSearchRow.enabled,
      },
    });
    signal.throwIfAborted();
    await this.runtime.saveToolPolicy(agent.session.id, snapshot);
  }

  /** 返回配置目录；独立保留 Harness 列及原生侧诊断。 */
  async catalog(signal: AbortSignal, refresh = false): Promise<CliToolCatalog> {
    const native = await this.nativeCatalog(
      signal,
      this.runtime.config.cwd,
      refresh,
    ).catch((error: unknown): NativeCatalog => ({
      version: "unknown",
      rows: [],
      overrides: [],
      diagnostic: error instanceof Error ? error.message : String(error),
    }));
    const harness = this.harnessRows();
    const rows = [...harness, ...native.rows];
    const diagnostics: Partial<Record<"harness" | "native", string>> = {};
    if (native.diagnostic !== undefined) diagnostics.native = native.diagnostic;
    try {
      await this.initialize(rows);
    } catch (error) {
      diagnostics.harness =
        error instanceof Error ? error.message : String(error);
    }
    const saved = this.runtime.config.toolSelection.get();
    // 已保存但当前任何视图都不可见的行（如插件已禁用）仍列出，选择保留。
    if (saved !== undefined)
      for (const item of saved.harness)
        if (
          !rows.some((row) => row.side === "harness" && row.name === item.name)
        )
          rows.push({
            side: "harness",
            source: ToolSourceId(item.source),
            name: item.name,
            registryName: item.name.startsWith(KMH_TOOL_PREFIX)
              ? item.name.slice(KMH_TOOL_PREFIX.length)
              : item.name,
            description: "",
            control: { kind: "adjustable" },
          });
    if (native.diagnostic !== undefined && saved !== undefined) {
      for (const item of saved.native) {
        if (
          rows.some(
            (row) =>
              row.side === "native" &&
              row.source === item.source &&
              row.name === item.name,
          )
        )
          continue;
        rows.push({
          side: "native",
          source: ToolSourceId(item.source),
          name: item.name,
          description: "",
          control: { kind: "unverified", reason: native.diagnostic },
        });
      }
    }
    return {
      revision: fingerprint(rows),
      tools: rows,
      ...(Object.keys(diagnostics).length === 0 ? {} : { diagnostics }),
    };
  }

  /**
   * 公开注册表只投影模型侧 schema，不含插件来源，Harness 行统一记为 harness。
   * 预设内的工具只在 agent 视图可见：无 agent 时合并全局视图与所有活动 agent 的视图。
   */
  private harnessRows(agent?: Agent): CliToolRow[] {
    const scopes: (Agent | undefined)[] =
      agent === undefined
        ? [undefined, ...(this.ctx.get("agents")?.list() ?? [])]
        : [agent];
    const rows = new Map<string, CliToolRow>();
    for (const scope of scopes)
      for (const schema of this.ctx.tools.schemas(scope))
        if (!rows.has(schema.name))
          rows.set(schema.name, {
            side: "harness",
            source: ToolSourceId("harness"),
            name: KMH_TOOL_PREFIX + schema.name,
            registryName: schema.name,
            description: schema.description,
            schema,
            control: { kind: "adjustable" },
          });
    return [...rows.values()];
  }

  /** 创建时该 Agent 可见的 Harness 工具快照。 */
  private snapshotInventory(agent: Agent): SavedInventoryEntry[] {
    return this.ctx.tools
      .schemas(agent)
      .map((schema) => ({ source: ToolSourceId("harness"), schema }));
  }

  private nativeCatalog(
    signal: AbortSignal,
    cwd: string,
    refresh: boolean,
    selection: NativeSelection = this.runtime.settings.selection,
  ): Promise<NativeCatalog> {
    const key = JSON.stringify([
      cwd,
      this.runtime.config.command,
      this.runtime.config.model,
      selection,
    ]);
    if (refresh || this.nativeCache?.key !== key) {
      const bounded = AbortSignal.any([
        this.lifetime.signal,
        AbortSignal.timeout(this.runtime.config.probeTimeoutMs),
      ]);
      const value = discoverNativeTools(
        this.ctx,
        this.runtime.config,
        selection,
        bounded,
        cwd,
      );
      this.nativeCache = { key, value };
      this.work.add(value);
      void value.then(
        () => this.work.delete(value),
        () => {
          this.work.delete(value);
          this.nativeCache = undefined;
          return Promise.resolve();
        },
      );
    }
    const cached = this.nativeCache.value;
    return cancelled(cached, AbortSignal.any([signal, this.lifetime.signal]));
  }

  private async initialize(rows: readonly CliToolRow[]): Promise<void> {
    if (this.runtime.config.toolSelection.get() !== undefined) return;
    if (this.migration !== undefined) return this.migration;
    this.migration = this.importChoices(rows).finally(() => {
      this.migration = undefined;
    });
    await this.migration;
  }

  private async importChoices(rows: readonly CliToolRow[]): Promise<void> {
    let legacy = this.runtime.settings.selection;
    try {
      legacy = legacySchema.parse(
        JSON.parse(
          await readFile(
            join(this.runtime.config.dataDir, "codex-settings.json"),
            "utf8",
          ),
        ),
      ).selection;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw new Error(
          `CODEX_TOOL_MIGRATION_FAILED: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
    const choices: ToolSelection = { version: 1, harness: [], native: [] };
    for (const row of rows) {
      if (row.control.kind === "fixed" || row.control.kind === "unverified")
        continue;
      const enabled = row.side === "harness" || nativeChoice(legacy, row.name);
      choices[row.side].push({ source: row.source, name: row.name, enabled });
    }
    // 已有粗粒度控制的精确 handler 身份；发现失败时保存这些选择并展示待核实。
    for (const name of [
      "exec_command",
      "write_stdin",
      "shell_command",
      "apply_patch",
      "view_image",
    ]) {
      if (
        choices.native.some(
          (row) => row.source === "codex/native" && row.name === name,
        )
      )
        continue;
      choices.native.push({
        source: "codex/native",
        name,
        enabled: nativeChoice(legacy, name),
      });
    }
    const settings = this.ctx.get("settings");
    if (settings === undefined)
      throw new Error("CODEX_TOOL_MIGRATION_NEEDS_PROFILE_SETTINGS");
    const descriptor = settings
      .describe()
      .find((row) => String(row.ns) === String(this.targetId));
    if (descriptor === undefined)
      throw new Error("CODEX_TOOL_MIGRATION_NEEDS_WRITABLE_PROFILE");
    if (this.runtime.config.toolSelection.get() !== undefined) return;
    await settings.update(
      this.targetId,
      { toolSelection: choices },
      descriptor.revision,
    );
  }

  private async untilPrepared(
    sessionId: NonNullable<GenerateOptions["sessionId"]>,
    turn: number,
    model: string,
    signal: AbortSignal,
  ): Promise<PreparedPolicy> {
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    combined.throwIfAborted();
    let snapshot = (await this.runtime.bindingRecord(sessionId))?.toolPolicy;
    if (snapshot === undefined)
      throw new Error(
        "CODEX_SESSION_STATE_INCOMPLETE: original tools are unavailable",
      );
    if (snapshot.target !== this.targetId)
      throw new Error(
        "CODEX_SESSION_STATE_INCOMPATIBLE: CLI profile entry changed",
      );
    const selected = {
      ...snapshot.nativeExecution,
      skills: this.runtime.settings.selection.skills,
    };
    if (snapshot.nativeCatalog === undefined) {
      const native = await this.nativeCatalog(
        combined,
        this.runtime.resolveCwd(sessionId),
        true,
        selected,
      );
      if (native.diagnostic !== undefined) throw new Error(native.diagnostic);
      snapshot = SavedToolPolicySchema.parse({
        ...snapshot,
        nativeCatalog: { version: native.version, rows: [...native.rows] },
      });
      await this.runtime.saveToolPolicy(sessionId, snapshot);
    }
    const saved = snapshot;
    const rows: CliToolRow[] = [
      ...saved.inventory.map((item) => ({
        side: "harness" as const,
        source: ToolSourceId(item.source),
        ...(item.sourceLabel === undefined
          ? {}
          : { sourceLabel: item.sourceLabel }),
        name: KMH_TOOL_PREFIX + item.schema.name,
        registryName: item.schema.name,
        description: item.schema.description,
        schema: item.schema,
        control: { kind: "adjustable" as const },
      })),
      ...(saved.nativeCatalog?.rows ?? []),
    ];
    const catalog = { revision: fingerprint(rows), tools: rows };
    await this.preflight(
      selected,
      this.runtime.resolveCwd(sessionId),
      model,
      combined,
    );
    const names = rows
      .filter(
        (row) => row.side === "harness" && choiceEnabled(saved.choices, row),
      )
      .flatMap((row) =>
        row.registryName === undefined ? [] : [row.registryName],
      );
    return {
      turn,
      choices: deepFreeze(saved.choices),
      catalog: deepFreeze(catalog),
      native: deepFreeze(selected),
      version: saved.nativeCatalog?.version ?? "unknown",
      fingerprint: fingerprint([saved.choices, rows, saved.nativeExecution]),
      names,
      inventory: saved.inventory,
    };
  }

  private async preflight(
    selection: NativeSelection,
    cwd: string,
    model: string,
    signal: AbortSignal,
  ): Promise<void> {
    const bounded = AbortSignal.any([
      signal,
      AbortSignal.timeout(this.runtime.config.probeTimeoutMs),
    ]);
    const plan = await prepareIsolation(this.ctx, this.runtime.config, {
      selection,
      cwd,
      signal: bounded,
    });
    const connection = await connectCodex(
      this.ctx,
      {
        command: this.runtime.config.command,
        cwd,
        configOverrides: plan.configOverrides,
        env: this.runtime.config.env,
        graceMs: this.runtime.config.graceMs,
        startupTimeoutMs: this.runtime.config.startupTimeoutMs,
      },
      bounded,
    );
    try {
      await verifyIsolation(connection, plan, bounded);
      const catalog = z
        .object({
          models: z.array(z.object({ slug: z.string() }).passthrough()),
        })
        .parse(JSON.parse(await readFile(plan.catalogPath, "utf8")));
      if (!catalog.models.some((entry) => entry.slug === model))
        throw new Error(`CODEX_NATIVE_MODEL_UNVERIFIED: ${model}`);
    } finally {
      await connection.stop(this.runtime.config.cleanupTimeoutMs);
    }
  }

  /** 已准备回合的冻结策略；辅助请求与未准备的会话返回 undefined，保留既有路径。 */
  forStream(options: GenerateOptions): PreparedPolicy | undefined {
    return options.sessionId === undefined
      ? undefined
      : this.sessions.get(options.sessionId);
  }
}

/** 精确工具名对应既有 Codex 控制字段。 */
function nativeChoice(selection: NativeSelection, name: string): boolean {
  switch (name) {
    case "exec_command":
    case "write_stdin":
    case "shell_command":
      return selection.commandExecution;
    case "apply_patch":
      return selection.fileChange;
    case "view_image":
      return selection.viewImage;
    default:
      return selection.webSearch;
  }
}
/** 完整参数与目录身份参与线程复用。 */
function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
/** 每个调用者单独取消等待，共享发现由插件生命周期管理。 */
async function cancelled<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  const abort = Promise.withResolvers<never>();
  const listener = (): void => {
    abort.reject(signal.reason);
  };
  signal.addEventListener("abort", listener, { once: true });
  try {
    return await Promise.race([work, abort.promise]);
  } finally {
    signal.removeEventListener("abort", listener);
  }
}
