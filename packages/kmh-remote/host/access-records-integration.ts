// 访问记录接入：采集一次密码提交终态，隔离保存失败，校验本机查询并保护代理入口。
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createAccessRecords } from './access-records.ts';
import {
  isRecordsPath,
  MAX_RECORD_QUERY_BYTES,
  QuerySchema,
  RecordsContextSchema,
  RecordsRequestIdSchema,
  recordFailure,
} from '../shared/access-records.ts';
import type {
  PageResult,
  PasswordAttempt,
  PasswordResult,
  RecordsContext,
} from '../shared/access-records.ts';

export const LOGIN_REJECTED_DESC = '密码错误，请重试 | Wrong PIN, try again';
type RecordStore = ReturnType<typeof createAccessRecords>;
type AttemptSink = ((attempt: PasswordAttempt) => unknown) | null;
type RecordLog = ((message: string) => void) | null;

/** 创建当前 Home 的记录器，保存故障交给宿主日志；目录与原始错误沿用文件模块约定。 */
export function createHostAccessRecords(logger: {
  error: (format: string, code: string, desc: string) => void;
}): RecordStore {
  return createAccessRecords({
    home: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    log: (error) =>
      logger.error('Remote 记录保存失败：%s %s', error.code, error.desc),
  });
}

/** 返回原有受限提示全文，登录页面与当次保存的拒绝原因共用。 */
export function loginLimitedDesc(retryAfter: number): string {
  return `尝试次数过多，请 ${retryAfter} 秒后再试 | Too many attempts — try again in ${retryAfter}s`;
}

/** 按原请求捕获来源；每次提交只交付首个终态，保存回调失败保持原登录流程。 */
export function createPasswordAttemptRecorder(
  onPasswordAttempt: AttemptSink,
  log: RecordLog,
) {
  return (req: IncomingMessage, isPublic: boolean) => {
    const entryKind = isPublic ? 'public' : 'lan';
    const peer = String(req.socket.remoteAddress ?? '').replace(
      /^::ffff:/i,
      '',
    );
    const claims = [
      req.headers['x-forwarded-for'],
      req.headers['x-real-ip'],
      req.headers.forwarded,
    ]
      .flatMap((value) => String(value ?? '').split(/[;,]/))
      .map((value) =>
        value
          .trim()
          .replace(/^for=/i, '')
          .replaceAll('"', '')
          .replace(/^\[|\]$/g, ''),
      )
      .filter((value) => isIP(value));
    let completed = false;
    const reportError = (error: unknown) => {
      log?.(
        `记录保存失败：${recordFailure(error, 'REMOTE_RECORD_SAVE_FAILED', 'save').desc}`,
      );
    };
    const complete = (result: PasswordResult): void => {
      if (completed) return;
      completed = true;
      if (!onPasswordAttempt) return;
      const value: PasswordAttempt = {
        peerAddress: isIP(peer) ? peer : null,
        ...(isIP(peer) ? {} : { sourceNote: '实际访问者来源无法确认' }),
        claimedAddresses: [...new Set(claims)].map(
          (address): PasswordAttempt['claimedAddresses'][number] => ({
            address,
            trust: 'unverified',
          }),
        ),
        entryKind,
        ...result,
      };
      try {
        Promise.resolve(onPasswordAttempt(value)).catch(reportError);
      } catch (error) {
        reportError(error);
      }
    };
    const fail = (code: string, desc: string): void =>
      complete({ outcome: 'failure', error: { code, desc } });
    return {
      success: (): void => complete({ outcome: 'success' }),
      rejected: (): void => fail('REMOTE_LOGIN_REJECTED', LOGIN_REJECTED_DESC),
      limited: (retryAfter: number): void =>
        fail('REMOTE_LOGIN_LIMITED', loginLimitedDesc(retryAfter)),
      bodyTooLarge: (): void =>
        fail('REMOTE_LOGIN_BODY_TOO_LARGE', '密码提交体超过 1024 字符'),
      observeSubmission: (): void => {
        req.on('aborted', () => fail('REMOTE_LOGIN_ABORTED', '密码提交中断'));
        req.on('error', (error: Error) => {
          const detail = recordFailure(
            error,
            'REMOTE_LOGIN_IO_FAILED',
            'submission',
          );
          fail(detail.code, detail.desc);
        });
      },
    };
  };
}

/** 拦截 Remote 的记录查询，POST 保留原 RPC 信封和关联 ID；返回是否已处理。 */
export function rejectRemoteRecordsRequest(
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (!isRecordsPath(req.url ?? '')) return false;
  const code = 'REMOTE_RECORD_LOCAL_ONLY';
  const desc = '访问记录仅供电脑本机查看';
  if (req.method !== 'POST') {
    res.writeHead(403, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ code, desc }));
    return true;
  }
  let body = '';
  let exceeded = false;
  req.on('data', (chunk: Buffer | string) => {
    if (Buffer.byteLength(body) + chunk.length > MAX_RECORD_QUERY_BYTES) {
      exceeded = true;
      body = '';
    } else if (!exceeded) body += chunk.toString();
  });
  req.on('end', () => {
    let rpcId = 'invalid-request';
    if (!exceeded) {
      try {
        const raw: unknown = JSON.parse(body);
        const parsed = RecordsRequestIdSchema.safeParse(raw);
        if (parsed.success) rpcId = parsed.data.rpcId;
      } catch {
        /* 非法信封仍明确拒绝。 */
      }
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        type: 'server-response',
        rpcId,
        result: {
          ok: false,
          error: { code, message: desc, details: { desc } },
        },
      }),
    );
  });
  req.on('error', () => res.destroy());
  return true;
}

/** 拒绝 Remote WebSocket 上的记录查询，保留原始拒绝报文；返回是否已处理。 */
export function rejectRemoteRecordsUpgrade(
  req: IncomingMessage,
  socket: Duplex,
): boolean {
  if (!isRecordsPath(req.url ?? '')) return false;
  socket.end(
    'HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nREMOTE_RECORD_LOCAL_ONLY',
  );
  return true;
}

/** 在宿主认证通过后，从原始 TCP 连接构造查询上下文。 */
export function recordsRequestContext(
  req: IncomingMessage,
  connection: { requestRejection?: unknown } | null | undefined,
): RecordsContext {
  const address = String(req.socket.remoteAddress ?? '').replace(
    /^::ffff:/i,
    '',
  );
  return RecordsContextSchema.parse({
    local: address === '127.0.0.1' || address === '::1',
    authenticated: typeof connection?.requestRejection === 'function',
  });
}

/** 本机授权查询；校验游标，保留文件模块和异常的原始 code/desc。 */
export async function queryAccessRecords(
  records: Pick<RecordStore, 'list'> | null,
  payload: unknown,
  signal: AbortSignal | undefined,
  context: RecordsContext | null | undefined,
): Promise<PageResult> {
  const reject = (code: string, desc: string): PageResult => ({
    ok: false,
    error: { code, message: desc, details: { desc } },
  });
  if (!context)
    return reject(
      'REMOTE_RECORD_LOCAL_CONTEXT_REQUIRED',
      '记录查看需要原始本机请求上下文',
    );
  if (!context.local || !context.authenticated)
    return reject('REMOTE_RECORD_LOCAL_ONLY', '访问记录仅供电脑本机授权查看');
  if (!records) return reject('REMOTE_RECORD_NOT_READY', '访问记录尚未就绪');
  try {
    return await records.list(QuerySchema.parse(payload), signal);
  } catch (error) {
    const detail = recordFailure(error, 'REMOTE_RECORD_QUERY_FAILED', 'query');
    return reject(detail.code, detail.desc);
  }
}
