/** 原生 CLI 文件的定位、分块读取与原文校验，所有句柄只以只读方式打开。 */
import { open, readdir, realpath } from "node:fs/promises";
import { join, relative, isAbsolute, sep } from "node:path";
import { createHash } from "node:crypto";
import { READ_CHUNK_BYTES } from "./paths.ts";
import { EnvelopeSchema, MetaSchema, type Envelope } from "./rollout-schema.ts";
import type { SourceRef } from "./protocol.ts";
export class TraceReadError extends Error {
  constructor(
    readonly code: string,
    readonly status = 503,
  ) {
    super(code);
    this.name = "TraceReadError";
  }
}
export interface SourceLine {
  source: SourceRef;
  digest: string;
  envelope: Envelope | null;
}
export interface SourceBatch {
  lines: SourceLine[];
  end: number;
  bytes: number;
  identity: string;
  mtime: number;
}
export function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
export function inRoot(root: string, file: string): boolean {
  const rel = relative(root, file);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}

/** 枚举已知原生目录，只按保存的 ID 匹配；多个候选保持歧义。 */
export async function locate(
  home: string,
  nativeId: string,
): Promise<{ path: string; relativePath: string } | null> {
  let root: string;
  try {
    root = await realpath(home);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw new TraceReadError("SOURCE_UNREADABLE");
  }
  const found: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw new TraceReadError("SOURCE_UNREADABLE");
    }
    for (const entry of entries) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else if (
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith("-" + nativeId + ".jsonl")
      ) {
        const full = await realpath(p);
        if (!inRoot(root, full))
          throw new TraceReadError("SOURCE_MISMATCH", 409);
        found.push(full);
      }
    }
  }
  await walk(join(root, "sessions"));
  await walk(join(root, "archived_sessions"));
  if (found.length > 1) throw new TraceReadError("SOURCE_AMBIGUOUS", 409);
  const path = found[0];
  return path === undefined
    ? null
    : { path, relativePath: relative(root, path) };
}
/** 从完整行边界开始读取。末尾半行留在源文件，等待下一次读取。 */
export async function readLines(
  file: string,
  start = 0,
  lineStart = 1,
  signal?: AbortSignal,
  endLimit?: number,
): Promise<SourceBatch> {
  signal?.throwIfAborted();
  const handle = await open(file, "r");
  try {
    const before = await handle.stat();
    const end = Math.min(before.size, endLimit ?? before.size);
    if (start > end) throw new TraceReadError("READ_CHANGED", 409);
    const lines: SourceLine[] = [];
    let position = start,
      lineNo = lineStart,
      complete = start,
      tail = Buffer.alloc(0);
    while (position < end) {
      signal?.throwIfAborted();
      const chunk = Buffer.alloc(Math.min(READ_CHUNK_BYTES, end - position));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) throw new TraceReadError("READ_CHANGED", 409);
      position += bytesRead;
      tail = Buffer.concat([tail, chunk.subarray(0, bytesRead)]);
      let consumed = 0;
      while (true) {
        const i = tail.indexOf(10, consumed);
        if (i < 0) break;
        const bytes = tail.subarray(consumed, i + 1);
        let envelope: Envelope | null = null;
        try {
          const input: unknown = JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes),
          );
          const p = EnvelopeSchema.safeParse(input);
          if (p.success) envelope = p.data;
        } catch {
          /* 原文保持在源文件，坏行由投影标明。 */
        }
        const source: SourceRef = {
          line: lineNo++,
          byteStart: complete,
          byteEnd: complete + bytes.length,
          ...(envelope?.ordinal === undefined
            ? {}
            : { ordinal: envelope.ordinal }),
        };
        lines.push({ source, digest: digest(bytes), envelope });
        complete += bytes.length;
        consumed = i + 1;
      }
      tail = tail.subarray(consumed);
    }
    const after = await handle.stat();
    if (
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      after.size < end
    )
      throw new TraceReadError("READ_CHANGED", 409);
    return {
      lines,
      end: complete,
      bytes: end,
      identity: `${before.dev}:${before.ino}`,
      mtime: before.mtimeMs,
    };
  } finally {
    await handle.close();
  }
}
/** 归属先验证原生文件头，保留外部版本信息。 */
export function sourceMeta(
  lines: readonly SourceLine[],
  nativeId: string,
): { cliVersion: string | null } {
  const first = lines[0]?.envelope;
  if (first?.type !== "session_meta")
    throw new TraceReadError("SOURCE_MISMATCH", 409);
  const parsed = MetaSchema.safeParse(first.payload);
  if (!parsed.success || parsed.data.id !== nativeId)
    throw new TraceReadError("SOURCE_MISMATCH", 409);
  return { cliVersion: parsed.data.cli_version ?? null };
}
/** 读取已索引原文并核对其摘要；内容变化时拒绝旧位置。 */
export async function readRaw(
  file: string,
  line: SourceLine,
  signal?: AbortSignal,
): Promise<Buffer> {
  signal?.throwIfAborted();
  const h = await open(file, "r");
  try {
    const bytes = Buffer.alloc(line.source.byteEnd - line.source.byteStart);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const r = await h.read(
        bytes,
        offset,
        bytes.length - offset,
        line.source.byteStart + offset,
      );
      if (r.bytesRead === 0) throw new TraceReadError("READ_CHANGED", 409);
      offset += r.bytesRead;
    }
    if (digest(bytes) !== line.digest)
      throw new TraceReadError("READ_CHANGED", 409);
    return bytes;
  } finally {
    await h.close();
  }
}
