/** 以真实归档和隔离子进程核对下载校验、发布时点与已有程序保留。 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const version = "1.2.3-alpha.1";
const platform = `${process.platform}-${process.arch}`;

/** 生成私有官方包替身及子进程下载适配；返回路径，文件或归档失败时抛错。 */
function fixture(t, { actualVersion = version, badChecksum = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "kmh-runtime-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, "bin");
  const source = join(root, "package");
  mkdirSync(bin);
  mkdirSync(join(source, "bin"), { recursive: true });
  mkdirSync(join(source, "codex-path"));
  writeFileSync(
    join(source, "codex-path", "resource"),
    "COMPLETE_RUNTIME_RESOURCE",
  );
  writeFileSync(
    join(source, "bin", "codex"),
    `#!/bin/sh\nprintf '%s\\n' 'codex-cli ${actualVersion}'\n`,
    { mode: 0o755 },
  );
  const archive = join(root, "runtime.tar.gz");
  const packed = spawnSync("tar", ["-czf", archive, "-C", source, "."], {
    encoding: "utf8",
  });
  assert.equal(packed.status, 0, packed.stderr);
  copyFileSync(
    fileURLToPath(new URL("../bin/install.mjs", import.meta.url)),
    join(bin, "install.mjs"),
  );
  writeFileSync(join(bin, "version"), `${version}\n`);
  writeFileSync(
    join(bin, "runtime-receipt.json"),
    JSON.stringify({
      version,
      downloads: {
        [platform]: {
          asset: "fixture.tar.gz",
          sha256: badChecksum
            ? "0".repeat(64)
            : createHash("sha256").update(readFileSync(archive)).digest("hex"),
        },
      },
    }),
  );
  const preload = join(root, "download.mjs");
  const requests = join(root, "requests.log");
  writeFileSync(
    preload,
    `import { readFileSync, appendFileSync } from 'node:fs';\n` +
      `globalThis.fetch = async (url) => {\n` +
      `  appendFileSync(process.env.KMH_INSTALL_REQUESTS, url + '\\n');\n` +
      `  return new Response(readFileSync(process.env.KMH_INSTALL_ARCHIVE));\n` +
      `};\n`,
  );
  return {
    bin,
    requests,
    destination: join(bin, version, platform),
    run() {
      const result = spawnSync(
        process.execPath,
        ["--import", preload, join(bin, "install.mjs")],
        {
          env: {
            ...process.env,
            KMH_INSTALL_ARCHIVE: archive,
            KMH_INSTALL_REQUESTS: requests,
          },
          encoding: "utf8",
          timeout: 15000,
        },
      );
      assert.equal(result.signal, null, result.error?.message);
      return result;
    },
  };
}

test("verified archives retain companion resources and install only once", (t) => {
  const f = fixture(t);
  const first = f.run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(
    readFileSync(join(f.destination, "codex-path", "resource"), "utf8"),
    "COMPLETE_RUNTIME_RESOURCE",
  );
  const second = f.run();
  assert.equal(second.status, 0, second.stderr);
  assert.equal(readFileSync(f.requests, "utf8").trim().split("\n").length, 1);
  assert.match(
    readFileSync(f.requests, "utf8"),
    /github\.com\/openai\/codex\/releases\/download\/rust-v1\.2\.3-alpha\.1\//,
  );
});

test("a bad archive checksum fails before publishing and clears temporary files", (t) => {
  const f = fixture(t, { badChecksum: true });
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CODEX_RUNTIME_CHECKSUM_MISMATCH/);
  assert.equal(existsSync(f.destination), false);
  assert.deepEqual(readdirSync(join(f.bin, version)), []);
});

test("a runtime version mismatch fails before publishing and clears temporary files", (t) => {
  const f = fixture(t, { actualVersion: `${version}-different` });
  const result = f.run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CODEX_VERSION_MISMATCH/);
  assert.equal(existsSync(f.destination), false);
  assert.deepEqual(readdirSync(join(f.bin, version)), []);
});
