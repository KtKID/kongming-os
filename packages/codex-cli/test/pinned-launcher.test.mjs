/** 使用真实启动器和隔离程序替身，核对平台选择、版本拒绝与进程参数。 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/", import.meta.url));
const version = readFileSync(join(bin, "version"), "utf8").trim();

/** 为指定平台建立私有运行目录；返回启动环境，创建失败向测试抛错。 */
function fixture(t, system, arch, platform, actualVersion) {
  const root = mkdtempSync(join(tmpdir(), "kmh-codex-platform-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tools = join(root, "tools");
  mkdirSync(tools);
  copyFileSync(join(bin, "codex"), join(root, "codex"));
  writeFileSync(join(root, "version"), `${version}\n`);
  writeFileSync(
    join(tools, "uname"),
    `#!/bin/sh\ncase "$1" in -s) printf '%s\\n' '${system}';; -m) printf '%s\\n' '${arch}';; *) exit 2;; esac\n`,
    { mode: 0o755 },
  );
  if (actualVersion !== undefined) {
    const executable = join(root, version, platform, "bin", "codex");
    mkdirSync(dirname(executable), { recursive: true });
    writeFileSync(
      executable,
      `#!/bin/sh\nif [ "$1" = --version ]; then printf '%s\\n' 'codex-cli ${actualVersion}'; exit 0; fi\nprintf '<%s>\\n' "$@"\nexit 17\n`,
      { mode: 0o755 },
    );
  }
  return {
    launcher: join(root, "codex"),
    env: { ...process.env, PATH: `${tools}${delimiter}${process.env.PATH}` },
  };
}

for (const [arch, platform] of [
  ["x86_64", "linux-x64"],
  ["aarch64", "linux-arm64"],
]) {
  test(`Linux ${arch} selects its runtime and preserves arguments and status`, (t) => {
    const f = fixture(t, "Linux", arch, platform, version);
    const result = spawnSync(
      f.launcher,
      ["app-server", "-c", "value=with space"],
      {
        env: f.env,
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 17, result.stderr);
    assert.equal(result.stdout, "<app-server>\n<-c>\n<value=with space>\n");
  });

  test(`Linux ${arch} reports a missing runtime path`, (t) => {
    const f = fixture(t, "Linux", arch, platform);
    const result = spawnSync(f.launcher, ["app-server"], {
      env: f.env,
      encoding: "utf8",
    });
    assert.equal(result.status, 78);
    assert.match(result.stderr, /CODEX_BUNDLED_RUNTIME_MISSING/);
    assert.ok(result.stderr.includes(`/${platform}/bin/codex`));
  });

  test(`Linux ${arch} rejects a different alpha version`, (t) => {
    const f = fixture(t, "Linux", arch, platform, `${version}-different`);
    const result = spawnSync(f.launcher, ["app-server"], {
      env: f.env,
      encoding: "utf8",
    });
    assert.equal(result.status, 78);
    assert.match(result.stderr, /CODEX_VERSION_MISMATCH/);
    assert.equal(result.stdout, "");
  });
}

test("macOS arm64 retains the existing runtime layout", (t) => {
  const f = fixture(t, "Darwin", "arm64", "darwin-arm64", version);
  const result = spawnSync(f.launcher, ["--version"], {
    env: f.env,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `codex-cli ${version}`);
});

test("unsupported platforms report their system and architecture", (t) => {
  const f = fixture(t, "Unknown", "unknown", "unsupported");
  const result = spawnSync(f.launcher, ["--version"], {
    env: f.env,
    encoding: "utf8",
  });
  assert.equal(result.status, 78);
  assert.match(
    result.stderr,
    /CODEX_BUNDLED_PLATFORM_UNSUPPORTED: Unknown\/unknown/,
  );
});
