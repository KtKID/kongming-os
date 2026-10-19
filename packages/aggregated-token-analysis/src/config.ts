/**
 * 聚合 Token 分析视图插件配置 schema。两个字段全部 volatile：经插件页
 * 表单修改后，loader 把新值热提交进运行中的配置引用，持久化由 settings
 * + config-editor 走当前 profile 的 Cordis patch。本文件是默认值的唯一
 * 出处（C5：浏览器半与表单运行时一律读配置，不复写字面量）。URL 的格式
 * 校验与规范化由配置表单的 parse 层承担（normalize-url.ts），宿主 schema
 * 用原生 string 字段——transform 节点的序列化产物会被 settings 的 client
 * 链路丢弃，导致配置页不可见（MadeMe 实测结论）。
 */
import type { Volatile } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";

/** 数值配置项的取值边界：Schemastery 的安全整数护栏，不是功能性阈值。 */
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

/** 聚合 Token 分析页地址：内嵌打开的目标（默认值来自用户 2026-10-18 原话）。 */
const pageUrl = Schema.string()
  .description("聚合 Token 分析页地址")
  .default("http://localhost:60010/_svc/x-token/")
  .volatile();

/** 页面加载超时：超过仍未加载完成即提示可能无法打开（沿用 Infra 已验证的 8 秒）。 */
const pageLoadTimeoutMs = Schema.number()
  .description("页面加载超时（毫秒）")
  .step(1)
  .min(1)
  .max(MAX_SAFE_INTEGER)
  .default(8000)
  .volatile();

/** 运行期配置形态：volatile 字段为活引用（.get() 读当前值）。 */
export interface Config {
  pageUrl: Volatile<string>;
  pageLoadTimeoutMs: Volatile<number>;
}

/** 插件配置 schema。 */
export const Config = Schema.object({ pageUrl, pageLoadTimeoutMs });
