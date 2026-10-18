/**
 * x-music 插件配置 schema。字段为 volatile：经 settings 体系修改后，loader 把
 * 新值热提交进运行中的配置引用（apply 收到的 config 即活引用），持久化走当前
 * profile 的 Cordis patch。本文件是面板地址默认值的唯一出处——浏览器半经
 * configForms 读取，不复写字面量。宿主 schema 用原生 string 字段：transform
 * 节点的序列化产物会被 settings 的 client 链路丢弃，导致配置页不可见
 * （MadeMe 实测结论）。
 */
import type { Volatile } from "@deepseek-ai/cordis";
import Schema from "@deepseek-ai/schemastery";

/**
 * 面板地址：x-music 的 Web 端（Board）。用户端口表（2026-10-18）把 60070 标为
 * "Web 端（Board，面板目标）"；music-core（3000）与手机网关（60073）不是面板
 * 目标，也不作为配置项出现（规格 C1）。
 */
const boardUrl = Schema.string()
  .description("x-music 面板地址")
  .default("http://127.0.0.1:60070")
  .volatile();

/** 运行期配置形态：volatile 字段为活引用（.get() 读当前值）。 */
export interface Config {
  boardUrl: Volatile<string>;
}

/** 插件配置 schema。 */
export const Config = Schema.object({ boardUrl });
