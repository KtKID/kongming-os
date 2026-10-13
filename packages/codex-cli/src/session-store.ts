/** KMH 会话创建时的工具选择、原生编号与增量处理位置。 */
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import Schema from "@deepseek-ai/schemastery";
import { brandString, type Branded } from "@deepseek-ai/dsh-brand";
import {
  CliTargetId,
  ToolSourceId,
  ToolSelectionSchema,
} from "@deepseek-ai/dsh-cli-tools";
import {
  assertSupportedJsonSchema,
  type ToolInventoryEntry,
} from "@deepseek-ai/dsh-tools";
import type { CursorSnapshot } from "./cursor.ts";

const choices = z
  .custom<ReturnType<typeof ToolSelectionSchema>>((value) => {
    try {
      Schema.resolve(value, ToolSelectionSchema, {});
      return true;
    } catch {
      return false;
    }
  }, "Invalid saved tool selection")
  .transform((value) => ToolSelectionSchema(value));
const rawToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.record(z.string(), z.json()),
  deferLoading: z.literal(true).optional(),
});
const toolSchema = rawToolSchema.transform(({ deferLoading, ...tool }) => ({
  ...tool,
  ...(deferLoading === undefined ? {} : { deferLoading }),
}));
const inventoryEntry = z.object({
  // 文件中的来源经过字符串校验后恢复公开 API 的名义类型。
  source: z
    .string()
    .min(1)
    .transform((value) => brandString<ToolInventoryEntry["source"]>(value)),
  sourceLabel: z.string(),
  schema: toolSchema,
  sdk: rawToolSchema
    .extend({
      output: z.record(z.string(), z.json()).transform((value) => {
        assertSupportedJsonSchema(value);
        return value;
      }),
    })
    .transform(({ deferLoading, ...tool }) => ({
      ...tool,
      ...(deferLoading === undefined ? {} : { deferLoading }),
    })),
});
const catalogRow = z
  .object({
    side: z.enum(["harness", "native"]),
    source: z.string().min(1).transform(ToolSourceId),
    name: z.string(),
    description: z.string(),
    sourceLabel: z.string().optional(),
    registryName: z.string().optional(),
    declaration: z.json().optional(),
    schema: toolSchema.optional(),
    control: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("adjustable") }),
      z.object({ kind: z.literal("linked"), group: z.string() }),
      z.object({
        kind: z.literal("fixed"),
        enabled: z.boolean(),
        reason: z.string(),
      }),
      z.object({ kind: z.literal("unverified"), reason: z.string() }),
    ]),
  })
  .transform(({ sourceLabel, registryName, declaration, schema, ...row }) => ({
    ...row,
    ...(sourceLabel === undefined ? {} : { sourceLabel }),
    ...(registryName === undefined ? {} : { registryName }),
    ...(declaration === undefined ? {} : { declaration }),
    ...(schema === undefined ? {} : { schema }),
  }));
/** 创建时固定的工具信息；原生目录首次验证后补存，技能仍独立读取。 */
export const SavedToolPolicySchema = z.object({
  version: z.literal(1),
  target: z.string().min(1).transform(CliTargetId),
  choices,
  inventory: z.array(inventoryEntry),
  nativeExecution: z.object({
    commandExecution: z.boolean(),
    fileChange: z.boolean(),
    viewImage: z.boolean(),
    webSearch: z.boolean(),
  }),
  nativeCatalog: z
    .object({ version: z.string(), rows: z.array(catalogRow) })
    .optional(),
});
/** 已校验的会话固定工具记录。 */
export type SavedToolPolicy = z.infer<typeof SavedToolPolicySchema>;
type NativeSessionId = Branded<"CodexNativeSessionId">;
type NativeTurnId = Branded<"CodexNativeTurnId">;
const nativeSessionId = z
  .string()
  .min(1)
  .transform(brandString<NativeSessionId>);
const nativeTurnId = z
  .string()
  .min(1)
  .transform(brandString<NativeTurnId>);
const bindingSchema = z
  .object({
    threadId: nativeSessionId.optional(),
    fingerprints: z.array(z.string()),
    lastTurnId: nativeTurnId.optional(),
    delivered: z.array(z.string()).optional(),
    toolsVersion: z.number().int().nonnegative().optional(),
    toolFingerprint: z.string().optional(),
    turns: z
      .array(
        z.object({
          turnId: nativeTurnId,
          fingerprints: z.array(z.string()),
          delivered: z.array(z.string()),
        }),
      )
      .optional(),
    previousThreadIds: z.array(nativeSessionId).optional(),
    toolMap: z.record(z.string(), z.string()).optional(),
    toolPolicy: SavedToolPolicySchema.optional(),
  })
  .superRefine((record, context) => {
    if (
      record.threadId === undefined &&
      (record.toolPolicy === undefined ||
        record.fingerprints.length > 0 ||
        record.lastTurnId !== undefined ||
        (record.delivered?.length ?? 0) > 0)
    ) {
      context.addIssue({
        code: "custom",
        message: "Missing native session id for accepted conversation",
      });
    }
  });
/** 会话记录：首条消息前只有工具信息，收到原生编号后保存完整绑定。 */
export type BindingRecord = z.infer<typeof bindingSchema>;
const bindingFileSchema = z.record(z.string(), bindingSchema);
type BindingFile = z.infer<typeof bindingFileSchema>;

/** 文件为会话状态来源；内存只缓存已成功保存的记录，坏文件明确报错。 */
export class CodexSessionStore {
  private cache: BindingFile | undefined;
  private loading: Promise<BindingFile> | undefined;
  private writes: Promise<void> = Promise.resolve();
  constructor(private readonly dataDir: string) {}
  private get file(): string {
    return join(this.dataDir, "codex-bindings.json");
  }
  private async load(): Promise<BindingFile> {
    if (this.cache !== undefined) return this.cache;
    const pending = (this.loading ??= this.read());
    try {
      this.cache = await pending;
      return this.cache;
    } finally {
      if (this.loading === pending) this.loading = undefined;
    }
  }
  private async read(): Promise<BindingFile> {
    let text: string;
    try {
      text = await readFile(this.file, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return {};
      throw new Error(
        "CODEX_SESSION_STATE_CORRUPT: cannot read saved bindings",
        { cause: error },
      );
    }
    try {
      const parsed: unknown = JSON.parse(text);
      return bindingFileSchema.parse(parsed);
    } catch (error) {
      throw new Error("CODEX_SESSION_STATE_CORRUPT: invalid saved bindings", {
        cause: error,
      });
    }
  }
  /**
   * 读取独立副本；确实不存在的会话返回 undefined，损坏状态抛错。
   * @param sessionKey - KMH 会话标识。
   * @returns 保存记录的独立副本或 undefined。
   */
  async get(sessionKey: string): Promise<BindingRecord | undefined> {
    const record = (await this.load())[sessionKey];
    return record === undefined ? undefined : structuredClone(record);
  }
  /**
   * 顺序保存记录；文件写入成功后才接受新状态。
   * @param sessionKey - KMH 会话标识。
   * @param record - 已校验的完整记录。
   */
  async put(sessionKey: string, record: BindingRecord): Promise<void> {
    const accepted = structuredClone(record);
    await this.enqueue(async () => {
      const all = { ...(await this.load()), [sessionKey]: accepted };
      await this.flush(all);
      this.cache = all;
    });
  }
  /**
   * 删除记录并保存；写入失败保留已接受状态。
   * @param sessionKey - KMH 会话标识。
   */
  async delete(sessionKey: string): Promise<void> {
    await this.enqueue(async () => {
      const all = { ...(await this.load()) };
      if (!(sessionKey in all)) return;
      delete all[sessionKey];
      await this.flush(all);
      this.cache = all;
    });
  }
  private async enqueue(write: () => Promise<void>): Promise<void> {
    const pending = this.writes.then(write);
    // 当前调用收到失败；后继保存仍可按顺序执行。
    this.writes = pending.catch(() => undefined);
    await pending;
  }
  private async flush(all: BindingFile): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(all), { mode: 0o600, flag: "wx" });
      await rename(temp, this.file);
    } catch (error) {
      try {
        await unlink(temp);
      } catch (cleanup) {
        if (!(
          cleanup instanceof Error &&
          "code" in cleanup &&
          cleanup.code === "ENOENT"
        ))
          throw new AggregateError(
            [error, cleanup],
            "Cannot save bindings or remove its temporary file",
          );
      }
      throw error;
    }
  }
}
/**
 * 从保存记录恢复消息处理位置。
 * @param record - 已校验的保存记录。
 * @returns 与原记录独立的消息处理位置。
 */
export function recordToCursor(record: BindingRecord): CursorSnapshot {
  return {
    fingerprints: [...record.fingerprints],
    delivered: [...(record.delivered ?? [])],
  };
}
/**
 * 将原生编号和消息处理位置写回记录；调用方合并创建时工具信息。
 * @param threadId - 官方 Codex 会话编号。
 * @param cursor - 已接受的消息处理位置。
 * @param lastTurnId - 最近完成的官方回合编号。
 * @returns 可合并到原记录的原生编号和消息处理位置。
 */
export function cursorToRecord(
  threadId: string,
  cursor: CursorSnapshot,
  lastTurnId?: string,
): BindingRecord {
  const delivered = cursor.delivered ?? [];
  return {
    threadId: brandString<NativeSessionId>(threadId),
    fingerprints: [...cursor.fingerprints],
    ...(lastTurnId === undefined
      ? {}
      : { lastTurnId: brandString<NativeTurnId>(lastTurnId) }),
    ...(delivered.length === 0 ? {} : { delivered: [...delivered] }),
  };
}
