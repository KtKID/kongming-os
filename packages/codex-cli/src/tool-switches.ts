/**
 * CLI 工具开关契约：详情页选择器与本插件之间共用的清单与切换载荷。
 * 纯 zod 与推导类型，不依赖 node，可随客户端打包；类型只从 schema 推导。
 */
import { z } from "zod";

/** 原生能力开关的固定身份；KMH 工具开关的 id 为 `kmh:<工具名>`。 */
export const NativeSwitchId = z.enum([
  "native:command-execution",
  "native:file-change",
  "native:view-image",
  "native:web-search",
]);
export type NativeSwitchId = z.infer<typeof NativeSwitchId>;

/** 一个开关：KMH 工具一行，或原生能力一行。 */
export const ToolSwitchSchema = z.object({
  /** 切换时回传的身份：KMH 为 `kmh:<工具名>`，原生为 NativeSwitchId。 */
  id: z.string().min(1),
  /** 显示名：KMH 为工具名（含 kmh- 前缀）；原生为能力键，客户端本地化。 */
  name: z.string().min(1),
  description: z.string(),
  enabled: z.boolean(),
  /** 原生能力覆盖的 Codex 工具名，仅作说明；KMH 为空数组。 */
  covers: z.array(z.string()),
});
export type ToolSwitch = z.infer<typeof ToolSwitchSchema>;

/** 原生目录核实状态：失败时携带原因，前端据此降级并提供重新读取。 */
export const NativeStatusSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), reason: z.string() }),
]);
export type NativeStatus = z.infer<typeof NativeStatusSchema>;

/** 详情页一次读取得到的完整清单。 */
export const ToolSwitchListSchema = z.object({
  target: z.literal("codex-cli"),
  /** settings 服务对 Codex 条目的当前修订号，切换时原样带回做并发核对。 */
  revision: z.number().int(),
  kmh: z.array(ToolSwitchSchema),
  native: z.array(ToolSwitchSchema),
  nativeStatus: NativeStatusSchema,
});
export type ToolSwitchList = z.infer<typeof ToolSwitchListSchema>;

/** 一次切换请求。 */
export const ToolSwitchUpdateSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean(),
  revision: z.number().int(),
});
export type ToolSwitchUpdate = z.infer<typeof ToolSwitchUpdateSchema>;
