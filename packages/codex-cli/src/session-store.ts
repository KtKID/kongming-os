/** KMH 会话与 Codex thread 绑定及差分游标的持久化。 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CursorSnapshot } from "./cursor.ts";

/** 单个会话的绑定记录。 */
export interface BindingRecord {
  /** Codex thread id。 */
  threadId: string;
  /** 已对齐消息指纹序列（差分游标）。 */
  fingerprints: string[];
  /** 已完成的最后一个 Codex turn id；fork 重建的边界。 */
  lastTurnId?: string;
  /** 待核对的回合块摘要队列（跨进程续用）。 */
  delivered?: string[];
  /** 工具声明版本：目录指纹变化时递增（feat03 场景9）。 */
  toolsVersion?: number;
  /** 目录指纹：本 thread 声明工具集的摘要；旧记录缺省表示裸名旧 thread。 */
  toolFingerprint?: string;
  /** 名称映射：声明名 → KMH 注册名；旧会话按其声明版本解析。 */
  toolMap?: Record<string, string>;
}
/** 持久化文件形态。 */
type BindingFile = Record<string, BindingRecord>;

/**
 * 绑定存储：进程内缓存 + JSON 文件落盘，写入原子（临时文件改名）。
 * 读取失败（缺失或损坏）视为空存储并重置，不中断请求。
 */
export class CodexSessionStore {
  private cache: BindingFile | undefined;
  private loading: Promise<BindingFile> | undefined;
  constructor(private readonly dataDir: string) {}
  private get file(): string {
    return join(this.dataDir, "codex-bindings.json");
  }
  private async load(): Promise<BindingFile> {
    this.cache ??= await (this.loading ??= this.read());
    return this.cache;
  }
  private async read(): Promise<BindingFile> {
    try {
      const text: unknown = await readFile(this.file, "utf8");
      const parsed: unknown = JSON.parse(typeof text === "string" ? text : "");
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      )
        return {};
      const result: BindingFile = {};
      for (const [key, value] of Object.entries(parsed)) {
        const record = validate(value);
        if (record !== undefined) result[key] = record;
      }
      return result;
    } catch {
      // 缺失或损坏：重置为空，等待首次投递重建。
      return {};
    }
  }
  /** 读取会话绑定；不存在时返回 undefined。 */
  async get(sessionKey: string): Promise<BindingRecord | undefined> {
    return (await this.load())[sessionKey];
  }
  /** 写入会话绑定并落盘。 */
  async put(sessionKey: string, record: BindingRecord): Promise<void> {
    const all = await this.load();
    all[sessionKey] = record;
    await this.flush(all);
  }
  /** 删除会话绑定并落盘。 */
  async delete(sessionKey: string): Promise<void> {
    const all = await this.load();
    if (sessionKey in all) {
      delete all[sessionKey];
      await this.flush(all);
    }
  }
  private async flush(all: BindingFile): Promise<void> {
    await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${this.file}.tmp`;
    await writeFile(temp, JSON.stringify(all));
    await rename(temp, this.file);
  }
}
/** 记录形态校验：字段非法时丢弃该条。 */
function validate(value: unknown): BindingRecord | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const threadId = (value as { threadId?: unknown }).threadId;
  const fingerprints = (value as { fingerprints?: unknown }).fingerprints;
  const lastTurnId = (value as { lastTurnId?: unknown }).lastTurnId;
  const delivered = (value as { delivered?: unknown }).delivered;
  const toolsVersion = (value as { toolsVersion?: unknown }).toolsVersion;
  const toolFingerprint = (value as { toolFingerprint?: unknown })
    .toolFingerprint;
  const toolMap = (value as { toolMap?: unknown }).toolMap;
  if (typeof threadId !== "string" || !Array.isArray(fingerprints))
    return undefined;
  if (!fingerprints.every((item) => typeof item === "string")) return undefined;
  const record: BindingRecord = {
    threadId,
    fingerprints,
    ...(typeof lastTurnId === "string" ? { lastTurnId } : {}),
    ...(Array.isArray(delivered) &&
    delivered.every((item) => typeof item === "string")
      ? { delivered: [...delivered] }
      : {}),
    ...(typeof toolsVersion === "number" && Number.isInteger(toolsVersion)
      ? { toolsVersion }
      : {}),
    ...(typeof toolFingerprint === "string" ? { toolFingerprint } : {}),
    ...(isToolMap(toolMap) ? { toolMap } : {}),
  };
  return record;
}
/** 名称映射字段校验：键值均为字符串的普通对象。 */
function isToolMap(value: unknown): value is Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  return Object.values(value).every((item) => typeof item === "string");
}
/** 游标快照与绑定记录的互转。 */
export function recordToCursor(record: BindingRecord): CursorSnapshot {
  return {
    fingerprints: [...record.fingerprints],
    delivered: [...(record.delivered ?? [])],
  };
}
export function cursorToRecord(
  threadId: string,
  cursor: CursorSnapshot,
  lastTurnId?: string,
): BindingRecord {
  const delivered = cursor.delivered ?? [];
  return {
    threadId,
    fingerprints: [...cursor.fingerprints],
    ...(lastTurnId !== undefined ? { lastTurnId } : {}),
    ...(delivered.length > 0 ? { delivered: [...delivered] } : {}),
  };
}
