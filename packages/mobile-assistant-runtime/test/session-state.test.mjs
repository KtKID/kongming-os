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
  "V01/V02/V03/V08 会话准备、真实挂起继续、重复与旧目标保护",
  { timeout: 60000 },
  async () => {
    const home = await mkdtemp(join(tmpdir(), "kmh-session-observation-"));
    const cwd = join(home, "workspace");
    await mkdir(cwd);
    let requests = 0;
    const model = createServer(async (req, res) => {
      for await (const chunk of req) {
      }
      requests++;
      if (requests === 1) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(
          "data: " +
            JSON.stringify({
              type: "message_start",
              message: {
                id: "hold",
                model: "deepseek-flash",
                usage: { input_tokens: 1, output_tokens: 0 },
              },
            }) +
            "\n\n",
        );
      } else respond(res, "continued answer");
    });
    model.listen(0, "127.0.0.1");
    await once(model, "listening");
    const client = sdk(home, cwd, "http://127.0.0.1:" + model.address().port);
    const query = { sessionId: "session", contextId: "phone" };
    try {
      const initialized = await client.request("initialize", {
        cwd,
        provider: "deepseek-official",
        model: "deepseek-flash",
      });
      assert.equal(initialized.kmhSessionObservation.version, 1);
      const missing = await client.request("kmh/session/get", query);
      assert.equal(missing.agentAvailable, false);
      assert.equal(requests, 0);
      const idle = await client.request("kmh/session/get", {
        ...query,
        prepare: true,
      });
      assert.equal(idle.status, "idle");
      assert.equal(idle.submissionPending, false);
      assert.deepEqual(await client.request("kmh/session/get", query), idle);
      assert.equal(requests, 0);
      await client.request("session/prompt", {
        sessionId: "session",
        task: { taskId: "t", contextId: "phone" },
        contentBlocks: [{ type: "text", text: "hold" }],
      });
      await waitUntil(() => requests === 1);
      const running = await client.request("kmh/session/get", query);
      assert.equal(running.status, "running");
      await assert.rejects(
        client.request("session/prompt", {
          sessionId: "session",
          task: { taskId: "duplicate", contextId: "phone" },
          contentBlocks: [{ type: "text", text: "draft" }],
        }),
        /TASK_BUSY/,
      );
      await client.request("session/prompt", {
        sessionId: "session",
        contentBlocks: [{ type: "text", text: "queued on computer" }],
      });
      const params = {
        ...query,
        operationId: "stop",
        expectedExecutionRef: running.executionRef,
      };
      const [stopped, repeated] = await Promise.all([
        client.request("kmh/session/cancel", params),
        client.request("kmh/session/cancel", params),
      ]);
      assert.deepEqual(repeated, stopped);
      assert.equal(stopped.outcome, "completed");
      assert.equal(stopped.observation.status, "suspended");
      assert.equal(requests, 1);
      await assert.rejects(
        client.request("kmh/session/resume", params),
        /TASK_PROTOCOL_ERROR/,
      );
      const resumed = await client.request("kmh/session/resume", {
        ...query,
        operationId: "resume",
        expectedExecutionRef: stopped.observation.executionRef,
      });
      assert.equal(resumed.outcome, "completed");
      await waitUntil(
        async () =>
          requests === 2 &&
          (await client.request("kmh/session/get", query)).status === "idle",
      );
      const late = await client.request("kmh/session/cancel", {
        ...query,
        operationId: "late",
        expectedExecutionRef: running.executionRef,
      });
      assert.equal(late.outcome, "target-changed");
      assert.equal(requests, 2);
      const original = await client.request("kmh/task/get", {
        ...query,
        taskId: "t",
      });
      assert.equal(original.outcome.kind, "aborted");
      assert.equal(original.executionStopped, true);
      assert.ok(
        client.notifications.some(
          (f) =>
            f.method === "kmh/session/status" &&
            f.params.observation.status === "running",
        ),
      );
      assert.ok(
        client.notifications.some(
          (f) =>
            f.method === "kmh/session/status" &&
            f.params.observation.status === "suspended",
        ),
      );
    } finally {
      await client.close();
      model.closeAllConnections();
      await new Promise((r) => model.close(r));
      await rm(home, { recursive: true, force: true });
    }
  },
);
