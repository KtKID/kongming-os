/** 下载当前平台的固定官方运行包；核对归档摘要和程序版本后发布，失败时清理临时目录。 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

/** 检查指定程序的完整版本；返回正常退出，运行失败或版本失配时抛错。 */
function verifyRuntime(executable, version) {
  const result = spawnSync(executable, ["--version"], { encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `Codex 版本检查失败：${result.stderr.trim() || result.signal || result.status}`,
    );
  }
  if (result.stdout.trim() !== `codex-cli ${version}`) {
    throw new Error(
      `CODEX_VERSION_MISMATCH: expected ${version}; actual ${result.stdout.trim()}`,
    );
  }
}

/** 读取包内版本和收据，下载当前平台完整归档；成功后保留运行包，失败向调用方抛错。 */
async function installRuntime() {
  const bin = dirname(fileURLToPath(import.meta.url));
  const version = (await readFile(join(bin, "version"), "utf8")).trim();
  const receipt = JSON.parse(
    await readFile(join(bin, "runtime-receipt.json"), "utf8"),
  );
  const platform = `${process.platform}-${process.arch}`;
  const download = receipt.downloads[platform];
  if (!download)
    throw new Error(`CODEX_BUNDLED_PLATFORM_UNSUPPORTED: ${platform}`);
  if (receipt.version !== version)
    throw new Error("固定版本与下载收据版本不一致");
  const destination = join(bin, version, platform);
  const executable = join(destination, "bin", "codex");
  let present = true;
  try {
    await access(executable);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    present = false;
  }
  if (present) {
    verifyRuntime(executable, version);
    console.log(`Codex ${version} (${platform}) 已就绪`);
    return;
  }

  await mkdir(join(bin, version), { recursive: true });
  const temporary = await mkdtemp(join(bin, version, `.${platform}-`));
  try {
    const url = `https://github.com/openai/codex/releases/download/rust-v${version}/${download.asset}`;
    console.log(`下载 Codex ${version} (${platform})`);
    const response = await fetch(url, { signal: AbortSignal.timeout(300000) });
    if (!response.ok || !response.body)
      throw new Error(`下载运行包失败：HTTP ${response.status}`);
    const archive = join(temporary, "runtime.tar.gz");
    await pipeline(Readable.fromWeb(response.body), createWriteStream(archive));
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    if (hash.digest("hex") !== download.sha256)
      throw new Error("CODEX_RUNTIME_CHECKSUM_MISMATCH");

    const unpacked = join(temporary, "package");
    await mkdir(unpacked);
    const extracted = spawnSync("tar", ["-xzf", archive, "-C", unpacked], {
      encoding: "utf8",
    });
    if (extracted.error) throw extracted.error;
    if (extracted.status !== 0)
      throw new Error(`解压运行包失败：${extracted.stderr.trim()}`);
    await chmod(join(unpacked, "bin", "codex"), 0o755);
    verifyRuntime(join(unpacked, "bin", "codex"), version);
    await rename(unpacked, destination);
    console.log(
      `Codex ${version} (${platform}) 安装完成，SHA-256 和版本校验通过`,
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

try {
  await installRuntime();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
