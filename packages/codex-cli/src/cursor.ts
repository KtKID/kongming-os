/** KMH 全量对话历史与 Codex thread 已投递内容的差分游标。 */
import { createHash } from "node:crypto";
import { fieldOf } from "./protocol.ts";
/** unknown 数组化：Array.isArray 守卫后的元素保持 unknown 而非 any。 */
function asArray(value: unknown): unknown[] {
  const out: unknown[] = [];
  if (Array.isArray(value)) for (const item of value) out.push(item);
  return out;
}
/** 文本块判断与文本提取。 */
function isTextBlock(block: unknown): boolean {
  return fieldOf(block, "type") === "text";
}
function textOf(block: unknown): string | undefined {
  const text = fieldOf(block, "text");
  return typeof text === "string" ? text : undefined;
}
import type { RequestMessage } from "@deepseek-ai/dsh-llm";

/** 已投递到 Codex thread 的对齐点：逐条消息的指纹序列。 */
export interface CursorSnapshot {
  fingerprints: string[];
}

/** 一次差分识别出的待投递增量。 */
export type Increment =
  | { kind: "new-input"; text: string; consumed: number }
  | {
      kind: "tool-results";
      results: { callId: string; text: string; isError: boolean }[];
      consumed: number;
    }
  | { kind: "baseline-lost"; reason: string };

/** 空游标：thread 尚未投递任何内容。 */
export function emptySnapshot(): CursorSnapshot {
  return { fingerprints: [] };
}

/** 提取消息的稳定指纹原料：角色、内容块与工具关联。 */
function messageKey(message: RequestMessage): string {
  const parts: string[] = [message.role];
  for (const block of asArray(fieldOf(message, "content")))
    parts.push(JSON.stringify(sortObject(block)));
  const toolCallId = fieldOf(message, "toolCallId");
  if (typeof toolCallId === "string") parts.push(toolCallId);
  return parts.join("\u0000");
}
/** 递归排序对象键，消除等价 JSON 的键序差异。 */
function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort())
      sorted[key] = sortObject(fieldOf(value, key));
    return sorted;
  }
  return value;
}
/** 消息指纹（短哈希）。 */
function fingerprint(message: RequestMessage): string {
  return createHash("sha256")
    .update(messageKey(message))
    .digest("hex")
    .slice(0, 16);
}

/**
 * 对比全量历史与已投快照，切出本次应投给 Codex 的尾部增量。
 * @param messages - 本次请求的完整对话历史。
 * @param snapshot - 上次投递成功后记录的对齐点。
 * @returns new-input 表示尾部是新增用户文本；tool-results 表示尾部是工具调用与结果，
 *   应回传给挂起中的 turn；baseline-lost 表示前缀对不上，调用方必须走恢复路径。
 */
export function diffIncrement(
  messages: readonly RequestMessage[],
  snapshot: CursorSnapshot,
): Increment {
  const count = snapshot.fingerprints.length;
  if (count > messages.length)
    return { kind: "baseline-lost", reason: "history-shrunk" };
  for (let index = 0; index < count; index++) {
    const message = messages[index];
    if (
      message === undefined ||
      fingerprint(message) !== snapshot.fingerprints[index]
    )
      return { kind: "baseline-lost", reason: "prefix-mismatch" };
  }
  const tail = messages.slice(count);
  const last = tail[tail.length - 1];
  if (last === undefined)
    return { kind: "baseline-lost", reason: "empty-increment" };
  if (last.role === "tool") return toolResults(tail, messages.length);
  return newInput(tail, messages.length);
}
/** 尾部识别为新增用户输入：必须恰是一条 user 消息且只含文本块。 */
function newInput(tail: RequestMessage[], total: number): Increment {
  if (tail.length !== 1 || tail[0]?.role !== "user")
    return { kind: "baseline-lost", reason: "unexpected-tail" };
  const texts: string[] = [];
  for (const block of asArray(fieldOf(tail[0], "content"))) {
    if (!isTextBlock(block))
      return { kind: "baseline-lost", reason: "unsupported-input-block" };
    const text = textOf(block);
    if (text === undefined)
      return { kind: "baseline-lost", reason: "unsupported-input-block" };
    texts.push(text);
  }
  return { kind: "new-input", text: texts.join("\n"), consumed: total };
}
/** 尾部识别为工具结果：收集末组 assistant 工具调用之后的全部 tool 消息。 */
function toolResults(tail: RequestMessage[], total: number): Increment {
  let split = tail.length;
  while (split > 0 && tail[split - 1]?.role === "tool") split--;
  const results: { callId: string; text: string; isError: boolean }[] = [];
  for (const message of tail.slice(split)) {
    const callId = fieldOf(message, "toolCallId");
    if (typeof callId !== "string")
      return { kind: "baseline-lost", reason: "tool-without-call" };
    const texts: string[] = [];
    let sawBlock = false;
    for (const block of asArray(fieldOf(message, "content"))) {
      if (!isTextBlock(block))
        return { kind: "baseline-lost", reason: "unsupported-tool-block" };
      sawBlock = true;
      const text = textOf(block);
      if (text !== undefined) texts.push(text);
    }
    if (!sawBlock) texts.push("");
    results.push({
      callId,
      text: texts.join("\n"),
      isError: fieldOf(message, "isError") === true,
    });
  }
  if (results.length === 0)
    return { kind: "baseline-lost", reason: "no-results" };
  // 增量中必须存在 assistant 工具调用记录（Codex 已自行生成）；
  // 全部为 tool 结果说明游标错位到了调用记录之前。
  if (!tail.some((message) => message.role === "assistant"))
    return { kind: "baseline-lost", reason: "no-call-before-results" };
  return { kind: "tool-results", results, consumed: total };
}
/** 计算推进到 total 条后的新快照。 */
export function snapshotAt(
  messages: readonly RequestMessage[],
  total: number,
): CursorSnapshot {
  const fingerprints: string[] = [];
  for (let index = 0; index < total; index++) {
    const message = messages[index];
    if (message !== undefined) fingerprints.push(fingerprint(message));
  }
  return { fingerprints };
}
