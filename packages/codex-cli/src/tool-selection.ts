/** CLI 工具选择的数据形状：Config 字段 toolSelection、目录行、来源与目标身份及开关判定。 */
import Schema from "@deepseek-ai/schemastery";
import { brandString, type Branded } from "@deepseek-ai/dsh-brand";
import type { ToolSchema } from "@deepseek-ai/dsh-llm";
import type { JsonValue } from "@deepseek-ai/dsh-util-values";

/** 工具来源身份：codex/native、codex/mcp/<server>、harness 等。 */
export type ToolSourceId = Branded<"CliToolSourceId">;
/** 把来源字符串标记为来源身份。 */
export function ToolSourceId(value: string): ToolSourceId {
  return brandString<ToolSourceId>(value);
}
/** CLI profile 条目身份（profile 清单中的插件 id）。 */
export type CliTargetId = Branded<"CliTargetId">;
/** 把条目 id 标记为目标身份。 */
export function CliTargetId(value: string): CliTargetId {
  return brandString<CliTargetId>(value);
}

const entry = Schema.object({
  source: Schema.string().min(1).required(),
  name: Schema.string().min(1).required(),
  enabled: Schema.boolean().required(),
});
const selection = Schema.object({
  version: Schema.const(1).required(),
  harness: Schema.array(entry).required(),
  native: Schema.array(entry).required(),
});
/** toolSelection 字段的明文值。 */
export type ToolSelection = Schemastery.TypeT<typeof selection>;
/**
 * 带版本的 Config 值；同侧重复身份在配置提交前失败。
 * transform 回调收到的是 inner 校验后的输出，输入输出因此都按已校验形状声明。
 */
export const ToolSelectionSchema: Schema<ToolSelection, ToolSelection> =
  Schema.transform(selection, (value) => {
    const parsed = selection(value);
    for (const side of ["harness", "native"] as const) {
      const identities = new Set<string>();
      for (const row of parsed[side]) {
        const key = JSON.stringify([row.source, row.name]);
        if (identities.has(key))
          throw new Error(`Duplicate ${side} tool ${row.source}/${row.name}`);
        identities.add(key);
      }
    }
    return parsed;
  });
type DeepReadonly<T> = T extends object
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;
/** volatile Config 访问器给出的深只读快照。 */
export type ReadonlyToolSelection = DeepReadonly<ToolSelection>;

/** 目录行的控制方式：可调、联动组、固定（含原因）或待核实。 */
export type CliToolControl =
  | { readonly kind: "adjustable" }
  | { readonly kind: "linked"; readonly group: string }
  | {
      readonly kind: "fixed";
      readonly enabled: boolean;
      readonly reason: string;
    }
  | { readonly kind: "unverified"; readonly reason: string };
/** 目录行身份：所属侧、来源与实际名称。 */
export interface CliToolRef {
  readonly side: "harness" | "native";
  readonly source: ToolSourceId;
  readonly name: string;
}
/** 一行可展示、可判定的工具目录条目。 */
export interface CliToolRow extends CliToolRef {
  readonly description: string;
  readonly sourceLabel?: string;
  readonly registryName?: string;
  readonly declaration?: JsonValue;
  readonly schema?: ToolSchema;
  readonly control: CliToolControl;
}
/** 一次完整目录及两侧各自的诊断。 */
export interface CliToolCatalog {
  readonly revision: string;
  readonly tools: readonly CliToolRow[];
  readonly diagnostics?: Partial<Record<"harness" | "native", string>>;
}
/** 会话创建时保存的 Harness 工具快照条目。 */
export interface SavedInventoryEntry {
  readonly source: ToolSourceId;
  readonly sourceLabel?: string;
  readonly schema: ToolSchema;
}

/**
 * 判定一行是否开启：固定行取其实际状态；其余按保存的身份查找，缺省关闭。
 * Harness 侧的公开注册表不暴露插件来源，身份未命中时按名称回退，
 * 以兼容带旧来源 id 的已保存配置。
 * @param value 已接受的 toolSelection。
 * @param row 实际目录行。
 * @returns 保存的选择或固定行的实际状态。
 */
export function choiceEnabled(
  value: ReadonlyToolSelection,
  row: CliToolRow,
): boolean {
  if (row.control.kind === "fixed") return row.control.enabled;
  const rows = value[row.side];
  const exact = rows.find(
    (item) => item.source === row.source && item.name === row.name,
  );
  if (exact !== undefined) return exact.enabled;
  if (row.side !== "harness") return false;
  return rows.find((item) => item.name === row.name)?.enabled ?? false;
}
