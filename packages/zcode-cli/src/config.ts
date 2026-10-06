/** Deployment configuration for official CLI execution and account isolation. */
import schema from "@deepseek-ai/schemastery";
import { isAbsolute } from "node:path";
const absolute = schema
  .transform(schema.string().required(), (value) => {
    if (!isAbsolute(value))
      throw new schema.ValidationError("Expected absolute path", { path: [] });
    return value;
  })
  .required();
/** Configurable executable, storage, model identity and process limits. */
export const Config = schema.object({
  command: schema.string().default("zcode"),
  cwd: absolute,
  dataDir: absolute,
  builtinConfigFile: schema.string().default(""),
  personalConfigFile: schema.string().default(""),
  providerId: schema
    .union([
      schema.const("account:zai-individual-coding-plan"),
      schema.const("account:bigmodel-individual-coding-plan"),
    ])
    .default("account:bigmodel-individual-coding-plan"),
  // 空 model 表示自动：登录后按官方模板与服务端模型列表的交集确定可用模型，
  // 交集首选即默认模型；非空值固定为该模型（仍须在动态列表内）。
  model: schema.string().default(""),
  apiBaseUrl: schema
    .transform(
      schema.string().default("https://open.bigmodel.cn/api/coding/paas/v4"),
      (value) => {
        const url = new URL(value);
        if (url.protocol !== "https:" || url.username || url.password)
          throw new schema.ValidationError("Expected HTTPS model endpoint", {
            path: [],
          });
        return url.href.replace(/\/$/, "");
      },
    )
    .default("https://open.bigmodel.cn/api/coding/paas/v4"),
  reasoningLevel: schema.const("high").default("high"),
  defaultMaxTokens: schema.natural().min(1).max(2147483647).default(1000000),
  requestTimeoutMs: schema.natural().min(1).max(2147483647).default(360000),
  // 模型等待超过该时长在请求状态中标记慢请求，默认 30 秒。
  slowRequestMs: schema.natural().min(1).max(2147483647).default(30000),
  // 用户停止先走官方取消通道：取消回执时限与受管范围清空确认时限。
  cancelReceiptTimeoutMs: schema.natural().min(1).max(2147483647).default(1000),
  cleanupTimeoutMs: schema.natural().min(1).max(2147483647).default(5000),
  probeTimeoutMs: schema.natural().min(1).max(2147483647).default(15000),
  probeMaxTokens: schema.natural().min(1).default(1),
  loginTimeoutMs: schema.natural().min(1).max(2147483647).default(1200000),
  graceMs: schema.natural().min(1).max(2147483647).default(1500),
  maxLoginOutputBytes: schema.natural().min(1024).default(32768),
  env: schema.dict(schema.string()).default({}),
});
/** Validated CLI settings. */
export type Config = ReturnType<typeof Config>;
