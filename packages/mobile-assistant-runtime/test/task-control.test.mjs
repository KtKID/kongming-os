/** 真实 KMH 启动器、Agent 和模型传输验证停止确认、查询及跨进程原结果恢复。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
const root = fileURLToPath(new URL("../../../", import.meta.url));

function sdk(home, cwd, url) {
  const child = spawn(
    process.execPath,
    [join(root, "scripts/kmh.mjs"), "dsh", "--profile", "kmh-mobile-assistant"],
    {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        KMH_HOME: home,
        DEEPSEEK_API_KEY: "test-only",
        DEEPSEEK_BASE_URL: url,
        DSH_TELEMETRY_DISABLED: "1",
      },
    },
  );
  const pending = new Map();
  let serial = 0;
  let stderr = "";
  const notifications = [];
  child.stderr.on("data", (b) => {
    stderr += b;
  });
  createInterface({ input: child.stdout }).on("line", (line) => {
    let frame;
    try {
      frame = JSON.parse(line);
    } catch {
      return;
    }
    if (frame.id !== undefined && frame.method === undefined) {
      const request = pending.get(frame.id);
      if (request) {
        pending.delete(frame.id);
        clearTimeout(request.timer);
        frame.error
          ? request.reject(Error(frame.error.message))
          : request.resolve(frame.result);
      }
    } else if (frame.method === "approval/ask" && frame.id !== undefined) {
      child.stdin.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: frame.id,
          result: { outcome: "allowed-once" },
        }) + "\n",
      );
      notifications.push(frame);
    } else notifications.push(frame);
  });
  child.on("exit", () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("SDK退出：" + stderr));
    }
    pending.clear();
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = ++serial;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(Error(method + " 超时：" + stderr));
      }, 10000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  return {
    request,
    notifications,
    async close() {
      if (child.exitCode !== null) return;
      const exit = once(child, "exit");
      await request("shutdown").catch(() => child.kill());
      await exit;
    },
  };
}
function respond(res, text) {
  const events = [
    {
      type: "message_start",
      message: {
        id: "control-test",
        model: "deepseek-flash",
        usage: { input_tokens: 1, output_tokens: 0 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn" },
      usage: { output_tokens: 1 },
    },
    { type: "message_stop" },
  ];
  res.writeHead(200, { "Content-Type": "text/event-stream" });
  res.end(events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""));
}
async function waitUntil(predicate) {
  for (let i = 0; i < 300; i++) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw Error("等待条件超时");
}

test(
  "T16/T19/T21 · 确认真实执行停止，复用停止结果，保持下一条与历史恢复",
  { timeout: 60000 },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), "kmh-task-control-"));
    const cwd = join(home, "workspace");
    await mkdir(cwd);
    let requests = 0,
      aborted = 0;
    const open = new Set();
    const model = createServer(async (req, res) => {
      for await (const _chunk of req) {
      }
      requests++;
      if (requests === 1) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          "data: " +
            JSON.stringify({
              type: "message_start",
              message: {
                id: "hang",
                model: "deepseek-flash",
                usage: { input_tokens: 1, output_tokens: 0 },
              },
            }) +
            "\n\n",
        );
        open.add(res);
        res.on("close", () => {
          if (!res.writableEnded) aborted++;
          open.delete(res);
        });
      } else respond(res, "停止后的新回答");
    });
    model.listen(0, "127.0.0.1");
    await once(model, "listening");
    const url = "http://127.0.0.1:" + model.address().port;
    const instances = [];
    t.after(async () => {
      for (const s of instances) await s.close();
      for (const r of open) r.destroy();
      model.closeAllConnections();
      await new Promise((r) => model.close(r));
      await rm(home, { recursive: true, force: true });
    });
    const first = sdk(home, cwd, url);
    instances.push(first);
    const initialized = await first.request("initialize", {
      cwd,
      provider: "deepseek-official",
      model: "deepseek-flash",
    });
    assert.equal(initialized.kmhTaskControl?.version, 1);
    const identity = { taskId: "task-first", contextId: "conversation" };
    await first.request("session/prompt", {
      sessionId: "durable-control",
      task: identity,
      contentBlocks: [{ type: "text", text: "CONTROL_FIRST" }],
    });
    await waitUntil(() => requests === 1);
    await new Promise((resolve) => setTimeout(resolve, 300));
    // 另一个 SDK 只能读取已有日志；当前写 ownership 保持在原执行者。
    const observer = sdk(home, cwd, url);
    instances.push(observer);
    await observer.request("initialize", {
      cwd,
      provider: "deepseek-official",
      model: "deepseek-flash",
    });
    const ownedElsewhere = await observer.request("kmh/task/get", {
      ...identity,
      sessionId: "durable-control",
    });
    assert.equal(ownedElsewhere.sessionState, "unavailable");
    assert.equal(ownedElsewhere.executionStopped, null);
    assert.equal(requests, 1);
    await observer.close();
    const control = {
      ...identity,
      sessionId: "durable-control",
      operationId: "stop-first",
    };
    const [stopped, duplicate] = await Promise.all([
      first.request("kmh/task/cancel", control),
      first.request("kmh/task/cancel", control),
    ]);
    assert.equal(stopped.executionStopped, true);
    assert.equal(stopped.outcome.kind, "aborted");
    assert.equal(stopped.detail.code, "TASK_ABORTED_USER");
    assert.deepEqual(duplicate, stopped);
    await waitUntil(() => aborted === 1);
    const secondId = { taskId: "task-second", contextId: "conversation" };
    await first.request("session/prompt", {
      sessionId: "durable-control",
      task: secondId,
      contentBlocks: [{ type: "text", text: "CONTROL_SECOND" }],
    });
    let result;
    await waitUntil(async () => {
      result = await first.request("kmh/task/get", {
        ...secondId,
        sessionId: "durable-control",
      });
      return result.outcome.kind === "completed";
    });
    assert.equal(result.answer, "停止后的新回答");
    assert.equal(requests, 2);
    await first.request("kmh/task/cancel", {
      ...control,
      operationId: "late-old-stop",
    });
    assert.equal(
      (
        await first.request("kmh/task/get", {
          ...secondId,
          sessionId: "durable-control",
        })
      ).outcome.kind,
      "completed",
    );
    await first.close();
    const restored = sdk(home, cwd, url);
    instances.push(restored);
    await restored.request("initialize", {
      cwd,
      provider: "deepseek-official",
      model: "deepseek-flash",
    });
    const historical = await restored.request("kmh/task/get", {
      ...secondId,
      sessionId: "durable-control",
    });
    assert.equal(historical.answer, "停止后的新回答");
    assert.equal(historical.outcome.kind, "completed");
    assert.equal(requests, 2);
    const missing = await restored.request("kmh/task/get", {
      sessionId: "durable-control",
      taskId: "missing",
      contextId: "conversation",
    });
    assert.equal(missing.outcome.kind, "unknown");
    assert.equal(missing.executionStopped, true);
    assert.equal(missing.sessionState, "idle");
    const absent = await restored.request("kmh/task/get", {
      sessionId: "absent-session",
      taskId: "absent",
      contextId: "conversation",
    });
    assert.equal(absent.executionStopped, null);
  },
);

import { createTaskStore } from "../lib/task-store.js";
import { createTaskRuntime, projectTask } from "../lib/task-state.js";
import { readFile, writeFile, readdir, stat } from "node:fs/promises";

const binding = {
  version: 1,
  taskId: "t",
  contextId: "c",
  internalSessionId: "s",
  messageId: "m",
  beforeSeq: -1,
  admission: "accepted",
  createdAt: 1,
};
const log = (reason = { kind: "completed" }) => [
  { seq: 0, type: "turn/start", data: { turn: 0 } },
  { seq: 1, type: "user/message", data: { id: "m" } },
  {
    seq: 2,
    type: "assistant/message",
    data: {
      turn: 0,
      message: { content: [{ type: "text", text: "原始正文" }] },
    },
  },
  { seq: 3, type: "turn/end", data: { turn: 0, reason } },
  { seq: 4, type: "turn/start", data: { turn: 1 } },
  {
    seq: 5,
    type: "assistant/message",
    data: {
      turn: 1,
      message: { content: [{ type: "text", text: "其他任务" }] },
    },
  },
];
for (const reason of [
  { kind: "completed" },
  ...["user", "parent", "hook", "disposed"].map((kind) => ({
    kind: "aborted",
    reason: { kind, reason: "具体原因" },
  })),
  { kind: "aborted" },
  { kind: "blocked" },
  { kind: "max-tokens" },
  { kind: "error", error: { code: 429, message: "模型繁忙" } },
  { kind: "interrupted" },
  { kind: "forked" },
  { kind: "future" },
])
  test("T6/T14 原日志投影保持所属正文及原因 " + JSON.stringify(reason), () => {
    const projected = projectTask(binding, log(reason), "running", "e", 1);
    assert.equal(projected.answer, "原始正文");
    assert.equal(projected.executionStopped, true);
    assert.equal(projected.sessionState, "running");
    assert.equal(
      projected.outcome.kind,
      reason.kind === "future" ? "unknown" : reason.kind,
    );
    if (reason.kind !== "completed") assert.ok(projected.detail?.message);
  });
test("T13 索引重启、并发写入、归属冲突和损坏记录均明确处理", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kmh-task-store-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createTaskStore(root);
  await Promise.all([
    store.put({ ...binding, admission: "intent" }),
    store.put({ ...binding, turn: 0 }),
    store.put({ ...binding, admission: "intent", answer: "禁止缓存正文" }),
  ]);
  const restored = await createTaskStore(root).get("c", "t");
  assert.equal(restored.admission, "accepted");
  assert.equal(restored.turn, 0);
  assert.equal("answer" in restored, false);
  assert.equal(await store.get("foreign", "t"), undefined);
  await assert.rejects(
    store.put({ ...binding, messageId: "foreign" }),
    /绑定其他消息/,
  );
  const [file] = await readdir(root);
  const path = join(root, file);
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  await writeFile(path, "{broken");
  await assert.rejects(store.get("c", "t"));
});
test("T13/T19 重启后的日志归属保护正在执行的新 turn", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kmh-task-owner-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createTaskStore(root);
  await store.put({ ...binding, turn: 0 });
  let canceled = 0,
    resumed = 0;
  const agent = {
    status: "suspended",
    cancel() {
      canceled++;
    },
    unsuspend() {
      resumed++;
    },
    inbox: {
      remove() {
        return false;
      },
    },
    async whenIdle() {},
  };
  const runtime = createTaskRuntime({
    store,
    observeAgent: async () => agent,
    readEvents: async () => log(),
    flush: async () => {},
  });
  await runtime.cancel({ ...binding, operationId: "late" });
  await runtime.resume({ ...binding, operationId: "late" });
  assert.equal(canceled, 0);
  assert.equal(resumed, 0);
  // 旧任务的结束记录缺失，活动已被新的 turn 接管。
  const broken = log().filter((e) => e.type !== "turn/end");
  const uncertain = createTaskRuntime({
    store,
    observeAgent: async () => agent,
    readEvents: async () => broken,
    flush: async () => {},
  });
  await assert.rejects(
    uncertain.cancel({ ...binding, operationId: "late" }),
    /TASK_STOP_FAILED/,
  );
  assert.equal(canceled, 0);
});
test("T16 执行前移除事实持久保存；whenIdle 完成前保持停止中", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "kmh-task-pending-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createTaskStore(root);
  let finish;
  const idle = new Promise((resolve) => (finish = resolve));
  let status = "running",
    removed = 0;
  const runtime = createTaskRuntime({
    store,
    observeAgent: async () => ({
      get status() {
        return status;
      },
      inbox: {
        remove(id) {
          assert.equal(id, "m");
          removed++;
          return true;
        },
      },
      cancel(cause, options) {
        assert.equal(cause.kind, "user");
        assert.equal(options.keepInbox, true);
      },
      whenIdle: () => idle,
    }),
    readEvents: async () => [],
    flush: async () => {},
  });
  await runtime.admit(binding);
  const stopped = runtime.cancel({ ...binding, operationId: "stop" });
  await waitUntil(() => removed === 1);
  assert.equal(runtime.isStopping("s"), true);
  await assert.rejects(
    runtime.admit({ ...binding, taskId: "next", messageId: "new" }),
    /TASK_BUSY/,
  );
  status = "idle";
  finish();
  const result = await stopped;
  assert.equal(result.outcome.kind, "aborted");
  assert.equal(result.detail.code, "TASK_ABORTED_USER");
  assert.equal(result.executionStopped, true);
  assert.equal(
    (await createTaskStore(root).get("c", "t")).stoppedBeforeTurn,
    true,
  );
});
test(
  "T12/T20 真实 Agent 停止保留已有其他输入，挂起后显式继续",
  { timeout: 60000 },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), "kmh-task-suspended-"));
    const cwd = join(home, "workspace");
    await mkdir(cwd);
    let requests = 0;
    let held;
    const model = createServer(async (req, res) => {
      for await (const _chunk of req) {
      }
      requests++;
      if (requests === 1) {
        held = res;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          "data: " +
            JSON.stringify({
              type: "message_start",
              message: {
                id: "hang",
                model: "deepseek-flash",
                usage: { input_tokens: 1, output_tokens: 0 },
              },
            }) +
            "\n\n",
        );
      } else respond(res, "继续已有输入");
    });
    model.listen(0, "127.0.0.1");
    await once(model, "listening");
    const app = sdk(home, cwd, "http://127.0.0.1:" + model.address().port);
    t.after(async () => {
      await app.close();
      held?.destroy();
      model.closeAllConnections();
      await new Promise((r) => model.close(r));
      await rm(home, { recursive: true, force: true });
    });
    await app.request("initialize", {
      cwd,
      provider: "deepseek-official",
      model: "deepseek-flash",
    });
    const task = {
      taskId: "original",
      contextId: "conversation",
      sessionId: "suspended-session",
    };
    await app.request("session/prompt", {
      sessionId: task.sessionId,
      task: { taskId: task.taskId, contextId: task.contextId },
      contentBlocks: [{ type: "text", text: "原任务" }],
    });
    await waitUntil(() => requests === 1);
    // 既有调用方已经排入另一条输入；手机仍只允许自己的单条输入。
    await app.request("session/prompt", {
      sessionId: task.sessionId,
      contentBlocks: [{ type: "text", text: "其他来源的已有输入" }],
    });
    const stopped = await app.request("kmh/task/cancel", {
      ...task,
      operationId: "stop",
    });
    assert.equal(stopped.outcome.kind, "aborted");
    assert.equal(stopped.sessionState, "suspended");
    assert.equal(stopped.executionStopped, true);
    assert.equal(requests, 1);
    const query = await app.request("kmh/task/get", task);
    assert.equal(query.sessionState, "suspended");
    assert.equal(requests, 1);
    await app.request("kmh/task/resume", { ...task, operationId: "continue" });
    await waitUntil(async () => {
      const q = await app.request("kmh/task/get", task);
      return q.sessionState === "idle";
    });
    assert.equal(requests, 2);
  },
);

test(
  "T16 · 真实 bash 子进程在停止确认前退出，后续文件写入被取消",
  { timeout: 60000 },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), "kmh-tool-stop-"));
    const cwd = join(home, "workspace");
    await mkdir(cwd);
    const pidFile = join(cwd, "tool.pid"),
      finished = join(cwd, "finished");
    let requests = 0;
    const model = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      requests++;
      if (requests === 1) {
        const body = JSON.parse(raw);
        const tool = body.tools.find((tool) => /(^|[-_])bash$/.test(tool.name));
        assert.ok(tool, "实际模型工具目录应提供 bash");
        const events = [
          {
            type: "message_start",
            message: {
              id: "tool-test",
              model: "deepseek-flash",
              usage: { input_tokens: 1, output_tokens: 0 },
            },
          },
          {
            type: "content_block_start",
            index: 0,
            content_block: {
              type: "tool_use",
              id: "call-stop-bash",
              name: tool.name,
              input: {},
            },
          },
          {
            type: "content_block_delta",
            index: 0,
            delta: {
              type: "input_json_delta",
              partial_json: JSON.stringify({
                description: "验证停止传播",
                command: `echo $$ > '${pidFile}'; sleep 20; touch '${finished}'`,
                workdir: cwd,
              }),
            },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "message_delta",
            delta: { stop_reason: "tool_use" },
            usage: { output_tokens: 1 },
          },
          { type: "message_stop" },
        ];
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(
          events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join(""),
        );
      } else respond(res, "工具停止后继续会话");
    });
    model.listen(0, "127.0.0.1");
    await once(model, "listening");
    const app = sdk(home, cwd, "http://127.0.0.1:" + model.address().port);
    t.after(async () => {
      await app.close();
      model.closeAllConnections();
      await new Promise((r) => model.close(r));
      await rm(home, { recursive: true, force: true });
    });
    await app.request("initialize", {
      cwd,
      provider: "deepseek-official",
      model: "deepseek-flash",
    });
    const identity = { taskId: "tool", contextId: "phone" };
    const sessionId = "tool-session";
    await app.request("session/prompt", {
      sessionId,
      task: identity,
      contentBlocks: [{ type: "text", text: "验证前台工具执行中止" }],
    });
    await waitUntil(async () => {
      try {
        return (await readFile(pidFile, "utf8")).trim() !== "";
      } catch {
        return false;
      }
    });
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    process.kill(pid, 0);
    const stopped = await app.request("kmh/task/cancel", {
      ...identity,
      sessionId,
      operationId: "stop-tool",
    });
    assert.equal(stopped.executionStopped, true);
    assert.equal(stopped.detail.code, "TASK_ABORTED_USER");
    assert.throws(() => process.kill(pid, 0));
    await assert.rejects(stat(finished), { code: "ENOENT" });
    assert.equal(requests, 1);
    await app.request("session/prompt", {
      sessionId,
      task: { taskId: "after-tool", contextId: "phone" },
      contentBlocks: [{ type: "text", text: "下一条" }],
    });
    await waitUntil(() => requests === 2);
  },
);

test("removed pending input remains stopped while a different task runs", () => {
  const result = projectTask(
    { ...binding, turn: undefined, stoppedBeforeTurn: true },
    [],
    "running",
    "epoch",
    1,
  );
  assert.equal(result.outcome.kind, "aborted");
  assert.equal(result.executionStopped, true);
  assert.equal(result.sessionState, "running");
});

import { MobileAssistantServer } from "../lib/server.js";
test("QA image admission serializes get/cancel until the original submission settles", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "kmh-admission-stop-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let releaseImage;
  const imageReady = new Promise((resolve) => (releaseImage = resolve));
  let entered = false,
    prompts = 0,
    cancels = 0,
    queued;
  const agent = {
    id: "agent",
    status: "idle",
    session: { seq: 0 },
    inbox: {
      nextTurn: [],
      nextStep: [],
      remove(id) {
        if (id !== queued) return false;
        queued = undefined;
        return true;
      },
    },
    followup(message) {
      prompts++;
      queued = message.id;
      this.status = "running";
    },
    cancel() {
      cancels++;
      this.status = "idle";
    },
    whenIdle: async () => {},
  };
  const runtime = createTaskRuntime({
    store: createTaskStore(dir),
    observeAgent: async () => agent,
    readEvents: async () => [],
    flush: async () => {},
  });
  // Exercise the actual server methods; replace only attachment I/O and the public Agent endpoint.
  const server = Object.assign(Object.create(MobileAssistantServer.prototype), {
    mobileCtx: {
      agents: { get: () => agent },
      sessionPersistence: { flush: async () => {} },
      get(name) {
        if (name === "attachments")
          return {
            saveImages: async () => {
              entered = true;
              await imageReady;
              return [{ attachmentId: "image", mediaType: "image/png" }];
            },
          };
      },
    },
    handles: new Map([["s", { agent }]]),
    opening: new Map(),
    abort: new AbortController(),
    route: { cwd: dir, provider: "test", model: "test" },
    tasks: runtime,
    submitting: new Set(),
    submissions: new Map(),
    controlling: new Set(),
    activeTasks: new Map(),
    activeInputs: new Map(),
    sessionContexts: new Map(),
    executions: new Map(),
    observations: new Map(),
    sessionEpoch: "fixture",
    mobilePeer: { notify() {} },
  });
  const task = {
    taskId: "image-task",
    contextId: "phone",
    sessionId: "s",
    operationId: "stop",
  };
  const admission = server.prompt({
    sessionId: "s",
    task: { taskId: task.taskId, contextId: task.contextId },
    contentBlocks: [{ type: "image", data: "dGVzdA==", mimeType: "image/png" }],
  });
  await waitUntil(() => entered);
  let cancelSettled = false,
    getSettled = false;
  const cancelled = server.cancelTask(task).then((value) => {
    cancelSettled = true;
    return value;
  });
  const queried = server.getTask(task).then((value) => {
    getSettled = true;
    return value;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const earlyCancel = cancelSettled,
    earlyGet = getSettled;
  releaseImage();
  await admission;
  const stopped = await cancelled;
  await queried;
  assert.equal(
    earlyCancel,
    false,
    "cancel must wait for original image admission",
  );
  assert.equal(earlyGet, false, "get must keep the original admission barrier");
  assert.equal(stopped.executionStopped, true);
  assert.equal(stopped.outcome.kind, "aborted");
  assert.equal(cancels, 1);
  const after = prompts;
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(prompts, after);
  assert.equal(agent.status, "idle");
});
