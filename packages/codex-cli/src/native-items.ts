/** 原生执行叙述投影（feat08 v1）：原生工具活动以文本块呈现进对话。 */
import { fieldOf } from "./protocol.ts";

/**
 * v1 形态说明（D14 预案的落地取舍）：完整的独立观察记录与对话卡片需要
 * 宿主新增公开扩展点（可 ignorable 的插件会话事件或扩展块类型；现有
 * Session.append 无法写 ignorable 标记，自定义事件会破坏旧宿主的会话
 * 重载）。v1 用既有公开通道：原生活动叙述为助手消息内独立文本块，
 * 与生图附注同一形态——差分账目（blockDigest）自动把它们识别为
 * Codex 自产内容，刷新/重开后随会话历史可查。
 */
/** 单条原生调用的叙述体积上限；超出截断并标注（D14：限制记录体积）。 */
export const NATIVE_NOTE_LIMIT = 8000;
/** turn 级 diff 叙述的最大更新次数；超出后停止追加（防刷屏）。 */
const DIFF_NOTE_MAX_UPDATES = 20;

/** 可叙述的原生 item wire 类型（0.160.0 ThreadItem 变体，camelCase）。 */
export type NativeItemType =
  | "commandExecution"
  | "fileChange"
  | "mcpToolCall"
  | "imageView"
  | "imageGeneration";
/** 叙述条目：item 定位与开头一行。 */
export interface NativeHeader {
  itemId: string;
  header: string;
}
/**
 * 从 item/started 或 item/completed 的 item 提取叙述开头。
 * @param item - ThreadItem 原始对象。
 * @returns 可叙述类型时返回条目；其余（KMH 桥的 dynamicToolCall、模型
 *   自产 agentMessage/reasoning 等）返回 undefined，不叙述。
 */
export function nativeHeaderOf(item: unknown): NativeHeader | undefined {
  const type = fieldOf(item, "type");
  const id = fieldOf(item, "id");
  if (typeof id !== "string") return undefined;
  switch (type) {
    case "commandExecution": {
      const command = fieldOf(item, "command");
      const cwd = fieldOf(item, "cwd");
      const where =
        typeof cwd === "string" && cwd !== "" ? `（目录 ${cwd}）` : "";
      return {
        itemId: id,
        header: `▸ [codex 原生·命令] ${typeof command === "string" ? command : "（未知命令）"}${where}`,
      };
    }
    case "fileChange": {
      const changes = fieldOf(item, "changes");
      const count = Array.isArray(changes) ? changes.length : 0;
      return {
        itemId: id,
        header: `▸ [codex 原生·文件修改] ${count} 个文件变更`,
      };
    }
    case "mcpToolCall": {
      const server = fieldOf(item, "server");
      const tool = fieldOf(item, "tool");
      return {
        itemId: id,
        header: `▸ [codex 原生·MCP] ${typeof server === "string" ? server : "?"}/${typeof tool === "string" ? tool : "?"}`,
      };
    }
    case "imageView":
      return { itemId: id, header: "▸ [codex 原生·查看图片]" };
    case "imageGeneration":
      return {
        itemId: id,
        header: "▸ [codex 原生·图片生成] 执行中，等待产物…",
      };
    default:
      return undefined;
  }
}
/**
 * 构造 item/completed 的收尾叙述：完成状态、退出码与耗时（增量输出
 * 已随 delta 流入，此处只收状态，避免与 aggregatedOutput 重复）。
 * @param item - ThreadItem 原始对象。
 * @returns 收尾文本；不可叙述类型返回 undefined。
 */
export function nativeCompletionNoteOf(item: unknown): string | undefined {
  const type = fieldOf(item, "type");
  const status = fieldOf(item, "status");
  const statusText = typeof status === "string" ? status : "unknown";
  const duration = fieldOf(item, "durationMs");
  const suffix =
    typeof duration === "number" && Number.isFinite(duration)
      ? `，耗时 ${Math.max(1, Math.round(duration / 100) / 10)}s`
      : "";
  switch (type) {
    case "commandExecution": {
      const exit = fieldOf(item, "exitCode");
      const exitText = typeof exit === "number" ? `退出码 ${exit}` : "已结束";
      return `▸ 完成：${exitText}${suffix}（${statusText}）`;
    }
    case "fileChange":
    case "mcpToolCall":
    case "imageView":
    case "imageGeneration":
      return `▸ 完成（${statusText}${suffix}）`;
    default:
      return undefined;
  }
}
/** 回合终止时未收到完成确认的调用补记（场景5/6：状态待确认）。 */
export const NATIVE_UNSETTLED_NOTE =
  "▸ 回合结束仍未收到完成确认，状态待确认；已有输出保留。";
/** turn 级 diff 叙述的固定 item 标识（懒开启）。 */
export const NATIVE_DIFF_NOTE_ID = "codex-native-diff";
/** 输出截断标注。 */
export const NATIVE_TRUNCATED_NOTE = "\n▸ （输出超过记录上限，已截断）";
/** turn 级 diff 更新的摘要行（按 +/- 行数统计，排除 +++/--- 文件头）。 */
export function diffSummaryLineOf(diff: string): string {
  let added = 0;
  let removed = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return `▸ [codex 原生·变更] turn diff 更新：+${added}/−${removed} 行`;
}
/** 叙述条目的体积账目（turn 持有，reopen 重置）。 */
export interface NativeNoteBudget {
  /** 已累积字符数（按 item）。 */
  chars: number;
  /** 已截断后停止追加。 */
  truncated: boolean;
  /** 是否已收尾（一次性：完成后不再追加）。 */
  closed: boolean;
  /** 累积的叙述全文：block-end 的权威内容（差分与消息组装以它为准）。 */
  text: string;
}
/** 新账目。 */
export function newNoteBudget(): NativeNoteBudget {
  return { chars: 0, truncated: false, closed: false, text: "" };
}
/** diff 叙述账目：更新次数封顶。 */
export interface DiffNoteBudget {
  updates: number;
}
export function newDiffBudget(): DiffNoteBudget {
  return { updates: 0 };
}
/** diff 是否还应继续追加（封顶保护）。 */
export function diffBudgetAccepts(budget: DiffNoteBudget): boolean {
  return budget.updates < DIFF_NOTE_MAX_UPDATES;
}
