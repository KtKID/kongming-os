/**
 * x-music 服务插件，宿主半：声明配置 schema（volatile 字段，settings 体系
 * 读写与持久化）。第一阶段没有运行期逻辑，也不装配 MCP——x-music 的助手工具
 * 接入（feat03）整体留第二阶段，届时按规格 findings 第 1 节在 profile 直接
 * 声明 @deepseek-ai/dsh-mcp-client 实例，不经本插件。
 */
export { Config } from "./config.ts";

/** Cordis 插件名（诊断用）；profile 中的 name 是模块说明符 @kmh/xmusic。 */
export const name = "kmh-xmusic";

/**
 * 装配宿主半。配置的读写、持久化与热提交全部由 settings 体系与 loader
 * 承担，浏览器半经 configForms 订阅取值，宿主半没有运行期逻辑；保留空
 * apply 以满足 Cordis 插件形态。
 */
export function apply(): void {}
