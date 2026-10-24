/** 单次构建 Host 与 Client，保留已有产物并写入更新，供 DSH HMR 检测变化。 */
import { writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const options = {
  absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
  entryPoints: ["src/client/index.ts"],
  outfile: "lib/client.js",
  bundle: true,
  write: false,
  loader: { ".module.css": "local-css" },
  platform: "browser",
  target: "es2022",
  format: "cjs",
  jsx: "automatic",
  external: [
    "react",
    "react/jsx-runtime",
    "react-dom",
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-client-ui-primitives",
    "@deepseek-ai/dsh-client-ui-slots",
  ],
  banner: {
    js: 'window.__ModuleLoader__.load({id:"@kmh/codex-cli",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
};

execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-b"], {
  cwd: options.absWorkingDir,
  stdio: "inherit",
});
const result = await build(options);
const javascript = result.outputFiles.find((file) => file.path.endsWith(".js"));
const stylesheet = result.outputFiles.find((file) =>
  file.path.endsWith(".css"),
);
if (javascript === undefined || stylesheet === undefined) {
  throw new Error("Codex 客户端构建缺少脚本或样式产物");
}
await writeFile(
  javascript.path,
  javascript.text.replace(
    "factory:(require)=>{",
    `factory:(require)=>{const __codexQuotaStyles=${JSON.stringify(stylesheet.text)};`,
  ),
);
