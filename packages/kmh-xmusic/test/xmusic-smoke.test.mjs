/**
 * x-music 插件冒烟测试：验证构建产物与包声明的完整性——exports 双入口（宿主半
 * + 浏览器半）、dsh.client 元数据（platform/inject）、bundle patch 声明与宿主半
 * 可导入、浏览器半是模块加载器工厂且注入服务恰为三个（不用 layout）；第一阶段
 * 剃刀门禁：浏览器半不含配置表单槽、刷新恢复标记、宿主 schema 与默认地址，默认
 * 地址只出现在 src/config.ts；kmh-web profile 登记了 kmh-xmusic 实例与包依赖，且
 * 没有以 x-music/xmusic 为 serverName 的 mcp-client 实例（第一版不做 MCP）。
 * 运行依赖先完成本包构建。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { loadOverlayPatches } from "../../../third_party/dsh/packages/boot/app-boot/lib/index.js";

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
  assert.match(patch, /name: ['"]@kmh\/xmusic['"]/u);
});

test("宿主半构建产物可导入且暴露插件名与 schema", async () => {
  const host = await import("../lib/src/index.js");
  assert.equal(host.name, "kmh-xmusic");
  assert.equal(typeof host.apply, "function");
  assert.equal(typeof host.Config, "function");
});

test("浏览器半构建产物为模块加载器工厂且声明恰三个注入服务", () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  assert.match(source, /window\.__ModuleLoader__\.load\(\{id:"@kmh\/xmusic"/u);
  assert.match(
    source,
    /var inject = \[\s*"slots",\s*"locale",\s*"configForms"\s*\]/u,
  );
});

test("浏览器半产物注册侧栏入口与 main 面板，并按 boardUrl 读地址", () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  assert.match(source, /"sidebar\.panellist"/u);
  assert.match(source, /name: "main"/u);
  assert.match(source, /boardUrl/u);
});

test("第一阶段剃刀门禁（产物级）：无配置表单、无刷新恢复，宿主 schema 与默认地址不进浏览器半", () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  // feat04 留第二阶段：不得注册插件页的两个配置表单槽。
  assert.doesNotMatch(source, /plugins\.bundle\.config/u);
  assert.doesNotMatch(source, /plugins\.row\.config/u);
  // 不做刷新恢复：不得残留 localStorage 标记键。
  assert.doesNotMatch(source, /:active/u);
  // 浏览器半不引 config.ts：schemastery 与 Schema 调用不得被打进来。
  assert.doesNotMatch(source, /schemastery/u);
  assert.doesNotMatch(source, /Schema\./u);
  // 默认地址只在宿主 schema 里。
  assert.doesNotMatch(source, /60070/u);
});

test("剃刀门禁（源码级）：默认地址只出现在 src/config.ts", () => {
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
      if (readFileSync(path, "utf8").includes("60070")) {
        offenders.push(relative(srcRoot, path));
      }
    }
  };
  walk(srcRoot);
  assert.deepEqual(offenders, []);
  const configSource = readFileSync(join(srcRoot, "config.ts"), "utf8");
  assert.match(configSource, /60070/u, "默认地址必须定义在 config.ts");
});

test("kmh-web profile 登记 kmh-xmusic 实例与包依赖，且第一版没有 x-music 的 mcp-client 实例", () => {
  const profileRoot = join(root, "../../../profiles/kmh-web");
  const entries = loadOverlayPatches(
    "test",
    join(profileRoot, "cordis.patch.yml"),
  ).flatMap((patch) => patch.insert ?? []);
  const instance = entries.find((entry) => entry.id === "kmh-xmusic");
  assert.ok(instance, "profiles/kmh-web/cordis.patch.yml 须声明 kmh-xmusic 实例");
  assert.equal(instance.name, "@kmh/xmusic");
  // feat03 留第二阶段：第一版不得声明接入 x-music 工具的 mcp-client 实例。
  assert.deepEqual(
    entries.filter(
      (entry) =>
        entry.name === "@deepseek-ai/dsh-mcp-client" &&
        ["x-music", "xmusic"].includes(entry.config?.serverName),
    ),
    [],
  );
  const profilePkg = JSON.parse(
    readFileSync(join(profileRoot, "package.json"), "utf8"),
  );
  assert.equal(
    profilePkg.dependencies["@kmh/xmusic"],
    "link:../../packages/kmh-xmusic",
  );
  assert.ok(!("@deepseek-ai/dsh-mcp-client" in (pkg.peerDependencies ?? {})));
});
