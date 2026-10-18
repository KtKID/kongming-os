/**
 * MadeMe 插件冒烟测试：验证构建产物与包声明的完整性——exports 双入口
 * （宿主半 + 浏览器半）、dsh.client 元数据（platform/inject）、bundle
 * patch 声明与宿主半可导入；并核对 kmh-web 与 kmh-mobile-assistant 两个 profile
 * 均以独立 mcp-client 实例（stdio）接入 MadeMe 工具。运行依赖根 pretest 先完成 build:kmh。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
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
  assert.match(patch, /name: ['"]@kmh\/mademe['"]/u);
});

test("宿主半构建产物可导入且暴露插件名", async () => {
  const host = await import("../lib/src/index.js");
  assert.equal(host.name, "kmh-mademe");
  assert.equal(typeof host.apply, "function");
});

test("浏览器半构建产物为模块加载器工厂且声明 inject 服务", async () => {
  const source = readFileSync(join(root, "../lib/client.js"), "utf8");
  assert.match(source, /window\.__ModuleLoader__\.load\(\{id:"@kmh\/mademe"/u);
  assert.match(
    source,
    /var inject = \[\s*"slots",\s*"locale",\s*"layout",\s*"configForms"\s*\]/u,
  );
  assert.match(source, /mademe/u);
});

test("kmh-web 与 kmh-mobile-assistant profile 均以独立 mcp-client 实例（stdio）接入 MadeMe 工具", () => {
  // MadeMe 工具不经本插件装配：两个 profile 各自直接声明 @deepseek-ai/dsh-mcp-client
  // 实例拉起 MadeMe-web 自带的 stdio MCP 服务，serverName 固定 mademe 以保持
  // 工具名 mcp__mademe__<tool> 稳定。与 tests/runtime 使用同一 patch 解析器。
  for (const profile of ["kmh-web", "kmh-mobile-assistant"]) {
    const patchFile = join(root, `../../../profiles/${profile}/cordis.patch.yml`);
    const entries = loadOverlayPatches("test", patchFile).flatMap(
      (patch) => patch.insert ?? [],
    );
    const instance = entries.find((entry) => entry.id === "mcp-mademe");
    assert.ok(instance, `profiles/${profile}/cordis.patch.yml 须声明 mcp-mademe 实例`);
    assert.equal(instance.name, "@deepseek-ai/dsh-mcp-client", profile);
    assert.equal(instance.config.transport, "stdio", profile);
    assert.equal(instance.config.serverName, "mademe", profile);
    assert.equal(typeof instance.config.command, "string", profile);
    assert.ok(
      Array.isArray(instance.config.args) && instance.config.args.length === 1,
      profile,
    );
    assert.match(instance.config.args[0], /\/mcp\/dist\/index\.js$/u, profile);
    // mademe 服务名在 profile 内唯一；插件自身不再依赖 mcp-client，也就不会
    // 在运行期抢占同名——两者任一回退都会让 profile 实例因重名加载失败。
    assert.equal(
      entries.filter(
        (entry) =>
          entry.name === "@deepseek-ai/dsh-mcp-client" &&
          entry.config?.serverName === "mademe",
      ).length,
      1,
      profile,
    );
  }
  assert.ok(!("@deepseek-ai/dsh-mcp-client" in (pkg.peerDependencies ?? {})));
});
