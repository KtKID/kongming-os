/** KMH 工具声明名映射（D13）：kmh- 前缀双向表、名称校验与目录指纹。 */
import { createHash } from "node:crypto";

/** 声明名前缀：模型侧可见的 KMH 工具统一挂载前缀，防与原生/其他来源同名冲突。 */
export const KMH_TOOL_PREFIX = "kmh-";
/** 官方动态工具名实测接受范围（平铺真名形态，0.160.0 基线）。 */
const DECLARED_NAME = /^[A-Za-z0-9_-]+$/;
/** 声明表输入条目（与 TurnStartInput.tools 一致）。 */
export interface ToolEntry {
  name: string;
  description: string;
  inputSchema: unknown;
}
/** 一份工具目录的声明映射与指纹。 */
export interface ToolRegistry {
  /** 声明名 → KMH 注册名。 */
  readonly declaredToKmh: ReadonlyMap<string, string>;
  /** KMH 注册名 → 声明名。 */
  readonly kmhToDeclared: ReadonlyMap<string, string>;
  /** 目录指纹：声明名、描述和参数序列化的摘要，任何目录/展示变化都会改变。 */
  readonly fingerprint: string;
}
/**
 * 计算工具目录指纹（声明名、描述和参数，按名称排序后摘要）。
 * @param tools - KMH 工具表。
 * @returns 十六进制摘要；空目录也有稳定指纹。
 */
export function toolFingerprintOf(tools: readonly ToolEntry[], policyFingerprint?: string): string {
  const declared = tools
    .map((tool) => [KMH_TOOL_PREFIX + tool.name, tool.description, tool.inputSchema] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return createHash("sha256").update(JSON.stringify([declared, policyFingerprint])).digest("hex");
}
/**
 * 从 KMH 工具表构建声明表：统一加 kmh- 前缀并做范围与碰撞校验。
 * @param tools - KMH 工具表。
 * @returns 声明映射与指纹。
 * @throws CODEX_TOOL_NAME_INVALID 前缀后名称超出官方接受范围。
 * @throws CODEX_TOOL_NAME_COLLISION 声明名相互重复。
 */
export function buildToolRegistry(tools: readonly ToolEntry[], policyFingerprint?: string): ToolRegistry {
  const declaredToKmh = new Map<string, string>();
  const kmhToDeclared = new Map<string, string>();
  for (const tool of tools) {
    const declared = KMH_TOOL_PREFIX + tool.name;
    if (!DECLARED_NAME.test(declared))
      throw new Error(
        `CODEX_TOOL_NAME_INVALID: ${tool.name} 前缀后超出官方工具名接受范围`,
      );
    if (declaredToKmh.has(declared))
      throw new Error(`CODEX_TOOL_NAME_COLLISION: ${declared}`);
    declaredToKmh.set(declared, tool.name);
    kmhToDeclared.set(tool.name, declared);
  }
  return {
    declaredToKmh,
    kmhToDeclared,
    fingerprint: toolFingerprintOf(tools, policyFingerprint),
  };
}
/**
 * 解析回调中的工具名为 KMH 注册名。
 * 先按声明表精确命中；未命中时兼容裸名（旧 thread 以裸名声明工具）；
 * 兼容范围以本回合的 KMH 工具表为准，防旧名误映射到已不存在的工具。
 * @param registry - 本回合声明表；临时会话（无工具）传 undefined。
 * @param name - 服务端回调携带的工具名。
 * @returns 对应的 KMH 注册名；未知名称返回 undefined。
 */
export function resolveKmhToolName(
  registry: ToolRegistry | undefined,
  name: string,
): string | undefined {
  if (registry === undefined) return undefined;
  const mapped = registry.declaredToKmh.get(name);
  if (mapped !== undefined) return mapped;
  if (registry.kmhToDeclared.has(name)) return name;
  return undefined;
}
/** 提示中的声明约定说明：加在 developerInstructions，避免改写正文词义。 */
export function toolDeclarationNote(): string {
  return `KMH 工具在本会话中以 ${KMH_TOOL_PREFIX} 前缀声明；系统提示或用户内容中提到的 KMH 工具名，即对应加该前缀后的同名工具。`;
}
