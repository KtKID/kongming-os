/**
 * kmh-infra 暗号解析的行为测试：用桩 shell 脚本与注入的取值器替身驱动
 * token.ts 的真实代码，断言解析顺序（shell 配置优先、进程环境后备、都没有
 * 为 absent）、shell 取值的护栏（超时、非零退出、空输出、噪声行）与边界
 * （非法变量名不起 shell）。暗号取值只在测试进程与桩脚本里存在。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SHELL_FETCH_TIMEOUT_MS,
  fetchTokenFromShellProfile,
  isValidEnvVarName,
  resolveToken,
} from "../lib/src/token.js";

/** 测试用的假暗号：用于验证传递与不泄漏，不是任何真实凭据。 */
const TOKEN_VALUE = "not-a-real-secret-0123456789";

/** 建一个可执行桩 shell：按 name 决定行为（输出噪声与取值 / 睡眠 / 非零退出 / 空输出）。 */
function createStubShell(name, body) {
  const dir = join(tmpdir(), `kmh-infra-token-test-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  return { file, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("isValidEnvVarName：字母数字下划线且不以数字开头才合法", () => {
  assert.equal(isValidEnvVarName("X_INFRA_MCP_TOKEN"), true);
  assert.equal(isValidEnvVarName("_PRIVATE"), true);
  assert.equal(isValidEnvVarName("a1_B2"), true);
  assert.equal(isValidEnvVarName(""), false);
  assert.equal(isValidEnvVarName("1BAD"), false);
  assert.equal(isValidEnvVarName("BAD NAME"), false);
  assert.equal(isValidEnvVarName('BAD";rm'), false);
});

test("fetchTokenFromShellProfile：取 stdout 最后一个非空行，吸收 rc 噪声", async () => {
  const stub = createStubShell(
    "noisy.sh",
    `echo "loading profile..."
printf %s "$STUB_TOKEN_VALUE"
echo`,
  );
  try {
    process.env.STUB_TOKEN_VALUE = TOKEN_VALUE;
    const value = await fetchTokenFromShellProfile("STUB_TOKEN_VALUE", stub.file, 2000);
    assert.equal(value, TOKEN_VALUE);
  } finally {
    delete process.env.STUB_TOKEN_VALUE;
    stub.cleanup();
  }
});

test("fetchTokenFromShellProfile：超时按取不到处理，不抛错", async () => {
  const stub = createStubShell("sleep.sh", "sleep 1");
  try {
    const value = await fetchTokenFromShellProfile("STUB_TOKEN_VALUE", stub.file, 100);
    assert.equal(value, undefined);
  } finally {
    stub.cleanup();
  }
});

test("fetchTokenFromShellProfile：非零退出按取不到处理", async () => {
  const stub = createStubShell("fail.sh", `printf %s "$STUB_TOKEN_VALUE"; exit 3`);
  try {
    process.env.STUB_TOKEN_VALUE = TOKEN_VALUE;
    const value = await fetchTokenFromShellProfile("STUB_TOKEN_VALUE", stub.file, 2000);
    assert.equal(value, undefined, "退出码非零时即使有输出也不采用");
  } finally {
    delete process.env.STUB_TOKEN_VALUE;
    stub.cleanup();
  }
});

test("fetchTokenFromShellProfile：空输出与不存在的 shell 都返回 undefined", async () => {
  const stub = createStubShell("empty.sh", "true");
  try {
    assert.equal(await fetchTokenFromShellProfile("STUB_TOKEN_VALUE", stub.file, 2000), undefined);
    assert.equal(
      await fetchTokenFromShellProfile("STUB_TOKEN_VALUE", "/nonexistent/shell", 2000),
      undefined,
      "启动失败不抛错",
    );
  } finally {
    stub.cleanup();
  }
});

test("fetchTokenFromShellProfile：默认超时是具名常量", () => {
  assert.equal(SHELL_FETCH_TIMEOUT_MS, 5000);
});

test("resolveToken：shell 配置取值优先于进程环境", async () => {
  const env = { SHELL: "/bin/zsh", X_INFRA_TEST_TOKEN: "from-env" };
  const resolution = await resolveToken("X_INFRA_TEST_TOKEN", env, async () => "from-shell");
  assert.deepEqual(resolution, { token: "from-shell", source: "shell" });
});

test("resolveToken：shell 取不到时回退进程环境", async () => {
  const env = { SHELL: "/bin/zsh", X_INFRA_TEST_TOKEN: "from-env" };
  const resolution = await resolveToken("X_INFRA_TEST_TOKEN", env, async () => undefined);
  assert.deepEqual(resolution, { token: "from-env", source: "env" });
});

test("resolveToken：两个来源都没有时为 absent，且不抛错", async () => {
  const env = { SHELL: "/bin/zsh" };
  const resolution = await resolveToken("X_INFRA_TEST_TOKEN", env, async () => undefined);
  assert.deepEqual(resolution, { token: undefined, source: "absent" });
});

test("resolveToken：非法变量名不起 shell，只查进程环境", async () => {
  let fetched = 0;
  const env = { SHELL: "/bin/zsh" };
  const resolution = await resolveToken('BAD";rm -rf', env, async () => {
    fetched += 1;
    return "should-not-happen";
  });
  assert.equal(fetched, 0, "非法变量名不得拼进 shell 命令");
  assert.deepEqual(resolution, { token: undefined, source: "absent" });
});

test("resolveToken：变量名为空或没有 SHELL 时都不起 shell", async () => {
  let fetched = 0;
  const fetcher = async () => {
    fetched += 1;
    return "should-not-happen";
  };
  assert.deepEqual(
    await resolveToken("", { SHELL: "/bin/zsh", "": "x" }, fetcher),
    { token: undefined, source: "absent" },
  );
  assert.deepEqual(
    await resolveToken("X_INFRA_TEST_TOKEN", { X_INFRA_TEST_TOKEN: "from-env" }, fetcher),
    { token: "from-env", source: "env" },
    "没有 SHELL 时直接走进程环境后备",
  );
  assert.equal(fetched, 0);
});
