/** 从规格场景给出独立报文样例，验证协议值域及来源保留。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AgentStatusSchema,
  TaskOutcomeSchema,
  TaskCodeSchema,
  TaskSnapshotSchema,
  WireFrameSchema,
  projectTurnReason,
  redactTaskMessage,
} from "../lib/protocol.js";
for (const status of ["idle", "running", "suspended"])
  test("生命周期 " + status, () =>
    assert.equal(AgentStatusSchema.parse(status), status),
  );
for (const [kind, code] of [
  ["user", "TASK_ABORTED_USER"],
  ["parent", "TASK_ABORTED_PARENT"],
  ["hook", "TASK_ABORTED_RULE"],
  ["disposed", "TASK_ABORTED_RELEASED"],
  ["legacy", "TASK_ABORTED_UNSPECIFIED"],
]) {
  test("中止来源 " + kind, () => {
    const result = projectTurnReason({
      kind: "aborted",
      reason: { kind, reason: "原始说明" },
    });
    assert.equal(result.detail.code, code);
    assert.match(result.detail.message, /原始说明/);
    assert.equal(result.detail.sourceReason, kind);
  });
}
for (const [kind, code] of [
  ["blocked", "TASK_BLOCKED"],
  ["max-tokens", "TASK_OUTPUT_LIMIT"],
  ["interrupted", "TASK_INTERRUPTED"],
  ["forked", "TASK_HISTORY_FORKED"],
])
  test("结束原因 " + kind, () => {
    const value = projectTurnReason({ kind });
    assert.equal(value.outcome.kind, kind);
    assert.equal(value.detail.code, code);
  });
test("保留模型码和说明并隐藏凭据", () => {
  const result = projectTurnReason({
    kind: "error",
    error: { code: "MODEL_BUSY", message: "模型忙 token=secret-123" },
  });
  assert.equal(result.detail.sourceCode, "MODEL_BUSY");
  assert.match(result.detail.message, /模型忙/);
  assert.doesNotMatch(result.detail.message, /secret-123/);
});
test("未知结束有明确结束事实，状态未知单独表示", () => {
  assert.equal(
    projectTurnReason({ kind: "future" }).outcome.endConfirmed,
    true,
  );
  assert.equal(
    TaskOutcomeSchema.parse({ kind: "unknown", endConfirmed: false })
      .endConfirmed,
    false,
  );
  assert.equal(TaskOutcomeSchema.safeParse({ kind: "unknown" }).success, false);
});
test("缺失终态状态与非法状态均拒绝", () => {
  const frame = {
    jsonrpc: "2.0",
    result: {
      kind: "status-update",
      taskId: "t",
      contextId: "c",
      final: true,
      status: {},
    },
  };
  assert.equal(WireFrameSchema.safeParse(frame).success, false);
  frame.result.status.state = "future";
  assert.equal(WireFrameSchema.safeParse(frame).success, false);
});
test("快照字段与版本验证", () => {
  const snapshot = {
    version: 1,
    taskId: "t",
    contextId: "c",
    epoch: "e",
    revision: 0,
    outcome: { kind: "pending" },
    sessionState: "running",
    executionStopped: false,
    contentCursor: -1,
    answer: "",
    reasoning: "",
    answerAvailability: "partial",
  };
  assert.equal(TaskSnapshotSchema.safeParse(snapshot).success, true);
  assert.equal(
    TaskSnapshotSchema.safeParse({ ...snapshot, version: 2 }).success,
    false,
  );
});
test("全部规格原因码均已收录", () => {
  for (const code of [
    "TASK_SUSPENDED",
    "TASK_RESUME_FAILED",
    "TASK_REASON_UNKNOWN",
    "TASK_EMPTY_RESULT",
    "TASK_RECEIVE_FAILED",
    "TASK_STATUS_UNAVAILABLE",
    "TASK_STATUS_UNKNOWN",
    "TASK_RESULT_UNAVAILABLE",
    "TASK_STOP_FAILED",
  ])
    assert.equal(TaskCodeSchema.parse(code), code);
});

test("未知结束原因保留已有说明", () => {
  const value = projectTurnReason({
    kind: "plugin-ended",
    reason: { reason: "自定义结束说明" },
  });
  assert.match(value.detail.message, /自定义结束说明/);
});

import { mkdtemp, mkdir, symlink, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("T22 临时生成结果被改动时检查失败", async (t) => {
  const harmony = await mkdtemp(join(tmpdir(), "kmh-protocol-drift-"));
  t.after(() => rm(harmony, { recursive: true, force: true }));
  const gateway = join(harmony, "kmh-mobile-server");
  await mkdir(gateway);
  await mkdir(join(gateway, "node_modules"));
  const require = createRequire(import.meta.url);
  await symlink(
    dirname(require.resolve("prettier/package.json")),
    join(gateway, "node_modules/prettier"),
  );
  const generator = fileURLToPath(
    new URL("../scripts/sync-protocol.mjs", import.meta.url),
  );
  const run = (check = false) =>
    spawnSync(
      process.execPath,
      [generator, "--harmony-root", harmony, ...(check ? ["--check"] : [])],
      { encoding: "utf8" },
    );
  assert.equal(run().status, 0);
  assert.equal(run(true).status, 0);
  await appendFile(
    join(
      harmony,
      "kmh-mobile-hm/entry/src/main/ets/a2a/generated/TaskProtocol.ets",
    ),
    "\n// drift\n",
  );
  const stale = run(true);
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /TaskProtocol/);
});

for (const sample of [
  'upstream error: {"api_key":"test-secret-value"}',
  "upstream error: {'password': 'test-secret-value with spaces'}",
  'upstream error: {"authorization":"Bearer test-secret-value"}',
  'upstream error: {"token":"test-secret-value\\\"suffix"}',
])
  test("QA quoted secret redaction: " + sample.split(":")[0], () => {
    const result = redactTaskMessage(sample);
    assert.doesNotMatch(result, /test-secret-value|suffix/);
    assert.match(result, /upstream error/);
  });
test("QA unknown reason retains upstream code", () => {
  const result = projectTurnReason({
    kind: "plugin-ended",
    error: { code: "PLUGIN42", message: "插件结束" },
  });
  assert.equal(result.detail.sourceCode, "PLUGIN42");
});

test("C3 会话异常保留系统来源码并保护凭据", async () => {
  const { taskFailureDetail } = await import("../lib/protocol.js");
  const value = taskFailureDetail(
    "TASK_STATUS_UNAVAILABLE",
    Object.assign(new Error("source token=secret-value"), { code: 429 }),
    "fallback",
  );
  assert.equal(value.sourceCode, 429);
  assert.match(value.message, /source/);
  assert.doesNotMatch(value.message, /secret-value/);
});
