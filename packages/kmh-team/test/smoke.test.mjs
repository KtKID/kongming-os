/** 真实 Agent、fresh spawn、工具/skill 和 JSONL 保存链路的无密钥 smoke。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Context } from "@deepseek-ai/cordis";
import { SessionId } from "@deepseek-ai/dsh-session";
import { FixtureAdapter } from "./fixtures-provider.mjs";
import {
  mountAgentLoopTestDependencies,
  mountAgentLoopTestHarness,
} from "../../../third_party/dsh/packages/test-support/agent-loop-testkit/lib/index.js";
import Persistence from "../../../third_party/dsh/packages/session/session-persistence-jsonl/lib/index.js";
import Query from "../../../third_party/dsh/packages/session-query/session-query/lib/index.js";
import Subagents from "@deepseek-ai/dsh-subagent";
import * as Spawn from "../../../third_party/dsh/packages/subagent/subagent-spawn-in-process/lib/index.js";
import Skills from "../../../third_party/dsh/packages/skill/skill/lib/index.js";
import * as ToolSkill from "../../../third_party/dsh/packages/skill/tool-skill/lib/index.js";
import SandboxPolicy, {
  setSandboxMode,
} from "../../../third_party/dsh/packages/sandbox/sandbox-policy/lib/index.js";
import Fs from "../../../third_party/dsh/packages/fs/fs-sandbox/lib/index.js";
import * as ToolFs from "../../../third_party/dsh/packages/fs/tool-fs/lib/index.js";
import Approval from "../../../third_party/dsh/packages/interaction/user-approval/lib/index.js";
import { TeamRoom } from "../lib/src/team/index.js";
import { TeamExecutor, DshExecution } from "../lib/src/execution/index.js";
class PointQuery extends Query {
  searchSessions() {
    throw Error("unused");
  }
  searchEvents() {
    throw Error("unused");
  }
}
const role = {
  roleId: randomUUID(),
  name: "程序员",
  instructions: "检查当前项目并报告完整结果",
  createRequestId: randomUUID(),
};
const writer = {
  roleId: randomUUID(),
  name: "写手",
  instructions: "按写作skill完成文章",
  createRequestId: randomUUID(),
};
const submit = (room, body, actors = []) =>
  room.submit({
    teamId: room.config.teamId,
    requestId: randomUUID(),
    body,
    mentions: actors.map((actor, i) => ({ actor, offset: i * 3, length: 3 })),
  });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "kmh-team-smoke-"));
  await writeFile(join(dir, "team-input.txt"), "PROJECT_FILE_OK");
  const ctx = new Context();
  await mountAgentLoopTestDependencies(ctx);
  await ctx.plugin(Persistence, { root: join(dir, "sessions") });
  await ctx.plugin(PointQuery);
  await ctx.plugin(Skills);
  await ctx.plugin(ToolSkill);
  await ctx.plugin(SandboxPolicy, { mode: "read-only", workspaceRoot: dir });
  await ctx.plugin(Fs, { cwd: dir });
  await ctx.plugin(ToolFs);
  await ctx.plugin(Approval);
  const driver = await mountAgentLoopTestHarness(ctx);
  await ctx.plugin(Subagents);
  await ctx.plugin(Spawn, { providerName: "spawn" });
  const adapter = new FixtureAdapter();
  ctx.llm.registerAdapter(["team-fixture"], adapter);
  ctx.skills.register({
    name: "team-writing",
    description: "团队写作规范",
    content: "SKILL_WRITING_OK：保留完整正文",
    source: "fixture",
  });
  const agents = new Map();
  ctx.provide("sessionController", {
    resolveAgent: async (id) => ({ agent: agents.get(id) }),
  });
  async function room() {
    const id = SessionId(randomUUID());
    const owner = await driver.create(
      id,
      { provider: "team-fixture", model: "fixture" },
      { cwd: dir },
    );
    agents.set(id, owner);
    setSandboxMode(owner.session, "read-only");
    const config = {
      kind: "created",
      version: 1,
      teamId: id,
      createRequestId: id,
      cwd: dir,
      model: { provider: "team-fixture", model: "fixture" },
      members: [role, writer],
    };
    const save = async (event) => {
      owner.session.append(`kmh-team/${event.kind}`, event, {
        ignorable: true,
      });
      assert.equal(await ctx.sessions.flush(owner.session), true);
    };
    await save(config);
    return { room: new TeamRoom(config, save, () => 20), owner };
  }
  const executor = new TeamExecutor(
    new DshExecution(ctx).run,
    () => 8,
    (error) => {
      throw error;
    },
  );
  return {
    ctx,
    dir,
    adapter,
    room,
    executor,
    async close() {
      await executor.close();
      await ctx.fiber.dispose();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("真实链路：owner 默认、静默成员、fresh 隔离、工具与 skill、公开完整结果和持久记录", async () => {
  const env = await setup();
  try {
    const { room: a, owner } = await env.room();
    const { room: b } = await env.room();
    env.executor.schedule(a, await submit(a, "A私有材料"));
    await env.executor.drain();
    assert.equal(a.view().messages.length, 2);
    assert.equal(env.adapter.calls.length, 1);
    const expected = JSON.parse(
      await readFile(
        new URL("./team-transcript.expected.json", import.meta.url),
        "utf8",
      ),
    );
    assert.deepEqual(
      a.messages.map((m) => ({ speaker: m.sender.kind, body: m.body })),
      expected,
    );
    const member = { kind: "member", roleId: role.roleId };
    const writing = { kind: "member", roleId: writer.roleId };
    env.executor.schedule(a, await submit(a, "@程 检查文件", [member]));
    await env.executor.drain();
    assert.match(a.messages.at(-1).body, /PROJECT_FILE_OK/);
    env.executor.schedule(b, await submit(b, "@程 B独立任务", [member]));
    await env.executor.drain();
    env.executor.schedule(a, await submit(a, "@写 使用skill", [writing]));
    await env.executor.drain();
    assert.match(a.messages.at(-1).body, /SKILL_WRITING_OK/);
    const childCalls = env.adapter.calls.filter(
      (c) => c.sessionId !== owner.id,
    );
    const ids = [...new Set(childCalls.map((c) => c.sessionId))];
    assert.equal(ids.length, 3);
    const bCall = childCalls.find((c) =>
      JSON.stringify(c.messages).includes("B独立任务"),
    );
    assert.equal(JSON.stringify(bCall.messages).includes("A私有材料"), false);
    const ownerObserved = await env.ctx.sessionQuery.readSession(owner.id);
    const linked = ownerObserved.events.filter(
      (e) => e.type === "kmh-team/task-linked",
    );
    assert.equal(linked.length, 2);
    for (const link of linked) {
      const child = await env.ctx.sessionQuery.readSession(
        SessionId(link.data.executionSessionId),
      );
      assert.equal(child.session.cwd, env.dir);
      assert.equal(
        child.events.find((e) => e.type === "approval/policy").data.policy,
        "never",
      );
      assert.equal(
        child.events.find((e) => e.type === "sandbox/mode").data.mode,
        "read-only",
      );
      assert.equal(
        child.events.filter(
          (e) => e.type === "user/message" && e.data.source?.kind === "user",
        ).length,
        1,
      );
      assert.ok(child.events.some((e) => e.type === "tool/result"));
    }
    assert.deepEqual(a.view().working, []);
    assert.ok(a.messages.every((m) => !m.body.includes("tool-call-delta")));
    const replay = new TeamRoom(
      a.config,
      async () => {},
      () => 20,
      ownerObserved.events
        .filter((e) => e.type.startsWith("kmh-team/"))
        .map((e) => e.data),
    );
    assert.deepEqual(replay.messages, a.messages);
  } finally {
    await env.close();
  }
});
test("真实链路：失败、内容过长、停止、已停止后 fresh 重试与并发工作标记", async () => {
  const env = await setup();
  try {
    const { room } = await env.room();
    const member = { kind: "member", roleId: role.roleId };
    for (const body of ["@程 失败模拟", "@程 过长模拟"]) {
      env.executor.schedule(room, await submit(room, body, [member]));
      await env.executor.drain();
      assert.equal([...room.ended.values()].at(-1).outcome, "failed");
      assert.deepEqual(room.view().working, []);
    }
    env.executor.schedule(room, await submit(room, "@程 等待停止", [member]));
    for (let i = 0; i < 100 && room.view().working.length === 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(room.view().working.length, 1);
    env.executor.stop(room);
    await env.executor.drain();
    assert.equal([...room.ended.values()].at(-1).outcome, "stopped");
    assert.deepEqual(room.view().working, []);
    env.executor.schedule(
      room,
      await submit(room, "@程 停止后重新处理", [member]),
    );
    await env.executor.drain();
    assert.equal([...room.ended.values()].at(-1).outcome, "completed");
  } finally {
    await env.close();
  }
});

test("真实链路：多成员同一快照、重复点名一次、完成顺序及多步工作标记", async () => {
  const env = await setup();
  try {
    const { room, owner } = await env.room();
    const member = { kind: "member", roleId: role.roleId };
    const writing = { kind: "member", roleId: writer.roleId };
    const submission = await submit(room, "@程@写@写 双成员同快照", [
      member,
      writing,
      writing,
    ]);
    assert.equal(submission.tasks.length, 2);
    assert.equal(room.view().working.length, 0);
    env.executor.schedule(room, submission);
    for (let i = 0; i < 100 && room.messages.length < 2; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(room.messages[1].sender.roleId, role.roleId);
    assert.deepEqual(room.view().working, [
      { kind: "member", roleId: writer.roleId },
    ]);
    await env.executor.drain();
    assert.equal(room.messages[2].sender.roleId, writer.roleId);
    const calls = env.adapter.calls.filter((c) => c.sessionId !== owner.id);
    assert.equal(calls.length, 2);
    const prompts = calls.map(
      (c) =>
        c.messages.findLast(
          (m) => m.role === "user" && m.source?.kind === "user",
        ).content[0].text,
    );
    assert.deepEqual(
      JSON.parse(prompts[0].slice(prompts[0].indexOf("\n") + 1)),
      JSON.parse(prompts[1].slice(prompts[1].indexOf("\n") + 1)),
    );
    assert.deepEqual(room.view().working, []);
    const before = env.adapter.calls.length;
    env.executor.schedule(room, await submit(room, "@程 检查文件", [member]));
    for (let i = 0; i < 100 && env.adapter.calls.length < before + 2; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(env.adapter.calls.length, before + 2);
    assert.deepEqual(room.view().working, [member]);
    await env.executor.drain();
    assert.match(room.messages.at(-1).body, /PROJECT_FILE_OK/);
    assert.deepEqual(room.view().working, []);
    env.executor.schedule(
      room,
      await submit(room, "向owner追问程序员的公开结果"),
    );
    await env.executor.drain();
    const ownerCall = env.adapter.calls.at(-1);
    assert.equal(ownerCall.sessionId, owner.id);
    assert.match(JSON.stringify(ownerCall.messages), /PROJECT_FILE_OK/);
    assert.equal(
      env.adapter.calls.filter((c) => c.sessionId !== owner.id).length,
      4,
    );
    env.executor.schedule(
      room,
      await submit(room, "@程@写 写手故障，程序员继续完成", [member, writing]),
    );
    await env.executor.drain();
    assert.equal(room.messages.at(-1).sender.roleId, role.roleId);
    assert.equal(room.view().notices.at(-1).actor.roleId, writer.roleId);
    assert.equal(room.view().notices.at(-1).outcome, "failed");
    assert.deepEqual(room.view().working, []);
  } finally {
    await env.close();
  }
});

test("真实链路：输入框停止owner后记录stopped终态并恢复待命", async () => {
  const env = await setup();
  try {
    const { room, owner } = await env.room();
    env.executor.schedule(
      room,
      await submit(room, "等待停止，owner输入框停止"),
    );
    for (let i = 0; i < 100 && room.view().working.length === 0; i++)
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(room.view().working.length, 1);
    owner.cancel({ kind: "user" });
    await env.executor.drain();
    assert.equal([...room.ended.values()].at(-1).outcome, "stopped");
    assert.deepEqual(room.view().working, []);
    assert.match(room.view().notices.at(-1).text, /停止/);
  } finally {
    await env.close();
  }
});

test("真实链路：关闭执行器取消两组活动成员并等待实际结束", async () => {
  const env = await setup();
  try {
    const { room: a } = await env.room(),
      { room: b } = await env.room();
    const member = { kind: "member", roleId: role.roleId };
    env.executor.schedule(a, await submit(a, "@程 等待停止", [member]));
    env.executor.schedule(b, await submit(b, "@程 等待停止", [member]));
    for (
      let i = 0;
      i < 100 && a.view().working.length + b.view().working.length < 2;
      i++
    )
      await new Promise((r) => setTimeout(r, 10));
    assert.equal(a.view().working.length + b.view().working.length, 2);
    await env.executor.close();
    for (const room of [a, b]) {
      assert.deepEqual(room.view().working, []);
      assert.equal([...room.ended.values()].at(-1).outcome, "stopped");
    }
  } finally {
    await env.close();
  }
});
