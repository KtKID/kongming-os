/**
 * x-music 插件词典：侧栏面板名（zh/en 键一致）。第一阶段面板内没有任何插件
 * 自己的文案——面板就是一个 iframe，内容全部由 x-music 提供。
 */

/** 中文文案。 */
export const zh = {
  panel: "x-music",
} as const;

/** 英文文案。 */
export const en = {
  panel: "x-music",
} as const;

/** 词典键：以 zh 为准，en 必须同键。 */
export type XmusicLocaleKey = keyof typeof zh;
