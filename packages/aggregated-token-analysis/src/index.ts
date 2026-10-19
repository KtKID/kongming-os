/**
 * 聚合 Token 分析视图插件，宿主半：声明配置 schema（volatile 字段，
 * settings 体系读写与持久化）。本插件只展示（C1）——不把任何能力接入
 * 助手，也没有宿主侧运行逻辑，与删掉 MCP 线后的 kmh-mademe 宿主半同型。
 */
export { Config } from "./config.ts";
export { normalizeHttpUrl } from "./normalize-url.ts";

/** Cordis 插件名（诊断用）；profile 中的 name 是模块说明符 @kmh/aggregated-token-analysis。 */
export const name = "aggregated-token-analysis";

/**
 * 装配宿主半。配置的读写、持久化与热提交全部由 settings 体系与 loader
 * 承担，浏览器半经 configForms 订阅取值，宿主半没有运行期逻辑；保留空
 * apply 以满足 Cordis 插件形态。
 */
export function apply(): void {}
