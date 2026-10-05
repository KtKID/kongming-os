import test from "node:test";
import assert from "node:assert/strict";
import {
  projectRequest,
  projectResult,
} from "../../packages/zcode-cli/lib/src/protocol.js";

test("KMH system messages, tool declarations and read correlation reach the raw channel", () => {
  const result = projectRequest({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    system: "You are KMH.",
    messages: [
      { role: "user", content: [{ type: "text", text: "read a file" }] },
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: "call-1",
            name: "read",
            arguments: '{"path":"a.txt"}',
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call-1",
        content: [{ type: "text", text: "file contents" }],
      },
    ],
    tools: [
      { name: "read", description: "KMH read", parameters: { type: "object" } },
    ],
  });
  assert.deepEqual(result.messages[0], {
    role: "system",
    content: "You are KMH.",
  });
  assert.deepEqual(result.messages[2].toolCalls, [
    { id: "call-1", name: "read", input: { path: "a.txt" } },
  ]);
  assert.equal(result.messages[3].toolName, "read");
  assert.deepEqual(result.tools, [
    { name: "read", description: "KMH read", inputSchema: { type: "object" } },
  ]);
});
test("unsupported request settings and orphan results fail explicitly", () => {
  assert.throws(
    () => projectRequest({ messages: [], temperature: 0.5 }),
    /temperature/,
  );
  assert.throws(
    () =>
      projectRequest({
        messages: [{ role: "tool", toolCallId: "lost", content: [] }],
      }),
    /correlation/,
  );
});
test("native output becomes KMH text and tool call events with exact arguments", () => {
  const chunks = [
    ...projectResult({
      text: "Reading",
      toolCalls: [{ id: "r1", name: "read", input: { path: "x" } }],
      finishReason: "tool-calls",
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    }),
  ];
  assert.equal(
    chunks.find((x) => x.type === "tool-call-delta").argumentsDelta,
    '{"path":"x"}',
  );
  assert.deepEqual(chunks.at(-1), {
    type: "finish",
    reason: { kind: "tool-calls" },
  });
});

import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const { parseDocument } = createRequire(
  new URL("../../third_party/dsh/packages/boot/plugin-manager/package.json", import.meta.url),
)("yaml");
import { Context } from "../../third_party/dsh/vendor/cordis/lib/index.js";
import { LocalSubprocessRuntime } from "../../third_party/dsh/packages/subprocess/subprocess-local/lib/index.js";
import { Config } from "../../packages/zcode-cli/lib/src/config.js";
import { ZcodeCli } from "../../packages/zcode-cli/lib/src/runtime.js";
import { accountResponse } from "../../packages/zcode-cli/lib/src/web.js";

async function fixture(t, mode = "success", extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kmh-zcode-test-"));
  const ctx = new Context();
  new LocalSubprocessRuntime(ctx);
  const builtin = join(dir, "builtin.json");
  writeFileSync(builtin, JSON.stringify({ revision: 30 }));
  const config = Config({
    providerId: "account:zai-individual-coding-plan",
    apiBaseUrl: "https://api.z.ai/api/coding/paas/v4",
    command: resolve("tests/runtime/fixtures/zcode-cli/cli.mjs"),
    cwd: dir,
    dataDir: dir,
    builtinConfigFile: builtin,
    requestTimeoutMs: 3000,
    loginTimeoutMs: 3000,
    graceMs: 100,
    env: { ZCODE_CREDENTIAL_SECRET: "fixture-cipher", KMH_FIXTURE_MODE: mode },
    ...extra,
  });
  const runtime = new ZcodeCli(ctx, config);
  t.after(async () => {
    await ctx.fiber.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
  return { runtime, dir, ctx };
}
async function until(runtime, value) {
  for (let n = 0; n < 100; n++) {
    const status = await runtime.status();
    if (status.login === value) return status;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(
    "login state did not settle: " + JSON.stringify(await runtime.status()),
  );
}
test("official login output, encrypted account registration, native framing and raw generation work together", async (t) => {
  const { runtime, dir } = await fixture(t);
  await runtime.login();
  await until(runtime, "signed-in");
  await runtime.check();
  assert.equal((await runtime.status()).connection, "ready");
  const probe = JSON.parse(readFileSync(join(dir, "requests.jsonl"), "utf8"));
  assert.deepEqual(probe.messages, [{ role: "user", content: "ping" }]);
  assert.deepEqual(probe.tools, []);
  assert.equal(probe.maxOutputTokens, 1);
  // 探测显式关闭思考；会话请求默认保持配置的高思考等级。
  assert.equal(probe.selection.options.reasoningLevel, "disabled");
  const result = await runtime.generate({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    system: "KMH owns this system",
    messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    tools: [
      { name: "read", description: "KMH read", parameters: { type: "object" } },
    ],
  });
  assert.equal(result.text, "KMH raw reply");
  const requests = readFileSync(join(dir, "requests.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  const request = requests.at(-1);
  assert.equal(request.selection.options.reasoningLevel, "high");
  assert.equal(request.messages[0].content, "KMH owns this system");
  assert.equal(request.maxOutputTokens, 1000000);
  assert.deepEqual(
    request.tools.map((t) => t.name),
    ["read"],
  );
  assert.equal(
    JSON.stringify(await runtime.status()).includes("fixture-secret"),
    false,
  );
  await runtime.logout();
  assert.equal((await runtime.status()).login, "idle");
  await assert.rejects(
    runtime.generate({ messages: [] }),
    /ZCODE_LOGIN_REQUIRED/,
  );
});
test("cancel joins the login process, stale cancellation cannot affect a retry, unload joins processes", async (t) => {
  const { runtime, ctx } = await fixture(t, "waiting");
  const first = await runtime.login();
  const same = await runtime.login();
  assert.equal(first.attemptId, same.attemptId);
  const waiting = await until(runtime, "waiting");
  assert.match(waiting.authorizeUrl, /zcode.z.ai/);
  await runtime.cancel(first.attemptId);
  assert.equal((await runtime.status()).login, "cancelled");
  const second = await runtime.login();
  assert.notEqual(second.attemptId, first.attemptId);
  await assert.rejects(runtime.cancel(first.attemptId), /ATTEMPT_CHANGED/);
  await until(runtime, "waiting");
  await ctx.fiber.dispose();
});
test("native failures and corrupt credentials expose controlled errors while preserving the file", async (t) => {
  const { runtime, dir } = await fixture(t, "fail");
  await runtime.login();
  const failed = await until(runtime, "failed");
  assert.equal(failed.error, "ZCODE_LOGIN_FAILED");
  assert.equal(JSON.stringify(failed).includes("private-secret"), false);
  const file = join(dir, ".zcode/v2/credentials.json");
  mkdirSync(join(dir, ".zcode/v2"), { recursive: true });
  writeFileSync(file, "corrupt");
  const response = await accountResponse(
    runtime,
    "status",
    new Request("http://localhost/api/zcode-cli/status"),
  );
  assert.equal((await response.json()).error, "ZCODE_CREDENTIAL_INVALID");
  assert.equal(readFileSync(file, "utf8"), "corrupt");
});
test("model cancellation terminates native generation within its configured deadline", async (t) => {
  const { runtime } = await fixture(t, "hang", { requestTimeoutMs: 150 });
  await runtime.login();
  await until(runtime, "signed-in");
  await assert.rejects(
    runtime.generate({ messages: [] }),
    /ZCODE_REQUEST_CANCELLED/,
  );
});
test("login timeout clears the authorization URL and HTTP cancel rejects malformed/stale attempts", async (t) => {
  const { runtime } = await fixture(t, "waiting", { loginTimeoutMs: 150 });
  await runtime.login();
  const failed = await until(runtime, "failed");
  assert.equal(failed.error, "ZCODE_LOGIN_TIMEOUT");
  assert.equal(failed.authorizeUrl, undefined);
  const response = await accountResponse(
    runtime,
    "cancel",
    new Request("http://localhost/api/zcode-cli/cancel", {
      method: "POST",
      body: "{}",
    }),
  );
  assert.equal(response.status, 400);
});

test("provider forwards only read while keeping the caller's tools and KMH system intact", async (t) => {
  const { runtime, dir } = await fixture(t, "loop");
  await runtime.login();
  await until(runtime, "signed-in");
  const options = {
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    system: "KMH existing system and skills",
    toolHistory: {
      tools: [],
      updates: [{ messageId: "existing-update", additions: [] }],
    },
    messages: [
      { role: "user", content: [{ type: "text", text: "Read sample.txt" }] },
    ],
    tools: [
      { name: "read", description: "KMH read", parameters: { type: "object" } },
      {
        name: "shell",
        description: "KMH shell",
        parameters: { type: "object" },
      },
    ],
  };
  const result = await runtime.generate(options);
  assert.equal(result.toolCalls[0].name, "read");
  const request = JSON.parse(readFileSync(join(dir, "requests.jsonl"), "utf8"));
  assert.deepEqual(
    request.tools.map((tool) => tool.name),
    ["read"],
  );
  assert.deepEqual(
    options.tools.map((tool) => tool.name),
    ["read", "shell"],
  );
  assert.equal(request.messages[0].content, options.system);
  const continued = await runtime.generate({
    ...options,
    messages: [
      ...options.messages,
      {
        role: "assistant",
        content: [
          {
            type: "tool-call",
            id: result.toolCalls[0].id,
            name: "read",
            arguments: JSON.stringify(result.toolCalls[0].input),
          },
        ],
      },
      {
        role: "tool",
        toolCallId: result.toolCalls[0].id,
        content: [{ type: "text", text: "kmh read fixture evidence" }],
      },
    ],
  });
  assert.equal(continued.text, "KMH read complete");
});

test("configuration rejects missing paths, relative paths and timer overflow before launch", () => {
  assert.throws(() => Config({ dataDir: "/tmp/zcode-test" }));
  assert.throws(() => Config({ cwd: "/tmp", dataDir: "relative" }));
  assert.throws(() =>
    Config({
      cwd: "/tmp",
      dataDir: "/tmp/zcode-test",
      loginTimeoutMs: 2147483648,
    }),
  );
  assert.throws(() =>
    Config({
      cwd: "/tmp",
      dataDir: "/tmp/zcode-test",
      defaultMaxTokens: 0,
    }),
  );
  assert.throws(() =>
    Config({
      cwd: "/tmp",
      dataDir: "/tmp/zcode-test",
      defaultMaxTokens: 2147483648,
    }),
  );
});

test("missing official executable becomes a controlled login failure", async (t) => {
  const { runtime } = await fixture(t, "success", {
    command: "kmh-fixture-command-that-does-not-exist",
  });
  await runtime.login();
  const failed = await until(runtime, "failed");
  assert.equal(failed.error, "ZCODE_CLI_MISSING");
});

test("native tool JSON remains available for KMH argument validation and cache usage is disjoint", () => {
  const chunks = [
    ...projectResult({
      text: "",
      toolCalls: [{ id: "bad", name: "read", input: null }],
      usage: {
        inputTokens: 10,
        outputTokens: 3,
        totalTokens: 13,
        cacheReadTokens: 4,
        cacheWriteTokens: 2,
        reasoningTokens: 1,
      },
    }),
  ];
  assert.equal(
    chunks.find((chunk) => chunk.type === "tool-call-delta").argumentsDelta,
    "null",
  );
  assert.deepEqual(chunks.find((chunk) => chunk.type === "usage").usage, {
    inputTokens: 4,
    outputTokens: 3,
    totalTokens: 13,
    cacheReadTokens: 4,
    cacheWriteTokens: 2,
    reasoningTokens: 1,
  });
});

test("partial native usage keeps successful text without inventing missing counters", () => {
  const chunks = [
    ...projectResult({
      text: "partial usage response",
      usage: { outputTokens: 3 },
    }),
  ];
  assert.equal(
    chunks.some((chunk) => chunk.type === "usage"),
    false,
  );
  assert.deepEqual(chunks.at(-1), { type: "finish", reason: { kind: "stop" } });
});

import {
  extractAuthorizeUrl,
  authorizeUrl,
} from "../../packages/zcode-cli/lib/src/authorize-url.js";
import { existsSync } from "node:fs";
const fullNativeUrl =
  "https://chat.z.ai/api/oauth/authorize?client_id=zcode&redirect_uri=https://zcode.z.ai/api/v1/oauth/cli/callback/zai&state=fixture&response_type=code";
test("native authorization preserves the complete URL and waits for a completed line", async (t) => {
  assert.equal(
    extractAuthorizeUrl("Open this URL to sign in:\n" + fullNativeUrl),
    undefined,
  );
  assert.equal(
    extractAuthorizeUrl("Open this URL to sign in:\n" + fullNativeUrl + "\r\n"),
    fullNativeUrl,
  );
  assert.throws(
    () =>
      authorizeUrl(
        "https://zcode.z.ai/api/v1/oauth/cli/callback/zai&state=fixture",
      ),
    /AUTHORIZE_URL_INVALID/,
  );
  assert.throws(
    () => extractAuthorizeUrl("https://unofficial.invalid/authorize\n"),
    /AUTHORIZE_URL_INVALID/,
  );
  const { runtime } = await fixture(t, "waiting", {
    env: {
      KMH_FIXTURE_MODE: "waiting",
      KMH_FIXTURE_AUTHORIZE_URL: fullNativeUrl,
    },
  });
  await runtime.login();
  assert.equal((await until(runtime, "waiting")).authorizeUrl, fullNativeUrl);
});
test("unofficial native authorization is a controlled failure instead of an event-handler exception", async (t) => {
  const { runtime } = await fixture(t, "waiting", {
    env: {
      KMH_FIXTURE_MODE: "waiting",
      KMH_FIXTURE_AUTHORIZE_URL: "https://unofficial.invalid/authorize",
    },
  });
  await runtime.login();
  const status = await until(runtime, "failed");
  assert.equal(status.error, "ZCODE_AUTHORIZE_URL_INVALID");
  assert.equal(status.authorizeUrl, undefined);
});
function oauthFixture(t, mode = "ready") {
  const calls = [];
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url, options) => {
    calls.push({
      url,
      body: options.body,
      authorization: options.headers.Authorization,
    });
    options.signal.throwIfAborted();
    let data;
    if (url.endsWith("/oauth/cli/init")) {
      assert.deepEqual(JSON.parse(options.body), { provider: "bigmodel" });
      data = {
        flow_id: "fixture-flow",
        authorize_url:
          mode === "bad-url"
            ? fullNativeUrl
            : "https://bigmodel.cn/login?appId=zcode&redirect=https%3A%2F%2Fzcode.z.ai%2Fapi%2Fv1%2Foauth%2Fcli%2Fcallback%2Fbigmodel&state=fixture",
        expires_at: Date.now() / 1000 + (mode === "expired" ? -1 : 30),
        poll_interval_sec: 1,
      };
    } else if (url.includes("/oauth/cli/poll/")) {
      if (mode === "waiting") data = { status: "pending" };
      else
        data = {
          status: "ready",
          user: { user_id: "wechat-user" },
          bigmodel: { access_token: "private-wechat-token" },
        };
    } else if (url.endsWith("/getCustomerInfo")) {
      assert.equal(options.headers.Authorization, "private-wechat-token");
      data = {
        organizations: [
          {
            organizationId: "org",
            organizationName: "默认机构",
            projects: [{ projectId: "project", projectName: "默认项目" }],
          },
        ],
      };
    } else if (url.endsWith("/api_keys")) {
      data = [{ name: "zcode-api-key", apiKey: "fixture-secret" }];
    } else if (url.includes("/copy/")) data = {};
    else throw new Error("Unexpected OAuth request");
    return Response.json({ code: 0, data });
  };
  return calls;
}
function domesticConfig() {
  return {
    providerId: "account:bigmodel-individual-coding-plan",
    apiBaseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    env: {
      ZCODE_CREDENTIAL_SECRET: "fixture-cipher",
      KMH_FIXTURE_PROVIDER: "account:bigmodel-individual-coding-plan",
    },
  };
}
test("BigModel WeChat authorization saves encrypted native credentials and registers its CLI model channel", async (t) => {
  const calls = oauthFixture(t);
  const { runtime, dir } = await fixture(t, "success", domesticConfig());
  await runtime.login();
  const status = await until(runtime, "signed-in");
  assert.equal(status.accountFamily, "bigmodel");
  const raw = readFileSync(join(dir, ".zcode/v2/credentials.json"), "utf8");
  assert.equal(raw.includes("fixture-secret"), false);
  assert.match(
    JSON.parse(raw)[
      "account-provider:account:bigmodel-individual-coding-plan:identity"
    ],
    /^enc:v1:/,
  );
  assert.equal(raw.includes("private-wechat-token"), false);
  await runtime.check();
  const registration = JSON.parse(
    readFileSync(join(dir, "registrations.jsonl"), "utf8"),
  );
  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, "personal-configs.jsonl"), "utf8")).config
      .providerConfigRules.providerRules[0].config.api,
    {
      type: "openai-chat-completions",
      baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    },
  );
  assert.deepEqual(
    Object.keys(
      registration.providers["account:bigmodel-individual-coding-plan"],
    ).sort(),
    ["access", "builtinModelIds"],
  );
  await runtime.generate({ messages: [] });
  const requests = readFileSync(join(dir, "requests.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  const request = requests.at(-1);
  assert.equal(
    request.selection.providerId,
    "account:bigmodel-individual-coding-plan",
  );
  assert.equal(request.selection.options.reasoningLevel, "high");
  assert.equal(
    JSON.stringify(await runtime.status()).includes("private-wechat-token"),
    false,
  );
  assert.equal(
    calls.filter((x) => x.url.includes("/oauth/cli/poll/")).length,
    1,
  );
  await runtime.logout();
  assert.equal((await runtime.status()).login, "idle");
});
test("cancelled BigModel attempts settle their polling and cannot persist credentials on retry", async (t) => {
  oauthFixture(t, "waiting");
  const { runtime, dir } = await fixture(t, "success", domesticConfig());
  const first = await runtime.login();
  const waiting = await until(runtime, "waiting");
  assert.equal(new URL(waiting.authorizeUrl).origin, "https://bigmodel.cn");
  await runtime.cancel(first.attemptId);
  assert.equal((await runtime.status()).login, "cancelled");
  assert.equal(existsSync(join(dir, ".zcode/v2/credentials.json")), false);
  const second = await runtime.login();
  assert.notEqual(second.attemptId, first.attemptId);
  await assert.rejects(runtime.cancel(first.attemptId), /ATTEMPT_CHANGED/);
  await until(runtime, "waiting");
  await runtime.cancel(second.attemptId);
});
test("BigModel expiry and wrong-family URLs fail before polling or writing credentials", async (t) => {
  for (const [mode, code] of [
    ["expired", "ZCODE_LOGIN_TIMEOUT"],
    ["bad-url", "ZCODE_AUTHORIZE_URL_INVALID"],
  ]) {
    await t.test(mode, async (sub) => {
      const calls = oauthFixture(sub, mode);
      const { runtime, dir } = await fixture(sub, "success", domesticConfig());
      await runtime.login();
      assert.equal((await until(runtime, "failed")).error, code);
      assert.equal(existsSync(join(dir, ".zcode/v2/credentials.json")), false);
      assert.equal(calls.length, 1);
    });
  }
});

test("connection testing uses its own short deadline and reports model failure", async (t) => {
  const { runtime, dir } = await fixture(t, "hang", {
    probeTimeoutMs: 180,
    requestTimeoutMs: 3000,
  });
  await runtime.login();
  await until(runtime, "signed-in");
  const response = await accountResponse(
    runtime,
    "check",
    new Request("http://localhost/api/zcode-cli/check", { method: "POST" }),
  );
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "ZCODE_PROBE_TIMEOUT" });
  assert.equal((await runtime.status()).connection, "failed");
  const probe = JSON.parse(readFileSync(join(dir, "requests.jsonl"), "utf8"));
  assert.deepEqual(probe.tools, []);
  assert.equal(probe.maxOutputTokens, 1);
});

test("session requests without maxTokens send the raised default and out-of-range values fail like the real CLI", async (t) => {
  const { runtime } = await fixture(t);
  await runtime.login();
  await until(runtime, "signed-in");
  const succeeded = await runtime.generate({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
  });
  assert.equal(succeeded.text, "KMH raw reply");
  await assert.rejects(
    runtime.generate({
      provider: "zcode-cli",
      model: "glm-5.3-flash",
      messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }],
      maxTokens: 1000001,
    }),
    /ZCODE_MODEL_CONNECTION_FAILED/,
  );
  const status = await runtime.status();
  assert.equal(status.error, "ZCODE_MODEL_CONNECTION_FAILED");
  assert.match(
    status.diagnostic.message,
    /maxOutputTokens is outside the model option range/,
  );
});

test("generation follows the requesting session workspace and falls back safely", async (t) => {
  const { runtime, dir, ctx } = await fixture(t);
  // macOS 的 getcwd 返回物理路径（/private/var），比较前统一 realpath。
  const realDir = realpathSync(dir);
  const sessionDir = realpathSync(
    mkdtempSync(join(tmpdir(), "kmh-zcode-session-")),
  );
  t.after(() => rmSync(sessionDir, { recursive: true, force: true }));
  const sessionId = "sess_fixture";
  const lastRequest = () =>
    JSON.parse(
      readFileSync(join(dir, "requests.jsonl"), "utf8")
        .trim()
        .split("\n")
        .at(-1),
    );
  const lastServerCwd = () =>
    readFileSync(join(dir, "server-cwds.jsonl"), "utf8")
      .trim()
      .split("\n")
      .at(-1);
  const ask = (extra = {}) =>
    runtime.generate({
      provider: "zcode-cli",
      model: "glm-5.3-flash",
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
      ...extra,
    });
  await runtime.login();
  await until(runtime, "signed-in");

  // 会话命中：子进程 cwd 与 JSON-RPC workspace 都切到会话目录。
  const disposeSessions = ctx.provide("sessions", {
    get: (id) =>
      id === sessionId ? { header: { cwd: sessionDir } } : undefined,
  });
  await ask({ sessionId });
  assert.equal(lastRequest().workspace.workspacePath, sessionDir);
  assert.equal(lastRequest().workspace.workspaceKey, sessionDir);
  assert.equal(lastServerCwd(), sessionDir);

  // 无 sessionId 的请求（如连通测试）保持启动目录。
  await ask();
  assert.equal(lastRequest().workspace.workspacePath, dir);
  assert.equal(lastServerCwd(), realDir);

  // 会话目录被删：回落启动目录，请求不失败。
  rmSync(sessionDir, { recursive: true, force: true });
  await ask({ sessionId });
  assert.equal(lastRequest().workspace.workspacePath, dir);
  assert.equal(lastServerCwd(), realDir);

  // sessions 服务未挂载或会话不在库中：同样回落。
  disposeSessions();
  await ask({ sessionId });
  assert.equal(lastRequest().workspace.workspacePath, dir);
  assert.equal(lastServerCwd(), realDir);
});

import { readAccount, saveAccount } from "../../packages/zcode-cli/lib/src/account.js";
import { createZCodeCredentialCipher } from "../../packages/zcode-cli/lib/vendor/zcode/credential-cipher.js";
function desktopCredentialFile(entries, secret) {
  const cipher = createZCodeCredentialCipher({
    env: { ZCODE_CREDENTIAL_SECRET: secret },
  });
  const file = {};
  for (const [identity, apiKey] of entries)
    // 桌面端键里的套餐段是不带 account: 前缀的 planId，身份嵌在键名中段。
    file[
      `account-provider:coding-plan:account:zai-individual-coding-plan:account:${encodeURIComponent(identity)}:api-key`
    ] = cipher.encrypt(apiKey);
  return file;
}
test("missing plugin credentials borrow the desktop login read-only", async (t) => {
  const { runtime, dir } = await fixture(t);
  const desktop = join(dir, "desktop-home");
  mkdirSync(join(desktop, ".zcode/v2"), { recursive: true });
  writeFileSync(
    join(desktop, ".zcode/v2/credentials.json"),
    JSON.stringify(desktopCredentialFile([["55171766419678819", "fixture-secret"]], "fixture-cipher")),
  );
  const previousHome = process.env.HOME;
  process.env.HOME = desktop;
  try {
    // 沙盒无凭据：借读桌面端（身份从 api-key 键名反解），状态机进入已登录。
    const status = await runtime.status();
    assert.equal(status.login, "signed-in");
    assert.equal(status.credentialSource, "desktop");
    // 借读的凭据可完成模型请求；桌面端文件保持只读。
    const before = readFileSync(join(desktop, ".zcode/v2/credentials.json"), "utf8");
    const result = await runtime.generate({
      provider: "zcode-cli",
      model: "glm-5.3-flash",
      messages: [{ role: "user", content: [{ type: "text", text: "Hello" }] }],
    });
    assert.equal(result.text, "KMH raw reply");
    assert.equal(readFileSync(join(desktop, ".zcode/v2/credentials.json"), "utf8"), before);
    // 本插件登录一次后覆盖借读；登出只清本插件沙盒。
    await runtime.login();
    await until(runtime, "signed-in");
    assert.equal((await runtime.status()).credentialSource, "plugin");
    await runtime.logout();
    assert.equal((await runtime.status()).login, "signed-in");
    assert.equal((await runtime.status()).credentialSource, "desktop");
    assert.equal(existsSync(join(desktop, ".zcode/v2/credentials.json")), true);
  } finally {
    process.env.HOME = previousHome;
  }
});
test("unreadable desktop credentials report signed out instead of failing", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kmh-zcode-account-"));
  const desktop = join(dir, "desktop.json");
  const env = { ZCODE_CREDENTIAL_SECRET: "fixture-cipher" };
  const broken = desktopCredentialFile([["u1", "k1"]], "other-secret");
  writeFileSync(desktop, JSON.stringify(broken));
  // 密钥不匹配的桌面端文件按未登录处理，不向调用方抛错。
  assert.equal(
    await readAccount(dir, "account:zai-individual-coding-plan", env, {
      desktopFile: desktop,
    }),
    undefined,
  );
  // 桌面端文件不存在同样按未登录处理。
  assert.equal(
    await readAccount(dir, "account:zai-individual-coding-plan", env, {
      desktopFile: join(dir, "absent.json"),
    }),
    undefined,
  );
  // 本地插件凭据存在时优先，不读桌面端文件。
  await saveAccount(
    dir,
    "account:zai-individual-coding-plan",
    { identity: "local-user", apiKey: "local-secret" },
    env,
    new AbortController().signal,
  );
  const account = await readAccount(dir, "account:zai-individual-coding-plan", env, {
    desktopFile: desktop,
  });
  assert.deepEqual(account, {
    identity: "local-user",
    apiKey: "local-secret",
    source: "plugin",
  });
  rmSync(dir, { recursive: true, force: true });
});

test("registration failure shows native code and a credential-filtered hint while preserving sign-in", async (t) => {
  const { runtime, dir } = await fixture(t, "registration-fail");
  await runtime.login();
  await until(runtime, "signed-in");
  const file = join(dir, ".zcode/v2/credentials.json");
  const saved = readFileSync(file, "utf8");
  await assert.rejects(runtime.check(), /ZCODE_MODEL_REGISTRATION_FAILED/);
  const status = await runtime.status();
  assert.equal(status.login, "signed-in");
  assert.equal(status.error, "ZCODE_MODEL_REGISTRATION_FAILED");
  assert.equal(status.diagnostic.code, -32603);
  assert.match(status.diagnostic.message, /Unrecognized key/);
  assert.equal(JSON.stringify(status).includes("fixture-secret"), false);
  assert.equal(JSON.stringify(status).includes("fixture-user"), false);
  assert.equal(readFileSync(file, "utf8"), saved);
});

test("personal endpoint overlay preserves supplied configuration and rejects damaged source files", async (t) => {
  const { runtime, dir } = await fixture(t);
  await runtime.login();
  await until(runtime, "signed-in");
  const source = join(dir, "personal-provider.json");
  const saved = JSON.stringify({
    schemaVersion: 1,
    config: {
      providerConfigRules: {
        providerRules: [
          {
            providerId: "personal:other",
            config: {
              api: {
                type: "openai-chat-completions",
                baseUrl: "https://example.com/v1",
              },
            },
          },
        ],
      },
      modelConfigRules: {
        providerModelRules: [
          {
            providerId: "personal:other",
            modelId: "GLM-4.7",
            config: { enabled: true },
          },
          {
            providerId: "account:zai-individual-coding-plan",
            modelId: "GLM-5.3-Flash",
            config: {
              enabled: false,
              optionSpecs: {
                reasoningLevel: { values: ["low", "high"] },
                maxOutputTokens: { max: 4096 },
              },
            },
          },
        ],
        manualProviderModelRules: [],
      },
      providerOrder: ["personal:other"],
    },
  });
  writeFileSync(source, saved);
  await runtime.check();
  const overlay = JSON.parse(
    readFileSync(join(dir, "kmh-model-provider.json"), "utf8"),
  );
  assert.equal(readFileSync(source, "utf8"), saved);
  assert.equal(overlay.config.providerConfigRules.providerRules.length, 2);
  assert.deepEqual(overlay.config.providerOrder, ["personal:other"]);
  const modelRules = overlay.config.modelConfigRules.providerModelRules;
  assert.equal(modelRules.length, 2);
  assert.deepEqual(modelRules[0], {
    providerId: "personal:other",
    modelId: "GLM-4.7",
    config: { enabled: true },
  });
  assert.deepEqual(modelRules[1], {
    providerId: "account:zai-individual-coding-plan",
    modelId: "GLM-5.3-Flash",
    config: {
      enabled: false,
      optionSpecs: {
        reasoningLevel: { values: ["low", "high"] },
        maxOutputTokens: { max: 1000000 },
      },
    },
  });
  writeFileSync(source, "corrupt");
  await assert.rejects(runtime.check(), /ZCODE_PERSONAL_CONFIG_INVALID/);
  assert.equal(readFileSync(source, "utf8"), "corrupt");
});

test("omitted model endpoint resolves to the BigModel Coding Plan URL", () => {
  const config = Config({ cwd: "/tmp", dataDir: "/tmp" });
  assert.equal(
    config.apiBaseUrl,
    "https://open.bigmodel.cn/api/coding/paas/v4",
  );
  assert.equal(config.providerId, "account:bigmodel-individual-coding-plan");
  assert.equal(config.defaultMaxTokens, 1000000);
  assert.throws(
    () =>
      Config({
        cwd: "/tmp",
        dataDir: "/tmp",
        apiBaseUrl: "http://example.com/v1",
      }),
    /HTTPS/,
  );
});

test("resolved model info carries the session default output cap for the llm layer", async () => {
  const { ZcodeAdapter } = await import(
    "../../packages/zcode-cli/lib/src/index.js"
  );
  const adapter = new ZcodeAdapter({
    config: {
      model: "glm-5.3-flash",
      nativeModel: "GLM-5.3-Flash",
      defaultMaxTokens: 1000000,
    },
  });
  const info = await adapter.resolveModel("zcode-cli", "glm-5.3-flash");
  assert.equal(info.defaultMaxTokens, 1000000);
  assert.equal(info.name, "GLM-5.3-Flash");
});

import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
test("published Client factory registers in Plugins and renders with the shared React runtime", () => {
  let handoff;
  runInNewContext(readFileSync("packages/zcode-cli/lib/client.js", "utf8"), {
    window: {
      __ModuleLoader__: {
        load: (value) => {
          handoff = value;
        },
      },
    },
  });
  assert.equal(handoff.id, "@kmh/zcode-cli");
  const require = createRequire(
    resolve("third_party/dsh/packages/client/ui-renderer/package.json"),
  );
  const react = require("react");
  const renderer = require("react-dom/server");
  const client = handoff.factory((name) => {
    if (name === "@deepseek-ai/dsh-client-ui-primitives")
      return {
        Button: ({ children }) => react.createElement("button", {}, children),
      };
    assert.ok(["react", "react/jsx-runtime"].includes(name), name);
    return require(name);
  });
  let Component;
  let copy;
  client.apply({
    effect: (setup) => setup(),
    locale: {
      bind: () => (key) => copy.zh[key],
      register: (_namespace, dictionaries) => {
        copy = dictionaries;
        return () => {};
      },
    },
    slots: {
      inject: (name, setup) => {
        assert.equal(name, "plugins.item");
        return setup();
      },
      register: (entry, component) => {
        assert.equal(entry.name, "plugins.item");
        assert.equal(entry.id, "zcode-cli");
        Component = component;
        return () => {};
      },
    },
  });
  const t = (key) => copy.zh[key];
  assert.match(Component({ view: "summary", t }), /ZCode CLI/);
  assert.equal(
    renderer.renderToStaticMarkup(
      react.createElement(Component, { view: "page", t }),
    ),
    '<p role="status">正在读取账号…</p>',
  );
});

test("normal KMH Web retains its stock preset definitions when ZCode is added", () => {
  const insertion =
    "    - id: kmh-zcode-cli\n      name: '@kmh/zcode-cli'\n      config:\n        providerId: account:bigmodel-individual-coding-plan\n        cwd: !!js process.cwd()\n        dataDir: !!js dshHomePath('zcode-cli')\n";
  // 只比较预设定义，独立的启动日志和安装路径配置可正常演进。
  const normalize = (text) => {
    const document = parseDocument(text, {
      customTags: [{ tag: "tag:yaml.org,2002:js", resolve: value => value }],
    });
    assert.equal(document.errors.length, 0);
    const presets = document.toJS()[0].insert.filter(row => row.name === "@deepseek-ai/dsh-agent-preset");
    assert.equal(presets.length, 4);
    return presets;
  };
  const current = readFileSync("profiles/kmh-web/cordis.patch.yml", "utf8");
  const baseline = execFileSync(
    "git",
    ["show", "HEAD:profiles/kmh-web/cordis.patch.yml"],
    { encoding: "utf8" },
  );
  assert.ok(current.includes(insertion));
  assert.deepEqual(normalize(current), normalize(baseline));
  assert.equal(existsSync("profiles/kmh-zcode"), false);
  assert.equal(existsSync("profiles/kmh-zcode-web"), false);
  const pkg = JSON.parse(
    readFileSync("packages/zcode-cli/package.json", "utf8"),
  );
  assert.equal(pkg.exports["./read-only"], undefined);
});
