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
