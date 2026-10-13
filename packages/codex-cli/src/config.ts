/** 官方 Codex CLI 执行、存储与超时限制的部署配置。 */
import { ToolSelectionSchema } from "@deepseek-ai/dsh-cli-tools";
import schema from "@deepseek-ai/schemastery";
import { isAbsolute } from "node:path";
// 共享 schema 保持选择类型；联动检查可在配置 schema 传到客户端后独立执行。
const codexToolSelection = schema.intersect([
  ToolSelectionSchema,
  schema.transform(ToolSelectionSchema, (value) => {
    if (value === undefined) return value;
    const commands = ["exec_command", "write_stdin", "shell_command"];
    const enabled = commands.map(
      (name) =>
        value.native?.find(
          (row) => row.source === "codex/native" && row.name === name,
        )?.enabled ?? false,
    );
    if (new Set(enabled).size > 1)
      throw new Error(
        "CODEX_NATIVE_LINKED_CHOICES_CONFLICT: exec_command, write_stdin, shell_command",
      );
    return value;
  }),
]);
const absolute = schema
  .transform(schema.string().required(), (value) => {
    if (!isAbsolute(value))
      throw new schema.ValidationError("Expected absolute path", { path: [] });
    return value;
  })
  .required();
/** 可配置的可执行文件、存储、模型身份与进程时限。 */
export const Config = schema.object({
  command: schema.string().default("codex"),
  cwd: absolute,
  dataDir: absolute,
  // 空 model 表示自动：登录后取模型目录首选；非空值固定为该模型。
  model: schema.string().default(""),
  defaultMaxTokens: schema.natural().min(1).max(2147483647).default(1000000),
  // 可见思考摘要由官方 CLI 生成；none 显式关闭摘要请求。
  reasoningSummary: schema
    .union(["auto", "concise", "detailed", "none"])
    .default("auto"),
  // 启动并完成 initialize 握手的时限。
  startupTimeoutMs: schema.natural().min(1).max(2147483647).default(20000),
  // 单次 stream（含排队、启动、重试与辅助请求）的总时限；收尾另有时限。
  requestTimeoutMs: schema.natural().min(1).max(2147483647).default(360000),
  // turn/interrupt 后等待 interrupted 终止通知的时限。
  cancelReceiptTimeoutMs: schema.natural().min(1).max(2147483647).default(5000),
  cleanupTimeoutMs: schema.natural().min(1).max(2147483647).default(5000),
  probeTimeoutMs: schema.natural().min(1).max(2147483647).default(15000),
  probeMaxTokens: schema.natural().min(1).default(1),
  loginTimeoutMs: schema.natural().min(1).max(2147483647).default(1200000),
  graceMs: schema.natural().min(1).max(2147483647).default(1500),
  // 原生 Codex 工具与技能开关：默认关闭，模型只见 KMH 的工具与技能。
  nativeToolsEnabled: schema.boolean().default(false),
  toolSelection: codexToolSelection.volatile(),
  env: schema.dict(schema.string()).default({}),
});
/** 校验后的 CLI 设置。 */
export type Config = ReturnType<typeof Config>;
