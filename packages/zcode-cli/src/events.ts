/** session/event 事件契约与到 DSH 流式块的回合投影。 */
import { z } from "zod";
import type { LlmFailure, StreamChunk, TokenUsage } from "@deepseek-ai/dsh-llm";

/** 行协议通知参数：会话身份、序号与事件载荷。 */
export const sessionEventEnvelope = z
  .object({
    sessionId: z.string(),
    sequenceNumber: z.number().int().nonnegative().optional(),
    payload: z.unknown(),
  })
  .passthrough();
/** 实况 token 流事件（model.streaming）。 */
export const streamingEvent = z
  .object({
    type: z.literal("model.streaming"),
    kind: z.enum([
      "start",
      "finish",
      "error",
      "text_start",
      "text_delta",
      "text_end",
      "reasoning_start",
      "reasoning_delta",
      "reasoning_end",
      "tool_input_start",
      "tool_input_delta",
      "tool_input_end",
      "tool_call",
    ]),
    delta: z.string().optional(),
    toolCallId: z.string().optional(),
    toolName: z.string().optional(),
  })
  .passthrough();
/** 回合完成事件（turn.completed）。 */
export const turnCompletedEvent = z
  .object({
    type: z.literal("turn.completed"),
    inputId: z.string().optional(),
    resultType: z.string(),
    usage: z.unknown().optional(),
  })
  .passthrough();
/** 回合失败事件（turn.failed）。 */
export const turnFailedEvent = z
  .object({ type: z.literal("turn.failed"), inputId: z.string().optional() })
  .passthrough();
/** 会话关闭事件（session.closed）。 */
export const sessionClosedEvent = z
  .object({ type: z.literal("session.closed") })
  .passthrough();

/** 回合终态：finish 块的 reason 与可选用量。 */
export interface TurnSettlement {
  reason:
    | { kind: "stop" }
    | { kind: "max-tokens" }
    | { kind: "aborted"; failure: LlmFailure }
    | { kind: "error"; failure: LlmFailure };
  usage?: TokenUsage;
}
/** 读取未知对象键值（无断言窄化）。 */
function fieldOf(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  for (const [name, item] of Object.entries(value))
    if (name === key) return item;
  return undefined;
}
/** 官方 usage 是折叠口径（input 含缓存命中）：按既有规则折成不相交口径。 */
function toDisjointUsage(value: unknown): TokenUsage | undefined {
  const inputTokens = fieldOf(value, "inputTokens");
  const outputTokens = fieldOf(value, "outputTokens");
  if (typeof inputTokens !== "number" || typeof outputTokens !== "number")
    return undefined;
  const rawCacheRead = fieldOf(value, "cacheReadTokens");
  const rawCacheWrite = fieldOf(value, "cacheWriteTokens");
  const cached = typeof rawCacheRead === "number" ? rawCacheRead : 0;
  const written = typeof rawCacheWrite === "number" ? rawCacheWrite : 0;
  const uncached = Math.max(0, inputTokens - cached - written);
  const rawReasoning = fieldOf(value, "reasoningTokens");
  const usage: TokenUsage = {
    inputTokens: uncached,
    outputTokens,
    ...(cached ? { cacheReadTokens: cached } : {}),
    ...(written ? { cacheWriteTokens: written } : {}),
    ...(typeof rawReasoning === "number"
      ? { reasoningTokens: rawReasoning }
      : {}),
  };
  return usage;
}
/** 官方 resultType → DSH finish reason。 */
function finishReasonOf(resultType: string): TurnSettlement["reason"] {
  if (resultType === "success") return { kind: "stop" };
  if (resultType === "error_max_turns") return { kind: "max-tokens" };
  if (resultType === "cancelled")
    return {
      kind: "aborted",
      failure: {
        message: "ZCode turn cancelled",
        code: "ZCODE_TURN_CANCELLED",
      },
    };
  return {
    kind: "error",
    failure: {
      message: `ZCode turn ended: ${resultType}`,
      code: "ZCODE_TURN_FAILED",
    },
  };
}
function settlementOf(resultType: string, usage: unknown): TurnSettlement {
  const parsed = toDisjointUsage(usage);
  const reason = finishReasonOf(resultType);
  return parsed === undefined ? { reason } : { reason, usage: parsed };
}
function failureOf(detail: string, code: string): TurnSettlement["reason"] {
  return { kind: "error", failure: { message: detail, code } };
}
interface OpenBlock {
  index: number;
  type: "text" | "reasoning";
  text: string;
}
/**
 * 单个回合的事件投影器：把 model.streaming 增量转成 text/reasoning 块事件，
 * CLI 侧工具活动不进内容块（执行发生在 CLI 内，投影为块会导致宿主重复执行）。
 * 终态由 turn.completed / turn.failed / session.closed 或调用方注入的停止决定。
 */
export class TurnEventProjector {
  private nextIndex = 0;
  private readonly open = new Map<"text" | "reasoning", OpenBlock>();
  private settled: TurnSettlement | undefined;
  /** 单回合生命周期内是否产生过可见内容（终态兜底 finish 用）。 */
  private sawContent = false;
  /** 注入用户停止：开放块立即收口，finish 归为 aborted。 */
  abort(detail: string): StreamChunk[] {
    if (this.settled !== undefined) return [];
    this.settled = {
      reason: {
        kind: "aborted",
        failure: { message: detail, code: "ZCODE_REQUEST_CANCELLED" },
      },
    };
    return this.closeOpen();
  }
  /** 注入通道失败：与 stop 同形但归为 error。 */
  fail(detail: string, code: string): StreamChunk[] {
    if (this.settled !== undefined) return [];
    this.settled = { reason: failureOf(detail, code) };
    return this.closeOpen();
  }
  /** 消费一条事件载荷；返回应发出的流式块（可为空）。 */
  push(payload: unknown): StreamChunk[] {
    if (this.settled !== undefined) return [];
    const streaming = streamingEvent.safeParse(payload);
    if (streaming.success) return this.pushStreaming(streaming.data);
    const completed = turnCompletedEvent.safeParse(payload);
    if (completed.success) {
      this.settled = settlementOf(
        completed.data.resultType,
        completed.data.usage,
      );
      return this.closeOpen();
    }
    const failed = turnFailedEvent.safeParse(payload);
    if (failed.success) {
      const message =
        typeof failed.data.error === "object" &&
        failed.data.error !== null &&
        "message" in failed.data.error
          ? String(failed.data.error.message)
          : JSON.stringify(failed.data.error ?? "turn failed").slice(0, 300);
      this.settled = { reason: failureOf(message, "ZCODE_TURN_FAILED") };
      return this.closeOpen();
    }
    if (sessionClosedEvent.safeParse(payload).success) {
      this.settled = {
        reason: failureOf("session closed", "ZCODE_SESSION_CLOSED"),
      };
      return this.closeOpen();
    }
    // 其余事件（session.updated、tool.updated、permission.requested 等）不进内容流。
    return [];
  }
  private pushStreaming(event: z.infer<typeof streamingEvent>): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    const delta = event.delta ?? "";
    if (event.kind === "reasoning_start" || event.kind === "text_start") {
      const type = event.kind === "text_start" ? "text" : "reasoning";
      chunks.push(...this.closeOne(type));
      const index = this.nextIndex++;
      this.open.set(type, { index, type, text: "" });
      chunks.push({ type: "block-start", index, blockType: type });
      return chunks;
    }
    if (event.kind === "reasoning_delta" || event.kind === "text_delta") {
      const type = event.kind === "text_delta" ? "text" : "reasoning";
      const block = this.open.get(type);
      if (block === undefined) {
        // 无 start 的增量（事件流续传场景）：补开一个块。
        const index = this.nextIndex++;
        this.open.set(type, { index, type, text: "" });
        chunks.push({ type: "block-start", index, blockType: type });
        return chunks;
      }
      block.text += delta;
      this.sawContent = true;
      if (delta !== "")
        chunks.push({
          type: type === "text" ? "text-delta" : "reasoning-delta",
          index: block.index,
          text: delta,
        });
      return chunks;
    }
    if (event.kind === "reasoning_end" || event.kind === "text_end") {
      const type = event.kind === "text_end" ? "text" : "reasoning";
      chunks.push(...this.closeOne(type));
      return chunks;
    }
    // start/finish/error/tool_* /tool_call：回合级标记与 CLI 侧工具活动，不投影。
    return chunks;
  }
  private closeOne(type: "text" | "reasoning"): StreamChunk[] {
    const block = this.open.get(type);
    if (block === undefined) return [];
    this.open.delete(type);
    return [
      {
        type: "block-end",
        index: block.index,
        block: { type, text: block.text },
      },
    ];
  }
  private closeOpen(): StreamChunk[] {
    const chunks: StreamChunk[] = [];
    for (const type of ["text", "reasoning"] as const)
      chunks.push(...this.closeOne(type));
    if (this.settled === undefined) return chunks;
    chunks.push(
      ...(this.settled.usage
        ? [{ type: "usage" as const, usage: this.settled.usage }]
        : []),
      { type: "finish" as const, reason: this.settled.reason },
    );
    return chunks;
  }
  /** 回合是否已终态。 */
  get finished(): boolean {
    return this.settled !== undefined;
  }
  /** 终态失败码（stop/max-tokens/aborted 与未终态为 undefined），供监督落账分类。 */
  get outcomeCode(): string | undefined {
    const reason = this.settled?.reason;
    return reason !== undefined && "failure" in reason
      ? reason.failure.code
      : undefined;
  }
  /** 是否产生过可见内容块（诊断用）。 */
  get contentSeen(): boolean {
    return this.sawContent;
  }
}
