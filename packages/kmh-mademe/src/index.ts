/**
 * MadeMe 服务插件，宿主半：声明配置 schema（volatile 字段，settings 体系
 * 读写与持久化）。MadeMe 工具不在本插件内装配——它由 kmh-web profile 的
 * `mcp-mademe` 实例（@deepseek-ai/dsh-mcp-client，stdio）直接挂到助手工具面，
 * 见 profiles/kmh-web/cordis.patch.yml。
 */
export { Config, normalizeHttpUrl } from "./config.ts";

/** Cordis 插件名（诊断用）；profile 中的 name 是模块说明符 @kmh/mademe。 */
export const name = "kmh-mademe";

/**
 * 装配宿主半。配置的读写、持久化与热提交全部由 settings 体系与 loader
 * 承担，浏览器半经 configForms 订阅取值，宿主半没有运行期逻辑；保留空
 * apply 以满足 Cordis 插件形态。
 */
export function apply(): void {}
