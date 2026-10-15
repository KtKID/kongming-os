/** 只读数据来源和页面刷新配置；错误路径在装载时拒绝。 */
import schema from "@deepseek-ai/schemastery";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import {
  DEFAULT_REFRESH_INTERVAL_MS,
  MAX_REFRESH_INTERVAL_MS,
} from "./paths.ts";
const absolute = schema.transform(schema.string().required(), (value) => {
  if (!isAbsolute(value)) throw new Error("Expected absolute path");
  return value;
});
export const Config = schema.object({
  bindingsFile: absolute.required(),
  codexHome: absolute.default(
    process.env.CODEX_HOME?.trim() || join(homedir(), ".codex"),
  ),
  refreshIntervalMs: schema
    .natural()
    .min(1)
    .max(MAX_REFRESH_INTERVAL_MS)
    .default(DEFAULT_REFRESH_INTERVAL_MS),
});
export type Config = ReturnType<typeof Config>;
