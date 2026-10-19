/** 原生流保留正文、块边界与任务归属。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTaskRuntime, projectTask } from "../lib/task-state.js";
const binding = {
  version: 1,
  taskId: "t",
  contextId: "c",
  internalSessionId: "s",
  messageId: "u",
  beforeSeq: -1,
  admission: "accepted",
  createdAt: 0,
  turn: 0,
};
test("S1 工具前的自然语言与后续回答按步骤留在同一正文", () => {
  const events = [
    { type: "turn/start", seq: 0, time: 0, data: { turn: 0 } },
    {
      type: "assistant/message",
      seq: 1,
      time: 1,
      data: {
        turn: 0,
        step: 0,
        message: {
          content: [
            { type: "text", text: "我先计算。" },
            { type: "tool-call", id: "x", name: "calc", arguments: "{}" },
          ],
        },
      },
    },
    {
      type: "assistant/message",
      seq: 2,
      time: 2,
      data: {
        turn: 0,
        step: 1,
        message: { content: [{ type: "text", text: "结果是2。" }] },
      },
    },
    {
      type: "turn/end",
      seq: 3,
      time: 3,
      data: { turn: 0, reason: { kind: "completed" } },
    },
  ];
  const result = projectTask(binding, events, "idle", "epoch", 0);
  assert.equal(result.answer, "我先计算。结果是2。");
  assert.equal(result.reasoning, "");
});

import { TaskAssistantStream } from "../lib/task-stream.js";
import { TaskStreamNotificationSchema } from "../lib/protocol.js";
test("T1/T13 原生前缀紧凑记录、index 与 Agent revision 重启保持原字段", () => {
  const source = new TaskAssistantStream();
  source.accept(
    { type: "start", attemptId: "s:1", revision: 1, turn: 1, step: 2 },
    5,
  );
  source.accept(
    {
      type: "chunk",
      attemptId: "s:1",
      revision: 2,
      index: 0,
      time: 10,
      chunk: { type: "text-delta", index: 3, text: "甲" },
    },
    5,
  );
  source.accept(
    {
      type: "chunk",
      attemptId: "s:1",
      revision: 3,
      index: 1,
      time: 13,
      chunk: { type: "text-delta", index: 3, text: "乙" },
    },
    5,
  );
  assert.deepEqual(source.snapshot(), {
    revision: 3,
    activeAttempt: {
      attemptId: "s:1",
      turn: 1,
      step: 2,
      startedAfterSeq: 5,
      nextIndex: 2,
      stream: [
        {
          type: "text-chunks",
          time0: 10,
          index: 3,
          dt: [3],
          texts: ["甲", "乙"],
        },
      ],
    },
  });
  source.accept(
    { type: "start", attemptId: "s:1", revision: 1, turn: 2, step: 0 },
    20,
  );
  assert.equal(source.snapshot().activeAttempt.nextIndex, 0);
  assert.equal(source.snapshot().activeAttempt.turn, 2);
  source.accept(
    {
      type: "chunk",
      attemptId: "s:1",
      revision: 2,
      index: 2,
      time: 30,
      chunk: { type: "text-delta", index: 0, text: "缺帧" },
    },
    20,
  );
  assert.equal(source.snapshot().activeAttempt, undefined);
});
test("T6 已知损坏帧明确失败，未知原生附加资料在转接中保留", () => {
  const value = {
    taskId: "t",
    contextId: "c",
    sessionId: "s",
    frame: {
      type: "event",
      event: {
        type: "plugin/future",
        seq: 1,
        time: 0,
        data: { original: { items: ["完整🙂"] } },
      },
    },
  };
  assert.deepEqual(TaskStreamNotificationSchema.parse(value), value);
  assert.equal(
    TaskStreamNotificationSchema.safeParse({
      ...value,
      frame: {
        type: "assistant-stream",
        frame: {
          type: "chunk",
          attemptId: "s",
          revision: 1,
          index: 0,
          time: 0,
          chunk: { type: "text-delta", index: 0, text: 1 },
        },
      },
    }).success,
    false,
  );
});

test("T14 内部上下文保留原任务，独立用户输入切断旧任务事件窗口", async () => {
  const events = [
    { type: "turn/start", seq: 0, time: 0, data: { turn: 0 } },
    {
      type: "user/message",
      seq: 1,
      time: 1,
      data: { id: "u", source: { kind: "user" } },
    },
    {
      type: "user/message",
      seq: 2,
      time: 2,
      data: { id: "context", source: { kind: "runtime-context" } },
    },
    {
      type: "assistant/message",
      seq: 3,
      time: 3,
      data: {
        turn: 0,
        step: 0,
        message: { content: [{ type: "text", text: "本轮" }] },
      },
    },
    {
      type: "turn/end",
      seq: 4,
      time: 4,
      data: { turn: 0, reason: { kind: "completed" } },
    },
  ];
  const runtime = createTaskRuntime({
    store: {
      get: async () => binding,
      put: async () => {},
      listSession: async () => [binding],
    },
    observeAgent: async () => {
      throw Error("unused");
    },
    readEvents: async () => events,
    flush: async () => {},
  });
  assert.equal(await runtime.isLatestBinding(binding), true);
  assert.deepEqual(await runtime.eventsFor(binding), events);
  events.push(
    { type: "turn/start", seq: 5, time: 5, data: { turn: 1 } },
    {
      type: "user/message",
      seq: 6,
      time: 6,
      data: { id: "other", source: { kind: "user" } },
    },
    {
      type: "assistant/message",
      seq: 7,
      time: 7,
      data: {
        turn: 1,
        step: 0,
        message: { content: [{ type: "text", text: "后来的独立输入" }] },
      },
    },
  );
  assert.equal(await runtime.isLatestBinding(binding), false);
  const own = await runtime.eventsFor(binding);
  assert.equal(own.at(-1).seq, 4);
  assert.equal(projectTask(binding, own, "idle", "e", 0).answer, "本轮");
});

import { MobileAssistantServer } from "../lib/server.js";
test("T1/T13 follow 安装观察后读取基线，退休来源高 revision 被切点覆盖，其他会话保持隔离", async () => {
  const query = { sessionId: "s", contextId: "c", taskId: "t" };
  const listeners = new Set();
  const sent = [];
  const source = new TaskAssistantStream();
  const emit = (id, task, frame) => {
    for (const listener of listeners) listener(id, task, frame);
  };
  const server = Object.assign(Object.create(MobileAssistantServer.prototype), {
    submissions: new Map(),
    followers: new Map(),
    streamListeners: listeners,
    activeInputs: new Map([["s", "u"]]),
    handles: new Map(),
    assistantStreams: new Map([["s", { task: query, source }]]),
    sessionContexts: new Map([["s", "c"]]),
    mobilePeer: {
      notify: (method, params) => sent.push({ method, ...params }),
    },
    acquire: async () => {},
    observeSession: () => ({ status: "running" }),
    tasks: {
      bindingFor: async () => binding,
      isLatestBinding: async () => true,
      eventsFor: async () => {
        emit("s", query, {
          type: "assistant-stream",
          frame: {
            type: "start",
            attemptId: "old",
            revision: 99,
            turn: 0,
            step: 0,
          },
        });
        emit(
          "other",
          { contextId: "other", taskId: "other" },
          {
            type: "event",
            event: {
              type: "future",
              seq: 50,
              time: 0,
              data: { foreign: true },
            },
          },
        );
        const event = {
          type: "step/start",
          seq: 0,
          time: 0,
          data: { turn: 0, step: 0 },
        };
        emit("s", query, { type: "event", event });
        source.accept(
          { type: "start", attemptId: "new", revision: 1, turn: 0, step: 0 },
          0,
        );
        source.accept(
          {
            type: "chunk",
            attemptId: "new",
            revision: 2,
            index: 0,
            time: 0,
            chunk: { type: "text-delta", index: 0, text: "当前前缀" },
          },
          0,
        );
        return [];
      },
    },
  });
  await server.followTask(query);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].frame.type, "snapshot");
  assert.equal(sent[0].frame.cursor, 0);
  assert.equal(sent[0].frame.assistantStream.revision, 2);
  assert.equal(sent[0].frame.assistantStream.activeAttempt.attemptId, "new");
  assert.equal(sent[0].frame.records.length, 1);
  emit("s", query, {
    type: "assistant-stream",
    frame: {
      type: "chunk",
      attemptId: "new",
      revision: 3,
      index: 1,
      time: 1,
      chunk: { type: "text-delta", index: 0, text: "后续" },
    },
  });
  assert.equal(sent.length, 2);
  assert.equal(sent[1].frame.frame.revision, 3);
  server.unfollowTask(query);
  emit("s", query, {
    type: "event",
    event: { type: "future", seq: 1, time: 1, data: {} },
  });
  assert.equal(sent.length, 2);
  assert.equal(listeners.size, 0);
});

test("QA 同 turn 独立 steer 保留原步骤，原任务控制保持旧输入归属", async () => {
  const events = [
    { type: "turn/start", seq: 0, time: 0, data: { turn: 0 } },
    {
      type: "user/message",
      seq: 1,
      time: 1,
      data: { id: "u", source: { kind: "user" } },
    },
    {
      type: "assistant/message",
      seq: 2,
      time: 2,
      data: {
        turn: 0,
        step: 0,
        message: { content: [{ type: "text", text: "原步骤" }] },
      },
    },
    { type: "step/end", seq: 3, time: 3, data: { turn: 0, step: 0 } },
    {
      type: "user/message",
      seq: 4,
      time: 4,
      data: { id: "steer", source: { kind: "user" } },
    },
    {
      type: "assistant/message",
      seq: 5,
      time: 5,
      data: {
        turn: 0,
        step: 1,
        message: { content: [{ type: "text", text: "其他输入" }] },
      },
    },
  ];
  let canceled = 0;
  const runtime = createTaskRuntime({
    store: {
      get: async () => binding,
      put: async () => {},
      listSession: async () => [binding],
    },
    observeAgent: async () => ({
      status: "running",
      cancel: () => canceled++,
      inbox: { remove: () => false },
      whenIdle: async () => {},
    }),
    readEvents: async () => events,
    flush: async () => {},
  });
  const own = await runtime.eventsFor(binding);
  assert.equal(own.at(-1).seq, 3);
  assert.equal(projectTask(binding, own, "running", "e", 0).answer, "原步骤");
  await assert.rejects(
    runtime.cancel({ ...binding, operationId: "late" }),
    /TASK_STOP_FAILED/,
  );
  assert.equal(canceled, 0);
});
