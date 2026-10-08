/** 插件回归：以真实官方 session 和未完成响应核对等级、摘要及增量时机。 */
import assert from "node:assert/strict";
import test from "node:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFileSync } from "node:fs";
import { Config } from "../lib/src/config.js";
import { reasoningItemText } from "../lib/src/protocol.js";
import { harness, nativeSession, run, until } from "./support/harness.mjs";

test("reasoning completion reads app-server string arrays", () => {
  assert.equal(
    reasoningItemText({ summary: ["Plan", "Verify"], content: [] }),
    "Plan\n\nVerify",
  );
  assert.equal(
    reasoningItemText({ summary: [], content: ["Raw ", "reasoning"] }),
    "Raw reasoning",
  );
  assert.equal(reasoningItemText({ summary: [], content: [] }), undefined);
  assert.equal(reasoningItemText({ summary: [""], content: [] }), undefined);
  assert.throws(() =>
    reasoningItemText({ summary: [{ text: "wrong protocol" }], content: [] }),
  );
});

test("reasoning summary configuration defaults to auto and validates values", () => {
  const base = { cwd: tmpdir(), dataDir: join(tmpdir(), "codex-config-test") };
  assert.equal(Config(base).reasoningSummary, "auto");
  assert.equal(
    Config({ ...base, reasoningSummary: "none" }).reasoningSummary,
    "none",
  );
  assert.throws(() => Config({ ...base, reasoningSummary: "invalid" }));
});

test(
  "explicit summary none is retained in native session and upstream",
  { timeout: 30000 },
  async (t) => {
    const h = await harness(t, "summary-none", { summary: "none" });
    const result = await run(h.adapter, {
      sessionId: "summary-none",
      reasoningEffort: "low",
      messages: [
        { role: "user", content: [{ type: "text", text: "reply briefly" }] },
      ],
    });
    const binding = await h.runtime.bindingRecord("summary-none");
    const { records } = nativeSession(h.codexHome, binding.threadId);
    assert.equal(
      records.filter((record) => record.type === "turn_context").at(-1).payload
        .summary,
      "none",
    );
    assert.equal(h.server.requests.at(-1).reasoning.summary, undefined);
    assert.equal(
      result.message.content.some((block) => block.type === "reasoning"),
      false,
    );
  },
);

test(
  "selected effort matches upstream and native logs across start resume and rebuild",
  { timeout: 90000 },
  async (t) => {
    const h = await harness(t, "effort");
    const sessionId = "effort-alignment";
    let messages = [
      { role: "user", content: [{ type: "text", text: "first input" }] },
    ];
    let originalThread;
    for (const [stage, effort] of [
      ["start", "low"],
      ["resume", "high"],
      ["rebuild", "medium"],
    ]) {
      if (stage === "rebuild")
        messages = [
          { role: "user", content: [{ type: "text", text: "edited input" }] },
        ];
      const result = await run(h.adapter, {
        sessionId,
        reasoningEffort: effort,
        messages,
      });
      const binding = await h.runtime.bindingRecord(sessionId);
      const { records } = nativeSession(h.codexHome, binding.threadId);
      const context = records
        .filter((record) => record.type === "turn_context")
        .at(-1).payload;
      assert.equal(context.effort, effort, `${stage}: native session effort`);
      assert.equal(context.summary, "auto", `${stage}: native session summary`);
      assert.equal(
        h.server.requests.at(-1).reasoning.effort,
        effort,
        `${stage}: upstream effort`,
      );
      assert.equal(
        h.server.requests.at(-1).reasoning.summary,
        "auto",
        `${stage}: upstream summary`,
      );
      assert.ok(
        result.message.content.some(
          (block) =>
            block.type === "reasoning" && block.text === "Think carefully.",
        ),
      );
      if (stage === "start") originalThread = binding.threadId;
      if (stage === "resume") assert.equal(binding.threadId, originalThread);
      if (stage === "rebuild")
        assert.notEqual(binding.threadId, originalThread);
      messages = [
        ...messages,
        result.message,
        {
          role: "user",
          content: [{ type: "text", text: `continue after ${stage}` }],
        },
      ];
    }
  },
);

test(
  "remaining supported efforts and inherited default reach native logs",
  { timeout: 90000 },
  async (t) => {
    const h = await harness(t, "effort-range");
    for (const effort of ["xhigh", "max", "ultra", undefined]) {
      const sessionId = `effort-${effort ?? "default"}`;
      await run(h.adapter, {
        sessionId,
        reasoningEffort: effort,
        messages: [
          { role: "user", content: [{ type: "text", text: "check effort" }] },
        ],
      });
      const binding = await h.runtime.bindingRecord(sessionId);
      const { records } = nativeSession(h.codexHome, binding.threadId);
      assert.equal(
        records.filter((record) => record.type === "turn_context").at(-1)
          .payload.effort,
        effort ?? "xhigh",
      );
      // 官方 CLI 的 ultra 会话级别在 Responses 请求中映射为 max。
      assert.equal(
        h.server.requests.at(-1).reasoning.effort,
        effort === "ultra" ? "max" : (effort ?? "xhigh"),
      );
    }
  },
);

test(
  "official CLI and plugin deliver multiple fragments before response completion",
  { timeout: 45000 },
  async (t) => {
    const h = await harness(t, "stream", { gated: true });
    const observed = [];
    const consuming = (async () => {
      for await (const chunk of h.adapter.stream({
        provider: "codex-cli",
        model: "gpt-6-sol",
        sessionId: "stream",
        tools: [],
        reasoningEffort: "low",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "stream the answer" }],
          },
        ],
        signal: AbortSignal.timeout(30000),
      })) {
        observed.push(chunk);
        appendFileSync(
          join(h.root, "plugin-stream.jsonl"),
          JSON.stringify({
            at: Date.now(),
            upstreamCompleted: h.server.completed,
            chunk,
          }) + "\n",
        );
      }
    })();
    let streamFailure;
    const settled = consuming.catch((error) => {
      streamFailure = error;
    });
    try {
      await until(
        () =>
          observed.some(
            (chunk) =>
              chunk.type === "reasoning-delta" && chunk.text === "Think ",
          ),
        "plugin first reasoning before continuation",
      );
      assert.equal(h.server.completed, false);
      h.server.advanceReasoning();
      await until(() => {
        if (streamFailure) throw streamFailure;
        return h.notifications.some(
          (event) => event.method === "item/agentMessage/delta",
        );
      }, "official first text notification");
      await until(
        () =>
          observed.some(
            (chunk) =>
              chunk.type === "text-delta" && chunk.text.includes("FIRST"),
          ),
        "plugin first text before completion",
        1000,
      );
      assert.equal(h.server.completed, false);
      assert.ok(observed.some((chunk) => chunk.type === "reasoning-delta"));
      h.server.advance();
      await until(
        () =>
          observed.some(
            (chunk) =>
              chunk.type === "text-delta" && chunk.text.includes("SECOND"),
          ),
        "plugin second text before completion",
        1000,
      );
      assert.equal(h.server.completed, false);
    } finally {
      h.server.advanceReasoning();
      h.server.advance();
      h.server.finish();
      await settled;
    }
    await consuming;
    const reasoningDeltas = observed.filter(
      (chunk) => chunk.type === "reasoning-delta",
    );
    assert.equal(new Set(reasoningDeltas.map((chunk) => chunk.index)).size, 1);
    assert.equal(
      reasoningDeltas.map((chunk) => chunk.text).join(""),
      "Think carefully.",
    );
    assert.notEqual(
      reasoningDeltas[0].index,
      observed.find((chunk) => chunk.type === "text-delta").index,
    );
    assert.equal(
      observed.filter(
        (chunk) =>
          chunk.type === "block-start" && chunk.blockType === "reasoning",
      ).length,
      1,
    );
    assert.equal(
      observed
        .filter((chunk) => chunk.type === "text-delta")
        .map((chunk) => chunk.text)
        .join(""),
      "FIRST SECOND",
    );
    assert.ok(
      observed.some(
        (chunk) =>
          chunk.type === "block-end" &&
          chunk.block.type === "reasoning" &&
          chunk.block.text === "Think carefully.",
      ),
    );
    assert.equal(
      observed.filter(
        (chunk) => chunk.type === "block-start" && chunk.blockType === "text",
      ).length,
      1,
    );
    const binding = await h.runtime.bindingRecord("stream");
    assert.ok(
      nativeSession(h.codexHome, binding.threadId).records.some(
        (record) =>
          record.type === "event_msg" &&
          record.payload.type === "task_complete",
      ),
    );
  },
);

test(
  "consumer return interrupts an active official CLI stream and joins its process",
  { timeout: 30000 },
  async (t) => {
    const h = await harness(t, "consumer-return", { gated: true });
    h.server.advanceReasoning();
    const iterator = h.adapter.stream({
      provider: "codex-cli",
      model: "gpt-6-sol",
      sessionId: "consumer-return",
      tools: [],
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: "stream until closed" }],
        },
      ],
      signal: AbortSignal.timeout(20000),
    });
    try {
      let firstText;
      while (firstText === undefined) {
        const next = await iterator.next();
        assert.equal(next.done, false);
        if (next.value.type === "text-delta") firstText = next.value.text;
      }
      assert.equal(h.server.completed, false);
      await iterator.return();
      assert.ok(
        h.notifications.some(
          (event) =>
            event.method === "turn/completed" &&
            event.params.turn.status === "interrupted",
        ),
      );
      assert.equal(h.runtime.liveSnapshot().sessions[0].streaming, false);
      await Promise.all(h.children.map((child) => child.done));
    } finally {
      h.server.advance();
      h.server.finish();
      await iterator.return();
    }
  },
);
