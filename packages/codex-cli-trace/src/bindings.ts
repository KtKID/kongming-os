/** 只读既有 KMH 到 CLI 的映射；格式损坏明确失败。 */
import { readFile } from "node:fs/promises";
import { BindingFileSchema, BindingSchema } from "./rollout-schema.ts";
/** 缺失关联返回空值，其他读取和校验错误保留错误类别。 */
export async function readBinding(
  file: string,
  sessionId: string,
): Promise<string | null> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw new Error("BINDING_UNREADABLE", { cause: error });
  }
  try {
    const input: unknown = JSON.parse(text);
    const rows = BindingFileSchema.parse(input);
    const row = rows[sessionId];
    if (row === undefined) return null;
    return BindingSchema.parse(row).threadId ?? null;
  } catch (error) {
    throw new Error("BINDING_INVALID", { cause: error });
  }
}
