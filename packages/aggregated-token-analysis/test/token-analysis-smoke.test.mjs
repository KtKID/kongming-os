/**
 * 聚合 Token 分析视图插件冒烟测试：验证构建产物与包声明的完整性——
 * exports 双入口（宿主半 + 浏览器半）、dsh.client 元数据（platform/inject）、
 * bundle patch 声明与宿主半可导入、浏览器半是模块加载器工厂且注入服务
 * 声明表单、槽、词典与公开配置 Remote；以及 C5 的机器门禁（技术设计 D06）：
 * 浏览器半产物不含宿主 schema、默认值与默认地址（含 esbuild 的 8e3 写法），
 * 源码里默认值只出现在 src/config.ts。运行依赖先完成本包构建。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

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
  assert.match(patch, /name: ['"]@kmh\/aggregated-token-analysis['"]/u);
});

test("宿主半构建产物可导入且暴露插件名", async () => {
  const host = await import("../lib/src/index.js");
  assert.equal(host.name, "aggregated-token-analysis");
  assert.equal(typeof host.apply, "function");
  assert.equal(typeof host.normalizeHttpUrl, "function");
});

test("浏览器半构建产物为模块加载器工厂且声明配置 Remote", () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  assert.match(
    source,
    /window\.__ModuleLoader__\.load\(\{id:"@kmh\/aggregated-token-analysis"/u,
  );
  assert.match(
    source,
    /var inject = \[\s*"slots",\s*"locale",\s*"configForms",\s*"remote",\s*"remote\.settings"\s*\]/u,
  );
});

test("浏览器半产物注册侧栏入口，并按两个配置键读地址与超时", () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  assert.match(source, /"sidebar\.panellist"/u);
  assert.match(source, /pageUrl/u);
  assert.match(source, /pageLoadTimeoutMs/u);
});

test("C5 门禁（产物级）：宿主 schema、默认值与默认地址都不进浏览器半", () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  // 浏览器半只引 normalize-url.ts：schemastery 与 Schema 调用不得被打进来。
  assert.doesNotMatch(source, /schemastery/u);
  assert.doesNotMatch(source, /Schema\./u);
  // esbuild 会把 8000 印成 8e3，两种写法都查；默认地址的两个特征串也不得出现。
  assert.doesNotMatch(source, /\b8000\b/u);
  assert.doesNotMatch(source, /\b8e3\b/u);
  assert.doesNotMatch(source, /60010/u);
  assert.doesNotMatch(source, /_svc\/x-token/u);
  // 不做刷新恢复：不得残留 localStorage 标记键。
  assert.doesNotMatch(source, /:active/u);
});

test("C5 门禁（源码级）：默认值与默认地址只出现在 src/config.ts", () => {
  const srcRoot = join(root, "../src");
  const offenders = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!/\.tsx?$/u.test(entry.name)) continue;
      if (relative(srcRoot, path) === "config.ts") continue;
      const text = readFileSync(path, "utf8");
      for (const literal of ["8000", "60010", "_svc/x-token"]) {
        if (text.includes(literal)) {
          offenders.push(`${relative(srcRoot, path)} 含 ${literal}`);
        }
      }
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, []);
  const configSource = readFileSync(join(srcRoot, "config.ts"), "utf8");
  assert.match(configSource, /8000/u, "默认超时必须定义在 config.ts");
  assert.match(configSource, /_svc\/x-token/u, "默认地址必须定义在 config.ts");
});
