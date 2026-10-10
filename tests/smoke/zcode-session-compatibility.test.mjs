/**
 * 隔离运行官方 CLI，调查原生会话、MCP 扩展和 KMH 模型通道的实际协议。
 * ZCODE_CLI_FILE 指向官方 zcode.cjs；协议用例保持模型请求为零，历史用例连接本机模拟模型。
 * 真实账号和远端模型请求保持为零。
 * 诊断通过表示已确认接口行为；原生 session 增量与 KMH 工具续接需要独立功能验收。
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import test from "node:test";

const cliFile = process.env.ZCODE_CLI_FILE;
const preferences = {
  nativeSearchEnhancementsEnabled: false,
  memoryEnabled: false,
  askUserQuestionAutoResolutionEnabled: false,
  modelContextBudgetStrategy: "preflight-v1",
};

/** 拉起隔离的 NDJSON app-server；反向请求只允许无副作用的运行偏好查询。 */
function connect(file, directory) {
  const env = {
    PATH: process.env.PATH,
    LANG: process.env.LANG ?? "en_US.UTF-8",
    TMPDIR: tmpdir(),
    HOME: directory,
    USERPROFILE: directory,
    ZCODE_DATA_BASE_DIR: directory,
    ZCODE_STORAGE_DIR: join(directory, "storage"),
    ZCODE_LOG_DIR: join(directory, "log"),
    ZCODE_BUILTIN_PROVIDER_CONFIG_FILE:
      process.env.ZCODE_BUILTIN_PROVIDER_CONFIG_FILE ??
      resolve(dirname(file), "../config/provider/zcode-builtin.json"),
    ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: join(
      directory,
      "personal-provider.json",
    ),
    ZCODE_CREDENTIAL_SECRET: "kmh-schema-probe-without-credentials",
  };
  const child = spawn(process.execPath, [file, "app-server"], {
    cwd: directory,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const exited = once(child, "exit");
  const pending = new Map();
  let nextId = 1;
  let closed = false;
  let diagnostic = "";
  child.stderr.on("data", (chunk) => {
    diagnostic = (diagnostic + chunk.toString("utf8")).slice(-4_000);
  });
  const lines = createInterface({ input: child.stdout });
  const send = (frame) => child.stdin.write(JSON.stringify(frame) + "\n");
  lines.on("line", (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof frame.method === "string" && frame.id !== undefined) {
      if (frame.method === "session/requestRuntimePreferences")
        send({ id: frame.id, result: preferences });
      else
        send({
          id: frame.id,
          error: {
            code: -32601,
            message: "KMH schema probe allows no execution",
          },
        });
      return;
    }
    if (frame.id === undefined) return;
    const request = pending.get(frame.id);
    if (!request) return;
    pending.delete(frame.id);
    clearTimeout(request.timer);
    request.resolve(frame);
  });
  child.on("exit", (code, signal) => {
    closed = true;
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(
        new Error(
          `Official app-server exited (${code ?? signal}): ${diagnostic}`,
        ),
      );
    }
    pending.clear();
  });
  return {
    /** 请求限于隔离诊断；超时失败并留给 close 回收子进程。 */
    request(method, params) {
      assert.equal(closed, false, "Official app-server must remain available");
      const id = nextId++;
      return new Promise((resolveRequest, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Official app-server timed out: ${method}`));
        }, 15_000);
        pending.set(id, { resolve: resolveRequest, reject, timer });
        send({ id, method, params });
      });
    },
    /** 等待本测试拥有的进程结束；强制终止也等待实际 exit。 */
    async close() {
      if (closed) return;
      child.stdin.end();
      const kill = setTimeout(() => child.kill("SIGKILL"), 2_000);
      try {
        await exited;
      } finally {
        clearTimeout(kill);
        lines.close();
      }
    },
  };
}

/** 将原生错误限制为协议代码和字段校验信息，测试报告保持凭据隔离。 */
function requireResult(frame, method) {
  if (frame.error)
    throw new Error(`${method}: ${frame.error.code} ${frame.error.message}`);
  return frame.result;
}

/** 核对公开参数校验结果；字段被拒绝只约束被测入口，其他接入方式继续调查。 */
function requireRejectedFields(frame, fields) {
  assert.equal(frame.error?.code, -32602);
  for (const field of fields) assert.ok(frame.error.message.includes(field));
}

test("official ZCode native session and model transport protocol diagnostics", async (t) => {
  assert.ok(cliFile, "Set ZCODE_CLI_FILE to the official zcode.cjs");
  const file = resolve(cliFile);
  const sha256 = createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
  t.diagnostic(`Official CLI SHA256 ${sha256}`);
  const directory = await mkdtemp(join(tmpdir(), "kmh-zcode-session-probe-"));
  const workspace = { workspacePath: directory, workspaceKey: directory };
  const createParams = {
    workspace,
    persistence: "immediate",
    titleGenerationEnabled: false,
    mcpServers: [],
    toolAllowlist: [],
    toolDenylist: ["*"],
    offPeakToolEnabled: false,
    dynamicWorkflowEnabled: false,
  };
  let connection = connect(file, directory);
  t.after(async () => {
    try {
      await connection.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  let sessionId;
  await t.test(
    "persisted native session survives app-server restart with zero model requests",
    async () => {
      const created = requireResult(
        await connection.request("session/create", {
          ...createParams,
          // 官方空会话在首条输入前保持惰性持久化；导入固定文本可验证恢复而保持模型调用为零。
          importedHistory: {
            source: "claudeCode",
            title: "KMH schema probe",
            messages: [
              { role: "user", content: "Synthetic KMH session fixture" },
              { role: "assistant", content: "Synthetic response" },
            ],
          },
        }),
        "session/create",
      );
      assert.equal(typeof created.session.sessionId, "string");
      sessionId = created.session.sessionId;
      await connection.close();
      connection = connect(file, directory);
      const resumed = requireResult(
        await connection.request("session/resume", { sessionId, workspace }),
        "session/resume",
      );
      assert.equal(resumed.session.sessionId, sessionId);
      assert.equal(resumed.messages.length, 2);
      const usage = requireResult(
        await connection.request("session/usage", { sessionId }),
        "session/usage",
      );
      assert.equal(usage.modelRequestCount, 0);
    },
  );

  await t.test(
    "legacy session/create rejects systemPrompt and inline tools fields",
    async () => {
      requireRejectedFields(
        await connection.request("session/create", {
          ...createParams,
          systemPrompt: "KMH owns this session's prompt, tools and outer loop.",
          tools: [
            {
              name: "kmh_echo",
              description: "Echo",
              inputSchema: { type: "object" },
            },
          ],
        }),
        ["systemPrompt", "tools"],
      );
    },
  );

  await t.test(
    "legacy session/send rejects the messages field for tool result delivery",
    async () => {
      assert.ok(
        sessionId,
        "Native session setup must succeed before probing tool delivery",
      );
      requireRejectedFields(
        await connection.request("session/send", {
          sessionId,
          content: "",
          messages: [
            {
              role: "tool",
              content: "echo",
              toolCallId: "kmh-call-1",
              toolName: "kmh_echo",
            },
          ],
        }),
        ["messages"],
      );
    },
  );

  await t.test(
    "legacy workspace/generateText rejects an explicit sessionId field",
    async () => {
      assert.ok(
        sessionId,
        "Native session setup must succeed before probing raw transport",
      );
      requireRejectedFields(
        await connection.request("workspace/generateText", {
          workspace,
          sessionId,
          selection: { providerId: "kmh-schema-probe", modelId: "disabled" },
          messages: [{ role: "user", content: "schema validation only" }],
          tools: [],
          querySource: "kmh-schema-probe",
        }),
        ["sessionId"],
      );
    },
  );

  await t.test(
    "raw transport accepts KMH system messages, tools and correlated tool results",
    async () => {
      const frame = await connection.request("workspace/generateText", {
        workspace,
        selection: { providerId: "kmh-schema-probe", modelId: "disabled" },
        messages: [
          { role: "system", content: "KMH owns prompt and tool execution." },
          { role: "user", content: "echo" },
          {
            role: "assistant",
            content: "",
            toolCalls: [{ id: "kmh-call-1", name: "kmh_echo", input: {} }],
          },
          {
            role: "tool",
            content: "echo",
            toolCallId: "kmh-call-1",
            toolName: "kmh_echo",
          },
        ],
        tools: [
          {
            name: "kmh_echo",
            description: "Echo",
            inputSchema: { type: "object" },
          },
        ],
        querySource: "kmh-schema-probe",
      });
      // 隔离账号保持为空；明确到达模型选择校验即证明消息和工具字段已通过协议解析。
      assert.ok(frame.error);
      assert.notEqual(frame.error.code, -32602, frame.error.message);
      assert.match(frame.error.message, /provider|model|模型|提供商/i);
      const usage = requireResult(
        await connection.request("session/usage", { sessionId }),
        "session/usage",
      );
      assert.equal(usage.modelRequestCount, 0);
    },
  );

  await t.test(
    "official MCP extension discovers a KMH-owned tool without model execution",
    async () => {
      const fixture = join(directory, "kmh-mcp.mjs");
      await writeFile(
        fixture,
        `import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  switch (request.method) {
    case "initialize":
      result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "kmh-probe", version: "1.0.0" } };
      break;
    case "tools/list":
      result = { tools: [{ name: "kmh_echo", description: "Echo", inputSchema: { type: "object", properties: {} } }] };
      break;
    case "ping":
      result = {};
      break;
    default:
      process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, error: { code: -32601, message: "Probe only supports discovery" } }) + "\\n");
      return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
});

`,
      );
      const mcpServers = [
        {
          name: "kmh-probe",
          command: process.execPath,
          args: [fixture],
          env: [],
          isolation: "session",
        },
      ];
      const result = requireResult(
        await connection.request("mcp/list", { workspace, mcpServers }),
        "mcp/list",
      );
      assert.equal(result.statuses["kmh-probe"].status, "connected");
      assert.equal(result.statuses["kmh-probe"].toolCount, 1);
      const usage = requireResult(
        await connection.request("session/usage", { sessionId }),
        "session/usage",
      );
      assert.equal(usage.modelRequestCount, 0);
    },
  );
});

test("official raw model history and session attribution against a loopback fixture", async (t) => {
  assert.ok(cliFile, "Set ZCODE_CLI_FILE to the official zcode.cjs");
  const file = resolve(cliFile);
  const directory = await mkdtemp(join(tmpdir(), "kmh-zcode-raw-probe-"));
  const requests = [];
  // 普通自定义 provider 隔离验证公共 raw 路径；Coding Plan 的签名和权益另行验收。
  const model = {
    providerId: "kmh-local-history-probe",
    modelId: "GLM-5.3-Flash",
  };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests.push({
      url: request.url,
      sessionId: request.headers["x-session-id"],
      body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: `local-completion-${requests.length}`,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1_000),
        model: model.modelId,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "Synthetic local response" },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
      }),
    );
  });
  let connection;
  t.after(async () => {
    try {
      await connection?.close();
    } finally {
      server.closeAllConnections();
      await new Promise((resolveClose) => server.close(resolveClose));
      await rm(directory, { recursive: true, force: true });
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await writeFile(
    join(directory, "personal-provider.json"),
    JSON.stringify({
      schemaVersion: 1,
      config: {
        providerConfigRules: {
          providerRules: [
            {
              providerId: model.providerId,
              config: {
                group: "standard-personal",
                access: {
                  type: "api-key",
                  apiKey: "synthetic-local-probe-key",
                },
                personalModelIds: [model.modelId],
                api: {
                  type: "openai-chat-completions",
                  baseUrl: `http://127.0.0.1:${address.port}/v1`,
                },
              },
            },
          ],
        },
        modelConfigRules: {
          providerModelRules: [],
          manualProviderModelRules: [],
        },
      },
    }),
  );
  function start() {
    connection = connect(file, directory);
  }
  start();
  const workspace = {
    workspacePath: directory,
    workspaceKey: "synthetic-kmh-conversation-a",
  };
  const created = requireResult(
    await connection.request("session/create", {
      workspace,
      persistence: "immediate",
      titleGenerationEnabled: false,
      toolAllowlist: [],
      toolDenylist: ["*"],
      mcpServers: [],
      offPeakToolEnabled: false,
      dynamicWorkflowEnabled: false,
      importedHistory: {
        source: "claudeCode",
        title: "Synthetic raw history probe",
        messages: [
          { role: "user", content: "Imported native history" },
          { role: "assistant", content: "Imported native response" },
        ],
      },
    }),
    "session/create",
  );
  const sessionId = created.session.sessionId;
  async function raw(messages, target = { workspace, sessionId }) {
    const result = requireResult(
      await connection.request("workspace/generateText", {
        workspace: target.workspace,
        selection: { ...model, options: { reasoningLevel: "high" } },
        messages,
        tools: [],
        maxOutputTokens: 16,
        querySource: "kmh-local-history-probe",
        operationId: `synthetic-raw-${requests.length}`,
      }),
      "workspace/generateText",
    );
    assert.equal(result.text, "Synthetic local response");
    const captured = requests.at(-1);
    assert.equal(captured.url, "/v1/chat/completions");
    assert.equal(captured.sessionId, target.sessionId.replace(/^sess_/, ""));
    return captured.body.messages;
  }
  await raw([
    { role: "system", content: "Synthetic KMH system prompt" },
    { role: "user", content: "First raw input" },
  ]);
  assert.deepEqual(await raw([{ role: "user", content: "Second raw input" }]), [
    { role: "user", content: "Second raw input" },
  ]);
  const otherWorkspace = {
    workspacePath: directory,
    workspaceKey: "synthetic-kmh-conversation-b",
  };
  const other = requireResult(
    await connection.request("session/create", {
      workspace: otherWorkspace,
      titleGenerationEnabled: false,
      toolAllowlist: [],
      toolDenylist: ["*"],
      mcpServers: [],
      offPeakToolEnabled: false,
      dynamicWorkflowEnabled: false,
    }),
    "session/create",
  );
  assert.notEqual(other.session.sessionId, sessionId);
  assert.deepEqual(
    await raw([{ role: "user", content: "Independent conversation" }], {
      workspace: otherWorkspace,
      sessionId: other.session.sessionId,
    }),
    [{ role: "user", content: "Independent conversation" }],
  );
  await connection.close();
  start();
  const resumed = requireResult(
    await connection.request("session/resume", { sessionId, workspace }),
    "session/resume",
  );
  assert.equal(resumed.session.sessionId, sessionId);
  assert.equal(resumed.messages.length, 2);
  assert.deepEqual(await raw([{ role: "user", content: "Raw after resume" }]), [
    { role: "user", content: "Raw after resume" },
  ]);
  assert.equal(requests.length, 4);
  t.diagnostic(
    "Four loopback model requests preserved session attribution across restart and isolated two conversations sharing a cwd via workspaceKey. Raw inputs stayed independent; the resumed native transcript retained only its two imported messages. Real provider requests: zero.",
  );
});
