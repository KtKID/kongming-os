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

/** 已投递到 Codex thread 的对齐点：逐条消息指纹与待核对回合块摘要。 */
export interface CursorSnapshot {
  fingerprints: string[];
  /**
   * Codex 本身已生成、历史尚未推进越过的块摘要队列（turn 边界核对用）。
   * KMH 在流结束后才组装 assistant 消息，指纹永远滞后一拍；此队列让差分
   * 能区分「Codex 自己的输出」（吞掉不重投）与「外来/被改写内容」（重建）。
   */
  delivered: string[];
}

/** 一次差分识别出的待投递增量。 */
export type Increment =
  | {
      kind: "new-input";
      text: string;
      consumed: number;
      /** 核对后剩余的待核对摘要（新输入路径通常为空）。 */
      delivered: string[];
    }
  | {
      kind: "tool-results";
      results: { callId: string; text: string; isError: boolean }[];
      consumed: number;
      delivered: string[];
    }
  | { kind: "baseline-lost"; reason: string };

/** 空游标：thread 尚未投递任何内容。 */
export function emptySnapshot(): CursorSnapshot {
  return { fingerprints: [], delivered: [] };
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
/** 短哈希摘要。 */
function digest(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

/**
 * 单个内容块的摘要：与 CodexTurn 投影块（block-end）同算法。
 * text/reasoning/tool-call/image 四类可摘要；其他块返回 undefined
 * （意味着无法证明该消息来自 Codex 本身，差分将按基线丢失处理）。
 */
export function blockDigest(block: unknown): string | undefined {
  const type = fieldOf(block, "type");
  if (type === "text") {
    const text = textOf(block);
    if (text === undefined || text === "") return undefined;
    return `t:${digest(text)}`;
  }
  if (type === "reasoning") {
    const text = textOf(block);
    if (text === undefined || text === "") return undefined;
    return `r:${digest(text)}`;
  }
  if (type === "tool-call") {
    const id = fieldOf(block, "id");
    const name = fieldOf(block, "name");
    const args = fieldOf(block, "arguments");
    if (typeof id !== "string" || typeof name !== "string") return undefined;
    const argsText = typeof args === "string" ? args : JSON.stringify(args);
    return `c:${digest(`${id}\u0000${name}\u0000${argsText}`)}`;
  }
  if (type === "image") {
    const attachment = fieldOf(block, "attachment");
    const id =
      attachment === null || attachment === undefined
        ? undefined
        : fieldOf(attachment, "attachmentId");
    return typeof id === "string" ? `i:${digest(id)}` : undefined;
  }
  return undefined;
}
/**
 * 一条 assistant 消息的块摘要序列；含不可摘要块时返回 undefined。
 * 空文本/空推理块跳过（两侧投影与组装对空块的取舍可能不同，空块无信息量）。
 */
function assistantDigests(message: RequestMessage): string[] | undefined {
  const out: string[] = [];
  for (const block of asArray(fieldOf(message, "content"))) {
    const type = fieldOf(block, "type");
    const text = textOf(block);
    if (
      (type === "text" || type === "reasoning") &&
      (text === undefined || text === "")
    )
      continue;
    const d = blockDigest(block);
    if (d === undefined) return undefined;
    out.push(d);
  }
  return out;
}
/** 消息是否真实用户输入（source.kind 缺省按 user 对待）。 */
function isRealUserMessage(message: RequestMessage): boolean {
  if (message.role !== "user") return false;
  const source = fieldOf(message, "source");
  if (source === null || source === undefined) return true;
  const kind = fieldOf(source, "kind");
  return kind === undefined || kind === "user";
}

/**
 * 对比全量历史与已投快照，切出本次应投给 Codex 的尾部增量。
 * @param messages - 本次请求的完整对话历史。
 * @param snapshot - 上次投递成功后记录的对齐点。
 * @returns new-input 表示尾部是新增用户文本（前缀中的 assistant 回复经
 *   块摘要核对为 Codex 自产、context/system 注入透明吞掉，不重投）；
 *   tool-results 表示尾部是工具调用与结果，应回传给挂起中的 turn；
 *   baseline-lost 表示前缀对不上或出现外来/不可证明内容，调用方必须走恢复路径。
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
  if (last.role === "tool") return toolResults(tail, messages.length, snapshot);
  return newUserInput(tail, messages.length, snapshot);
}

/**
 * 尾部识别为新增用户输入。允许的形态：任意条「Codex 自产 assistant 消息
 * （块摘要逐一核对）+ context/system 注入（透明吞掉）」后跟最后一条真实
 * 用户消息，且其后还可跟随任意条注入（新会话首轮的准备注入——技能清单、
 * 时间戳、运行时上下文——排在真实输入之后，2026-10-08 实测）；注入文本
 * 与真实输入一并作为本次投递内容。其余形态（连续多条真实用户消息、外来
 * 回复、未知角色）断基线。
 */
function newUserInput(
  tail: RequestMessage[],
  total: number,
  snapshot: CursorSnapshot,
): Increment {
  const rest = [...snapshot.delivered];
  let lastReal = -1;
  for (let index = tail.length - 1; index >= 0; index--) {
    const message = tail[index];
    if (message !== undefined && isRealUserMessage(message)) {
      lastReal = index;
      break;
    }
  }
  const last = lastReal >= 0 ? tail[lastReal] : undefined;
  if (last === undefined)
    return { kind: "baseline-lost", reason: "unexpected-tail" };
  /** 拼接一条消息的全部文本块；出现非文本块返回 undefined。 */
  const textOfMessage = (message: RequestMessage): string | undefined => {
    const parts: string[] = [];
    for (const block of asArray(fieldOf(message, "content"))) {
      if (!isTextBlock(block)) return undefined;
      const text = textOf(block);
      if (text === undefined) return undefined;
      parts.push(text);
    }
    return parts.join("\n");
  };
  const texts: string[] = [];
  for (const message of tail.slice(0, lastReal)) {
    if (message.role === "assistant") {
      const digests = assistantDigests(message);
      if (digests === undefined)
        return { kind: "baseline-lost", reason: "history-rewritten" };
      for (const d of digests)
        if (rest.shift() !== d)
          return { kind: "baseline-lost", reason: "history-rewritten" };
    } else if (message.role === "system" || message.role === "developer") {
      // 系统提示经 thread 创建时的 baseInstructions 交付；中途变化不重投
      // （Codex 沿用创建时指令），如实情不符应显式分叉重建。
      continue;
    } else if (message.role === "user" && !isRealUserMessage(message)) {
      continue;
    } else {
      return { kind: "baseline-lost", reason: "unexpected-tail" };
    }
  }
  const lastText = textOfMessage(last);
  if (lastText === undefined)
    return { kind: "baseline-lost", reason: "unsupported-input-block" };
  texts.push(lastText);
  for (const message of tail.slice(lastReal + 1)) {
    // 尾随注入只接受透明类型；文本并入本次投递（模型需要看到技能清单、
    // 时间戳与运行时上下文），非文本块断基线。
    if (!(
      message.role === "system" ||
      message.role === "developer" ||
      (message.role === "user" && !isRealUserMessage(message))
    ))
      return { kind: "baseline-lost", reason: "unexpected-tail" };
    const injected = textOfMessage(message);
    if (injected === undefined)
      return { kind: "baseline-lost", reason: "unsupported-input-block" };
    texts.push(injected);
  }
  return {
    kind: "new-input",
    text: texts.join("\n\n"),
    consumed: total,
    delivered: rest,
  };
}
/** 尾部识别为工具结果：收集末组 assistant 工具调用之后的全部 tool 消息。 */
function toolResults(
  tail: RequestMessage[],
  total: number,
  snapshot: CursorSnapshot,
): Increment {
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
  // 尾部中已被指纹覆盖推进的 assistant 消息，其块摘要同步出队：
  // 后续 turn 边界核对只面对尚未越过的新回复。
  const rest = [...snapshot.delivered];
  for (const message of tail.slice(0, split)) {
    if (message.role !== "assistant") continue;
    const digests = assistantDigests(message);
    if (digests === undefined) continue;
    for (const d of digests)
      if (rest.shift() !== d)
        return { kind: "baseline-lost", reason: "digest-desync" };
  }
  return {
    kind: "tool-results",
    results,
    consumed: total,
    delivered: rest,
  };
}
/** 计算推进到 total 条后的新快照。 */
export function snapshotAt(
  messages: readonly RequestMessage[],
  total: number,
  delivered: string[] = [],
): CursorSnapshot {
  const fingerprints: string[] = [];
  for (let index = 0; index < total; index++) {
    const message = messages[index];
    if (message !== undefined) fingerprints.push(fingerprint(message));
  }
  return { fingerprints, delivered: [...delivered] };
}
