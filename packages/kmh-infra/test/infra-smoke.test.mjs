/**
 * kmh-infra 插件冒烟测试：验证构建产物与包声明的完整性——exports 双入口
 * （宿主半 + 浏览器半）、dsh.client 元数据（platform/inject）、bundle
 * patch 声明与宿主半可导入。运行依赖根 pretest 先完成 build:kmh。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, "../package.json"), "utf8"));

test("exports 声明宿主半与浏览器半双入口", () => {
  assert.equal(pkg.exports["."].default, "./lib/src/index.js");
  assert.equal(pkg.exports["./client"].default, "./lib/client.js");
});

test("dsh.client 声明 web 平台与注入包，client runner 据此发现浏览器半", () => {
  assert.equal(pkg.dsh.client.platform, "web");
  assert.deepEqual(pkg.dsh.client.inject, [
    "@deepseek-ai/dsh-client-locale",
    "@deepseek-ai/dsh-client-ui-layout",
    "@deepseek-ai/dsh-client-ui-settings",
    "@deepseek-ai/dsh-client-ui-sidebar",
  ]);
});

test("组合包声明指向 bundle patch，插件页可按此安装启停", () => {
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
  const patch = readFileSync(join(root, "../cordis.patch.yml"), "utf8");
  assert.match(patch, /name: ['"]@kmh\/kmh-infra['"]/u);
});

test("宿主半构建产物可导入且暴露插件名", async () => {
  const host = await import("../lib/src/index.js");
  assert.equal(host.name, "kmh-infra");
  assert.equal(typeof host.apply, "function");
  assert.equal(typeof host.normalizeHttpUrl, "function");
});

test("浏览器半构建产物为模块加载器工厂且声明 inject 服务", () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  assert.match(source, /window\.__ModuleLoader__\.load\(\{id:"@kmh\/kmh-infra"/u);
  assert.match(
    source,
    /var inject = \[\s*"slots",\s*"locale",\s*"layout",\s*"configForms"\s*\]/u,
  );
});

test("浏览器半产物注册侧栏入口与中心面板，并带刷新恢复标记", () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  assert.match(source, /"sidebar\.panellist"/u);
  assert.match(source, /infraDashTarget/u);
  assert.match(source, /kmh-infra:active/u);
});

test("浏览器半产物取地址与超时自配置，不含写死的超时数值", () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  assert.match(source, /dashUrl/u);
  assert.match(source, /panelLoadTimeoutMs/u);
  // 功能性数值走配置：默认值只在宿主半 schema 里出现，浏览器半不得复写。
  assert.doesNotMatch(source, /8000/u);
});
