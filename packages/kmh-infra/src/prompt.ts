/**
 * kmh-infra 的措辞引导段落：服务查询工具的输出文本由上游服务生成，插件不能
 * 改写它，因此"结果码该怎么讲给用户"放在系统提示词里引导。
 *
 * 段落挂在 DSH 已分配的 MCP_SERVERS 段位（mcp-client 自己也用这个位置注册
 * 服务指令），随本子插件的 fiber 回收——与工具一起挂载、一起卸载，停用后不
 * 残留对已不存在能力的描述。
 *
 * 这是模型遵从的引导，不是硬校验：验收要在每种结果码上各观察一次措辞。
 * 正文里不出现地址、凭据或任何本机具体值。
 */
import type { Context } from "@deepseek-ai/cordis";
import type {} from "@deepseek-ai/dsh-system-prompt";

/** Cordis 插件名（诊断用）。 */
export const name = "kmh-infra-prompt";

/** 依赖系统提示词注册表。 */
export const inject = ["systemPrompt"];

/** 段落名：加包前缀避免与其他插件的段落重名。 */
export const PROMPT_SECTION = "kmh-infra:mcp-guidance";

/** 引导正文：逐条给出"结果码 → 怎么回答"，不复制上游的状态码表。 */
const GUIDANCE = [
  "本机服务查询工具（mcp__infra__service_list、mcp__infra__service_info）的结果里带一个 code 字段。请按码如实作答：",
  "code 为 invalid_token 或 service_auth_disabled 时，回答“身份校验错误”，不要回答“没有服务”。",
  "code 为 dash_unreachable 时，说明 x-dash 面板没有在运行、因此查不到，并说明这不代表没有服务登记。",
  "code 为 not_found 时，说明没有登记过这个名字的服务。",
  "code 为 invalid_argument 时，说明需要提供具体的服务名字。",
  "服务的 status 为 unknown 时，说成“还没查过该服务”，不要判断在线或离线。",
  "结果里带 duplicate_names 时，说明存在重名，不要把返回的那一台说成唯一一台。",
  "只转述结果里给出的信息，不要推测服务状态，也不要建议启停或修改服务。",
].join("\n");

/**
 * 注册措辞引导段落。
 * @param ctx - 本子插件的上下文；段落随其 fiber 回收。
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({
    name: PROMPT_SECTION,
    order: ctx.systemPrompt.getSectionOrder("MCP_SERVERS"),
    interpolate: false,
    text: GUIDANCE,
  });
}
