import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { createFrameBridge } from "../../packages/codex-cli/lib/src/protocol.js";
import {
  DynamicToolCallParams,
  DynamicToolCallResponse,
  TurnCompletedParams,
  AgentMessageDeltaParams,
} from "../../packages/codex-cli/lib/src/protocol.js";

/** 收集写入行的内存输出流。 */
function sink() {
  const lines = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString("utf8"));
      callback();
    },
  });
  return { stream, lines };
}

test("frame bridge strips the jsonrpc field and forwards one line per frame", async () => {
  const { stream, lines } = sink();
  const bridge = createFrameBridge(stream);
  bridge.write(
    JSON.stringify({ jsonrpc: "2.0", id: "req_1", method: "turn/start" }),
  );
  bridge.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized" }));
  await new Promise((resolve) => bridge.end(resolve));
  assert.deepEqual(lines, [
    '{"id":"req_1","method":"turn/start"}\n',
    '{"method":"initialized"}\n',
  ]);
});

test("frame bridge rejects non-JSON frames instead of writing garbage", async () => {
  const { stream, lines } = sink();
  const bridge = createFrameBridge(stream);
  const failure = new Promise((resolve) => bridge.once("error", resolve));
  bridge.write("not json");
  const error = await failure;
  assert.match(error.message, /FRAME_INVALID|JSON/);
  assert.equal(lines.length, 0);
});

test("dynamic tool call params and response round-trip the verified wire shape", () => {
  const params = DynamicToolCallParams.parse({
    threadId: "01a1119b",
    turnId: "turn-1",
    callId: "call_kmh",
    namespace: null,
    tool: "kmh_echo",
    arguments: { text: "hello" },
  });
  assert.equal(params.tool, "kmh_echo");
  assert.deepEqual(params.arguments, { text: "hello" });
  const response = DynamicToolCallResponse.parse({
    success: true,
    contentItems: [{ type: "inputText", text: "hello from KMH" }],
  });
  assert.equal(response.contentItems[0]?.text, "hello from KMH");
  assert.throws(() =>
    DynamicToolCallResponse.parse({
      success: true,
      contentItems: [{ type: "outputText", text: "bad kind" }],
    }),
  );
});

test("turn completion and stream delta notifications parse verified shapes", () => {
  const completed = TurnCompletedParams.parse({
    threadId: "01a1119b",
    turn: { id: "turn-1", status: "interrupted" },
  });
  assert.equal(completed.turn.status, "interrupted");
  const delta = AgentMessageDeltaParams.parse({
    threadId: "01a1119b",
    itemId: "item-1",
    delta: "部分正文",
  });
  assert.equal(delta.delta, "部分正文");
});

// ---- 差分游标（cursor） ----
import {
  diffIncrement,
  emptySnapshot,
  snapshotAt,
} from "../../packages/codex-cli/lib/src/cursor.js";
import {
  resolveLlmModel,
} from "../../packages/codex-cli/lib/src/models.js";
import { readFile } from "node:fs/promises";

const user = (text) => ({ role: "user", content: [{ type: "text", text }] });
const call = (id, name, args) => ({
  role: "assistant",
  content: [{ type: "tool-call", id, name, arguments: JSON.stringify(args) }],
});
const tool = (id, text, isError) => ({
  role: "tool",
  toolCallId: id,
  isError,
  content: [{ type: "text", text }],
});

test("cursor diffs fresh history into one new user input", () => {
  const history = [user("读取文件")];
  const increment = diffIncrement(history, emptySnapshot());
  assert.equal(increment.kind, "new-input");
  assert.equal(increment.text, "读取文件");
  assert.equal(increment.consumed, 1);
});

test("cursor aligns prefix and yields pending tool results", () => {
  const first = [user("帮我读 a.txt")];
  const snapshot = snapshotAt(first, 1);
  const call1 = call("call-1", "read", { path: "a.txt" });
  const second = [...first, call1, tool("call-1", "内容", false)];
  const increment = diffIncrement(second, snapshot);
  assert.equal(increment.kind, "tool-results");
  assert.equal(increment.results.length, 1);
  assert.equal(increment.results[0].callId, "call-1");
  assert.equal(increment.results[0].text, "内容");
  assert.equal(increment.results[0].isError, false);
  // 回传后推进游标，新输入再次可差分。
  const advanced = snapshotAt(second, 3);
  const third = [...second, user("继续")];
  const next = diffIncrement(third, advanced);
  assert.equal(next.kind, "new-input");
  assert.equal(next.text, "继续");
});

test("cursor reports baseline loss on edits, shrinkage and bad tails", () => {
  const first = [user("原话")];
  const snapshot = snapshotAt(first, 1);
  assert.equal(
    diffIncrement([user("改写后的历史")], snapshot).kind,
    "baseline-lost",
  );
  assert.equal(diffIncrement([], snapshot).kind, "baseline-lost");
  // 键序不同但内容等价的消息不破坏前缀。
  const reordered = [
    {
      role: "user",
      content: [{ text: "原话", type: "text" }],
    },
    user("追问"),
  ];
  const increment = diffIncrement(reordered, snapshot);
  assert.equal(increment.kind, "new-input");
  assert.equal(increment.text, "追问");
  // 工具结果前缺失 assistant 调用即断基线。
  const orphan = [...first, tool("call-9", "孤儿结果", false)];
  assert.equal(diffIncrement(orphan, snapshot).kind, "baseline-lost");
});

test("cursor rejects non-text input blocks explicitly", () => {
  const history = [
    { role: "user", content: [{ type: "image", ref: "x" }] },
  ];
  const increment = diffIncrement(history, emptySnapshot());
  assert.equal(increment.kind, "baseline-lost");
  assert.equal(increment.reason, "unsupported-input-block");
});

// ---- 模型映射（models） ----
test("model mapping carries efforts from the catalog entry", () => {
  const resolved = resolveLlmModel(
    "codex-cli",
    {
      id: "gpt-6-sol",
      displayName: "GPT-6 Sol",
      efforts: ["low", "medium", "high"],
      defaultEffort: "medium",
    },
    1000000,
  );
  assert.equal(resolved.id, "gpt-6-sol");
  assert.equal(resolved.defaultMaxTokens, 1000000);
  assert.deepEqual(
    resolved.reasoning.efforts.map((e) => e.id),
    ["low", "medium", "high"],
  );
  assert.equal(resolved.reasoning.defaultEffort, "medium");
  assert.throws(() => resolveLlmModel("codex-cli", undefined, 1), /UNKNOWN/);
});

// ---- vendored 目录结构（isolation 输入） ----
test("vendored catalog parses and keeps required prune targets", async () => {
  const catalog = JSON.parse(
    await readFile(
      new URL(
        "../../packages/codex-cli/vendor/codex/models.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  assert.ok(Array.isArray(catalog.models));
  assert.ok(catalog.models.length > 0);
  for (const model of catalog.models) {
    assert.equal(typeof model.slug, "string");
    // 裁剪目标字段在改写前都存在且非直通形态。
    assert.ok("tool_mode" in model);
    assert.ok("shell_type" in model);
  }
});

// ---- 桥接冒烟：真实 CLI + fixture 模型服务（存在官方 CLI 时执行） ----
import { startFixtureServer } from "./fixtures/codex-fixture-server.mjs";
import { mkdirSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn as spawnRaw, spawnSync } from "node:child_process";

const codexCandidates = [
  "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex",
  "codex",
];
function findCodexBinary() {
  for (const candidate of codexCandidates)
    if (candidate.includes("/")) {
      if (existsSync(candidate)) return candidate;
    } else {
      // PATH 查找交给 spawn 的 shell 语义不可靠，用 which。
      try {
        const which = spawnSync("which", [candidate], { encoding: "utf8" });
        if (which.status === 0) return which.stdout.trim();
      } catch {
        // which 不可用即跳过。
      }
    }
  return undefined;
}

test("bridge round trip through the real CLI with isolated tools", { skip: !findCodexBinary() }, async () => {
  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
  const fixture = await startFixtureServer();
  const root = mkdtempSync(join(tmpdir(), "kmh-codex-smoke-"));
  const cwd = join(root, "workspace");
  mkdirSync(cwd, { recursive: true });
  // 鸭子类型宿主：subprocess 服务用裸 child_process 实现同等语义。
  const fakeCtx = {
    subprocess: {
      resolveExecutable: async (command) => command,
      spawn: ({ argv, cwd: dir, env, stdio }) => {
        const child = spawnRaw(argv[0], argv.slice(1), {
          cwd: dir,
          env: { ...process.env, ...env },
          stdio: stdio ? ["pipe", "pipe", "pipe"] : undefined,
        });
        return {
          stdin: child.stdin,
          stdout: child.stdout,
          stderr: child.stderr,
          exitCode: child.exitCode,
          done: new Promise((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", (code) => resolve({ exitCode: code }));
          }),
          terminate: () => child.kill("SIGTERM"),
          waitForExit: (signal) =>
            new Promise((resolve) => {
              if (child.exitCode !== null) return resolve(true);
              const timer = signal
                ? setTimeout(() => resolve(false), 2000)
                : undefined;
              child.once("exit", () => {
                if (timer) clearTimeout(timer);
                resolve(true);
              });
            }),
        };
      },
    },
  };
  const config = {
    command: findCodexBinary(),
    cwd,
    dataDir: join(root, "data"),
    nativeToolsEnabled: false,
    graceMs: 1500,
    startupTimeoutMs: 30000,
    cancelReceiptTimeoutMs: 5000,
    cleanupTimeoutMs: 5000,
    env: {},
  };
  const signal = AbortSignal.timeout(120000);
  const fixtureOverrides = [
    'model="gpt-6-sol"',
    'model_provider="fixture"',
    `model_providers.fixture={name="Bridge fixture",base_url="${fixture.base}",env_key="KMH_CODEX_SMOKE_KEY",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`,
  ];
  config.env = {
    KMH_CODEX_SMOKE_KEY: "fixture-key",
    HTTP_PROXY: "",
    HTTPS_PROXY: "",
    ALL_PROXY: "",
    NO_PROXY: "127.0.0.1,localhost",
  };
  const turn = new CodexTurn(fakeCtx, config, cwd, fixtureOverrides);
  try {
    const threadId = await turn.start(
      {
        text: "Use kmh_echo",
        model: "gpt-6-sol",
        baseInstructions: "KMH owns all tools and skills.",
        tools: [
          {
            name: "kmh_echo",
            description: "Echo text through KMH",
            inputSchema: {
              type: "object",
              properties: { text: { type: "string" } },
              required: ["text"],
              additionalProperties: false,
            },
          },
        ],
      },
      undefined,
      signal,
    );
    assert.ok(threadId);
    // 第一段：工具挂起。
    const first = [];
    for await (const chunk of turn.pump(signal)) first.push(chunk);
    const toolBlocks = first.filter(
      (chunk) => chunk.type === "block-end" && chunk.block?.type === "tool-call",
    );
    assert.equal(toolBlocks.length, 1);
    assert.equal(toolBlocks[0].block.name, "kmh_echo");
    assert.ok(first.some((chunk) => chunk.type === "finish" && chunk.reason?.kind === "tool-calls"));
    const callId = turn.pendingCallIds()[0];
    assert.equal(callId, "call_kmh");
    // 第二段：回传结果续推到最终文本。
    const second = [];
    for await (const chunk of turn.resumeWithToolResult
      ? turn.resumeWithToolResult(
          { callId, text: "hello from KMH", isError: false },
          signal,
        )
      : turn.resumeWithToolResults(
          [{ callId, text: "hello from KMH", isError: false }],
          signal,
        ))
      second.push(chunk);
    const text = second
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.text)
      .join("");
    assert.equal(text, "BRIDGE_OK");
    assert.ok(second.some((chunk) => chunk.type === "finish" && chunk.reason?.kind === "stop"));
    // 隔离验证：CODEX_HOME 沿用用户默认（共享登录，已拍板），用户配置的
    // MCP 设备随之可见（已接受）；其余原生能力（shell、code mode、
    // tool_search、原生技能）必须已消灭，KMH 工具以 kmh.* 命名空间在列。
    for (const request of fixture.requests) {
      const tools = [
        ...(request.body.tools ?? []),
        ...(request.body.input ?? [])
          .filter((item) => item.type === "additional_tools")
          .flatMap((item) => item.tools ?? []),
      ].map((tool) => tool.name ?? tool.type);
      assert.ok(tools.includes("kmh_echo"), JSON.stringify(tools));
      for (const tool of tools)
        if (tool !== "kmh_echo")
          assert.match(
            tool,
            /^(list_mcp_resources|list_mcp_resource_templates|read_mcp_resource|mcp__)/,
            `unexpected non-MCP residual tool: ${tool}`,
          );
    }
    // 工具结果确实进入第二请求。
    const resultSeen = (fixture.requests[1]?.body.input ?? []).some(
      (item) => item.type === "function_call_output",
    );
    assert.ok(resultSeen);
  } finally {
    await turn.dispose();
    await fixture.close();
  }
});

// ---- 绑定持久化（session-store） ----
import { mkdtempSync as mkdtempSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join2 } from "node:path";
import { tmpdir as tmpdir2 } from "node:os";
import {
  CodexSessionStore,
  cursorToRecord,
  recordToCursor,
} from "../../packages/codex-cli/lib/src/session-store.js";

test("session store round-trips bindings and survives corruption", async () => {
  const dir = mkdtempSync2(join2(tmpdir2(), "kmh-codex-store-"));
  const store = new CodexSessionStore(dir);
  await store.put("sess-1", cursorToRecord("thread-1", { fingerprints: ["a", "b"] }, "turn-9"));
  const loaded = await store.get("sess-1");
  assert.equal(loaded.threadId, "thread-1");
  assert.deepEqual(loaded.fingerprints, ["a", "b"]);
  assert.equal(loaded.lastTurnId, "turn-9");
  const cursor = recordToCursor(loaded);
  assert.deepEqual(cursor.fingerprints, ["a", "b"]);
  assert.equal(await store.get("missing"), undefined);
  await store.delete("sess-1");
  assert.equal(await store.get("sess-1"), undefined);
  // 损坏文件：读取回落空存储，写入可恢复。
  writeFileSync2(join2(dir, "codex-bindings.json"), "{not json");
  const store2 = new CodexSessionStore(dir);
  assert.equal(await store2.get("sess-1"), undefined);
  await store2.put("sess-2", cursorToRecord("thread-2", { fingerprints: [] }));
  assert.equal((await store2.get("sess-2")).threadId, "thread-2");
});
