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

// ---- 生图产物验收（feat10，R3 从简） ----
import {
  pngSizeOf,
  imageSizeRequirementOf,
  imageSizeNote,
  imageFailureNote,
} from "../../packages/codex-cli/lib/src/image-delivery.js";

/** 构造只含签名与 IHDR 的最小 PNG 头（宽高为真实字段）。 */
function pngHeaderOf(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  buf.write("IHDR", 12, "ascii");
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test("png size reads IHDR width and height, rejecting non-PNG bytes", () => {
  // 银河会话实测产物为 1254×1254。
  assert.deepEqual(pngSizeOf(pngHeaderOf(1254, 1254)), { width: 1254, height: 1254 });
  assert.deepEqual(pngSizeOf(pngHeaderOf(256, 256)), { width: 256, height: 256 });
  assert.equal(pngSizeOf(Buffer.alloc(24)), undefined);
  assert.equal(pngSizeOf(pngHeaderOf(1254, 1254).subarray(0, 20)), undefined);
});

test("explicit size requirement needs a two-digit width x height pair", () => {
  assert.deepEqual(imageSizeRequirementOf("帮我生成 256×256 的图标"), { width: 256, height: 256 });
  assert.deepEqual(imageSizeRequirementOf("图片尺寸 1024x768"), { width: 1024, height: 768 });
  assert.deepEqual(imageSizeRequirementOf("像素 800 * 600"), { width: 800, height: 600 });
  // 单数字对（棋盘、行列类）与无数字对文本不构成要求。
  assert.equal(imageSizeRequirementOf("画一个 4x4 的棋盘"), undefined);
  assert.equal(imageSizeRequirementOf("生成一张银河图片"), undefined);
});

test("size note reports actual pixels and states mismatch honestly", () => {
  const note = imageSizeNote({ width: 1254, height: 1254 }, { width: 256, height: 256 });
  assert.match(note, /1254×1254/);
  assert.match(note, /256×256/);
  assert.match(note, /不符/);
  // 无要求或要求满足时只报实际尺寸。
  assert.equal(imageSizeNote({ width: 256, height: 256 }, undefined), "图片实际尺寸 256×256 像素。");
  assert.equal(
    imageSizeNote({ width: 256, height: 256 }, { width: 256, height: 256 }),
    "图片实际尺寸 256×256 像素。",
  );
  // 实际尺寸不可读时如实占位。
  assert.match(imageSizeNote(undefined, { width: 256, height: 256 }), /未知/);
});

test("failure note keeps both states and the original artifact path", () => {
  const note = imageFailureNote("/Users/x/.codex/generated_images/a/b.png", "CODEX_IMAGE_REF_MISSING");
  assert.match(note, /已由 Codex 生成/);
  assert.match(note, /接入失败/);
  assert.match(note, /\/Users\/x\/\.codex\/generated_images\/a\/b\.png/);
});

// ---- 工具声明映射（D13：kmh- 前缀、目录指纹与回执解析） ----
import {
  buildToolRegistry,
  resolveKmhToolName,
  toolFingerprintOf,
} from "../../packages/codex-cli/lib/src/tool-registry.js";

test("tool registry prefixes declarations and validates names", () => {
  const registry = buildToolRegistry(parallelToolCatalog);
  assert.equal(registry.kmhToDeclared.get("kmh_echo"), "kmh-kmh_echo");
  assert.equal(registry.declaredToKmh.get("kmh-kmh_echo"), "kmh_echo");
  // 前缀后名称超出官方接受范围：明确报错。
  assert.throws(
    () => buildToolRegistry([{ name: "bad/name", description: "", inputSchema: {} }]),
    /CODEX_TOOL_NAME_INVALID/,
  );
  // 声明名碰撞（同名工具重复出现）：明确报错。
  assert.throws(
    () =>
      buildToolRegistry([
        { name: "dup", description: "", inputSchema: {} },
        { name: "dup", description: "again", inputSchema: {} },
      ]),
    /CODEX_TOOL_NAME_COLLISION/,
  );
});

test("resolveKmhToolName maps declared names and falls back to bare legacy names", () => {
  const registry = buildToolRegistry(parallelToolCatalog);
  // 声明名精确命中。
  assert.equal(resolveKmhToolName(registry, "kmh-kmh_echo"), "kmh_echo");
  // 旧 thread 裸名兼容（以当前工具表为界）。
  assert.equal(resolveKmhToolName(registry, "kmh_echo"), "kmh_echo");
  // 未知名：undefined（上层回明确错误回执）。
  assert.equal(resolveKmhToolName(registry, "kmh-gone"), undefined);
  assert.equal(resolveKmhToolName(registry, "other"), undefined);
  // 临时会话（无声明表）：一律未知。
  assert.equal(resolveKmhToolName(undefined, "kmh-kmh_echo"), undefined);
});

test("tool fingerprint changes with catalog, description or order-stable", () => {
  const echo = [{ name: "kmh_echo", description: "Echo", inputSchema: {} }];
  const echoGlob = [...echo, { name: "kmh_glob", description: "Glob", inputSchema: {} }];
  const echoRetitled = [{ name: "kmh_echo", description: "Echo v2", inputSchema: {} }];
  // 目录增删与描述变化都会改变指纹（展示方式变化 → 重建，feat03 场景9）。
  assert.notEqual(toolFingerprintOf(echo), toolFingerprintOf(echoGlob));
  assert.notEqual(toolFingerprintOf(echo), toolFingerprintOf(echoRetitled));
  // 顺序无关：同一目录不同顺序指纹一致。
  assert.equal(toolFingerprintOf(echoGlob), toolFingerprintOf([...echoGlob].reverse()));
});

// ---- 原生能力逐项选择（feat02 修订版：允许清单、迁移与可用性） ----
import {
  DEFAULT_SELECTION,
  FULL_SELECTION,
  capabilityViews,
  selectionFromLegacy,
  selectionOf,
} from "../../packages/codex-cli/lib/src/capabilities.js";
import {
  featureOffFor,
  prunedFieldsFor,
} from "../../packages/codex-cli/lib/src/isolation.js";

test("selection model validates fields and migrates the legacy switch", () => {
  // 合法选择原样保留；缺失/非法字段回落默认；垃圾输入整体回落。
  assert.deepEqual(selectionOf({ ...FULL_SELECTION }), FULL_SELECTION);
  assert.deepEqual(selectionOf({ commandExecution: true }), {
    ...DEFAULT_SELECTION,
    commandExecution: true,
  });
  assert.deepEqual(selectionOf("junk"), DEFAULT_SELECTION);
  assert.deepEqual(selectionOf(null), DEFAULT_SELECTION);
  // 旧总开关迁移：false → 全关（保留 KMH 与图片生成使用方式），true → 全开。
  assert.deepEqual(selectionFromLegacy(false), DEFAULT_SELECTION);
  assert.deepEqual(selectionFromLegacy(true), FULL_SELECTION);
});

test("capability views mark availability from the version check", () => {
  const ok = capabilityViews({ version: "0.162.0", ok: true });
  assert.equal(ok.length, 5);
  assert.ok(ok.every((item) => item.available && item.reason === undefined));
  const missing = capabilityViews({ version: undefined, ok: false, reason: "CODEX_CLI_MISSING" });
  assert.ok(missing.every((item) => !item.available && item.reason === "CODEX_CLI_MISSING"));
  assert.deepEqual(
    missing.map((item) => item.id),
    ["commandExecution", "fileChange", "viewImage", "webSearch", "skills"],
  );
});

test("allowlist isolation prunes only unselected native capabilities", () => {
  // 默认全关：四项工具与技能的裁剪都在，基础隔离字段也在。
  const off = prunedFieldsFor(DEFAULT_SELECTION);
  assert.equal(off.shell_type, "disabled");
  assert.equal(off.apply_patch_tool_type, null);
  assert.equal(off.supports_search_tool, false);
  assert.equal(off.include_skills_usage_instructions, false);
  assert.ok(featureOffFor(DEFAULT_SELECTION).includes("shell_tool"));
  assert.ok(featureOffFor(DEFAULT_SELECTION).includes("view_image"));
  // 全开：逐项字段与功能关闭消失，但基础隔离保留（多 agent 等始终关闭）。
  const on = prunedFieldsFor(FULL_SELECTION);
  assert.equal("shell_type" in on, false);
  assert.equal("apply_patch_tool_type" in on, false);
  assert.equal("supports_search_tool" in on, false);
  assert.equal("include_skills_usage_instructions" in on, false);
  const features = featureOffFor(FULL_SELECTION);
  assert.ok(!features.includes("shell_tool"));
  assert.ok(!features.includes("view_image"));
  assert.ok(features.includes("multi_agent"));
  assert.ok(features.includes("code_mode"));
  // 单项开放：只放开该项（关一项裁一项）。
  const partial = prunedFieldsFor({ ...DEFAULT_SELECTION, webSearch: true });
  assert.equal("supports_search_tool" in partial, false);
  assert.equal(partial.shell_type, "disabled");
  assert.ok(!featureOffFor({ ...DEFAULT_SELECTION, viewImage: true }).includes("view_image"));
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
    // tool_search、原生技能）必须已消灭，KMH 工具以 kmh- 前缀声明在列（D13）。
    for (const request of fixture.requests) {
      const tools = [
        ...(request.body.tools ?? []),
        ...(request.body.input ?? [])
          .filter((item) => item.type === "additional_tools")
          .flatMap((item) => item.tools ?? []),
      ].map((tool) => tool.name ?? tool.type);
      assert.ok(tools.includes("kmh-kmh_echo"), JSON.stringify(tools));
      for (const tool of tools)
        if (tool !== "kmh-kmh_echo")
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
  /** 每次拉起 CLI 的完整 argv（允许清单断言用）。 */
  const spawnArgv = [];
  const fakeCtx = {
    subprocess: {
      resolveExecutable: async (command) => command,
      spawn: ({ argv, cwd: dir, env, stdio }) => {
        spawnArgv.push([...argv]);
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
  return { fakeCtx, config, cwd, fixtureOverrides, spawnArgv };
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
    toolFingerprint: undefined,
    toolMap: undefined,
    toolsVersion: undefined,
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
    settings: { selection: selectionFromLegacy(false) },
    resolveCwd: () => parts.cwd,
    bindingRecord: async () =>
      binding.threadId === undefined ? undefined : { ...binding },
    recordBinding: async (_key, t) => {
      if (t.threadId === undefined) return;
      binding.threadId = t.threadId;
      binding.fingerprints = [...t.cursor.fingerprints];
      binding.delivered = [...(t.cursor.delivered ?? [])];
      binding.lastTurnId = t.lastCompletedTurnId;
      // 与真实 recordBinding 一致：声明字段随 turn.toolRegistry 落盘，
      // 目录指纹变化递增版本（feat03 场景9 的 adapter 判据）。
      const registry = t.toolRegistry;
      if (registry !== undefined) {
        const sameFingerprint = binding.toolFingerprint === registry.fingerprint;
        binding.toolFingerprint = registry.fingerprint;
        binding.toolMap = Object.fromEntries(registry.declaredToKmh);
        binding.toolsVersion = sameFingerprint
          ? binding.toolsVersion ?? 1
          : (binding.toolsVersion ?? 0) + 1;
      }
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

const globToolSpec = [
  ...echoToolSpec,
  {
    name: "kmh_glob",
    description: "Glob files through KMH",
    parameters: {
      type: "object",
      properties: { pattern: { type: "string" } },
      required: ["pattern"],
    },
  },
];

test("tool catalog change redeclares tools on a fresh thread with rebuilt history", { skip: !findCodexBinary() }, async () => {
  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
  const { CodexAdapter } = await import("../../packages/codex-cli/lib/src/adapter.js");
  const fixture = await startFixtureServer({});
  const { fakeCtx, config, cwd, fixtureOverrides } = makeBridgeHarness(fixture, "catalog");
  const signal = AbortSignal.timeout(240000);
  const { runtime, getTurn, binding } = makeAdapterHarness({
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
    sessionId: "kmh-codex-catalog",
    system: "KMH owns all tools and skills.",
    signal,
  };
  const history = [user("第一轮的问题")];
  try {
    // 第一轮：单工具目录 → 工具挂起 → 回传 → 完成；绑定记录目录指纹 v1。
    const s1 = await collectStream(adapter, { ...base, tools: echoToolSpec, messages: [...history] });
    assert.ok(s1.finishes.includes("tool-calls"));
    history.push(call("call_kmh", "kmh_echo", { text: "hello" }));
    history.push(tool("call_kmh", "hello from KMH", false));
    const s2 = await collectStream(adapter, { ...base, tools: echoToolSpec, messages: [...history] });
    assert.equal(s2.text, "BRIDGE_OK");
    assert.ok(s2.finishes.includes("stop"));
    history.push(assistantText("BRIDGE_OK"));
    const threadBefore = binding.threadId;
    assert.equal(binding.toolsVersion, 1);
    // 第二轮：目录新增 glob → 指纹不符 → 跳过 resume/fork（两者继承旧工具集），
    // 新建 thread 重新声明工具并注入重建历史。
    history.push(user("第二轮的问题"));
    const s3 = await collectStream(adapter, { ...base, tools: globToolSpec, messages: [...history] });
    assert.equal(s3.text, "BRIDGE_OK");
    assert.ok(s3.finishes.includes("stop"));
    assert.notEqual(binding.threadId, threadBefore);
    assert.equal(binding.toolsVersion, 2);
    assert.equal(binding.toolMap["kmh-kmh_glob"], "kmh_glob");
    assert.ok(fixtureInputText(fixture).includes("对话记录重建"));
    assert.ok(
      JSON.stringify(fixture.requests.at(-1)?.body.tools ?? []).includes("kmh-kmh_glob"),
    );
    // 第三轮：目录不变 → 指纹一致 → 正常 resume：thread 不再更换、版本
    // 不再递增、新输入以原文（而非重建序列化）投递。
    const threadAfterRebuild = binding.threadId;
    history.push(assistantText("BRIDGE_OK"));
    history.push(user("第三轮的问题"));
    const s4 = await collectStream(adapter, { ...base, tools: globToolSpec, messages: [...history] });
    assert.equal(s4.text, "BRIDGE_OK");
    assert.ok(s4.finishes.includes("stop"));
    assert.equal(binding.threadId, threadAfterRebuild);
    assert.equal(binding.toolsVersion, 2);
    const lastInput = fixtureInputText(fixture);
    assert.ok(lastInput.includes("第三轮的问题"));
    assert.ok(!lastInput.includes("用户：第三轮的问题"));
  } finally {
    await getTurn().dispose();
    await fixture.close();
  }
});

test("allowlist selection opens native capabilities in the spawned process", { skip: !findCodexBinary() }, async () => {
  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
  const fixture = await startFixtureServer({});
  const { fakeCtx, config, cwd, fixtureOverrides, spawnArgv } =
    makeBridgeHarness(fixture, "allowlist");
  const signal = AbortSignal.timeout(120000);
  const spawnOnce = async (selection) => {
    const turn = new CodexTurn(fakeCtx, config, cwd, fixtureOverrides);
    try {
      // 只需拉起进程核对 -c 允许清单参数，流不消费（dispose 即回收）。
      await turn.start(
        {
          text: "hello",
          model: "gpt-6-sol",
          baseInstructions: "KMH owns all tools and skills.",
          tools: echoToolSpec.map((entry) => ({
            name: entry.name,
            description: entry.description,
            inputSchema: entry.parameters,
          })),
          selection,
        },
        undefined,
        signal,
      );
    } finally {
      await turn.dispose();
    }
    // 每次回合先发现技能/钩子再拉正式进程：取最后一个即本回合主进程。
    return spawnArgv.at(-1).join("\n");
  };
  try {
    // 默认全关：逐项关闭与 web_search 禁用都在（等价旧开关 false 语义）。
    const offArgs = await spawnOnce(selectionFromLegacy(false));
    assert.ok(offArgs.includes("features.shell_tool=false"));
    assert.ok(offArgs.includes("features.view_image=false"));
    assert.ok(offArgs.includes('web_search="disabled"'));
    assert.ok(offArgs.includes("skills.bundled.enabled=false"));
    // 全开（旧开关 true 迁移）：逐项关闭消失，基础隔离保留（feat02 场景1/7）。
    const onArgs = await spawnOnce(selectionFromLegacy(true));
    assert.ok(!onArgs.includes("features.shell_tool=false"));
    assert.ok(!onArgs.includes("features.view_image=false"));
    assert.ok(!onArgs.includes('web_search="disabled"'));
    assert.ok(!onArgs.includes("skills.bundled.enabled=false"));
    assert.ok(onArgs.includes("features.multi_agent=false"));
    assert.ok(onArgs.includes("features.code_mode=false"));
    assert.ok(onArgs.includes("tools.update_plan.enabled=false"));
  } finally {
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
import { mkdtempSync as mkdtempSync2, writeFileSync as writeFileSync2, mkdirSync as mkdirSync2 } from "node:fs";
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

test("binding records round-trip tool declaration fields and keep legacy entries", async () => {
  const dir = mkdtempSync2(join2(tmpdir2(), "kmh-codex-store-tools-"));
  const file = join2(dir, "codex-bindings.json");
  mkdirSync2(dir, { recursive: true });
  // 旧记录（无工具字段）与新记录共存：旧 thread 按裸名兼容续用。
  writeFileSync2(
    file,
    JSON.stringify({
      legacy: { threadId: "thread-legacy", fingerprints: ["a"] },
      modern: {
        threadId: "thread-modern",
        fingerprints: ["a"],
        toolsVersion: 3,
        toolFingerprint: "abc123",
        toolMap: { "kmh-kmh_echo": "kmh_echo" },
      },
    }),
  );
  const store = new CodexSessionStore(dir);
  const legacy = await store.get("legacy");
  assert.equal(legacy.toolFingerprint, undefined);
  assert.equal(legacy.toolMap, undefined);
  const modern = await store.get("modern");
  assert.equal(modern.toolsVersion, 3);
  assert.equal(modern.toolFingerprint, "abc123");
  assert.deepEqual(modern.toolMap, { "kmh-kmh_echo": "kmh_echo" });
  // 可选工具字段非法：剥除该字段保留记录（绑定本体仍可按裸名旧 thread 续用）。
  writeFileSync2(
    file,
    JSON.stringify({
      bad: { threadId: "t", fingerprints: ["a"], toolMap: { x: 1 } },
    }),
  );
  const store2 = new CodexSessionStore(dir);
  const bad = await store2.get("bad");
  assert.equal(bad.threadId, "t");
  assert.equal(bad.toolMap, undefined);
});
