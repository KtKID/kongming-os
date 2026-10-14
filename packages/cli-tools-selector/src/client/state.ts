/** 区块的纯状态逻辑：主题判定、乐观切换与回滚，不含 React 与网络。 */
import type { ToolSwitchList } from "@kmh/codex-cli/tool-switches";

/** 第一版只适配 codex-cli：其 plugins.item 注册 id。 */
const CODEX_ITEM_ID = "codex-cli";

/** 读取对象上的某个字段；不是对象时返回 undefined，不做类型断言。 */
export function fieldOf(value: unknown, key: string): unknown {
  if (value === null || typeof value !== "object") return undefined;
  for (const [name, item] of Object.entries(value))
    if (name === key) return item;
  return undefined;
}

/**
 * 只在 codex-cli 官方插件页渲染。
 * @param subject - 插件页传入的主题；官方插件为 `{ kind: 'item', id }`。
 */
export function matchesSubject(subject: unknown): boolean {
  return (
    fieldOf(subject, "kind") === "item" &&
    fieldOf(subject, "id") === CODEX_ITEM_ID
  );
}

/**
 * 返回把某个开关置为目标状态后的新清单，原清单不变；身份不存在时原样返回。
 * 乐观更新用它先改界面，失败时用保存的原清单回滚。
 */
export function withSwitch(
  list: ToolSwitchList,
  id: string,
  enabled: boolean,
): ToolSwitchList {
  const flip = (rows: ToolSwitchList["kmh"]): ToolSwitchList["kmh"] =>
    rows.map((row) => (row.id === id ? { ...row, enabled } : row));
  if (![...list.kmh, ...list.native].some((row) => row.id === id)) return list;
  return { ...list, kmh: flip(list.kmh), native: flip(list.native) };
}
