/** 固定程序的真实版本、启动拒绝及参数传递；替身只用于异常边界。 */
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
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Config } from "../lib/src/config.js";
import { checkVersion } from "../lib/src/status.js";
import { Context } from "@deepseek-ai/cordis";
import { LocalSubprocessRuntime } from "../../../third_party/dsh/packages/subprocess/subprocess-local/lib/index.js";

const bin = fileURLToPath(new URL("../bin/", import.meta.url));
const version = "0.163.0-alpha.10.2";
const launcher = join(bin, "codex");
const platform = `${process.platform}-${process.arch}`;
const supported = ["darwin-arm64", "linux-x64", "linux-arm64"].includes(
  platform,
);

test("default command is the plugin-owned checked launcher", () => {
  const config = Config({ cwd: tmpdir(), dataDir: tmpdir() });
  assert.equal(config.command, launcher);
  const manifest = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.ok(manifest.files.includes("bin"));
});

test(
  "bundled CLI reports the complete pinned version",
  { skip: !supported },
  () => {
    const result = spawnSync(launcher, ["--version"], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), `codex-cli ${version}`);
  },
);

test(
  "version status retains the exact alpha version",
  { skip: !supported },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "kmh-codex-version-"));
    const ctx = new Context();
    new LocalSubprocessRuntime(ctx);
    t.after(async () => {
      await ctx.fiber.dispose();
      rmSync(root, { recursive: true, force: true });
    });
    const config = Config({
      cwd: root,
      dataDir: root,
      env: { CODEX_HOME: root },
    });
    const status = await checkVersion(ctx, config, AbortSignal.timeout(10000));
    assert.equal(status.ok, true, status.reason);
    assert.equal(status.version, version);
  },
);

/** 独占临时目录中的 CLI 替身，保持真实启动器与进程调用。 */
function fixture(t, actualVersion) {
  const root = mkdtempSync(join(tmpdir(), "kmh-codex-pin-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  copyFileSync(launcher, join(root, "codex"));
  writeFileSync(join(root, "version"), `${version}\n`);
  if (actualVersion !== undefined) {
    const cli = join(root, version, platform, "bin", "codex");
    mkdirSync(dirname(cli), { recursive: true });
    writeFileSync(
      cli,
      `#!/bin/sh\nif [ "$1" = '--version' ]; then printf '%s\\n' 'codex-cli ${actualVersion}'; exit 0; fi\nprintf '<%s>\\n' "$@"\nexit 17\n`,
      { mode: 0o755 },
    );
  }
  return join(root, "codex");
}

test(
  "a different alpha version is rejected before execution",
  { skip: !supported },
  (t) => {
    const result = spawnSync(fixture(t, "0.163.0-alpha.10.3"), ["app-server"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 78);
    assert.match(result.stderr, /CODEX_VERSION_MISMATCH/);
    assert.match(result.stderr, /0\.163\.0-alpha\.10\.2/);
    assert.match(result.stderr, /0\.163\.0-alpha\.10\.3/);
    assert.equal(result.stdout, "");
  },
);

test(
  "a missing bundled runtime produces a clear error",
  { skip: !supported },
  (t) => {
    const result = spawnSync(fixture(t), ["app-server"], { encoding: "utf8" });
    assert.equal(result.status, 78);
    assert.match(result.stderr, /CODEX_BUNDLED_RUNTIME_MISSING/);
  },
);

test(
  "matching versions preserve arguments and real exit status",
  { skip: !supported },
  (t) => {
    const result = spawnSync(
      fixture(t, version),
      ["app-server", "-c", "value=with space"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 17);
    assert.equal(result.stdout, "<app-server>\n<-c>\n<value=with space>\n");
  },
);
