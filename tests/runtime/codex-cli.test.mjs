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

// ---- 原生审批桥（feat09，D18 公开服务直连） ----
import { CodexApprovalBridge } from "../../packages/codex-cli/lib/src/approval.js";
import { inject as codexCliInject } from "../../packages/codex-cli/lib/src/index.js";

test("plugin entry declares the services the approval bridge forwards to", () => {
  // D20/D22：漏声明 inject 时运行期访问抛
  // "cannot get property ... without inject"——审批桥（agents）与生图投影
  // （attachments）都曾栽在这，逐项列出防止回退。
  assert.deepEqual(codexCliInject, [
    "llm",
    "subprocess",
    "agents",
    "approval",
    "userQuestions",
    "attachments",
  ]);
});
import {
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  FileChangeRequestApprovalParams,
  PermissionsRequestApprovalParams,
  ToolRequestUserInputParams,
  McpServerElicitationRequestParams,
} from "../../packages/codex-cli/lib/src/protocol.js";

/** 桥测试用的假宿主：按场景注入 agents/approval/userQuestions。 */
function bridgeCtx({ outcome, answer, error } = {}) {
  const asked = [];
  const agent = { id: "sess-approval" };
  return {
    asked,
    logger: { warn: () => undefined },
    agents: { get: (id) => (id === "sess-approval" ? agent : undefined) },
    approval:
      outcome === undefined
        ? undefined
        : {
            request: async (req) => {
              asked.push({ kind: "approval", toolName: req.toolName, reason: req.reason });
              if (outcome === "throw") throw new Error("approval blew up");
              return outcome;
            },
          },
    userQuestions:
      answer === undefined && error === undefined
        ? undefined
        : {
            ask: async (req) => {
              asked.push({ kind: "questions", questions: req.questions });
              if (error !== undefined) throw error;
              return answer;
            },
          },
  };
}

const commandApprovalParams = {
  threadId: "th-1",
  turnId: "turn-1",
  itemId: "item-1",
  startedAtMs: 1759800000000,
  command: "rm -rf ~/important",
  cwd: "/workspace/demo",
  reason: "需要删除工作区外文件",
};

test("approval bridge maps KMH outcomes to codex command decisions", async () => {
  const cases = [
    ["allowed-once", "accept"],
    ["rejected", "decline"],
    ["cancelled", "cancel"],
    ["unavailable", "decline"],
  ];
  for (const [outcome, decision] of cases) {
    const ctx = bridgeCtx({ outcome });
    const bridge = new CodexApprovalBridge(ctx, "sess-approval", undefined);
    const response = await bridge.handleCommandApproval(commandApprovalParams);
    assert.deepEqual(response, { decision });
    CommandExecutionRequestApprovalResponse.parse(response);
  }
  // 展示信息携带命令、目录与申请原因（用户在 KMH 审批卡可见）。
  const ctx = bridgeCtx({ outcome: "allowed-once" });
  await new CodexApprovalBridge(ctx, "sess-approval", undefined).handleCommandApproval(
    commandApprovalParams,
  );
  const asked = ctx.asked[0];
  assert.equal(asked.toolName, "codex 命令执行审批");
  assert.ok(asked.reason.includes("rm -rf ~/important"));
  assert.ok(asked.reason.includes("/workspace/demo"));
  // 请求参数形态收敛（0.160.0 生成 schema）。
  CommandExecutionRequestApprovalParams.parse(commandApprovalParams);
});

test("approval bridge fails closed without agent or approval service", async () => {
  // 无 approval 服务：拒绝并保持可继续。
  const noService = new CodexApprovalBridge(bridgeCtx({}), "sess-approval", undefined);
  assert.deepEqual(await noService.handleCommandApproval(commandApprovalParams), {
    decision: "decline",
  });
  // 无会话身份（临时会话）：同样拒绝。
  const noSession = new CodexApprovalBridge(bridgeCtx({ outcome: "allowed-once" }), undefined, undefined);
  assert.deepEqual(await noSession.handleCommandApproval(commandApprovalParams), {
    decision: "decline",
  });
  // 文件修改与权限申请同语义。
  const fileParams = FileChangeRequestApprovalParams.parse({
    threadId: "th-1",
    turnId: "turn-1",
    itemId: "item-2",
    startedAtMs: 1759800000000,
    reason: "越界写",
    grantRoot: "/outside",
  });
  assert.deepEqual(await noSession.handleFileChangeApproval(fileParams), {
    decision: "decline",
  });
  assert.deepEqual(await noSession.handlePermissionsApproval({
    threadId: "th-1",
    turnId: "turn-1",
    itemId: "item-3",
    startedAtMs: 1759800000000,
    cwd: "/w",
    permissions: { network: { hosts: ["*"] } },
  }), { permissions: {}, scope: "turn" });
});

test("permissions approval grants only the requested profile for one turn", async () => {
  const requested = { network: { hosts: ["example.com"] } };
  const params = {
    threadId: "th-1",
    turnId: "turn-1",
    itemId: "item-3",
    startedAtMs: 1759800000000,
    cwd: "/w",
    reason: null,
    permissions: requested,
  };
  PermissionsRequestApprovalParams.parse(params);
  // 批准：授予请求声明的范围，scope=turn（R2 单次请求授权）。
  const allowed = bridgeCtx({ outcome: "allowed-once" });
  const grant = await new CodexApprovalBridge(allowed, "sess-approval", undefined)
    .handlePermissionsApproval(params);
  assert.deepEqual(grant, { permissions: requested, scope: "turn" });
  // 拒绝：空授权。
  const rejected = bridgeCtx({ outcome: "rejected" });
  const empty = await new CodexApprovalBridge(rejected, "sess-approval", undefined)
    .handlePermissionsApproval(params);
  assert.deepEqual(empty, { permissions: {}, scope: "turn" });
});

test("user input bridge maps questions and merges selected with custom text", async () => {
  const params = {
    threadId: "th-1",
    turnId: "turn-1",
    itemId: "item-4",
    isBlocking: true,
    questions: [
      {
        id: "q1",
        header: "确认",
        question: "使用哪个环境？",
        options: [
          { label: "测试", description: "test env" },
          { label: "生产", description: "prod env" },
        ],
      },
      { id: "q2", header: "", question: "备注" },
    ],
  };
  ToolRequestUserInputParams.parse(params);
  const ctx = bridgeCtx({
    answer: {
      answers: [
        { id: "q1", selected: ["测试"] },
        { id: "q2", selected: [], custom: "无" },
      ],
    },
  });
  const response = await new CodexApprovalBridge(ctx, "sess-approval", undefined)
    .handleUserInput(params);
  assert.deepEqual(response, {
    action: "accept",
    answers: { q1: { answers: ["测试"] }, q2: { answers: ["无"] } },
  });
  // 选项透传给用户问题服务。
  assert.deepEqual(ctx.asked[0].questions[0].options, [
    { label: "测试", description: "test env" },
    { label: "生产", description: "prod env" },
  ]);
});

test("elicitation bridge builds form questions and typed content", async () => {
  const formParams = {
    threadId: "th-1",
    turnId: null,
    serverName: "demo-mcp",
    mode: "form",
    message: "确认外部授权",
    requestedSchema: {
      type: "object",
      properties: {
        env: { type: "string", enum: ["dev", "prod"], title: "环境" },
        count: { type: "number" },
        force: { type: "boolean" },
      },
      required: ["env"],
    },
  };
  McpServerElicitationRequestParams.parse(formParams);
  const ctx = bridgeCtx({
    answer: {
      answers: [
        { id: "env", selected: ["prod"] },
        { id: "count", selected: [], custom: "3" },
        { id: "force", selected: [], custom: "true" },
      ],
    },
  });
  const response = await new CodexApprovalBridge(ctx, "sess-approval", undefined)
    .handleElicitation(formParams);
  assert.deepEqual(response, {
    action: "accept",
    content: { env: "prod", count: 3, force: true },
  });
  // 枚举属性映射为选项。
  assert.deepEqual(ctx.asked[0].questions.find((q) => q.id === "env").options, [
    { label: "dev" },
    { label: "prod" },
  ]);
  // 用户中止 → cancel；其余失败（含无应答者）→ decline。
  const aborted = bridgeCtx({ error: Object.assign(new Error("aborted"), { code: "ASK_ABORTED" }) });
  assert.deepEqual(
    await new CodexApprovalBridge(aborted, "sess-approval", undefined).handleElicitation(formParams),
    { action: "cancel" },
  );
  const noProvider = bridgeCtx({ error: Object.assign(new Error("nope"), { code: "NO_PROVIDER" }) });
  assert.deepEqual(
    await new CodexApprovalBridge(noProvider, "sess-approval", undefined).handleElicitation(formParams),
    { action: "decline" },
  );
  // 无用户问题服务：拒绝。
  const bare = new CodexApprovalBridge(bridgeCtx({}), "sess-approval", undefined);
  assert.deepEqual(await bare.handleElicitation(formParams), { action: "decline" });
});

test("approval bridge passes the turn abort signal to the approval service", async () => {
  // 停止/中断路径：回合级 AbortController 的信号透传给审批/问题服务，
  // 由服务侧归结 cancelled / ASK_ABORTED（映射已由上方用例覆盖）。
  const controller = new AbortController();
  const signals = [];
  const ctx = {
    logger: { warn: () => undefined },
    agents: { get: () => ({ id: "sess-approval" }) },
    approval: {
      request: async (req) => {
        signals.push(req.signal);
        return "allowed-once";
      },
    },
  };
  const bridge = new CodexApprovalBridge(ctx, "sess-approval", controller.signal);
  await bridge.handleCommandApproval(commandApprovalParams);
  assert.equal(signals[0], controller.signal);
});

// ---- 原生执行叙述投影（feat08 v1） ----
import {
  NATIVE_DIFF_NOTE_ID,
  NATIVE_NOTE_LIMIT,
  diffBudgetAccepts,
  diffSummaryLineOf,
  nativeCompletionNoteOf,
  nativeHeaderOf,
  newDiffBudget,
  newNoteBudget,
} from "../../packages/codex-cli/lib/src/native-items.js";

test("native headers and completion notes cover narratable item types", () => {
  const command = nativeHeaderOf({
    type: "commandExecution",
    id: "cmd-1",
    command: "git status",
    cwd: "/repo",
    status: "inProgress",
  });
  assert.equal(command.itemId, "cmd-1");
  assert.ok(command.header.includes("[codex 原生·命令]"));
  assert.ok(command.header.includes("git status"));
  assert.ok(command.header.includes("/repo"));
  assert.ok(nativeHeaderOf({ type: "mcpToolCall", id: "m-1", server: "srv", tool: "tool" }).header.includes("srv/tool"));
  assert.ok(nativeHeaderOf({ type: "imageView", id: "v-1" }).header.includes("查看图片"));
  assert.ok(nativeHeaderOf({ type: "imageGeneration", id: "g-1" }).header.includes("图片生成"));
  assert.deepEqual(nativeHeaderOf({ type: "fileChange", id: "f-1", changes: [{}, {}] }).header, "▸ [codex 原生·文件修改] 2 个文件变更");
  // 模型自产与 KMH 桥条目不叙述。
  assert.equal(nativeHeaderOf({ type: "agentMessage", id: "a", text: "hi" }), undefined);
  assert.equal(nativeHeaderOf({ type: "dynamicToolCall", id: "d" }), undefined);
  // 完成状态：命令带退出码，其余带状态。
  const done = nativeCompletionNoteOf({
    type: "commandExecution", id: "cmd-1", status: "completed", exitCode: 0, durationMs: 1500,
  });
  assert.ok(done.includes("退出码 0"));
  assert.ok(done.includes("1.5s"));
  assert.ok(nativeCompletionNoteOf({ type: "mcpToolCall", id: "m-1", status: "completed" }).includes("完成"));
  assert.equal(nativeCompletionNoteOf({ type: "agentMessage", id: "a" }), undefined);
});

test("diff summary counts added and removed lines, budget caps updates", () => {
  const line = diffSummaryLineOf("+++\n---\n+a\n+b\n-c\n");
  assert.equal(line, "▸ [codex 原生·变更] turn diff 更新：+2/−1 行");
  const budget = newDiffBudget();
  for (let index = 0; index < 30; index += 1) {
    if (diffBudgetAccepts(budget)) budget.updates += 1;
  }
  assert.equal(budget.updates, 20);
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

test("cursor accepts trailing context injections after the real input", () => {
  // 新会话首轮实测形态：系统提示 + 真实输入 + 运行时上下文/技能清单/时间
  // 注入（source.kind 非 user）排在真实输入之后，2026-10-08 修复前误判
  // baseline-lost 导致首轮全走重建注入。
  const injected = (text) => ({
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: "context" },
  });
  const history = [
    { role: "system", content: [{ type: "text", text: "sys" }] },
    { ...user("你好"), source: { kind: "user" } },
    injected("runtime ctx"),
    injected("skills"),
    injected("time"),
  ];
  const increment = diffIncrement(history, emptySnapshot());
  assert.equal(increment.kind, "new-input");
  assert.equal(increment.text, "你好\n\nruntime ctx\n\nskills\n\ntime");
  assert.equal(increment.consumed, 5);
  // 注入在前同样透明（后续轮次）：Codex 自产回复按摘要核对后吞掉。
  const later = [
    ...history,
    {
      role: "assistant",
      content: [{ type: "text", text: "reply" }],
    },
    injected("ctx2"),
    { ...user("第二轮"), source: { kind: "user" } },
  ];
  const replyDigest = blockDigest({ type: "text", text: "reply" });
  const second = diffIncrement(
    later,
    snapshotAt(history, history.length, [replyDigest]),
  );
  assert.equal(second.kind, "new-input");
  assert.ok(second.text.startsWith("第二轮"));
  // 尾随注入后再出现真实用户输入以外的人物（assistant/外来回复）仍断基线。
  const foreign = [
    ...history,
    { role: "assistant", content: [{ type: "text", text: "foreign" }] },
  ];
  const lost = diffIncrement(foreign, snapshotAt(history, history.length));
  assert.equal(lost.kind, "baseline-lost");
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
    // 用量样本（token usage）：每个 step 恰一条 usage chunk，且两步之和
    // 等于回合真实总量（工具步样本晚到时首步为零、终局合并剩余，之和不变）。
    const usageOf = (chunks) => {
      const samples = chunks.filter((chunk) => chunk.type === "usage");
      assert.equal(samples.length, 1);
      return samples[0].usage;
    };
    const firstUsage = usageOf(first);
    const finalUsage = usageOf(second);
    assert.equal(
      firstUsage.totalTokens + finalUsage.totalTokens,
      1030 + 1240,
    );
    // 拆分口径与官方总数一致性（normalizeUsage 规则）。
    const merged = finalUsage;
    assert.equal(
      merged.totalTokens,
      merged.outputTokens +
        merged.inputTokens +
        (merged.cacheReadTokens ?? 0) +
        (merged.cacheWriteTokens ?? 0),
    );
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
    // D17 权限档：harness 无投影服务，走回落默认即可（真实映射另有 argv smoke）。
    resolvePermission: () => ({ sandbox: "workspace-write", approval: "ask" }),
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
  const spawnOnce = async (selection, permission) => {
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
          ...(permission === undefined ? {} : { permission }),
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
    // D17 权限档：选中执行类工具时注入沙箱/审批参数（ask→on-request）；
    // 未选中执行类工具时不注入（不影响默认行为如生图落盘）。
    const asked = await spawnOnce(
      { ...selectionFromLegacy(false), commandExecution: true },
      { sandbox: "workspace-write", approval: "ask" },
    );
    assert.ok(asked.includes('sandbox_mode="workspace-write"'));
    assert.ok(asked.includes('approval_policy="on-request"'));
    // D15/D20：请求审批档必须把提权审查路由给用户（0.162 默认 auto_review
    // 会静默放行提权命令，不发客户端审批请求）。
    assert.ok(asked.includes('approvals_reviewer="user"'));
    const never = await spawnOnce(selectionFromLegacy(true), {
      sandbox: "danger-full-access",
      approval: "never",
    });
    assert.ok(never.includes('sandbox_mode="danger-full-access"'));
    assert.ok(never.includes('approval_policy="never"'));
    assert.ok(!never.includes("approvals_reviewer="));
    const untouched = await spawnOnce(
      { ...selectionFromLegacy(false), viewImage: true },
      { sandbox: "workspace-write", approval: "ask" },
    );
    assert.ok(!untouched.includes("sandbox_mode="));
    assert.ok(!untouched.includes("approval_policy="));
  } finally {
    await fixture.close();
  }
});

test("native execution narration projects item lifecycle into the stream", { skip: !findCodexBinary() }, async () => {
  const { PassThrough } = await import("node:stream");
  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
  const fixture = await startFixtureServer({ script: "delayedText" });
  let inject;
  const { fakeCtx, config, cwd, fixtureOverrides } = makeBridgeHarness(fixture, "narrate", {
    wrapStdout: (stdout) => {
      const pass = new PassThrough();
      stdout.pipe(pass);
      inject = pass;
      return pass;
    },
  });
  const signal = AbortSignal.timeout(120000);
  const turn = new CodexTurn(fakeCtx, config, cwd, fixtureOverrides);
  try {
    await turn.start(
      {
        text: "run something",
        model: "gpt-6-sol",
        baseInstructions: "KMH owns all tools and skills.",
        tools: [],
      },
      undefined,
      signal,
    );
    const threadId = turn.threadId;
    // 模型响应延迟窗口内注入原生通知：started → 输出增量×2 → diff → completed。
    const notify = (method, params) =>
      inject.write(JSON.stringify({ method, params }) + "\n");
    const startedItem = {
      type: "commandExecution",
      id: "cmd-narrate",
      command: "echo kmh",
      cwd,
      status: "inProgress",
    };
    notify("item/started", { threadId, item: startedItem });
    notify("item/commandExecution/outputDelta", {
      threadId,
      turnId: "turn-x",
      itemId: "cmd-narrate",
      delta: "第一行输出\n",
    });
    notify("item/commandExecution/outputDelta", {
      threadId,
      turnId: "turn-x",
      itemId: "cmd-narrate",
      delta: "第二行输出\n",
    });
    notify("turn/diff/updated", {
      threadId,
      turnId: "turn-x",
      diff: "+a\n-b\n",
    });
    notify("item/completed", {
      threadId,
      item: { ...startedItem, status: "completed", exitCode: 0, durationMs: 1200 },
    });
    const chunks = [];
    for await (const chunk of turn.pump(signal)) chunks.push(chunk);
    const deltas = chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.text)
      .join("");
    // 叙述完整链路：来源与命令 → 输出增量 → diff 摘要 → 完成状态（场景1/2）。
    assert.ok(deltas.includes("[codex 原生·命令] echo kmh"));
    assert.ok(deltas.includes("第一行输出"));
    assert.ok(deltas.includes("第二行输出"));
    assert.ok(deltas.includes("turn diff 更新：+1/−1 行"));
    assert.ok(deltas.includes("退出码 0"));
    // 模型最终文本仍在（叙述不干扰正文）。
    assert.ok(deltas.includes("BRIDGE_OK"));
    // 叙述块以全文收尾（block-end 权威内容，差分账目依据）。
    const noteEnd = chunks.find(
      (chunk) =>
        chunk.type === "block-end" &&
        chunk.block?.type === "text" &&
        String(chunk.block.text).includes("[codex 原生·命令]"),
    );
    assert.ok(noteEnd !== undefined);
    const noteText = String(noteEnd.block.text);
    assert.ok(noteText.includes("第一行输出"));
    assert.ok(noteText.includes("退出码 0"));
    assert.ok(chunks.some((chunk) => chunk.type === "finish" && chunk.reason?.kind === "stop"));
  } finally {
    await turn.dispose();
    await fixture.close();
  }
});

test("codex native compaction notification keeps bridge and diff stable", { skip: !findCodexBinary() }, async () => {
  const { PassThrough } = await import("node:stream");  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
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

// ---- 会话底部状态小球（client dock 注册与渲染） ----
import { runInNewContext } from "node:vm";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { readFileSync as readFileSyncForClient } from "node:fs";

test("client registers the live ball dock and renders the three states", () => {
  let handoff;
  runInNewContext(
    readFileSyncForClient("packages/codex-cli/lib/client.js", "utf8"),
    {
      window: {
        __ModuleLoader__: {
          load: (value) => {
            handoff = value;
          },
        },
      },
    },
  );
  assert.equal(handoff.id, "@kmh/codex-cli");
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
    assert.ok(
      ["react", "react/jsx-runtime"].includes(name),
      name,
    );
    return require(name);
  });
  let copy;
  let dockEntry;
  let dockComponent;
  const injected = [];
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
        injected.push(name);
        return setup();
      },
      register: (entry, component) => {
        if (entry.name === "conversation.composer.dock") {
          dockEntry = entry;
          dockComponent = component;
        }
        return () => {};
      },
    },
  });
  assert.deepEqual(injected, ["plugins.item", "conversation.composer.dock"]);
  assert.equal(dockEntry.id, "codex-cli-live");
  // 排在活动/用量药丸之后（第 n 轮第 n 步行最右）。
  assert.ok(dockEntry.order > 1);
  assert.equal(typeof dockComponent, "function");
  const t = (key) => copy.zh[key];
  const ball = (color) =>
    renderer.renderToStaticMarkup(
      react.createElement(client.LiveBallView, {
        entry: {
          sessionId: "s",
          color,
          streaming: color === "green",
          detail: "d",
          updatedAt: 0,
        },
        t,
      }),
    );
  assert.match(ball("green"), /state-success-primary/);
  assert.match(ball("green"), /通信正常/);
  assert.match(ball("gray"), /state-idle-primary/);
  assert.match(ball("gray"), /已停止/);
  assert.match(ball("red"), /state-error-primary/);
  assert.match(ball("red"), /状态异常/);
});

// ---- 生图投影整链（真实 CLI + fixture 注入 imageGeneration 完成通知） ----
test("image generation projects an image block beside its narration", { skip: !findCodexBinary() }, async () => {
  const { PassThrough } = await import("node:stream");
  const { writeFileSync } = await import("node:fs");
  const { CodexTurn } = await import("../../packages/codex-cli/lib/src/turn.js");
  const fixture = await startFixtureServer({ script: "delayedText" });
  let inject;
  const { fakeCtx, config, cwd, fixtureOverrides } = makeBridgeHarness(fixture, "image", {
    wrapStdout: (stdout) => {
      const pass = new PassThrough();
      stdout.pipe(pass);
      inject = pass;
      return pass;
    },
  });
  // 附件服务假实现：saveImages 回一个可识别的引用。
  fakeCtx.attachments = {
    saveImages: async (inputs) => [{ attachmentId: "att-img-1" }],
  };
  const signal = AbortSignal.timeout(120000);
  const turn = new CodexTurn(fakeCtx, config, cwd, fixtureOverrides);
  try {
    await turn.start(
      {
        text: "画一张小图",
        model: "gpt-6-sol",
        baseInstructions: "KMH owns all tools and skills.",
        tools: [],
      },
      undefined,
      signal,
    );
    const threadId = turn.threadId;
    // 构造 2×3 最小 PNG（签名 + IHDR，pngSizeOf 只读 IHDR 宽高）。
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(2, 0);
    ihdr.writeUInt32BE(3, 4);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from([0, 0, 0, 13]),
      Buffer.from("IHDR"),
      ihdr,
      Buffer.alloc(4),
    ]);
    const imagePath = join(cwd, "generated.png");
    writeFileSync(imagePath, png);
    const notify = (method, params) =>
      inject.write(JSON.stringify({ method, params }) + "\n");
    // 叙述块（feat08）与投影块（feat10）共用 item id：索引必须互不覆盖。
    notify("item/started", {
      threadId,
      item: {
        type: "imageGeneration",
        id: "gen-1",
        status: "inProgress",
        revisedPrompt: "a tiny image",
      },
    });
    notify("item/completed", {
      threadId,
      item: {
        type: "imageGeneration",
        id: "gen-1",
        status: "completed",
        revisedPrompt: "a tiny image",
        savedPath: imagePath,
      },
    });
    const chunks = [];
    for await (const chunk of turn.pump(signal)) chunks.push(chunk);
    // 叙述文本块与 image 块并存（2026-10-08 前索引冲突导致 image 块被组装器丢弃）。
    const narration = chunks.find(
      (chunk) =>
        chunk.type === "block-end" &&
        chunk.block?.type === "text" &&
        String(chunk.block.text).includes("[codex 原生·图片生成]"),
    );
    assert.ok(narration !== undefined, "narration text block missing");
    const imageEnd = chunks.find(
      (chunk) =>
        chunk.type === "block-end" && chunk.block?.type === "image",
    );
    assert.ok(imageEnd !== undefined, "image block missing");
    assert.equal(imageEnd.block.attachment.attachmentId, "att-img-1");
    assert.notEqual(imageEnd.index, narration.index);
    // 尺寸附注按实际像素报告。
    const deltas = chunks
      .filter((chunk) => chunk.type === "text-delta")
      .map((chunk) => chunk.text)
      .join("");
    assert.ok(deltas.includes("实际尺寸 2×3"));
    assert.ok(chunks.some((chunk) => chunk.type === "finish" && chunk.reason?.kind === "stop"));
  } finally {
    await turn.dispose();
    await fixture.close();
  }
});
