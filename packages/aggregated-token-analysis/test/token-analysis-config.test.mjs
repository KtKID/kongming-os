/**
 * 聚合 Token 分析视图配置 schema 单测：默认值与类型（数值是 number）、
 * schema 只声明两个字段、schema 原样保留输入（规范化只发生在表单层）、
 * 默认地址经 normalizeHttpUrl 原样往返与非法值边界。运行前先构建本包
 * （node build.mjs），测试读 lib/ 下的产物。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Config } from "../lib/src/config.js";
import { normalizeHttpUrl } from "../lib/src/normalize-url.js";

/** 断言解析输出的 volatile 字段读到期望值。 */
function volatileValue(field) {
  assert.equal(typeof field, "object");
  assert.equal(typeof field.get, "function");
  return field.get();
}

/** 用户给定的默认地址（spec C2），测试断言以它为准。 */
const DEFAULT_URL = "http://localhost:60010/_svc/x-token/";

test("缺省输入解析出两个默认值（volatile 引用；数值是 number）", () => {
  const config = Config({});
  assert.equal(volatileValue(config.pageUrl), DEFAULT_URL);
  const timeout = volatileValue(config.pageLoadTimeoutMs);
  assert.equal(typeof timeout, "number");
  assert.equal(timeout, 8000);
});

test("schema 只声明两个字段", () => {
  assert.deepEqual(Object.keys(Config({})), ["pageUrl", "pageLoadTimeoutMs"]);
});

test("schema 原样保留输入；规范化只发生在表单层（normalizeHttpUrl）", () => {
  const config = Config({
    pageUrl: "mademe.local:8443",
    pageLoadTimeoutMs: 2500,
  });
  assert.equal(volatileValue(config.pageUrl), "mademe.local:8443");
  assert.equal(volatileValue(config.pageLoadTimeoutMs), 2500);
  assert.equal(
    normalizeHttpUrl("mademe.local:8443"),
    "https://mademe.local:8443/",
  );
});

test("默认地址经 normalizeHttpUrl 原样往返（协议与末尾斜杠保留）", () => {
  assert.equal(normalizeHttpUrl(DEFAULT_URL), DEFAULT_URL);
});

test("无 scheme 补 https；非法值拒绝", () => {
  assert.equal(
    normalizeHttpUrl("localhost:60010/_svc/x-token/"),
    "https://localhost:60010/_svc/x-token/",
  );
  assert.equal(normalizeHttpUrl("not a url"), undefined);
  assert.equal(normalizeHttpUrl("ftp://example.com"), undefined);
  assert.equal(normalizeHttpUrl("https://user:pass@example.com"), undefined);
});

test("边界：空串、超长、内嵌脚本拒绝", () => {
  assert.equal(normalizeHttpUrl("   "), undefined);
  assert.equal(normalizeHttpUrl("x".repeat(3000)), undefined);
  assert.equal(normalizeHttpUrl("javascript:alert(1)"), undefined);
  assert.equal(
    normalizeHttpUrl("https://ok.example.com:1/p"),
    "https://ok.example.com:1/p",
  );
});
