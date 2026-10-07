/** 生图产物验收（feat10，R3 从简版）：PNG 实际尺寸解析与明确尺寸要求识别。 */
/** PNG 文件签名（前 8 字节）。 */
const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** 实际像素尺寸。 */
export interface PixelSize {
  width: number;
  height: number;
}
/**
 * 从 PNG 字节读取实际像素尺寸（IHDR 宽高，大端 uint32）。
 * @param data - 产物文件字节。
 * @returns PNG 且 IHDR 可读时返回宽高；否则 undefined（不构成错误）。
 */
export function pngSizeOf(data: Buffer): PixelSize | undefined {
  if (data.length < 24 || !data.subarray(0, 8).equals(PNG_SIGNATURE))
    return undefined;
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width === 0 || height === 0) return undefined;
  return { width, height };
}
/** 用户输入中的明确像素尺寸要求。 */
export type SizeRequirement = PixelSize;
/** 宽×高数字对（允许 x/×/* 与空白变体）；2–5 位数字排除棋盘行列类单数字对。 */
const SIZE_PAIR = /(\d{2,5})\s*[x×*]\s*(\d{2,5})/i;
/**
 * 从用户输入识别明确像素尺寸要求（R3 从简：识别只用于如实报告，
 * 无副作用，偶发误识别仅多一句附注）。
 * @param text - 本回合用户输入文本。
 * @returns 出现宽×高数字对时返回该尺寸；否则 undefined。
 */
export function imageSizeRequirementOf(
  text: string,
): SizeRequirement | undefined {
  const match = SIZE_PAIR.exec(text);
  if (match === null) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isInteger(width) || !Number.isInteger(height)) return undefined;
  return { width, height };
}
/**
 * 构造随图片展示的尺寸报告：始终报实际像素尺寸；存在明确要求且不符时
 * 如实说明未满足（R3 从简：不自动另存改尺寸副本，原图可保存）。
 * @param actual - 产物实际尺寸；无法解析时为 undefined，报告改用占位说明。
 * @param requirement - 用户明确要求的尺寸；无要求时为 undefined。
 * @returns 报告文本。
 */
export function imageSizeNote(
  actual: PixelSize | undefined,
  requirement: SizeRequirement | undefined,
): string {
  const actualText =
    actual === undefined
      ? "未知（产物非 PNG 或元数据不可读）"
      : `${actual.width}×${actual.height}`;
  if (
    requirement === undefined ||
    (actual !== undefined &&
      actual.width === requirement.width &&
      actual.height === requirement.height)
  )
    return `图片实际尺寸 ${actualText} 像素。`;
  return `图片实际尺寸 ${actualText} 像素，与要求的 ${requirement.width}×${requirement.height} 不符（未改尺寸另存，原图可直接保存）。`;
}
/**
 * 构造产物接入失败的双态报告：生成成功（Codex 侧）与接入失败（KMH 侧）
 * 分开陈述，并给出原生产物路径作为恢复入口。
 * @param path - Codex 侧已落盘的原生产物路径。
 * @param reason - 接入失败原因。
 * @returns 报告文本。
 */
export function imageFailureNote(path: string, reason: string): string {
  return `图片已由 Codex 生成并保存（${path}），但 KMH 产物接入失败：${reason}。可从原生产物路径恢复。`;
}
