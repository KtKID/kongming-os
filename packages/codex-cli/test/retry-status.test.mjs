/** 真实 CLI 的连接失败、恢复、等待取消与请求时限。 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { harness, run, until } from "./support/harness.mjs";

const input = {
  sessionId: "retry-status",
  messages: [{ role: "user", content: [{ type: "text", text: "say hello" }] }],
};

/** 先挂拒绝处理器，避免断言阶段的在途请求形成未处理拒绝。 */
function outcome(promise) {
  return promise.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
}

/** 有界断言：实现缺失时测试按时失败，清理由测试 fixture 执行。 */
async function bounded(promise, timeoutMs = 5000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("request remained pending")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test("retry and failure reasons are visible in the dock", () => {
  let handoff;
  runInNewContext(
    readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"),
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
  const require = createRequire(
    new URL(
      "../../../third_party/dsh/packages/client/ui-renderer/package.json",
      import.meta.url,
    ),
  );
  const react = require("react");
  const renderer = require("react-dom/server");
  const client = handoff.factory((name) =>
    name === "@deepseek-ai/dsh-client-ui-primitives" ? {} : require(name),
  );
  let dictionaries;
  client.apply({
    effect: (setup) => setup(),
    locale: {
      bind: () => (key) => dictionaries.zh[key],
      register: (_, copy) => {
        dictionaries = copy;
        return () => {};
      },
    },
    slots: { inject: (_, setup) => setup(), register: () => () => {} },
  });
  const render = (locale, color, retrying) =>
    renderer.renderToStaticMarkup(
      react.createElement(client.LiveBallView, {
        entry: {
          sessionId: "s",
          color,
          streaming: retrying,
          retrying,
          detail: "fixture unavailable",
          updatedAt: 0,
        },
        t: (key) => dictionaries[locale][key],
      }),
    );
  assert.match(render("zh", "red", true), />[^<]*正在重试[^<]*</);
  assert.match(render("en", "red", true), />[^<]*Retrying[^<]*</);
  assert.match(render("zh", "red", false), />[^<]*fixture unavailable[^<]*</);
  assert.match(render("zh", "green", false), /通信正常/);
});

test("official retry status recovers with streamed output", async (t) => {
  const h = await harness(t, "retry-recovery", { failures: 1, gated: true });
  const pending = outcome(run(h.adapter, input));
  await until(
    () =>
      h.notifications.some(
        (row) => row.method === "error" && row.params.willRetry,
      ),
    "official retry",
  );
  const live = h.runtime.liveSnapshot().sessions[0];
  assert.equal(live.retrying, true);
  assert.equal(live.color, "red");
  assert.equal(live.streaming, true);
  assert.match(live.detail, /503|unavailable/);
  h.server.recover();
  await until(
    () =>
      h.notifications.some(
        (row) =>
          row.method.includes("reasoning") && row.method.endsWith("Delta"),
      ),
    "recovered reasoning",
    20000,
  );
  assert.equal(h.runtime.liveSnapshot().sessions[0].retrying, false);
  assert.equal(h.runtime.liveSnapshot().sessions[0].color, "green");
  h.server.advanceReasoning();
  h.server.advance();
  h.server.finish();
  const result = await bounded(pending);
  assert.equal(result.error, undefined);
  assert.ok(result.value.chunks.some((chunk) => chunk.type === "text-delta"));
  assert.equal(h.runtime.liveSnapshot().sessions[0].retrying, false);
});

for (const retry of [false, true]) {
  test(
    retry
      ? "stop during official retry joins the process"
      : "stop before the first output joins the process",
    async (t) => {
      const h = await harness(
        t,
        retry ? "stop-retry" : "stop-first",
        retry ? { failures: 10 } : { holdFirst: true },
      );
      const controller = new AbortController();
      const pending = outcome(
        run(h.adapter, { ...input, signal: controller.signal }),
      );
      await until(
        () =>
          retry
            ? h.notifications.some(
                (row) => row.method === "error" && row.params.willRetry,
              )
            : h.server.requests.length > 0,
        "waiting state",
      );
      controller.abort(retry ? { kind: "user" } : undefined);
      const result = await bounded(pending);
      assert.equal(result.error?.code, "ABORTED");
      assert.equal(h.runtime.liveSnapshot().sessions[0].color, "gray");
      assert.equal(h.runtime.liveSnapshot().sessions[0].streaming, false);
      await bounded(Promise.all(h.children.map((child) => child.done)));
    },
  );
}

test("request deadline ends a stalled turn and permits another request", async (t) => {
  const h = await harness(t, "timeout-main", {
    holdFirst: true,
    requestTimeoutMs: 2000,
  });
  const result = await bounded(outcome(run(h.adapter, input)), 6000);
  assert.equal(result.error?.code, "CODEX_REQUEST_TIMEOUT");
  const live = h.runtime.liveSnapshot().sessions[0];
  assert.equal(live.color, "red");
  assert.equal(live.streaming, false);
  assert.match(live.detail, /CODEX_REQUEST_TIMEOUT/);
  await bounded(Promise.all(h.children.map((child) => child.done)));
  h.server.advanceFirst();
  const next = await run(h.adapter, input);
  assert.ok(next.chunks.some((chunk) => chunk.type === "text-delta"));
});

test("auxiliary requests obey the same deadline", async (t) => {
  const h = await harness(t, "timeout-aux", {
    holdFirst: true,
    requestTimeoutMs: 2000,
  });
  const result = await bounded(
    outcome(run(h.adapter, { ...input, purpose: "session-title" })),
    6000,
  );
  assert.equal(result.error?.code, "CODEX_REQUEST_TIMEOUT");
  await bounded(Promise.all(h.children.map((child) => child.done)));
});

test("terminal provider failure retains the error state", async (t) => {
  const h = await harness(t, "retry-exhausted", { failures: 10 });
  const result = await bounded(outcome(run(h.adapter, input)), 25000);
  assert.match(result.error?.message ?? "", /503|unavailable/);
  const live = h.runtime.liveSnapshot().sessions[0];
  assert.equal(live.color, "red");
  assert.equal(live.streaming, false);
  assert.equal(live.retrying, false);
});
