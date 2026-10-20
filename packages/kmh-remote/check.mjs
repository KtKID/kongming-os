/** 检查手写 JavaScript 和测试的语法；TypeScript 由本包 typecheck 单独检查。 */
import { readdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 遍历指定目录并检查原生模块，遇到语法错误保留 Node 诊断并终止。 */
async function checkDirectory(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = new URL(item.name, directory);
    if (item.isDirectory()) {
      await checkDirectory(new URL(`${item.name}/`, directory));
    } else if (/\.(mjs|js)$/.test(item.name)) {
      execFileSync(process.execPath, ['--check', fileURLToPath(file)], {
        stdio: 'inherit',
      });
    }
  }
}

for (const directory of ['host/', 'client/', 'test/']) {
  await checkDirectory(new URL(directory, import.meta.url));
}
