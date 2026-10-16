/**
 * kmh-infra 配置 schema 单测：八个配置项的默认值与类型、字符串字段原样保留、
 * 地址规范化的合法与非法边界。运行前需要本包已构建（lib/src/config.js）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Config, normalizeHttpUrl } from "../lib/src/config.js";

/** 断言 volatile 字段读到期望值。 */
function volatileValue(field) {
  assert.equal(typeof field, "object");
  assert.equal(typeof field.get, "function");
  return field.get();
}

test("缺省输入解析出八个配置项的默认值", () => {
  const config = Config({});
  assert.equal(volatileValue(config.dashUrl), "http://127.0.0.1:60010");
  assert.equal(volatileValue(config.tokenEnvVar), "X_INFRA_MCP_TOKEN");
  assert.equal(volatileValue(config.pythonCommand), "python3");
  assert.equal(
    volatileValue(config.mcpModuleDir),
    "/Volumes/machub_app/proj/x-infra/x-infra-mcp",
  );
  assert.equal(volatileValue(config.panelLoadTimeoutMs), 8000);
  assert.equal(volatileValue(config.probeTimeoutMs), 5000);
  assert.equal(volatileValue(config.toolCallTimeoutMs), 60000);
  assert.equal(volatileValue(config.mcpEnabled), true);
});

test("三个数值配置项读出数字而不是字符串", () => {
  const config = Config({
    panelLoadTimeoutMs: 1200,
    probeTimeoutMs: 900,
    toolCallTimeoutMs: 30000,
  });
  const fields = [
    config.panelLoadTimeoutMs,
    config.probeTimeoutMs,
    config.toolCallTimeoutMs,
  ];
  for (const field of fields) {
    assert.equal(typeof volatileValue(field), "number");
  }
  assert.equal(volatileValue(config.panelLoadTimeoutMs), 1200);
  assert.equal(volatileValue(config.probeTimeoutMs), 900);
  assert.equal(volatileValue(config.toolCallTimeoutMs), 30000);
});

test("字符串字段原样保留；规范化只发生在表单层", () => {
  // 宿主 schema 用原生 string：transform 节点的序列化产物会被 settings 的
  // client 侧校验丢弃，导致配置页不可见（MadeMe 实测结论）。
  const config = Config({
    dashUrl: "dash.local:60010",
    tokenEnvVar: "",
    pythonCommand: "python3.12",
  });
  assert.equal(volatileValue(config.dashUrl), "dash.local:60010");
  assert.equal(volatileValue(config.tokenEnvVar), "");
  assert.equal(volatileValue(config.pythonCommand), "python3.12");
  assert.equal(normalizeHttpUrl("dash.local:60010"), "https://dash.local:60010/");
});

test("布尔开关保留显式取值", () => {
  const config = Config({ mcpEnabled: false });
  assert.equal(volatileValue(config.mcpEnabled), false);
});

test("normalizeHttpUrl 接受合法地址并保留端口与路径", () => {
  assert.equal(
    normalizeHttpUrl("http://127.0.0.1:60010"),
    "http://127.0.0.1:60010/",
  );
  assert.equal(
    normalizeHttpUrl("https://ok.example.com:1/p"),
    "https://ok.example.com:1/p",
  );
  assert.equal(normalizeHttpUrl("localhost:60010"), "https://localhost:60010/");
  assert.equal(
    normalizeHttpUrl("  http://10.0.0.5:8100/base  "),
    "http://10.0.0.5:8100/base",
  );
});

test("normalizeHttpUrl 拒绝非法地址", () => {
  assert.equal(normalizeHttpUrl(""), undefined);
  assert.equal(normalizeHttpUrl("   "), undefined);
  assert.equal(normalizeHttpUrl("not a url"), undefined);
  assert.equal(normalizeHttpUrl("ftp://example.com"), undefined);
  assert.equal(normalizeHttpUrl("https://user:pass@example.com"), undefined);
  assert.equal(normalizeHttpUrl("javascript:alert(1)"), undefined);
  assert.equal(normalizeHttpUrl("x".repeat(3000)), undefined);
});
