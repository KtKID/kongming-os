/**
 * 按请求的监督状态：阶段、尝试次数、首个终止原因与清理结果彼此独立记录。
 * 关键函数：open 按「会话 + 请求指纹」续接重试（同指纹失败记录重开为下一次尝试）；
 * terminate 只保留首个终止原因；snapshot 以注入的慢请求阈值计算提示位，供 Web 展示。
 * 状态契约（枚举与快照 schema）位于 status.ts，宿主与浏览器共享。
 */
import { randomUUID } from "node:crypto";
import type {
  RequestOutcome,
  RequestStage,
  RequestStatus,
  TerminationCause,
} from "./status.ts";

const finishedRetention = 50;

/** exactOptionalPropertyTypes 下省略未定义的可选字段。 */
function withDetail(detail: string | undefined): { detail?: string } {
  return detail === undefined ? {} : { detail };
}

/** 单条请求记录；状态变更只经 note/failAttempt/terminate/succeed/cleanup 进入。 */
export class RequestRecord {
  readonly requestId = randomUUID();
  attempt = 1;
  stage: RequestStage = "starting";
  outcome: RequestOutcome = "running";
  readonly startedAt = Date.now();
  updatedAt = this.startedAt;
  readonly attemptFailures: {
    attempt: number;
    cause: TerminationCause;
    detail?: string;
  }[] = [];
  termination?: { cause: TerminationCause; at: number; detail?: string };
  cleanupResult?: { ok: boolean; detail?: string };
  stop?: {
    requestedAt: number;
    receipt?: boolean;
    receiptAt?: number;
    exitConfirmed?: boolean;
  };
  waitingSince: number | undefined;
  constructor(readonly sessionId: string | undefined) {}
  /** 更新阶段并刷新时间戳；进入 waiting 时记录等待起点供慢请求计算。 */
  note(change: { stage?: RequestStage }): void {
    if (change.stage !== undefined) {
      if (change.stage === "waiting" && this.stage !== "waiting")
        this.waitingSince = Date.now();
      this.stage = change.stage;
    }
    this.updatedAt = Date.now();
  }
  /** 记录一次尝试失败；已终止的请求忽略晚到的失败。失败记录仍可被 open 续接。 */
  failAttempt(cause: TerminationCause, detail?: string): void {
    if (this.termination !== undefined || this.outcome === "succeeded") return;
    this.attemptFailures.push({
      attempt: this.attempt,
      cause,
      ...withDetail(detail),
    });
    this.outcome = "failed";
    this.updatedAt = Date.now();
  }
  /** 终止整条逻辑请求；仅首个原因生效，后续终止调用只刷新时间戳。 */
  terminate(cause: TerminationCause, detail?: string): void {
    if (this.termination === undefined)
      this.termination = { cause, at: Date.now(), ...withDetail(detail) };
    this.outcome = "failed";
    this.updatedAt = Date.now();
  }
  succeed(): void {
    this.outcome = "succeeded";
    this.updatedAt = Date.now();
  }
  /** 清理结果独立于终止原因记录，允许在任意终态之后追加。 */
  cleanup(ok: boolean, detail?: string): void {
    this.cleanupResult = { ok, ...withDetail(detail) };
    this.updatedAt = Date.now();
  }

  /** 用户停止链路起点：记录停止请求时刻，先于官方取消发送。 */
  noteStop(): void {
    if (this.stop === undefined) this.stop = { requestedAt: Date.now() };
    this.updatedAt = Date.now();
  }

  /** 官方取消回执；超时无回执记 false 并保留到达时刻区分。 */
  noteReceipt(receipt: boolean): void {
    if (this.stop === undefined) this.stop = { requestedAt: Date.now() };
    this.stop = { ...this.stop, receipt, receiptAt: Date.now() };
    this.updatedAt = Date.now();
  }

  /** 本机受管范围清空确认（waitForExit 结果）。 */
  noteExitConfirmed(confirmed: boolean): void {
    if (this.stop === undefined) this.stop = { requestedAt: Date.now() };
    this.stop = { ...this.stop, exitConfirmed: confirmed };
    this.updatedAt = Date.now();
  }
  /** 续接重试：尝试数加一并回到运行态；输入为打开方已核对的同指纹记录。 */
  reopen(): void {
    this.attempt += 1;
    this.outcome = "running";
    this.stage = "starting";
    this.waitingSince = undefined;
    this.updatedAt = Date.now();
  }
  status(slow: boolean): RequestStatus {
    return {
      requestId: this.requestId,
      sessionId: this.sessionId ?? null,
      stage: this.stage,
      attempt: this.attempt,
      startedAt: this.startedAt,
      updatedAt: this.updatedAt,
      waitingSince: this.waitingSince ?? null,
      slow,
      outcome: this.outcome,
      attemptFailures: [...this.attemptFailures],
      termination: this.termination ? { ...this.termination } : undefined,
      cleanupResult: this.cleanupResult ? { ...this.cleanupResult } : undefined,
      stop: this.stop ? { ...this.stop } : undefined,
    };
  }
}

/**
 * 请求监督器：并发跟踪多条请求，重试按「会话 + 指令指纹」续接同一记录。
 * 打开同指纹的失败记录 = 下一次尝试；已终止或成功的记录总是开启新记录。
 */
export class RequestSupervisor {
  private readonly records = new Map<string, RequestRecord>();
  private readonly continuations = new Map<string, string>();
  /**
   * 打开或续接一条请求记录。
   * @param sessionId - 发起请求的会话；探测类请求可为 undefined。
   * @param fingerprint - 区分逻辑请求的指纹（调用方用消息与模型构成）。
   * @returns 运行中的记录；同指纹的失败记录以 attempt+1 续接。
   */
  open(sessionId: string | undefined, fingerprint: string): RequestRecord {
    const key = `${sessionId ?? ""}|${fingerprint}`;
    const previousId = this.continuations.get(key);
    if (previousId !== undefined) {
      const previous = this.records.get(previousId);
      if (
        previous !== undefined &&
        previous.outcome === "failed" &&
        previous.termination === undefined
      ) {
        this.continuations.delete(key);
        previous.reopen();
        return previous;
      }
    }
    const record = new RequestRecord(sessionId);
    this.records.set(record.requestId, record);
    this.continuations.set(key, record.requestId);
    this.prune();
    return record;
  }
  /** 以慢请求阈值生成全部记录的快照；按更新时间倒序，等待超阈值记 slow。 */
  snapshot(slowMs: number, now: number = Date.now()): RequestStatus[] {
    const rows = [...this.records.values()].map((record) => ({
      record,
      slow:
        record.outcome === "running" &&
        record.stage === "waiting" &&
        record.waitingSince !== undefined &&
        now - record.waitingSince >= slowMs,
    }));
    rows.sort((a, b) => b.record.updatedAt - a.record.updatedAt);
    const pruned = this.prune();
    return rows
      .filter((row) => pruned.has(row.record))
      .map((row) => row.record.status(row.slow));
  }
  /** 控制内存占用：只保留最近 finishedRetention 条已结束记录。 */
  private prune(): Set<RequestRecord> {
    const finished = [...this.records.values()]
      .filter((record) => record.outcome !== "running")
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const excess = finished.slice(finishedRetention);
    for (const record of excess) this.records.delete(record.requestId);
    return new Set(this.records.values());
  }
}
