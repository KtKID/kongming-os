/** 单次构建 Host 与 Client，保留已有产物并写入更新，供 DSH HMR 检测变化。 */
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
  platform: "browser",
  target: "es2022",
  format: "cjs",
  jsx: "automatic",
  external: [
    ...Object.keys(
      JSON.parse(
        await (
          await import("node:fs/promises")
        ).readFile(new URL("package.json", import.meta.url), "utf8"),
      ).peerDependencies,
    ).filter((name) => name.startsWith("@deepseek-ai/dsh-client-")),
    "react",
    "react/jsx-runtime",
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-client-ui-primitives",
    "@deepseek-ai/dsh-client-ui-slots",
  ],
  banner: {
    js: 'window.__ModuleLoader__.load({id:"@kmh/kmh-team",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
};

execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-b"], {
  cwd: options.absWorkingDir,
  stdio: "inherit",
});
await build(options);
