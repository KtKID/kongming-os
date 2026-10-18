/** 构建 Host 与 Client，输出现有 Web 模块加载器使用的插件工厂。 */
import { build, context } from "esbuild";
import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
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
    "react",
    "react/jsx-runtime",
    "@deepseek-ai/cordis",
    "@deepseek-ai/dsh-client-ui-primitives",
    "@deepseek-ai/dsh-client-ui-slots",
  ],
  banner: {
    js: 'window.__ModuleLoader__.load({id:"@kmh/xmusic",factory:(require)=>{var module={exports:{}};var exports=module.exports;',
  },
  footer: { js: "return module.exports;}});" },
};

/** 初次构建后监听页面依赖，返回异步关闭函数；初始化失败释放构建器。 */
export async function watchClient() {
  const watcher = await context(options);
  try {
    await watcher.rebuild();
    await watcher.watch();
    return () => watcher.dispose();
  } catch (error) {
    await watcher.dispose();
    throw error;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await rm("lib", { recursive: true, force: true });
  execFileSync(
    process.execPath,
    [require.resolve("typescript/bin/tsc"), "-b"],
    {
      stdio: "inherit",
    },
  );
  await build(options);
}
