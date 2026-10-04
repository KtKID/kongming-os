/** 构建 Host 与 Client，输出现有 Web 模块加载器使用的插件工厂。 */
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
await rm("lib", { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-b"], {
  stdio: "inherit",
});
await build({
  entryPoints: ["src/client/index.ts"],
  outfile: "lib/client.js",
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "cjs",
  jsx: "automatic",
  external: [
    "react",
    "react/jsx-runtime",
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-client-ui-primitives",
    "@deepseek-ai/dsh-client-ui-slots",
  ],
  banner: {
    js: 'window.__ModuleLoader__.load({id:"@kmh/zcode-cli",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
});
