import test from "node:test";
import assert from "node:assert/strict";
import { chooseTurn, notices } from "../lib/browser-types/src/client/state.js";
test("T03 T05 active/default turn selection", () => {
  const turns = [
    { nativeTurnId: "a", status: "completed" },
    { nativeTurnId: "b", status: "pending" },
  ];
  assert.equal(chooseTurn(turns, null), "b");
  assert.equal(chooseTurn(turns, "a"), "a");
  assert.equal(chooseTurn([], null), null);
});
test("T18 global feedback survives panel lifecycle and clears on completion", () => {
  let observed = 0;
  const dispose = notices.subscribe(() => observed++);
  notices.show("复制成功");
  assert.equal(notices.getSnapshot().text, "复制成功");
  dispose();
  notices.clear();
  assert.equal(notices.getSnapshot(), null);
  assert.equal(observed, 1);
});
import { poll } from "../lib/browser-types/src/client/state.js";
test("T20 T22 controlled clock serializes refresh and cancels late work", async () => {
  let next,
    id = 0,
    calls = 0,
    release,
    signal;
  const clock = {
    set(fn) {
      next = fn;
      return ++id;
    },
    clear() {
      next = undefined;
    },
  };
  let visible = true;
  const p = poll(
    {
      run: (s) => {
        calls++;
        signal = s;
        return new Promise((resolve) => (release = resolve));
      },
      interval: () => 1000,
      visible: () => visible,
      onError: () => assert.fail("unexpected error"),
    },
    clock,
  );
  assert.equal(calls, 1);
  p.wake();
  assert.equal(calls, 1);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  visible = false;
  next();
  assert.equal(calls, 1);
  visible = true;
  p.wake();
  assert.equal(calls, 2);
  p.stop();
  assert.equal(signal.aborted, true);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(next, undefined);
});
import { receiveExport } from "../lib/browser-types/src/client/state.js";
test("T27 download preparation rejects HTTP and incomplete JSON before creating a Blob", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json(
      { error: "SOURCE_UNAVAILABLE", reason: "当前会话暂无记录" },
      { status: 404 },
    ),
  );
  await assert.rejects(
    () => receiveExport("a", new AbortController().signal),
    /当前会话暂无记录/,
  );
  globalThis.fetch = async () => new Response('{"formatVersion":1');
  await assert.rejects(() => receiveExport("a", new AbortController().signal));
});
