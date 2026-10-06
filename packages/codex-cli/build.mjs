/** 构建 Host 产物；Client 打包随详情页任务加入 src/client 后启用。 */
import { rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
await rm("lib", { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve("typescript/bin/tsc"), "-b"], {
  stdio: "inherit",
});
