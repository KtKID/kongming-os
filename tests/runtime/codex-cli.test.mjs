import test from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { createFrameBridge } from "../../packages/codex-cli/lib/src/protocol.js";
import {
  DynamicToolCallParams,
  DynamicToolCallResponse,
  TurnCompletedParams,
  AgentMessageDeltaParams,
  imageProjectionOf,
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

test("image projection extracts only completed saved generations", () => {
  // wire 形态取自官方 ts-rs 生成类型 ThreadItem/ImageGenerationItem。
  const done = imageProjectionOf({
    type: "imageGeneration",
    id: "call_5a12",
    status: "completed",
    revisedPrompt: "绚丽的银河，方形构图",
    result: "success",
    failure: null,
    savedPath:
      "/Users/x/.codex/generated_images/01a1/call_5a12.png",
  });
  assert.equal(done.id, "call_5a12");
  assert.equal(done.path, "/Users/x/.codex/generated_images/01a1/call_5a12.png");
  assert.equal(done.name, "绚丽的银河，方形构图");
  // 无 revisedPrompt 时展示名缺省（不注入路径类信息）。
  const unnamed = imageProjectionOf({
    type: "imageGeneration",
    id: "call_b",
    status: "completed",
    revisedPrompt: null,
    result: "success",
    savedPath: "/tmp/b.png",
  });
  assert.equal(unnamed.name, undefined);
  // 未完成、未落盘、非生图项均不投影。
  assert.equal(
    imageProjectionOf({ type: "imageGeneration", id: "c", status: "failed", result: "" }),
    undefined,
  );
  assert.equal(
    imageProjectionOf({ type: "imageGeneration", id: "c", status: "completed", result: "success" }),
    undefined,
  );
  assert.equal(imageProjectionOf({ type: "agentMessage", id: "m", text: "hi" }), undefined);
});

// ---- 差分游标（cursor） ----
import {
  blockDigest,
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
  const callBlock = {
    type: "tool-call",
    id: "call-1",
    name: "read",
    arguments: JSON.stringify({ path: "a.txt" }),
  };
  // 工具调用块已在本 turn 流中投递：待核对队列须含其摘要。
  const snapshot = snapshotAt(first, 1, [blockDigest(callBlock)]);
  const call1 = call("call-1", "read", { path: "a.txt" });
  const second = [...first, call1, tool("call-1", "内容", false)];
  const increment = diffIncrement(second, snapshot);
  assert.equal(increment.kind, "tool-results");
  assert.equal(increment.results.length, 1);
  assert.equal(increment.results[0].callId, "call-1");
  assert.equal(increment.results[0].text, "内容");
  assert.equal(increment.results[0].isError, false);
  // 已被指纹覆盖的调用消息同时出队，回传后推进游标，新输入再次可差分。
  assert.deepEqual(increment.delivered, []);
  const advanced = snapshotAt(second, 3, increment.delivered);
  const third = [...second, user("继续")];
  const next = diffIncrement(third, advanced);
  assert.equal(next.kind, "new-input");
  assert.equal(next.text, "继续");
});

test("cursor swallows codex-owned replies and context injections at turn boundary", () => {
  const reply = blockDigest({ type: "text", text: "Codex 的回答" });
  const base = [user("第一轮的问题")];
  const snapshot = snapshotAt(base, 1, [reply]);
  const ctxUser = (kind) => ({
    role: "user",
    source: { kind },
    content: [{ type: "text", text: "运行时上下文快照" }],
  });
  const assistant = (t) => ({
    role: "assistant",
    content: [{ type: "text", text: t }],
  });
  const system = () => ({
    role: "system",
    content: [{ type: "text", text: "系统提示" }],
  });
  // Codex 自产回复（摘要核对通过）+ system/ctx 注入透明 + 恰一条真实输入。
  const next = [
    ...base,
    assistant("Codex 的回答"),
    system(),
    ctxUser("runtime-context"),
    user("第二轮的问题"),
  ];
  const increment = diffIncrement(next, snapshot);
  assert.equal(increment.kind, "new-input");
  assert.equal(increment.text, "第二轮的问题");
  assert.deepEqual(increment.delivered, []);
  // 外来/被改写回复（摘要不命中）：断基线走重建，保证模型切换等场景历史完整。
  const foreign = [...base, assistant("另一个模型的回答"), user("第二轮的问题")];
  assert.equal(diffIncrement(foreign, snapshot).kind, "baseline-lost");
  // 连续两条真实用户消息：一次只能投一条，断基线。
  const doubled = [...base, user("第一条"), user("第二条")];
  assert.equal(diffIncrement(doubled, snapshot).kind, "baseline-lost");
  // 空块（空推理/空文本）不参与核对，两侧组装差异不影响判定。
  const withEmpty = [
    ...base,
    { role: "assistant", content: [{ type: "reasoning", text: "" }, { type: "text", text: "Codex 的回答" }] },
    user("第二轮的问题"),
  ];
  assert.equal(diffIncrement(withEmpty, snapshot).kind, "new-input");
});

test("cursor rejects non-text input blocks explicitly", () => {
  const history = [
    { role: "user", content: [{ type: "image", ref: "x" }] },
  ];
  const increment = diffIncrement(history, emptySnapshot());
  assert.equal(increment.kind, "baseline-lost");
  assert.equal(increment.reason, "unsupported-input-block");
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

// ---- 并行工具挂起与状态丢失恢复（真实 CLI + fixture） ----
// 共享的桥接测试脚手架：与上方冒烟测试同构，供并行场景复用。
// hooks.wrapStdout 可包一层注入流（模拟 Codex 侧通知）。
function makeBridgeHarness(fixture, script, hooks = {}) {
  const root = mkdtempSync(join(tmpdir(), `kmh-codex-${script}-`));
  const cwd = join(root, "workspace");
  mkdirSync(cwd, { recursive: true });
  const fakeCtx = {
    subprocess: {
      resolveExecutable: async (command) => command,
      spawn: ({ argv, cwd: dir, env, stdio }) => {
        const child = spawnRaw(argv[0], argv.slice(1), {
          cwd: dir,
          env: { ...process.env, ...env },
          stdio: stdio ? ["pipe", "pipe", "pipe"] : undefined,
        });
        const stdout =
          hooks.wrapStdout === undefined
            ? child.stdout
            : hooks.wrapStdout(child.stdout);
        return {
          stdin: child.stdin,
          stdout,
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
    env: {
      KMH_CODEX_SMOKE_KEY: "fixture-key",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "127.0.0.1,localhost",
    },
  };
  const fixtureOverrides = [
    'model="gpt-6-sol"',
    'model_provider="fixture"',
    `model_providers.fixture={name="Bridge fixture",base_url="${fixture.base}",env_key="KMH_CODEX_SMOKE_KEY",wire_api="responses",requires_openai_auth=false,supports_websockets=false}`,
  ];
  return { fakeCtx, config, cwd, fixtureOverrides };
}

const parallelToolCatalog = [
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
  {
    name: "kmh_glob",
    description: "Glob files through KMH",
    inputSchema: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
      additionalProperties: false,
    },
  },
];

/**
 * adapter 级测试的鸭子类型 runtime：复刻真实 withSession 的串行与
 * restoreCursor 语义（含差分游标与待核对摘要队列），turn 由测试显式替换。
 */
function makeAdapterHarness(parts) {
  const binding = {
    threadId: undefined,
    fingerprints: [],
    delivered: [],
    lastTurnId: undefined,
  };
  let turn = new parts.CodexTurn(
    parts.fakeCtx,
    parts.config,
    parts.cwd,
    parts.fixtureOverrides,
  );
  const replaceTurn = async () => {
    await turn.dispose();
    turn = new parts.CodexTurn(
      parts.fakeCtx,
      parts.config,
      parts.cwd,
      parts.fixtureOverrides,
    );
    return turn;
  };
  const runtime = {
    settings: { nativeToolsEnabled: false },
    resolveCwd: () => parts.cwd,
    bindingRecord: async () =>
      binding.threadId === undefined ? undefined : { ...binding },
    recordBinding: async (_key, t) => {
      if (t.threadId === undefined) return;
      binding.threadId = t.threadId;
      binding.fingerprints = [...t.cursor.fingerprints];
      binding.delivered = [...(t.cursor.delivered ?? [])];
      binding.lastTurnId = t.lastCompletedTurnId;
    },
    releaseSession: () => {},
    withSession: async function* (_sessionKey, _cwd, run) {
      turn.cursor = {
        fingerprints: [...binding.fingerprints],
        delivered: [...binding.delivered],
      };
      turn.pendingDigests = [...binding.delivered];
      turn.lastCompletedTurnId = binding.lastTurnId;
      yield* run(turn);
    },
  };
  return { binding, runtime, replaceTurn, getTurn: () => turn };
}

/** adapter 流收集：返回全部 chunk 与终局 reason kind 列表。 */
async function collectStream(adapter, options) {
  const chunks = [];
  for await (const chunk of adapter.stream(options)) chunks.push(chunk);
  return {
    chunks,
    finishes: chunks
      .filter((chunk) => chunk.type === "finish")
      .map((chunk) => chunk.reason?.kind),
    text: chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.text)
      .join(""),
  };
}
/** fixture 请求 input 数组的 JSON 文本（增量断言用）。 */
function fixtureInputText(fixture, index = -1) {
  const request = fixture.requests.at(index);
  return JSON.stringify(request?.body.input ?? []);
}

test("parallel tool calls suspend one at a time and resume to final text", { skip: !findCodexBinary() }, async () => {
  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
  const fixture = await startFixtureServer({ script: "parallel" });
  const { fakeCtx, config, cwd, fixtureOverrides } = makeBridgeHarness(fixture, "parallel");
  const signal = AbortSignal.timeout(120000);
  const turn = new CodexTurn(fakeCtx, config, cwd, fixtureOverrides);
  try {
    await turn.start(
      {
        text: "Use both tools",
        model: "gpt-6-sol",
        baseInstructions: "KMH owns all tools and skills.",
        tools: parallelToolCatalog,
      },
      undefined,
      signal,
    );
    // 第一段：只交付第一个工具（echo），glob 保持挂起。
    const first = [];
    for await (const chunk of turn.pump(signal)) first.push(chunk);
    const firstTools = first.filter(
      (chunk) => chunk.type === "block-end" && chunk.block?.type === "tool-call",
    );
    assert.equal(firstTools.length, 1);
    assert.equal(firstTools[0].block.name, "kmh_echo");
    assert.ok(first.some((chunk) => chunk.type === "finish" && chunk.reason?.kind === "tool-calls"));
    // codex 串行发送动态工具执行请求：第二个 item/tool/call 要等第一个
    // 回执后才发出（实测验证），因此此处只挂起第一个工具。
    assert.deepEqual(turn.pendingCallIds(), ["call_kmh"]);
    // 第二段：回传第一个结果，续推应交付第二个工具（glob）。
    const second = [];
    for await (const chunk of turn.resumeWithToolResults(
      [{ callId: "call_kmh", text: "hello from KMH", isError: false }],
      signal,
    ))
      second.push(chunk);
    const secondTools = second.filter(
      (chunk) => chunk.type === "block-end" && chunk.block?.type === "tool-call",
    );
    assert.equal(secondTools.length, 1);
    assert.equal(secondTools[0].block.name, "kmh_glob");
    assert.ok(second.some((chunk) => chunk.type === "finish" && chunk.reason?.kind === "tool-calls"));
    // 第三段：回传第二个结果，续推到最终文本。
    const third = [];
    for await (const chunk of turn.resumeWithToolResults(
      [{ callId: "call_glob", text: "sun.png", isError: false }],
      signal,
    ))
      third.push(chunk);
    const text = third
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.text)
      .join("");
    assert.equal(text, "BRIDGE_OK");
    assert.ok(third.some((chunk) => chunk.type === "finish" && chunk.reason?.kind === "stop"));
  } finally {
    await turn.dispose();
    await fixture.close();
  }
});

test("adapter recovers from lost pending tools by rebuilding the thread", { skip: !findCodexBinary() }, async () => {
  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
  const { CodexAdapter } = await import("../../packages/codex-cli/lib/src/adapter.js");
  const fixture = await startFixtureServer({ script: "parallel" });
  const { fakeCtx, config, cwd, fixtureOverrides } = makeBridgeHarness(fixture, "recovery");
  const signal = AbortSignal.timeout(180000);
  const { runtime, replaceTurn, getTurn } = makeAdapterHarness({
    CodexTurn,
    fakeCtx,
    config,
    cwd,
    fixtureOverrides,
  });
  const adapter = new CodexAdapter(runtime);
  const base = {
    provider: "codex-cli",
    model: "gpt-6-sol",
    sessionId: "kmh-codex-recovery",
    system: "KMH owns all tools and skills.",
    tools: parallelToolCatalog.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    })),
    signal,
  };
  const history = [user("Use both tools")];
  try {
    // 第一段：新输入 → 第一个工具挂起，游标与绑定落盘。
    const first = await collectStream(adapter, { ...base, messages: [...history] });
    assert.ok(first.finishes.includes("tool-calls"));
    // KMH 侧执行第一个工具后历史推进。
    history.push(call("call_kmh", "kmh_echo", { text: "hello" }));
    history.push(tool("call_kmh", "hello from KMH", false));
    // 生产事故模拟：会话状态重建丢弃带挂起工具的 turn（stateOf 替换），
    // 新 turn 从绑定恢复游标，挂起表为空——结果回传必须走恢复路径而非报错。
    await replaceTurn();
    const second = await collectStream(adapter, { ...base, messages: [...history] });
    assert.equal(second.text, "BRIDGE_OK");
    assert.ok(second.finishes.includes("stop"));
  } finally {
    await getTurn().dispose();
    await fixture.close();
  }
});

// ---- 多轮/压缩/编辑重发基线 smoke（T3/T5/T6/T10/T11） ----
const assistantText = (t) => ({ role: "assistant", content: [{ type: "text", text: t }] });
const contextUser = (t) => ({
  role: "user",
  source: { kind: "runtime-context" },
  content: [{ type: "text", text: t }],
});
const echoToolSpec = [
  {
    name: "kmh_echo",
    description: "Echo text through KMH",
    parameters: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    },
  },
];

test("multi turn sessions continue across restarts with linear history delivery", { skip: !findCodexBinary() }, async () => {
  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
  const { CodexAdapter } = await import("../../packages/codex-cli/lib/src/adapter.js");
  const fixture = await startFixtureServer({});
  const { fakeCtx, config, cwd, fixtureOverrides } = makeBridgeHarness(fixture, "multiturn");
  const signal = AbortSignal.timeout(180000);
  const { runtime, replaceTurn, getTurn, binding } = makeAdapterHarness({
    CodexTurn,
    fakeCtx,
    config,
    cwd,
    fixtureOverrides,
  });
  const adapter = new CodexAdapter(runtime);
  const base = {
    provider: "codex-cli",
    model: "gpt-6-sol",
    sessionId: "kmh-codex-multiturn",
    system: "KMH owns all tools and skills.",
    tools: echoToolSpec,
    signal,
  };
  const history = [user("第一轮的问题")];
  try {
    // 第一轮：新输入（含 system 前缀形态）→ 工具挂起 → 结果回传 → 完成。
    const s1 = await collectStream(adapter, { ...base, messages: [...history] });
    assert.ok(s1.finishes.includes("tool-calls"));
    // 首轮即原文投递：不含重建标记。
    assert.equal(fixtureInputText(fixture).includes("对话记录重建"), false);
    history.push(call("call_kmh", "kmh_echo", { text: "hello" }));
    history.push(tool("call_kmh", "hello from KMH", false));
    const s2 = await collectStream(adapter, { ...base, messages: [...history] });
    assert.equal(s2.text, "BRIDGE_OK");
    assert.ok(s2.finishes.includes("stop"));
    history.push(assistantText("BRIDGE_OK"));
    // 进程重启（turn 对象重建）+ 第二轮：含新 context 注入与上轮回复。
    await replaceTurn();
    history.push(contextUser("运行时上下文快照"));
    history.push(user("第二轮的问题"));
    const s3 = await collectStream(adapter, { ...base, messages: [...history] });
    assert.equal(s3.text, "BRIDGE_OK");
    assert.ok(s3.finishes.includes("stop"));
    // token 线性（增量投递）等价断言：原文投递、无重建、历史单份。
    const inputText = fixtureInputText(fixture);
    assert.equal(inputText.includes("以下是本会话此前的对话记录重建"), false);
    assert.equal(inputText.split("第一轮的问题").length - 1, 1);
    assert.equal(inputText.split("BRIDGE_OK").length - 1, 1);
    assert.ok(inputText.includes("第二轮的问题"));
    assert.ok(binding.threadId !== undefined);
  } finally {
    await getTurn().dispose();
    await fixture.close();
  }
});

test("codex native compaction notification keeps bridge and diff stable", { skip: !findCodexBinary() }, async () => {
  const { PassThrough } = await import("node:stream");
  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
  const { CodexAdapter } = await import("../../packages/codex-cli/lib/src/adapter.js");
  const fixture = await startFixtureServer({});
  let inject;
  const { fakeCtx, config, cwd, fixtureOverrides } = makeBridgeHarness(fixture, "compact", {
    wrapStdout: (stdout) => {
      const pass = new PassThrough();
      stdout.pipe(pass);
      inject = pass;
      return pass;
    },
  });
  const signal = AbortSignal.timeout(180000);
  const { runtime, replaceTurn, getTurn, binding } = makeAdapterHarness({
    CodexTurn,
    fakeCtx,
    config,
    cwd,
    fixtureOverrides,
  });
  const adapter = new CodexAdapter(runtime);
  const base = {
    provider: "codex-cli",
    model: "gpt-6-sol",
    sessionId: "kmh-codex-compaction",
    system: "KMH owns all tools and skills.",
    tools: echoToolSpec,
    signal,
  };
  const history = [user("第一轮的问题")];
  try {
    const s1 = await collectStream(adapter, { ...base, messages: [...history] });
    assert.ok(s1.finishes.includes("tool-calls"));
    // Codex 原生压缩通知（终拍板：KMH 基线不受影响）：桥必须不崩、后续差分不变。
    inject.write(
      JSON.stringify({ method: "thread/compacted", params: { threadId: binding.threadId } }) + "\n",
    );
    history.push(call("call_kmh", "kmh_echo", { text: "hello" }));
    history.push(tool("call_kmh", "hello from KMH", false));
    const s2 = await collectStream(adapter, { ...base, messages: [...history] });
    assert.equal(s2.text, "BRIDGE_OK");
    assert.ok(s2.finishes.includes("stop"));
    history.push(assistantText("BRIDGE_OK"));
    await replaceTurn();
    history.push(user("压缩后的下一轮"));
    const s3 = await collectStream(adapter, { ...base, messages: [...history] });
    assert.equal(s3.text, "BRIDGE_OK");
    const inputText = fixtureInputText(fixture);
    assert.equal(inputText.includes("对话记录重建"), false);
    assert.equal(inputText.split("第一轮的问题").length - 1, 1);
  } finally {
    await getTurn().dispose();
    await fixture.close();
  }
});

test("editing history rebuilds the binding and continues linearly", { skip: !findCodexBinary() }, async () => {
  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
  const { CodexAdapter } = await import("../../packages/codex-cli/lib/src/adapter.js");
  const fixture = await startFixtureServer({});
  const { fakeCtx, config, cwd, fixtureOverrides } = makeBridgeHarness(fixture, "edit-resend");
  const signal = AbortSignal.timeout(180000);
  const { runtime, replaceTurn, getTurn, binding } = makeAdapterHarness({
    CodexTurn,
    fakeCtx,
    config,
    cwd,
    fixtureOverrides,
  });
  const adapter = new CodexAdapter(runtime);
  const base = {
    provider: "codex-cli",
    model: "gpt-6-sol",
    sessionId: "kmh-codex-edit",
    system: "KMH owns all tools and skills.",
    tools: echoToolSpec,
    signal,
  };
  const history = [user("原始问题")];
  try {
    // 第一轮完成，建立基线绑定。
    const s1 = await collectStream(adapter, { ...base, messages: [...history] });
    assert.ok(s1.finishes.includes("tool-calls"));
    history.push(call("call_kmh", "kmh_echo", { text: "hello" }));
    history.push(tool("call_kmh", "hello from KMH", false));
    const s2 = await collectStream(adapter, { ...base, messages: [...history] });
    assert.ok(s2.finishes.includes("stop"));
    const firstThread = binding.threadId;
    assert.ok(firstThread !== undefined);
    // 编辑重发：改写用户消息，基线失效 → fork 或新建 thread 并注入重建历史。
    const edited = [user("改写后的问题")];
    await replaceTurn();
    const s3 = await collectStream(adapter, { ...base, messages: [...edited] });
    assert.ok(s3.finishes.includes("stop"));
    const rebuildText = fixtureInputText(fixture);
    assert.ok(rebuildText.includes("以下是本会话此前的对话记录重建"));
    assert.ok(rebuildText.includes("改写后的问题"));
    assert.notEqual(binding.threadId, firstThread);
    // 重建后的新基线上，下一轮恢复增量投递。
    edited.push(assistantText("BRIDGE_OK"), user("重建后的下一轮"));
    await replaceTurn();
    const s4 = await collectStream(adapter, { ...base, messages: [...edited] });
    assert.equal(s4.text, "BRIDGE_OK");
    const linearText = fixtureInputText(fixture);
    // 恢复的是重建线程：历史合法含一次重建文本；断言无新增重建且原文投递。
    assert.equal(linearText.split("以下是本会话此前的对话记录重建").length - 1, 1);
    assert.equal(linearText.split("改写后的问题").length - 1, 1);
    assert.ok(linearText.includes("重建后的下一轮"));
  } finally {
    await getTurn().dispose();
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
  await store.put(
    "sess-1",
    cursorToRecord(
      "thread-1",
      { fingerprints: ["a", "b"], delivered: ["t:1"] },
      "turn-9",
    ),
  );
  const loaded = await store.get("sess-1");
  assert.equal(loaded.threadId, "thread-1");
  assert.deepEqual(loaded.fingerprints, ["a", "b"]);
  assert.equal(loaded.lastTurnId, "turn-9");
  assert.deepEqual(loaded.delivered, ["t:1"]);
  const cursor = recordToCursor(loaded);
  assert.deepEqual(cursor.fingerprints, ["a", "b"]);
  assert.deepEqual(cursor.delivered, ["t:1"]);
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
