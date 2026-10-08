/** 会话流的即时交付、串行归属与消费方收尾。 */
import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config, CodexCli } from "../lib/src/index.js";

/** 真实插件服务；这些用例只驱动包装器的流与执行归属。 */
function runtime(t) {
  const root = mkdtempSync(join(tmpdir(), "kmh-codex-session-stream-"));
  const ctx = new Context();
  const service = new CodexCli(ctx, Config({ cwd: root, dataDir: root }));
  t.after(() => ctx.fiber.dispose());
  return { service, root };
}

test("consumer return closes the active turn and permits the next call", async (t) => {
  const { service, root } = runtime(t);
  let active;
  const iterator = service.withSession("return", root, async function* (turn) {
    active = turn;
    yield { type: "text-delta", index: 0, text: "first" };
    yield { type: "text-delta", index: 0, text: "second" };
  });
  assert.equal((await iterator.next()).value.text, "first");
  await iterator.return();
  assert.equal(active.terminated, true);
  assert.equal(service.liveSnapshot().sessions[0].streaming, false);
  const following = service.withSession("return", root, async function* (turn) {
    assert.notEqual(turn, active);
    yield { type: "text-delta", index: 0, text: "next" };
  });
  assert.equal((await following.next()).value.text, "next");
  await following.return();
});

test("stream failure releases the session for another call", async (t) => {
  const { service, root } = runtime(t);
  const failed = service.withSession("failure", root, async function* () {
    yield { type: "text-delta", index: 0, text: "partial" };
    throw new Error("source failed");
  });
  assert.equal((await failed.next()).value.text, "partial");
  await assert.rejects(failed.next(), /source failed/);
  const following = service.withSession("failure", root, async function* () {
    yield { type: "text-delta", index: 0, text: "next" };
  });
  assert.equal((await following.next()).value.text, "next");
  await following.return();
});

test("another call in the same session waits for the active consumer", async (t) => {
  const { service, root } = runtime(t);
  const first = service.withSession("serial", root, async function* () {
    yield { type: "text-delta", index: 0, text: "first" };
  });
  await first.next();
  let entered = false;
  const second = service.withSession("serial", root, async function* () {
    entered = true;
    yield { type: "text-delta", index: 0, text: "second" };
  });
  const next = second.next();
  await new Promise((resolve) => setImmediate(resolve));
  const enteredBeforeReturn = entered;
  await first.return();
  assert.equal((await next).value.text, "second");
  await second.return();
  assert.equal(enteredBeforeReturn, false);
});

test("cancelled queue entry preserves session ownership", async (t) => {
  const { service, root } = runtime(t);
  const first = service.withSession("queue-stop", root, async function* () {
    yield { type: "text-delta", index: 0, text: "first" };
  });
  await first.next();
  t.after(() => first.return());
  const controller = new AbortController();
  let secondEntered = false;
  const second = service.withSession(
    "queue-stop",
    root,
    async function* () {
      secondEntered = true;
    },
    controller.signal,
  );
  const rejected = assert.rejects(second.next(), { name: "AbortError" });
  controller.abort();
  const cancelled = await Promise.race([
    rejected.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 500)),
  ]);
  if (!cancelled) {
    await first.return();
    await rejected.catch(() => {});
  }
  assert.equal(
    cancelled,
    true,
    "queued abort must settle before the active consumer returns",
  );
  assert.equal(secondEntered, false);
  let thirdEntered = false;
  const third = service.withSession("queue-stop", root, async function* () {
    thirdEntered = true;
  });
  const next = third.next();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(thirdEntered, false);
  await first.return();
  await next;
  assert.equal(thirdEntered, true);
});
