/**
 * x-music 配置 schema 单测：默认面板地址、合法覆盖保留、volatile 活引用输出、
 * schema 只声明 boardUrl 一个字段（第一阶段无超时、无 MCP 配置项）。
 * 运行依赖先完成本包构建（根 pretest 的 build:kmh）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Config } from "../lib/src/config.js";

/** 断言解析输出的 volatile 字段读到期望值。 */
function volatileValue(field) {
  assert.equal(typeof field, "object");
  assert.equal(typeof field.get, "function");
  return field.get();
}

test("缺省输入解析出默认面板地址（volatile 引用）", () => {
  const config = Config({});
  assert.equal(volatileValue(config.boardUrl), "http://127.0.0.1:60070");
});

test("合法覆盖保留；schema 为原生 string，不在宿主侧做格式校验", () => {
  // 先落到局部变量再断言：同一表达式内联求值时 Volatile 包装偶发丢失 get
  // （MadeMe 单测观察到的求值顺序怪癖），拆开后稳定。
  const overridden = Config({ boardUrl: "http://10.0.0.5:60070/" }).boardUrl;
  assert.equal(volatileValue(overridden), "http://10.0.0.5:60070/");
  const freeForm = Config({ boardUrl: "board.local:60070" }).boardUrl;
  assert.equal(volatileValue(freeForm), "board.local:60070");
});

test("schema 只声明 boardUrl：第一阶段没有超时与 MCP 配置项", () => {
  const config = Config({});
  assert.deepEqual(Object.keys(config), ["boardUrl"]);
});
