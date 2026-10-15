/**
 * MadeMe 配置 schema 单测：默认值解析、URL 规范化（无 scheme 补 https）、
 * 非法地址拒绝、volatile 活引用输出、normalizeHttpUrl 边界。运行依赖根
 * pretest 先完成 build:kmh。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Config, normalizeHttpUrl } from "../lib/src/config.js";

/** 断言解析输出的 volatile 字段读到期望值。 */
function volatileValue(field) {
  assert.equal(typeof field, "object");
  assert.equal(typeof field.get, "function");
  return field.get();
}

test("缺省输入解析出默认值（volatile 引用，schema 原样保留）", () => {
  const config = Config({});
  assert.equal(volatileValue(config.serviceUrl), "http://127.0.0.1:30000");
  assert.equal(volatileValue(config.mcpUrl), "http://127.0.0.1:30000/mcp");
  assert.equal(volatileValue(config.mcpEnabled), true);
});

test("schema 原样保留输入；规范化只发生在表单层（normalizeHttpUrl）", () => {
  const config = Config({
    serviceUrl: "mademe.local:8443",
    mcpUrl: "127.0.0.1:9000/mcp",
  });
  assert.equal(volatileValue(config.serviceUrl), "mademe.local:8443");
  assert.equal(volatileValue(config.mcpUrl), "127.0.0.1:9000/mcp");
  assert.equal(normalizeHttpUrl("mademe.local:8443"), "https://mademe.local:8443/");
});

test("URL 校验由表单层承担：schema 接受任意字符串，normalizeHttpUrl 拒绝非法值", () => {
  // 宿主 schema 为原生 string（transform 序列化会被 settings client 侧丢弃）；
  // 格式拦截在配置表单的 parse 层（settingsHttpUrlField）完成。
  // 先落到局部变量再断言：同一表达式内联求值时 Volatile 包装偶发丢失 get
  // （求值顺序怪癖），拆开后稳定。
  const freeForm = Config({ serviceUrl: "ftp://x" }).serviceUrl;
  assert.equal(volatileValue(freeForm), "ftp://x");
  assert.equal(normalizeHttpUrl("not a url"), undefined);
  assert.equal(normalizeHttpUrl("ftp://example.com"), undefined);
  assert.equal(normalizeHttpUrl("https://user:pass@example.com"), undefined);
});

test("合法覆盖与布尔开关保留", () => {
  const config = Config({
    serviceUrl: "http://10.0.0.5:8100/base",
    mcpUrl: "http://10.0.0.5:8100/mcp",
    mcpEnabled: false,
  });
  assert.equal(volatileValue(config.serviceUrl), "http://10.0.0.5:8100/base");
  assert.equal(volatileValue(config.mcpEnabled), false);
});

test("normalizeHttpUrl 边界：空串、超长、非 http 协议拒绝", () => {
  assert.equal(normalizeHttpUrl("   "), undefined);
  assert.equal(normalizeHttpUrl("x".repeat(3000)), undefined);
  assert.equal(normalizeHttpUrl("javascript:alert(1)"), undefined);
  assert.equal(
    normalizeHttpUrl("https://ok.example.com:1/p"),
    "https://ok.example.com:1/p",
  );
});
