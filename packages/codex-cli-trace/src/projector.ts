/** 将已有 CLI 行整理为可回查的事实；计数以明确标识去重。 */
import { z } from "zod";
import {
  CompletedSchema,
  ContextSchema,
  IdentitySchema,
  ResponseSchema,
  TaskSchema,
  TextPartsSchema,
  TokenCountSchema,
  UsageRecordSchema,
  type NativeUsage,
} from "./rollout-schema.ts";
import type {
  Issue,
  SourceRef,
  TraceEntry,
  TraceTurn,
  Usage,
} from "./protocol.ts";
import type { SourceLine } from "./source.ts";
export interface EntryFacts {
  entry: TraceEntry;
  arguments: string | null;
  result: string | null;
  text: string | null;
}
export interface Projection {
  turns: TraceTurn[];
  facts: Map<string, EntryFacts>;
  issues: Issue[];
}
export function emptyUsage(): Usage {
  return {
    input: null,
    cached: null,
    cacheWrite: null,
    output: null,
    reasoning: null,
    total: null,
    coverage: "missing",
  };
}
export function nativeUsage(u: NativeUsage): Usage {
  const v = {
    input: u.input_tokens ?? null,
    cached: u.cached_input_tokens ?? null,
    cacheWrite: u.cache_write_input_tokens ?? null,
    output: u.output_tokens ?? null,
    reasoning: u.reasoning_output_tokens ?? null,
    total: u.total_tokens ?? null,
  };
  return {
    ...v,
    coverage: Object.values(v).every((x) => x !== null)
      ? "complete"
      : "partial",
  };
}
/** 任意已校验 JSON 内容的文本表示，空字符串保持原值。 */
export function display(value: unknown): string {
  const text = z.string().safeParse(value);
  if (text.success) return text.data;
  const parts = TextPartsSchema.safeParse(value);
  if (parts.success)
    return parts.data.map((p) => p.text ?? JSON.stringify(p)).join("\n");
  const strings = z.array(z.string()).safeParse(value);
  if (strings.success) return strings.data.join("\n");
  return JSON.stringify(value, null, 2) ?? "";
}
const usageFields = [
  "input",
  "cached",
  "cacheWrite",
  "output",
  "reasoning",
  "total",
] satisfies (keyof Omit<Usage, "coverage">)[];
/** 对唯一记录逐字段求和；缺字段保留空值。 */
export function sumUsage(values: readonly Usage[]): Usage {
  if (values.length === 0) return emptyUsage();
  const result = emptyUsage();
  for (const field of usageFields) {
    const numbers = values.map((u) => u[field]);
    result[field] = numbers.every((v) => v !== null)
      ? numbers.reduce<number>((sum, v) => sum + (v ?? 0), 0)
      : null;
  }
  result.coverage = usageFields.every((k) => result[k] !== null)
    ? "complete"
    : "partial";
  return result;
}
/** 按保存的消息角色命名，未知角色保持可见。 */
function messageTitle(role: string | undefined): string {
  switch (role) {
    case "user":
      return "用户消息";
    case "assistant":
      return "助手回复";
    case "developer":
      return "开发者消息";
    case "system":
      return "系统消息";
    case undefined:
      return "消息 · 角色未记录";
    default:
      return "消息 · " + role;
  }
}
function initialTurn(id: string): TraceTurn {
  return {
    nativeTurnId: id,
    title: id,
    model: null,
    effort: null,
    status: "pending",
    durationMs: null,
    ttftMs: null,
    startedAt: null,
    responseCount: 0,
    toolCount: 0,
    failedTools: 0,
    skillCount: 0,
    usage: emptyUsage(),
    usageSources: [],
  };
}
const toolKinds = new Set([
  "DynamicToolCall",
  "CommandExecution",
  "FileChange",
  "McpToolCall",
  "WebSearch",
  "ImageView",
  "ImageGeneration",
]);
const fileTools = new Set([
  "kmh-read",
  "kmh-write",
  "kmh-edit",
  "read_file",
  "apply_patch",
  "FileChange",
]);
const SkillArgsSchema = z.looseObject({
  name: z.string().optional(),
  file_path: z.string().optional(),
  path: z.string().optional(),
});
/** 文件顺序是默认顺序；无法确认归属的记录保留原文入口。 */
export function project(
  lines: readonly SourceLine[],
  nativeId: string,
): Projection {
  const turns = new Map<string, TraceTurn>(),
    facts = new Map<string, EntryFacts>(),
    issues: Issue[] = [];
  const fallbackMessages: {
    key: string;
    facts: EntryFacts;
    category: string;
  }[] = [];
  const primaryMessages = new Set<string>();
  const aggregates = new Map<string, { usage: Usage; source: SourceRef }>();
  const turnTotals = new Map<string, { usage: Usage; source: SourceRef }>();
  let active: string | null = null;
  const getTurn = (id: string): TraceTurn => {
    let t = turns.get(id);
    if (t === undefined) {
      t = initialTurn(id);
      turns.set(id, t);
    }
    return t;
  };
  const issue = (
    kind: string,
    message: string,
    line: SourceLine,
    nativeTurnId: string | null = active,
  ): void => {
    issues.push({ kind, message, source: line.source, nativeTurnId });
  };
  const make = (
    id: string,
    kind: TraceEntry["kind"],
    title: string,
    nativeTurnId: string | null,
    line: SourceLine,
  ): EntryFacts => {
    let f = facts.get(id);
    if (f === undefined) {
      f = {
        entry: {
          entryId: id,
          kind,
          title,
          nativeTurnId,
          at: line.envelope?.timestamp ?? null,
          status: "unknown",
          durationMs: null,
          toolName: null,
          callId: null,
          usage: null,
          sources: [],
        },
        arguments: null,
        result: null,
        text: null,
      };
      facts.set(id, f);
    }
    f.entry.sources.push(line.source);
    return f;
  };
  const tool = (
    id: string,
    name: string,
    nativeTurnId: string | null,
    line: SourceLine,
  ): EntryFacts => {
    const kind =
      name === "kmh-skill" ? "skill" : fileTools.has(name) ? "file" : "tool";
    const f = make("call:" + id, kind, name, nativeTurnId, line);
    f.entry.kind = kind;
    f.entry.toolName = name;
    f.entry.callId = id;
    return f;
  };
  for (const line of lines) {
    const env = line.envelope;
    if (env === null) {
      issue("damaged", "记录格式损坏", line, null);
      make("raw:" + line.source.line, "unknown", "损坏记录", null, line);
      continue;
    }
    const identity = IdentitySchema.safeParse(env.payload);
    if (
      identity.success &&
      [identity.data.thread_id, identity.data.session_id].some(
        (v) => v !== undefined && v !== nativeId,
      )
    ) {
      issue("source-mismatch", "记录中的 CLI session 与文件头不符", line, null);
      continue;
    }
    if (env.type === "session_meta") continue;
    if (env.type === "turn_context") {
      const p = ContextSchema.safeParse(env.payload);
      if (!p.success) {
        issue("damaged", "回合上下文格式无法识别", line);
        continue;
      }
      active = p.data.turn_id;
      const t = getTurn(active);
      t.model = p.data.model ?? t.model;
      t.effort = p.data.effort ?? t.effort;
      const context = make(
        "context:" + active,
        "unknown",
        "回合上下文",
        active,
        line,
      );
      context.text = JSON.stringify(
        { model: t.model, effort: t.effort },
        null,
        2,
      );
      context.entry.status = "completed";
      continue;
    }
    if (env.type === "token_usage_record") {
      const p = UsageRecordSchema.safeParse(env.payload);
      if (!p.success) {
        issue("damaged", "用量记录格式无法识别", line);
        continue;
      }
      const q = p.data;
      getTurn(q.turn_id);
      const responseKey = "response:" + q.turn_id + ":" + q.response_id;
      const seen = facts.has(responseKey);
      const f = make(responseKey, "response", "模型响应", q.turn_id, line);
      const usage = nativeUsage(q.usage);
      if (!seen && q.turn_token_usage !== undefined)
        turnTotals.set(q.turn_id, {
          usage: nativeUsage(q.turn_token_usage),
          source: line.source,
        });
      if (
        usage.total !== null &&
        usage.input !== null &&
        usage.output !== null &&
        usage.total !== usage.input + usage.output
      )
        issue(
          "usage-conflict",
          "保存的总 token 与输入输出和不同",
          line,
          q.turn_id,
        );
      if (
        f.entry.usage !== null &&
        JSON.stringify(f.entry.usage) !== JSON.stringify(usage)
      )
        issue(
          "usage-conflict",
          "同一次模型响应的用量存在差异",
          line,
          q.turn_id,
        );
      else f.entry.usage = usage;
      f.entry.status = "completed";
      continue;
    }
    if (env.type === "event_msg") {
      const task = TaskSchema.safeParse(env.payload);
      if (task.success) {
        const q = task.data;
        const id: string | null = q.turn_id ?? active;
        if (id === null) continue;
        active = id;
        const t = getTurn(id);
        if (q.type === "task_started") {
          t.startedAt = env.timestamp ?? null;
          t.status = "pending";
        } else {
          t.status = q.type === "task_complete" ? "completed" : "failed";
          if (
            (t.durationMs !== null &&
              q.duration_ms !== undefined &&
              t.durationMs !== q.duration_ms) ||
            (t.ttftMs !== null &&
              q.time_to_first_token_ms !== undefined &&
              t.ttftMs !== q.time_to_first_token_ms)
          )
            issue(
              "duration-conflict",
              "同一回合保存了不同计时；概览保留首次明确值，原始记录保留各份数据",
              line,
              id,
            );
          t.durationMs ??= q.duration_ms ?? null;
          t.ttftMs ??= q.time_to_first_token_ms ?? null;
          const timing = make("timing:" + id, "unknown", "回合计时", id, line);
          timing.entry.status = t.status;
          timing.entry.durationMs = t.durationMs;
          timing.text = JSON.stringify(
            { durationMs: t.durationMs, ttftMs: t.ttftMs },
            null,
            2,
          );
          active = null;
        }
        continue;
      }
      const done = CompletedSchema.safeParse(env.payload);
      if (done.success) {
        const q = done.data;
        getTurn(q.turn_id);
        const item = q.item;
        const id = item.id ?? "line:" + line.source.line;
        if (toolKinds.has(item.type)) {
          const f = tool(id, item.tool ?? item.type, q.turn_id, line);
          f.arguments ??=
            item.arguments === undefined
              ? JSON.stringify(item, null, 2)
              : display(item.arguments);
          if (item.content_items !== undefined)
            f.result = display(item.content_items);
          f.entry.status =
            item.success === false || item.status === "failed"
              ? "failed"
              : item.status === "completed" || item.success === true
                ? "completed"
                : "pending";
          f.entry.durationMs =
            item.duration === undefined
              ? q.started_at_ms !== undefined &&
                q.completed_at_ms !== undefined &&
                q.completed_at_ms >= q.started_at_ms
                ? q.completed_at_ms - q.started_at_ms
                : null
              : item.duration.secs * 1000 + item.duration.nanos / 1e6;
          const args = SkillArgsSchema.safeParse(item.arguments);
          if (args.success) {
            const suffix =
              f.entry.kind === "skill"
                ? args.data.name
                : (args.data.file_path ?? args.data.path);
            if (suffix !== undefined)
              f.entry.title = (f.entry.toolName ?? "调用") + " · " + suffix;
          }
        } else {
          const kind =
            item.type === "Reasoning"
              ? "reasoning"
              : item.type === "UserMessage" || item.type === "AgentMessage"
                ? "message"
                : "unknown";
          const category =
            q.turn_id +
            ":" +
            (item.type === "UserMessage"
              ? "user"
              : item.type === "AgentMessage"
                ? "assistant"
                : "reasoning");
          const f: EntryFacts = {
            entry: {
              entryId: "item:" + id,
              kind,
              title:
                item.type === "UserMessage"
                  ? "用户消息"
                  : item.type === "AgentMessage"
                    ? "助手回复"
                    : item.type,
              nativeTurnId: q.turn_id,
              at: env.timestamp ?? null,
              status: "completed",
              durationMs:
                q.started_at_ms !== undefined &&
                q.completed_at_ms !== undefined &&
                q.completed_at_ms >= q.started_at_ms
                  ? q.completed_at_ms - q.started_at_ms
                  : null,
              toolName: null,
              callId: null,
              usage: null,
              sources: [line.source],
            },
            arguments: null,
            result: null,
            text:
              item.summary_text !== undefined
                ? display(item.summary_text)
                : item.content === undefined
                  ? null
                  : display(item.content),
          };
          fallbackMessages.push({ key: f.entry.entryId, facts: f, category });
        }
        continue;
      }
      const count = TokenCountSchema.safeParse(env.payload);
      if (count.success) {
        if (active !== null && count.data.info?.total_token_usage !== undefined)
          aggregates.set(active, {
            usage: nativeUsage(count.data.info.total_token_usage),
            source: line.source,
          });
        continue;
      }
    }
    if (env.type === "response_item") {
      const p = ResponseSchema.safeParse(env.payload);
      if (!p.success) {
        issue("damaged", "内容记录无法识别", line);
        continue;
      }
      const q = p.data;
      const nativeTurnId =
        q.internal_chat_message_metadata_passthrough?.turn_id ?? active;
      if (nativeTurnId !== null) getTurn(nativeTurnId);
      if (q.type === "function_call") {
        const id = q.call_id ?? q.id ?? "line:" + line.source.line;
        const f = tool(id, q.name ?? "未知工具", nativeTurnId, line);
        f.arguments = q.arguments === undefined ? null : display(q.arguments);
        if (f.entry.status === "unknown") f.entry.status = "pending";
        continue;
      }
      if (q.type === "function_call_output") {
        const id = q.call_id ?? q.id ?? "line:" + line.source.line;
        const prior = facts.get("call:" + id);
        const f = tool(
          id,
          prior?.entry.toolName ?? "未知工具",
          nativeTurnId,
          line,
        );
        f.result = q.output === undefined ? null : display(q.output);
        if (f.entry.status === "pending" || f.entry.status === "unknown")
          f.entry.status = "completed";
        continue;
      }
      if (q.type === "message" || q.type === "reasoning") {
        const reasoning = q.type === "reasoning";
        const id = "item:" + (q.id ?? "line:" + line.source.line);
        const f = make(
          id,
          reasoning ? "reasoning" : "message",
          reasoning
            ? "可见思考摘要"
            : q.role === "user"
              ? "用户消息"
              : messageTitle(q.role),
          nativeTurnId,
          line,
        );
        f.text = display(reasoning ? q.summary : q.content);
        f.entry.status = "completed";
        primaryMessages.add(
          (nativeTurnId ?? "") +
            ":" +
            (reasoning ? "reasoning" : (q.role ?? "assistant")),
        );
        if (q.role === "user" && nativeTurnId !== null) {
          const t = getTurn(nativeTurnId);
          t.title = f.text.split("\n")[0]?.slice(0, 120) ?? nativeTurnId;
        }
        continue;
      }
    }
    issue("unknown", "记录类型暂未识别：" + env.type, line);
    make("raw:" + line.source.line, "unknown", env.type, active, line);
  }
  for (const item of fallbackMessages) {
    const existing = facts.get(item.key);
    if (existing !== undefined) {
      existing.entry.sources.push(...item.facts.entry.sources);
      existing.entry.durationMs = item.facts.entry.durationMs;
    } else if (!primaryMessages.has(item.category))
      facts.set(item.key, item.facts);
    else {
      item.facts.entry.kind = "unknown";
      item.facts.entry.title = "补充完成记录";
      item.facts.text = null;
      facts.set(item.key, item.facts);
    }
  }
  for (const [nativeTurnId, aggregate] of aggregates) {
    if (
      [...facts.values()].some(
        (f) =>
          f.entry.nativeTurnId === nativeTurnId && f.entry.kind === "response",
      )
    )
      continue;
    const f: EntryFacts = {
      entry: {
        entryId: "aggregate:" + nativeTurnId,
        nativeTurnId,
        kind: "unknown",
        title: "CLI session 累计用量",
        at: null,
        status: "unknown",
        durationMs: null,
        toolName: null,
        callId: null,
        usage: aggregate.usage,
        sources: [aggregate.source],
      },
      arguments: null,
      result: null,
      text: "来源为 session 累计值，当前回合逐响应用量未记录",
    };
    facts.set(f.entry.entryId, f);
    issues.push({
      kind: "partial-usage",
      message: f.text ?? "部分用量",
      source: aggregate.source,
      nativeTurnId,
    });
  }
  for (const t of turns.values()) {
    const entries = [...facts.values()].filter(
      (f) => f.entry.nativeTurnId === t.nativeTurnId,
    );
    const responses = entries.filter((f) => f.entry.kind === "response");
    t.responseCount = responses.length;
    const responseSum = sumUsage(
      responses.flatMap((f) => (f.entry.usage === null ? [] : [f.entry.usage])),
    );
    const cumulative = turnTotals.get(t.nativeTurnId);
    t.usage = cumulative?.usage ?? responseSum;
    t.usageSources = [
      ...responses.flatMap((f) => f.entry.sources),
      ...(cumulative === undefined ? [] : [cumulative.source]),
    ];
    if (
      cumulative !== undefined &&
      usageFields.some(
        (key) =>
          cumulative.usage[key] !== null &&
          responseSum[key] !== null &&
          cumulative.usage[key] !== responseSum[key],
      )
    )
      issues.push({
        kind: "usage-conflict",
        message:
          "保存的回合累计用量与唯一响应和不同，概览采用回合累计值；逐响应用量与原文保留供核对",
        source: cumulative.source,
        nativeTurnId: t.nativeTurnId,
      });
    if (t.usage.coverage !== "complete")
      issues.push({
        kind: "partial-usage",
        message: "回合用量字段存在未记录部分",
        source: t.usageSources[0] ?? null,
        nativeTurnId: t.nativeTurnId,
      });
    const calls = entries.filter((f) => f.entry.callId !== null);
    t.toolCount = calls.length;
    t.failedTools = calls.filter((f) => f.entry.status === "failed").length;
    t.skillCount = calls.filter((f) => f.entry.kind === "skill").length;
    for (const f of calls) {
      if (f.result === null)
        issues.push({
          kind: "missing",
          message: "工具返回内容未记录",
          source: f.entry.sources[0] ?? null,
          nativeTurnId: t.nativeTurnId,
        });
    }
  }
  return { turns: [...turns.values()], facts, issues };
}
