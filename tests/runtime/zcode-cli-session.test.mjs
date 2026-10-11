// zcode-cli session 中继测试：事件投影、增量发送、绑定 resume、审批桥与停止通道。
// 复用 zcode-cli.test.mjs 的 fixture 模式（假 CLI 行协议桩），fixture 扩展了
// session 协议（create/resume/subscribe/send/stop + 脚本化 session/event 流）。
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  writeFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
const { parseDocument } = createRequire(
  new URL(
    "../../third_party/dsh/packages/boot/plugin-manager/package.json",
    import.meta.url,
  ),
)("yaml");
import { Context } from "../../third_party/dsh/vendor/cordis/lib/index.js";
import { LocalSubprocessRuntime } from "../../third_party/dsh/packages/subprocess/subprocess-local/lib/index.js";
import { Config } from "../../packages/zcode-cli/lib/src/config.js";
import { ZcodeCli } from "../../packages/zcode-cli/lib/src/runtime.js";
import { ZcodeAdapter } from "../../packages/zcode-cli/lib/src/index.js";
import { TurnEventProjector } from "../../packages/zcode-cli/lib/src/events.js";
import { splitHistory } from "../../packages/zcode-cli/lib/src/session.js";
import {
  zcodeModeForPreset,
  resolveZcodeMode,
} from "../../packages/zcode-cli/lib/src/permission.js";
import {
  Session,
  SessionId,
} from "../../third_party/dsh/packages/core/session/lib/index.js";
import {
  ApprovalService,
  setApprovalPolicy,
} from "../../third_party/dsh/packages/interaction/user-approval/lib/index.js";
import {
  ZcodeInteractionBridge,
  permissionDecisionOf,
} from "../../packages/zcode-cli/lib/src/interaction.js";

const modelsFixture = ["glm-5.3", "glm-5.3-flash"];
async function fixture(t, mode = "success", extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "kmh-zcode-session-"));
  const ctx = new Context();
  new LocalSubprocessRuntime(ctx);
  const builtin = join(dir, "builtin.json");
  writeFileSync(builtin, JSON.stringify({ revision: 30 }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (typeof url === "string" && url.endsWith("/models")) {
      options.signal.throwIfAborted();
      return Response.json({
        object: "list",
        data: modelsFixture.map((id) => ({ id, object: "model" })),
      });
    }
    return originalFetch(url, options);
  };
  const config = Config({
    providerId: "account:zai-individual-coding-plan",
    apiBaseUrl: "https://api.z.ai/api/anthropic",
    command: resolve("tests/runtime/fixtures/zcode-cli/cli.mjs"),
    cwd: dir,
    dataDir: dir,
    builtinConfigFile: builtin,
    requestTimeoutMs: 5000,
    loginTimeoutMs: 3000,
    graceMs: 100,
    env: { ZCODE_CREDENTIAL_SECRET: "fixture-cipher", KMH_FIXTURE_MODE: mode },
    ...extra,
  });
  const runtime = new ZcodeCli(ctx, config);
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await ctx.fiber.dispose();
    rmSync(dir, { recursive: true, force: true });
  });
  return { runtime, dir, ctx, config };
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
/** 登录并完成一次探测，保证目录已解析。 */
async function signIn(runtime) {
  await runtime.login();
  await until(runtime, "signed-in");
  await runtime.check();
}
function readLog(dir, name) {
  return readFileSync(join(dir, name), "utf8")
    .trim()
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line));
}
const userMessage = (text) => ({
  role: "user",
  content: [{ type: "text", text }],
});
const assistantMessage = (text) => ({
  role: "assistant",
  content: [{ type: "text", text }],
});

function permissionSession(ctx, preset = "workspace-write") {
  const session = { id: "sess-permissions", header: {} };
  const state = { preset };
  ctx.provide("sessions", {
    get: (id) => (id === session.id ? session : undefined),
  });
  ctx.provide("permissionPresets", { current: () => state.preset });
  return {
    session,
    select(value) {
      state.preset = value;
      ctx.emit("session/event", session, {
        type: "permission/preset",
        data: { preset: value },
      });
    },
  };
}

async function permissionTurn(runtime, text = "权限测试") {
  const chunks = [];
  for await (const chunk of runtime.relayTurn({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    sessionId: "sess-permissions",
    messages: [userMessage(text)],
  }))
    chunks.push(chunk);
  return chunks;
}

test("permissions mapping rejects unknown presets and preserves conservative defaults", async (t) => {
  const { ctx } = await fixture(t);
  assert.equal(resolveZcodeMode(ctx, undefined), "build");
  const permissions = permissionSession(ctx);
  assert.equal(resolveZcodeMode(ctx, "unbound"), "build");
  for (const [preset, expected] of [
    ["read-only", "plan"],
    ["workspace-write", "build"],
    ["workspace-write-auto", "edit"],
    ["danger-full-access", "yolo"],
  ]) {
    permissions.select(preset);
    assert.equal(zcodeModeForPreset(preset), expected);
    assert.equal(resolveZcodeMode(ctx, "sess-permissions"), expected);
  }
  for (const preset of ["", " ", "custom", "yolo", "x".repeat(1024)])
    assert.throws(
      () => zcodeModeForPreset(preset),
      /ZCODE_PERMISSION_MODE_UNSUPPORTED/,
    );
});

test("permissions full access still requires a bound active KMH agent", async (t) => {
  const { runtime, dir, ctx } = await fixture(t, "session-tool");
  permissionSession(ctx, "danger-full-access");
  await signIn(runtime);
  await permissionTurn(runtime);
  assert.equal(
    readLog(dir, "permission-replies.jsonl").at(-1).decision,
    "deny",
  );
});

for (const [preset, expected] of [
  ["read-only", "plan"],
  ["workspace-write", "build"],
  ["danger-full-access", "yolo"],
]) {
  test(`permissions create ${preset} as ${expected}`, async (t) => {
    const { runtime, dir, ctx } = await fixture(t);
    permissionSession(ctx, preset);
    await signIn(runtime);
    await permissionTurn(runtime);
    assert.equal(readLog(dir, "session-creates.jsonl")[0].mode, expected);
  });
}

test("permissions switching preserves the CLI session and incremental input", async (t) => {
  const { runtime, dir, ctx } = await fixture(t);
  const permissions = permissionSession(ctx);
  await signIn(runtime);
  await permissionTurn(runtime, "第一问");
  permissions.select("danger-full-access");
  await permissionTurn(runtime, "第二问");
  permissions.select("read-only");
  await permissionTurn(runtime, "第三问");
  const creates = readLog(dir, "session-creates.jsonl");
  const sends = readLog(dir, "session-sends.jsonl");
  const modes = readLog(dir, "session-modes.jsonl");
  assert.equal(creates.length, 1);
  assert.deepEqual(
    sends.map((send) => send.content),
    ["第一问", "第二问", "第三问"],
  );
  assert.equal(new Set(sends.map((send) => send.sessionId)).size, 1);
  assert.deepEqual(
    modes.map((request) => request.mode),
    ["yolo", "build", "plan"],
  );
});

test("permissions creation corrects the CLI default before the first send", async (t) => {
  const { runtime, dir, ctx } = await fixture(t, "session-create-default");
  permissionSession(ctx, "danger-full-access");
  await signIn(runtime);
  await permissionTurn(runtime);
  assert.equal(readLog(dir, "session-creates.jsonl")[0].mode, "yolo");
  assert.deepEqual(readLog(dir, "session-modes.jsonl").map((request) => request.mode), ["yolo"]);
  assert.equal(readLog(dir, "session-sends.jsonl").length, 1);
});

test("permissions resume applies the current mode to the persisted CLI session", async (t) => {
  const { runtime, dir, ctx } = await fixture(t);
  const permissions = permissionSession(ctx, "danger-full-access");
  await signIn(runtime);
  await permissionTurn(runtime);
  await runtime.recycleSessionChannel();
  permissions.select("read-only");
  await permissionTurn(runtime, "恢复后继续");
  assert.equal(readLog(dir, "session-creates.jsonl").length, 1);
  const resume = readLog(dir, "session-resumes.jsonl")[0];
  const mode = readLog(dir, "session-modes.jsonl").at(-1);
  assert.equal(mode.sessionId, resume.sessionId);
  assert.equal(mode.mode, "plan");
});

test("permissions callbacks follow the live preset with the real approval service", async (t) => {
  const { runtime, dir, ctx } = await fixture(t, "session-tool");
  const session = Session.create(SessionId("sess-permissions"));
  session.append("turn/start", { turn: 1 });
  const agent = { id: session.id, session };
  const state = { preset: "danger-full-access", answer: "allowed-once" };
  ctx.provide("sessions", {
    get: (id) => (id === session.id ? session : undefined),
  });
  ctx.provide("agents", {
    get: (id) => (id === session.id ? agent : undefined),
  });
  ctx.provide("permissionPresets", { current: () => state.preset });
  new ApprovalService(ctx, { policy: "never" });
  let prompts = 0;
  ctx.on("approval/request", () => {
    prompts += 1;
    return Promise.resolve(state.answer);
  });
  await signIn(runtime);
  await permissionTurn(runtime, "完全权限");
  assert.equal(
    readLog(dir, "permission-replies.jsonl").at(-1).decision,
    "allow",
  );
  assert.equal(prompts, 0);
  for (const [preset, policy, answer, expected] of [
    ["workspace-write", "ask", "allowed-once", "allow"],
    ["workspace-write", "ask", "rejected", "deny"],
    ["read-only", "ask", "allowed-once", "deny"],
  ]) {
    state.preset = preset;
    state.answer = answer;
    setApprovalPolicy(session, policy);
    ctx.emit("session/event", session, {
      type: "permission/preset",
      data: { preset },
    });
    await permissionTurn(runtime, preset);
    assert.equal(
      readLog(dir, "permission-replies.jsonl").at(-1).decision,
      expected,
    );
  }
  assert.equal(prompts, 2);
  setApprovalPolicy(session, "never");
  assert.equal(
    await ctx.approval.request({ agent, toolName: "control" }),
    "rejected",
  );
  assert.equal(prompts, 2);
  const snapshot = {
    createdMode: readLog(dir, "session-creates.jsonl")[0].mode,
    modeChanges: readLog(dir, "session-modes.jsonl").map(
      (request) => request.mode,
    ),
    cliDecisions: readLog(dir, "permission-replies.jsonl").map(
      (reply) => reply.decision,
    ),
    approvalDecisions: session
      .snapshotEvents()
      .filter((event) => event.type === "approval/decided")
      .map((event) => event.data.outcome),
    prompts,
    sessionCount: readLog(dir, "session-creates.jsonl").length,
  };
  assert.deepEqual(
    snapshot,
    JSON.parse(
      readFileSync(
        "tests/runtime/fixtures/zcode-cli/permission-modes.expected.json",
        "utf8",
      ),
    ),
  );
});

test("permissions switch during a running turn without sending another prompt", async (t) => {
  const { runtime, dir, ctx } = await fixture(t, "session-hang");
  const permissions = permissionSession(ctx);
  await signIn(runtime);
  const controller = new AbortController();
  const chunks = [];
  const running = (async () => {
    for await (const chunk of runtime.relayTurn({
      provider: "zcode-cli",
      model: "glm-5.3-flash",
      sessionId: "sess-permissions",
      messages: [userMessage("运行时切换")],
      signal: controller.signal,
    }))
      chunks.push(chunk);
  })();
  t.after(() => controller.abort());
  for (
    let n = 0;
    n < 100 && !chunks.some((chunk) => chunk.type === "text-delta");
    n++
  )
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(chunks.some((chunk) => chunk.type === "text-delta"));
  permissions.select("danger-full-access");
  let changes = [];
  for (let n = 0; n < 100; n++) {
    try {
      changes = readLog(dir, "session-modes.jsonl");
    } catch {
      /* Await first mode request. */
    }
    if (changes.length > 0) break;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.equal(changes.at(-1)?.mode, "yolo");
  assert.equal(readLog(dir, "session-sends.jsonl").length, 1);
  controller.abort();
  await running;
  assert.equal(chunks.at(-1).reason.kind, "aborted");
});

test("permissions mode failure blocks further sends", async (t) => {
  const { runtime, dir, ctx } = await fixture(t, "session-mode-fail");
  const permissions = permissionSession(ctx);
  await signIn(runtime);
  await permissionTurn(runtime);
  permissions.select("danger-full-access");
  await assert.rejects(permissionTurn(runtime, "受阻输入"), /mode rejected/);
  assert.equal(readLog(dir, "session-sends.jsonl").length, 1);
});

test("permissions mismatched mode acknowledgement blocks further sends", async (t) => {
  const { runtime, dir, ctx } = await fixture(t, "session-mode-mismatch");
  const permissions = permissionSession(ctx);
  await signIn(runtime);
  await permissionTurn(runtime);
  permissions.select("danger-full-access");
  await assert.rejects(
    permissionTurn(runtime, "受阻输入"),
    /ZCODE_PERMISSION_MODE_NOT_APPLIED/,
  );
  assert.equal(readLog(dir, "session-sends.jsonl").length, 1);
});

test("permissions missing plan confirmation blocks the first send", async (t) => {
  const { runtime, dir, ctx } = await fixture(t, "session-plan-missing");
  permissionSession(ctx, "read-only");
  await signIn(runtime);
  await assert.rejects(
    permissionTurn(runtime),
    /ZCODE_PERMISSION_MODE_NOT_APPLIED/,
  );
  assert.equal(existsSync(join(dir, "session-sends.jsonl")), false);
});

test("permissions unknown live preset fails before creating a CLI session", async (t) => {
  const { runtime, dir, ctx } = await fixture(t);
  permissionSession(ctx, "custom");
  await signIn(runtime);
  await assert.rejects(
    permissionTurn(runtime),
    /ZCODE_PERMISSION_MODE_UNSUPPORTED/,
  );
  assert.equal(existsSync(join(dir, "session-creates.jsonl")), false);
});

test("projector streams reasoning and text blocks with disjoint usage and stop", () => {
  const projector = new TurnEventProjector();
  const chunks = [
    ...projector.push({ type: "model.streaming", kind: "reasoning_start" }),
    ...projector.push({
      type: "model.streaming",
      kind: "reasoning_delta",
      delta: "想一下",
    }),
    ...projector.push({ type: "model.streaming", kind: "reasoning_end" }),
    ...projector.push({ type: "model.streaming", kind: "text_start" }),
    ...projector.push({
      type: "model.streaming",
      kind: "text_delta",
      delta: "你好",
    }),
    ...projector.push({ type: "model.streaming", kind: "text_end" }),
    ...projector.push({
      type: "turn.completed",
      resultType: "success",
      usage: {
        inputTokens: 100,
        outputTokens: 10,
        totalTokens: 110,
        cacheReadTokens: 60,
      },
    }),
  ];
  assert.deepEqual(
    chunks.map((chunk) => chunk.type),
    [
      "block-start",
      "reasoning-delta",
      "block-end",
      "block-start",
      "text-delta",
      "block-end",
      "usage",
      "finish",
    ],
  );
  assert.equal(chunks[0].blockType, "reasoning");
  assert.equal(chunks[3].blockType, "text");
  assert.deepEqual(chunks[2].block, { type: "reasoning", text: "想一下" });
  assert.deepEqual(chunks[5].block, { type: "text", text: "你好" });
  // input 100 - cache 60 = 40 未命中输入；缓存独立计量。
  assert.deepEqual(chunks[6].usage, {
    inputTokens: 40,
    outputTokens: 10,
    cacheReadTokens: 60,
  });
  assert.deepEqual(chunks[7].reason, { kind: "stop" });
  assert.equal(projector.finished, true);
});
test("projector backfills the response text when a turn has no deltas", () => {
  // 真机丢文本形态：整回合零增量，正文只出现在 turn.completed.response。
  const flat = new TurnEventProjector();
  const chunks = flat.push({
    type: "turn.completed",
    resultType: "success",
    response: "整段只在终态出现的正文",
    usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 },
  });
  assert.deepEqual(
    chunks.map((chunk) => chunk.type),
    ["block-start", "text-delta", "block-end", "usage", "finish"],
  );
  assert.equal(chunks[0].blockType, "text");
  assert.equal(chunks[1].text, "整段只在终态出现的正文");
  assert.deepEqual(chunks[2].block, {
    type: "text",
    text: "整段只在终态出现的正文",
  });
  // response 为空串：无可回填，只出终态。
  const empty = new TurnEventProjector();
  const emptyChunks = empty.push({
    type: "turn.completed",
    resultType: "success",
    response: "",
  });
  assert.deepEqual(emptyChunks.map((chunk) => chunk.type), ["finish"]);
});
test("projector keeps streamed text and skips backfill when response also arrives", () => {
  // 已有文本增量时终态 response 不得重复回填。
  const projector = new TurnEventProjector();
  const chunks = [
    ...projector.push({ type: "model.streaming", kind: "text_start" }),
    ...projector.push({
      type: "model.streaming",
      kind: "text_delta",
      delta: "流式正文",
    }),
    ...projector.push({ type: "model.streaming", kind: "text_end" }),
    ...projector.push({
      type: "turn.completed",
      resultType: "success",
      response: "终态同文重复体",
    }),
  ];
  const textDeltas = chunks.filter((chunk) => chunk.type === "text-delta");
  assert.deepEqual(
    textDeltas.map((chunk) => chunk.text),
    ["流式正文"],
  );
  const blockEnd = chunks.find((chunk) => chunk.type === "block-end");
  assert.deepEqual(blockEnd.block, { type: "text", text: "流式正文" });
});
test("projector backfills response text after reasoning-only deltas", () => {
  // 思考增量不代表正文已投：reasoning-only 回合的正文仍从 response 回填。
  const projector = new TurnEventProjector();
  const chunks = [
    ...projector.push({ type: "model.streaming", kind: "reasoning_start" }),
    ...projector.push({
      type: "model.streaming",
      kind: "reasoning_delta",
      delta: "只思考",
    }),
    ...projector.push({ type: "model.streaming", kind: "reasoning_end" }),
    ...projector.push({
      type: "turn.completed",
      resultType: "success",
      response: "思考后才出现的正文",
    }),
  ];
  assert.ok(chunks.some((chunk) => chunk.type === "reasoning-delta"));
  const textDeltas = chunks.filter((chunk) => chunk.type === "text-delta");
  assert.deepEqual(
    textDeltas.map((chunk) => chunk.text),
    ["思考后才出现的正文"],
  );
  // 回填块在思考块之后收口：思考与正文两块共存且序不乱。
  const blocks = chunks
    .filter((chunk) => chunk.type === "block-end")
    .map((chunk) => chunk.block.type);
  assert.deepEqual(blocks, ["reasoning", "text"]);
});
test("projector maps resultType variants and failure events", () => {
  const maxTokens = new TurnEventProjector();
  maxTokens.push({ type: "turn.completed", resultType: "error_max_turns" });
  assert.equal(maxTokens.push([]).length, 0);
  const cancelled = new TurnEventProjector();
  const cancelledChunks = cancelled.push({
    type: "turn.completed",
    resultType: "cancelled",
  });
  assert.equal(cancelledChunks.at(-1).reason.kind, "aborted");
  const failed = new TurnEventProjector();
  const failedChunks = failed.push({
    type: "turn.failed",
    error: { message: "boom" },
  });
  assert.equal(failedChunks.at(-1).reason.kind, "error");
  assert.equal(failedChunks.at(-1).reason.failure.code, "ZCODE_TURN_FAILED");
  const closed = new TurnEventProjector();
  const closedChunks = closed.push({ type: "session.closed" });
  assert.equal(closedChunks.at(-1).reason.failure.code, "ZCODE_SESSION_CLOSED");
  // CLI 工具活动事件不进内容流（执行留在 CLI 内，防宿主重复执行）。
  const tools = new TurnEventProjector();
  assert.deepEqual(
    tools.push({
      type: "model.streaming",
      kind: "tool_input_delta",
      delta: '{"a":1}',
      toolName: "Bash",
    }),
    [],
  );
});
test("splitHistory keeps the trailing user text and text-only imported prefix", () => {
  const { imported, input } = splitHistory([
    { role: "system", content: [{ type: "text", text: "system prompt" }] },
    userMessage("第一问"),
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "思考不导入" },
        { type: "text", text: "第一答" },
        {
          type: "tool-call",
          id: "c1",
          name: "read",
          arguments: "{}",
        },
      ],
    },
    { role: "tool", toolCallId: "c1", content: [] },
    userMessage("第二问"),
  ]);
  assert.equal(input, "第二问");
  assert.deepEqual(imported, [
    { role: "user", content: "第一问" },
    { role: "assistant", content: "第一答" },
  ]);
  const empty = splitHistory([]);
  assert.equal(empty.input, "");
  assert.deepEqual(empty.imported, []);
});
test("relay turn streams reasoning and text through the adapter", async (t) => {
  const { runtime, dir } = await fixture(t);
  await signIn(runtime);
  const adapter = new ZcodeAdapter(runtime);
  const chunks = [];
  for await (const chunk of adapter.stream({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    sessionId: "sess-kmh-1",
    system: "KMH system ignored by session relay",
    messages: [userMessage("你好")],
    tools: [
      { name: "read", description: "KMH read", parameters: { type: "object" } },
    ],
  }))
    chunks.push(chunk);
  const kinds = chunks.map((chunk) => chunk.type);
  assert.ok(kinds.includes("reasoning-delta"));
  assert.ok(kinds.includes("text-delta"));
  assert.equal(kinds.at(-2), "usage");
  assert.deepEqual(chunks.at(-1).reason, { kind: "stop" });
  // reasoning 块先于 text 块：思考先流入再答正文。
  assert.ok(kinds.indexOf("reasoning-delta") < kinds.indexOf("text-delta"));
  const sends = readLog(dir, "session-sends.jsonl");
  assert.equal(sends.length, 1);
  assert.equal(sends[0].content, "你好");
  assert.equal(sends[0].modelSelection.modelId, "glm-5.3-flash");
  assert.equal(sends[0].modelSelection.options.reasoningLevel, "high");
  const creates = readLog(dir, "session-creates.jsonl");
  assert.equal(creates.length, 1);
  // 首轮无导入历史：单条用户消息即全部历史。
  assert.equal(creates[0].importedHistory, undefined);
  // 绑定落盘。
  const bindings = JSON.parse(
    readFileSync(join(dir, "session-bindings.json"), "utf8"),
  );
  assert.ok(bindings["sess-kmh-1"].cliSessionId.startsWith("sess-fx-"));
});
test("flat turn without deltas delivers the response text end to end", async (t) => {
  // 覆盖真机丢文本形态：CLI 不发增量，正文只在 turn.completed.response。
  const { runtime } = await fixture(t, "session-flat");
  await signIn(runtime);
  const adapter = new ZcodeAdapter(runtime);
  const chunks = [];
  for await (const chunk of adapter.stream({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    sessionId: "sess-kmh-flat",
    messages: [userMessage("你好")],
  }))
    chunks.push(chunk);
  const textDeltas = chunks.filter((chunk) => chunk.type === "text-delta");
  assert.deepEqual(
    textDeltas.map((chunk) => chunk.text),
    ["整段只在终态出现的正文"],
  );
  const blockEnd = chunks.find((chunk) => chunk.type === "block-end");
  assert.deepEqual(blockEnd.block, {
    type: "text",
    text: "整段只在终态出现的正文",
  });
  assert.equal(chunks.at(-2).type, "usage");
  assert.deepEqual(chunks.at(-1).reason, { kind: "stop" });
});
test("second turn reuses the bound session and sends only new input", async (t) => {
  const { runtime, dir } = await fixture(t);
  await signIn(runtime);
  const turn = async (history) => {
    const chunks = [];
    for await (const chunk of runtime.relayTurn({
      provider: "zcode-cli",
      model: "glm-5.3-flash",
      sessionId: "sess-kmh-2",
      messages: history,
    }))
      chunks.push(chunk);
    return chunks;
  };
  await turn([userMessage("第一问")]);
  const second = await turn([
    userMessage("第一问"),
    assistantMessage("第一答"),
    userMessage("第二问"),
  ]);
  assert.deepEqual(second.at(-1).reason, { kind: "stop" });
  const creates = readLog(dir, "session-creates.jsonl");
  const sends = readLog(dir, "session-sends.jsonl");
  assert.equal(creates.length, 1); // 同绑定不重建
  assert.equal(sends.length, 2);
  assert.equal(sends[1].content, "第二问"); // 只发增量
  assert.equal(sends[1].sessionId, sends[0].sessionId);
});
test("channel recycle resumes the persisted session across processes", async (t) => {
  const { runtime, dir } = await fixture(t);
  await signIn(runtime);
  const first = [];
  for await (const chunk of runtime.relayTurn({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    sessionId: "sess-kmh-3",
    messages: [userMessage("第一问")],
  }))
    first.push(chunk);
  assert.equal(first.at(-1).reason.kind, "stop");
  // 回收通道模拟进程重启：新进程按持久会话表 resume 同一会话。
  await runtime.recycleSessionChannel();
  const second = [];
  for await (const chunk of runtime.relayTurn({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    sessionId: "sess-kmh-3",
    messages: [userMessage("第一问"), userMessage("继续")],
  }))
    second.push(chunk);
  assert.equal(second.at(-1).reason.kind, "stop");
  const resumes = readLog(dir, "session-resumes.jsonl");
  assert.equal(resumes.length, 1);
  const sends = readLog(dir, "session-sends.jsonl");
  assert.equal(sends[1].sessionId, sends[0].sessionId);
  assert.equal(sends[1].content, "继续");
  const creates = readLog(dir, "session-creates.jsonl");
  assert.equal(creates.length, 1);
});
test("unresumable binding rebuilds with imported text history", async (t) => {
  const { runtime, dir } = await fixture(t);
  await signIn(runtime);
  for await (const chunk of runtime.relayTurn({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    sessionId: "sess-kmh-4",
    messages: [userMessage("第一问")],
  }))
    void chunk;
  // 模拟 CLI 数据目录会话丢失：删除持久会话表并回收通道。
  rmSync(join(dir, "fixture-sessions.json"), { force: true });
  await runtime.recycleSessionChannel();
  const chunks = [];
  for await (const chunk of runtime.relayTurn({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    sessionId: "sess-kmh-4",
    messages: [
      userMessage("第一问"),
      assistantMessage("第一答"),
      userMessage("重建后继续"),
    ],
  }))
    chunks.push(chunk);
  assert.equal(chunks.at(-1).reason.kind, "stop");
  const creates = readLog(dir, "session-creates.jsonl");
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[1].importedHistory.messages, [
    { role: "user", content: "第一问", timestamp: creates[1].importedHistory.messages[0].timestamp },
    {
      role: "assistant",
      content: "第一答",
      timestamp: creates[1].importedHistory.messages[1].timestamp,
    },
  ]);
});
test("user stop settles the turn and routes through session/stop", async (t) => {
  const { runtime, dir } = await fixture(t, "session-hang");
  await signIn(runtime);
  const controller = new AbortController();
  const chunks = [];
  const iterating = (async () => {
    for await (const chunk of runtime.relayTurn({
      provider: "zcode-cli",
      model: "glm-5.3-flash",
      sessionId: "sess-kmh-5",
      messages: [userMessage("挂住的回合")],
      signal: controller.signal,
    }))
      chunks.push(chunk);
  })();
  // 等到首个思考增量到达后停止。
  for (let n = 0; n < 100 && !chunks.some((c) => c.type === "reasoning-delta"); n++)
    await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(chunks.some((c) => c.type === "reasoning-delta"));
  controller.abort();
  await iterating;
  const finish = chunks.find((chunk) => chunk.type === "finish");
  assert.equal(finish.reason.kind, "aborted");
  // 开放块被收口，块序列完整。
  const blockEnds = chunks.filter((chunk) => chunk.type === "block-end");
  assert.ok(blockEnds.length >= 1);
  const stops = readLog(dir, "session-stops.jsonl");
  assert.equal(stops.length, 1);
  assert.equal(stops[0].sessionId.startsWith("sess-fx-"), true);
  // 停止落账收敛：回执确认 + 清理成功，「正在停止」据此解除（两段式状态行）。
  const row = runtime.requests().find((r) => r.stop !== undefined);
  assert.ok(row !== undefined, "停止记录存在");
  assert.equal(row.stop.receipt, true);
  assert.equal(row.stop.exitConfirmed, true);
  assert.equal(row.cleanupResult.ok, true);
});
test("mid-turn permission request is answered fail-closed without services", async (t) => {
  const { runtime, dir } = await fixture(t, "session-tool");
  await signIn(runtime);
  const chunks = [];
  for await (const chunk of runtime.relayTurn({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    sessionId: "sess-kmh-6",
    messages: [userMessage("需要工具的回合")],
  }))
    chunks.push(chunk);
  // 审批无服务应答 fail-closed 拒绝，CLI 继续完成回合。
  assert.deepEqual(chunks.at(-1).reason, { kind: "stop" });
  const replies = readLog(dir, "permission-replies.jsonl");
  assert.equal(replies.length, 1);
  assert.equal(replies[0].decision, "deny");
});
test("invalid reasoning level surfaces a controlled provider failure", async (t) => {
  const { runtime } = await fixture(t);
  await signIn(runtime);
  const adapter = new ZcodeAdapter(runtime);
  // async generator 需真实拉取才会执行与抛错。
  const drain = async (iterating) => {
    const chunks = [];
    for await (const chunk of iterating) chunks.push(chunk);
    return chunks;
  };
  // 档位白名单在适配层先行拒绝。
  await assert.rejects(
    drain(
      adapter.stream({
        provider: "zcode-cli",
        model: "glm-5.3-flash",
        sessionId: "sess-kmh-7",
        reasoningEffort: "medium",
        messages: [userMessage("任意")],
      }),
    ),
    (error) => error.code === "INVALID_REASONING_EFFORT",
  );
  // CLI 侧档位校验错误以受控失败冒出。
  await assert.rejects(
    drain(
      runtime.relayTurn({
        provider: "zcode-cli",
        model: "glm-5.3-flash",
        sessionId: "sess-kmh-7",
        reasoningEffort: "weird",
        messages: [userMessage("任意")],
      }),
    ),
    (error) => error instanceof Error,
  );
});
test("adapter exposes low/high/max efforts matching the CLI enum", async (t) => {
  const { runtime } = await fixture(t);
  await signIn(runtime);
  const adapter = new ZcodeAdapter(runtime);
  const info = await adapter.resolveModel("zcode-cli", "glm-5.3-flash");
  assert.deepEqual(
    info.reasoning.efforts.map((effort) => effort.id),
    ["low", "high", "max"],
  );
  assert.equal(info.reasoning.defaultEffort, "high");
});
test("concurrent first calls share one session and each stream owns its text", async (t) => {
  const { runtime, dir } = await fixture(t);
  await signIn(runtime);
  // 模拟新会话的标题生成与主回复同时到达：并发两条回合。
  const drain = async (iterating) => {
    const chunks = [];
    for await (const chunk of iterating) chunks.push(chunk);
    return chunks;
  };
  const [first, second] = await Promise.all([
    drain(
      runtime.relayTurn({
        provider: "zcode-cli",
        model: "glm-5.3-flash",
        sessionId: "sess-race",
        messages: [userMessage("标题用")],
      }),
    ),
    drain(
      runtime.relayTurn({
        provider: "zcode-cli",
        model: "glm-5.3-flash",
        sessionId: "sess-race",
        messages: [userMessage("主回复用")],
      }),
    ),
  ]);
  // 单飞：只建一个 CLI 会话；串行：两个 send 都被受理且各含自己的正文。
  const creates = readLog(dir, "session-creates.jsonl");
  assert.equal(creates.length, 1);
  const sends = readLog(dir, "session-sends.jsonl");
  assert.equal(sends.length, 2);
  assert.equal(sends[0].sessionId, sends[1].sessionId);
  for (const chunks of [first, second]) {
    assert.ok(chunks.some((c) => c.type === "reasoning-delta"));
    assert.ok(chunks.some((c) => c.type === "text-delta"));
    assert.deepEqual(chunks.at(-1).reason, { kind: "stop" });
  }
});

test("idle connections are recycled and the next turn resumes a fresh process", async (t) => {
  const { runtime, dir } = await fixture(t, "success", { sessionIdleMs: 400 });
  await signIn(runtime);
  for await (const chunk of runtime.relayTurn({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    sessionId: "sess-idle",
    messages: [userMessage("第一问")],
  }))
    void chunk;
  const cwdsBefore = readFileSync(join(dir, "server-cwds.jsonl"), "utf8")
    .trim()
    .split("\n").length;
  // 等待空闲回收（闲置 400ms，扫描间隔 1s）。
  await new Promise((resolve) => setTimeout(resolve, 2200));
  const chunks = [];
  for await (const chunk of runtime.relayTurn({
    provider: "zcode-cli",
    model: "glm-5.3-flash",
    sessionId: "sess-idle",
    messages: [userMessage("第一问"), userMessage("闲置后继续")],
  }))
    chunks.push(chunk);
  assert.deepEqual(chunks.at(-1).reason, { kind: "stop" });
  const cwdsAfter = readFileSync(join(dir, "server-cwds.jsonl"), "utf8")
    .trim()
    .split("\n").length;
  assert.equal(cwdsAfter, cwdsBefore + 1); // 闲置连接被回收，新回合拉起新进程
  const resumes = readLog(dir, "session-resumes.jsonl");
  assert.equal(resumes.length, 1); // 绑定仍在：新进程 resume 同一会话
});
test("idle sweep spares turns in flight and the stop channel stays alive", async (t) => {
  const { runtime } = await fixture(t, "session-hang", { sessionIdleMs: 400 });
  await signIn(runtime);
  const controller = new AbortController();
  const chunks = [];
  const iterating = (async () => {
    for await (const chunk of runtime.relayTurn({
      provider: "zcode-cli",
      model: "glm-5.3-flash",
      sessionId: "sess-hang-idle",
      messages: [userMessage("挂住且闲置")],
      signal: controller.signal,
    }))
      chunks.push(chunk);
  })();
  for (
    let n = 0;
    n < 100 && !chunks.some((c) => c.type === "reasoning-delta");
    n++
  )
    await new Promise((resolve) => setTimeout(resolve, 20));
  // 悬挂回合期间多次扫过闲置阈值：在途回合免回收，进程必须存活。
  await new Promise((resolve) => setTimeout(resolve, 2200));
  controller.abort();
  await iterating;
  const finish = chunks.find((chunk) => chunk.type === "finish");
  assert.equal(finish.reason.kind, "aborted");
  // 停止回执可送达 = 进程仍在：若被闲置回收误杀，回执必为 false。
  const row = runtime.requests().find((r) => r.stop !== undefined);
  assert.equal(row.stop.receipt, true);
  assert.equal(row.stop.exitConfirmed, true);
});
test("channel exit settles the turn as failed and records the cause", async (t) => {
  const { runtime } = await fixture(t, "session-exit");
  await signIn(runtime);
  const chunks = [];
  const error = await runtime
    .relayTurn({
      provider: "zcode-cli",
      model: "glm-5.3-flash",
      sessionId: "sess-exit",
      messages: [userMessage("进程将退出")],
    })
    .next()
    .then(
      (result) => {
        chunks.push(result.value);
        return undefined;
      },
      (failure) => failure,
    );
  void error;
  // 拉空迭代器：通道退出注入终态块。
  const rest = [];
  try {
    for await (const chunk of runtime.relayTurn({
      provider: "zcode-cli",
      model: "glm-5.3-flash",
      sessionId: "sess-exit-2",
      messages: [userMessage("进程将退出")],
    }))
      rest.push(chunk);
  } catch {
    void 0;
  }
  const settled = [...chunks, ...rest].find(
    (chunk) => chunk.type === "finish",
  );
  assert.ok(settled !== undefined, "finish 块到达");
  assert.equal(settled.reason.kind, "error");
  assert.equal(settled.reason.failure.code, "ZCODE_CHANNEL_EXIT");
  const failed = runtime.requests().find(
    (row) => row.outcome === "failed" && row.termination?.cause === "channel-exit",
  );
  assert.ok(failed !== undefined, "通道退出按 channel-exit 落账");
});

test("interaction bridge maps approval outcomes and user answers", async () => {
  // KMH 四态 → ZCode 决策（方案 A：无 allow-always）。
  assert.deepEqual(permissionDecisionOf("allowed-once"), { decision: "allow" });
  assert.deepEqual(permissionDecisionOf("rejected").decision, "deny");
  assert.deepEqual(permissionDecisionOf("cancelled").decision, "deny");
  assert.deepEqual(permissionDecisionOf("unavailable").decision, "deny");
  const asked = [];
  const agent = { id: "sess-approval" };
  const ctx = {
    logger: { warn: () => undefined },
    get: (name) =>
      name === "agents"
        ? { get: (id) => (id === "sess-approval" ? agent : undefined) }
        : name === "approval"
          ? {
              request: async (req) => {
                asked.push(req);
                return "allowed-once";
              },
            }
          : name === "userQuestions"
            ? {
                ask: async (req) => ({
                  answers: [
                    { selected: [req.questions[0].options?.[0]?.label], custom: undefined },
                  ],
                }),
              }
            : undefined,
  };
  const bridge = new ZcodeInteractionBridge(ctx, {
    kmhSessionOf: (id) => (id === "sess-cli-1" ? "sess-approval" : undefined),
    apiKey: async () => "fixture-secret",
    catalog: () => [{ id: "glm-5.3", nativeId: "GLM-5.3", name: "GLM-5.3" }],
    providerId: "account:zai-individual-coding-plan",
  });
  const decision = await bridge.handle("interaction/requestPermission", {
    sessionId: "sess-cli-1",
    requestId: "r1",
    toolCallId: "tc-1",
    toolName: "Bash",
    riskLevel: "high",
    reason: "run tests",
    input: { command: "pnpm test" },
  });
  assert.deepEqual(decision, { decision: "allow" });
  assert.equal(asked[0].toolName, "ZCode 工具审批");
  assert.ok(asked[0].reason.includes("Bash"));
  assert.ok(asked[0].reason.includes("pnpm test"));
  // 未知 CLI 会话（无绑定）：fail closed。
  const orphan = await bridge.handle("interaction/requestPermission", {
    sessionId: "sess-cli-unknown",
    toolCallId: "tc-2",
    toolName: "Bash",
    riskLevel: "low",
    reason: "x",
    input: {},
  });
  assert.equal(orphan.decision, "deny");
  // 用户输入：choice 直译，答案回 value。
  const answer = await bridge.handle("interaction/requestUserInput", {
    sessionId: "sess-cli-1",
    requestId: "r2",
    prompt: "选一个",
    inputType: "choice",
    choices: ["甲", "乙"],
  });
  assert.deepEqual(answer, { value: "甲" });
  // 凭据头：路由匹配才放行。
  const headers = await bridge.handle("interaction/requestProviderRuntimeHeaders", {
    providerId: "account:zai-individual-coding-plan",
    modelSelection: {
      providerId: "account:zai-individual-coding-plan",
      modelId: "GLM-5.3",
    },
  });
  assert.deepEqual(headers, {
    headersApplied: true,
    requestAuth: { apiKey: "fixture-secret" },
  });
  await assert.rejects(
    bridge.handle("interaction/requestProviderRuntimeHeaders", {
      providerId: "account:zai-individual-coding-plan",
      modelSelection: {
        providerId: "account:zai-individual-coding-plan",
        modelId: "GLM-不在目录",
      },
    }),
    /ZCODE_AUTH_ROUTE_MISMATCH/,
  );
  // 未覆盖的反向请求抛错由传输层回执。
  await assert.rejects(
    bridge.handle("interaction/requestOfficialMcpAuthHeaders", {}),
    /ZCODE_INTERACTION_UNSUPPORTED/,
  );
});
test("normal KMH Web keeps the ZCode insertion present", () => {
  // 中继化改造不动 profile 插件段：插入仍存在（结构级断言在既有测试）。
  const profile = readFileSync("profiles/kmh-web/cordis.patch.yml", "utf8");
  assert.ok(profile.includes("'@kmh/zcode-cli'"));
});
