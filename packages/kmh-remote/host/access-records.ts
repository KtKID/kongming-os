// 访问记录文件模块：按终态顺序写入、写前分文件；按稳定截止位置倒读历史，失败保留原文。
import * as nativeFs from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  AttemptSchema,
  RecordSchema,
  QuerySchema,
  CursorSchema,
  MAX_FILE_BYTES,
  RECORD_VERSION,
  PAGE_SIZE,
  recordFailure,
} from '../shared/access-records.ts';
import type {
  AccessRecord,
  PageResult,
  RecordFailure,
} from '../shared/access-records.ts';

type FileInfo = {
  name: string;
  size: number;
  readable: number;
  last: bigint;
  sealed: boolean;
};
type SaveResult =
  { ok: true; sequence: string } | { ok: false; error: RecordFailure };
const FILE_NAME = /^\d{4}-\d{2}-\d{2}(?:_[1-9]\d*)?\.log$/;
const BLOCK_BYTES = 64 * 1024;

/** 构造模块主动识别的失败，保留稳定错误码和发生处说明。 */
function failure(code: string, desc: string): Error {
  return Object.assign(new Error(desc), { code });
}
/** 格式化记录发生时的本地时间及偏移；无效设备时钟由 schema 校验报告。 */
function localTime(date: Date): string {
  const pad = (value: number, length = 2) =>
    String(value).padStart(length, '0');
  const offset = -date.getTimezoneOffset();
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${offset >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`;
}
/** 从指定行尾倒读一行，返回正文和前一页可继续读取的位置；只申请文件块大小的中间缓冲。 */
async function previousLine(handle: FileHandle, end: number) {
  const parts: Buffer[] = [];
  let position = end;
  let first = true;
  while (position > 0) {
    const start = Math.max(0, position - BLOCK_BYTES);
    const data = Buffer.alloc(position - start);
    const result = await handle.read(data, 0, data.length, start);
    if (result.bytesRead !== data.length)
      throw failure(
        'REMOTE_RECORD_FILE_CHANGED',
        '记录文件长度在读取时发生变化',
      );
    let part = data;
    if (first && part.at(-1) === 10) part = part.subarray(0, -1);
    first = false;
    const newline = part.lastIndexOf(10);
    if (newline >= 0) {
      parts.unshift(part.subarray(newline + 1));
      return {
        text: Buffer.concat(parts).toString('utf8'),
        start: start + newline + 1,
      };
    }
    parts.unshift(part);
    position = start;
  }
  return { text: Buffer.concat(parts).toString('utf8'), start: 0 };
}

/** 创建一份 Home 的记录器；save/list 返回明确结果，close 等待已交付写入，文件故障保留在实例状态。 */
export function createAccessRecords({
  home,
  clock = () => new Date(),
  fs = nativeFs,
  log,
}: {
  home: string;
  clock?: () => Date;
  fs?: typeof nativeFs;
  log?: (error: RecordFailure) => void;
}) {
  const directory = join(home, 'logs', '.kmh-remote');
  const instance = randomUUID();
  let files: FileInfo[] = [];
  let sequence = 0n;
  let initialized = false;
  let initialization: Promise<void> | undefined;
  let lifecycle: 'open' | 'closing' | 'closed' = 'open';
  let chain = Promise.resolve();
  let saveError: RecordFailure | null = null;
  let recovered = false;
  const report = (error: unknown, operation: string) => {
    const detail = recordFailure(
      error,
      `REMOTE_RECORD_${operation.toUpperCase()}_FAILED`,
      operation,
    );
    saveError = detail;
    recovered = false;
    try {
      log?.(detail);
    } catch {
      /* 文件错误仍由查询状态向本机展示。 */
    }
    return detail;
  };
  const openRead = async (name: string) => {
    const handle = await fs.open(
      join(directory, name),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      if (!(await handle.stat()).isFile())
        throw failure('REMOTE_RECORD_PATH_INVALID', '访问记录必须为普通文件');
    } catch (error) {
      await handle.close();
      throw error;
    }
    return handle;
  };
  /** 只读初始化目录信息，采用尾部已完成记录重建序号；初始无目录视为空历史。 */
  const rebuild = async () => {
    let names;
    try {
      if (!(await fs.lstat(directory)).isDirectory())
        throw failure('REMOTE_RECORD_PATH_INVALID', '记录目录必须为真实目录');
      names = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (recordFailure(error, '', '').code === 'ENOENT') {
        initialized = true;
        return;
      }
      throw error;
    }
    const found: FileInfo[] = [];
    let highest = 0n;
    for (const item of names) {
      if (!FILE_NAME.test(item.name)) continue;
      if (!item.isFile())
        throw failure('REMOTE_RECORD_PATH_INVALID', '访问记录必须为普通文件');
      const handle = await openRead(item.name);
      try {
        const { size } = await handle.stat();
        let readable = size;
        let last = 0n;
        let sealed = false;
        if (size > 0) {
          const finalByte = Buffer.alloc(1);
          await handle.read(finalByte, 0, 1, size - 1);
          if (finalByte[0] !== 10) {
            readable = (await previousLine(handle, size)).start;
            sealed = true;
            report(
              failure('REMOTE_RECORD_INCOMPLETE', '记录文件末尾存在未完成内容'),
              'read',
            );
          }
          if (readable > 0)
            last = BigInt(
              RecordSchema.parse(
                JSON.parse((await previousLine(handle, readable)).text),
              ).sequence,
            );
        }
        highest = last > highest ? last : highest;
        found.push({ name: item.name, size, readable, last, sealed });
      } finally {
        await handle.close();
      }
    }
    files = found.sort((a, b) =>
      a.last < b.last ? -1 : a.last > b.last ? 1 : a.name.localeCompare(b.name),
    );
    sequence = highest;
    initialized = true;
  };
  /** 共用一次初始化，查询与首条写入交叠时保持目录状态一致；失败后允许重试。 */
  const initialize = () => {
    if (initialized) return Promise.resolve();
    initialization ??= rebuild().finally(() => {
      initialization = undefined;
    });
    return initialization;
  };
  /** 新文件名按创建当刻日期递增避让；独占创建使已有文件保持原样。 */
  const newFile = async () => {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (!(await fs.lstat(directory)).isDirectory())
      throw failure('REMOTE_RECORD_PATH_INVALID', '记录目录必须为真实目录');
    const day = localTime(clock()).slice(0, 10);
    for (let suffix = 0; ; suffix++) {
      const name = `${day}${suffix ? `_${suffix}` : ''}.log`;
      try {
        const handle = await fs.open(join(directory, name), 'wx', 0o600);
        const info: FileInfo = {
          name,
          size: 0,
          readable: 0,
          last: 0n,
          sealed: false,
        };
        files.push(info);
        return { handle, info };
      } catch (error) {
        if (recordFailure(error, '', '').code !== 'EEXIST') throw error;
      }
    }
  };
  /** 接受一个已判定的密码终态，串行保存并返回落盘结果；异常成为可查询的保存错误。 */
  const save = (raw: unknown): Promise<SaveResult> => {
    if (lifecycle !== 'open')
      return Promise.resolve({
        ok: false,
        error: report(
          failure('REMOTE_RECORD_CLOSED', '访问记录器已关闭'),
          'write',
        ),
      });
    const when = clock();
    const job = chain.then(async (): Promise<SaveResult> => {
      let active: FileInfo | undefined;
      try {
        const attempt = AttemptSchema.parse(raw);
        await initialize();
        const record = RecordSchema.parse({
          ...attempt,
          version: RECORD_VERSION,
          sequence: String(sequence + 1n),
          occurredAt: localTime(when),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          event: 'password-attempt',
        });
        const bytes = Buffer.from(JSON.stringify(record) + '\n');
        if (bytes.length > MAX_FILE_BYTES)
          throw failure(
            'REMOTE_RECORD_TOO_LARGE',
            `记录实际 ${bytes.length} 字节，允许上限 ${MAX_FILE_BYTES} 字节`,
          );
        sequence = BigInt(record.sequence);
        const current = files.at(-1);
        let handle: FileHandle;
        if (
          current &&
          !current.sealed &&
          current.size + bytes.length <= MAX_FILE_BYTES
        ) {
          active = current;
          handle = await fs.open(
            join(directory, active.name),
            constants.O_WRONLY | constants.O_APPEND | constants.O_NOFOLLOW,
          );
        } else {
          const created = await newFile();
          active = created.info;
          handle = created.handle;
        }
        try {
          let offset = 0;
          while (offset < bytes.length) {
            const written = await handle.write(
              bytes,
              offset,
              bytes.length - offset,
              null,
            );
            if (written.bytesWritten === 0)
              throw failure(
                'REMOTE_RECORD_WRITE_STALLED',
                '文件写入返回零字节',
              );
            offset += written.bytesWritten;
          }
          await handle.sync();
          active.size += bytes.length;
          active.readable = active.size;
          active.last = BigInt(record.sequence);
          sequence = active.last;
        } finally {
          await handle.close();
        }
        recovered = saveError !== null;
        return { ok: true, sequence: record.sequence };
      } catch (error) {
        if (active) active.sealed = true;
        return { ok: false, error: report(error, 'write') };
      }
    });
    chain = job.then(() => {});
    return job;
  };
  /** 校验游标并按保存顺序倒读一页；失败原文返回，读取保持历史内容。 */
  const list = async (
    raw: unknown = {},
    signal?: AbortSignal,
  ): Promise<PageResult> => {
    try {
      const query = QuerySchema.parse(raw);
      const pending = chain;
      await pending;
      if (lifecycle !== 'open')
        throw failure('REMOTE_RECORD_CLOSED', '访问记录器已关闭');
      await initialize();
      let cutoff = sequence;
      let index = files.length - 1;
      let offset = files[index]?.readable ?? 0;
      if (query.cursor) {
        const parsed = CursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
        );
        index = files.findIndex((f) => f.name === parsed.file);
        const selected = files[index];
        if (
          parsed.instance !== instance ||
          !selected ||
          BigInt(parsed.cutoff) > sequence ||
          parsed.offset > selected.readable
        )
          throw failure(
            'REMOTE_RECORD_CURSOR_INVALID',
            '访问记录翻页位置已失效，请刷新',
          );
        cutoff = BigInt(parsed.cutoff);
        offset = parsed.offset;
      }
      const records: AccessRecord[] = [];
      let info = files[index];
      while (info && records.length < PAGE_SIZE) {
        if (offset === 0) {
          index--;
          info = files[index];
          offset = info?.readable ?? 0;
          continue;
        }
        const handle = await openRead(info.name);
        try {
          while (offset > 0 && records.length < PAGE_SIZE) {
            if (signal?.aborted)
              throw failure('REMOTE_RECORD_CANCELLED', '记录查询已取消');
            const line = await previousLine(handle, offset);
            offset = line.start;
            const record = RecordSchema.parse(JSON.parse(line.text));
            if (BigInt(record.sequence) <= cutoff) records.push(record);
          }
        } finally {
          await handle.close();
        }
      }
      while (index >= 0 && offset === 0) {
        index--;
        offset = files[index]?.readable ?? 0;
      }
      const next = files[index];
      const nextCursor = next
        ? Buffer.from(
            JSON.stringify({
              instance,
              cutoff: String(cutoff),
              file: next.name,
              offset,
            }),
          ).toString('base64url')
        : null;
      return {
        ok: true,
        value: { records, nextCursor, homeLabel: home, saveError, recovered },
      };
    } catch (error) {
      const detail = recordFailure(error, 'REMOTE_RECORD_READ_FAILED', 'read');
      return {
        ok: false,
        error: {
          code: detail.code,
          message: detail.desc,
          details: { desc: detail.desc, saveError },
        },
      };
    }
  };
  /** 停止接纳新任务并等待已交付写入结束；重复关闭保持相同结果。 */
  const close = async () => {
    lifecycle = 'closing';
    await chain;
    lifecycle = 'closed';
  };
  return { save, list, close };
}
