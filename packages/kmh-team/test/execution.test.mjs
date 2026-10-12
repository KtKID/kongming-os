import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TeamRoom } from "../lib/src/team/index.js";
import { CreatedSchema, SubmitSchema } from "../lib/src/protocol/index.js";
import { TeamExecutor } from "../lib/src/execution/index.js";
const roleId = randomUUID();
function room() {
  return new TeamRoom(
    CreatedSchema.parse({
      kind: "created",
      version: 1,
      teamId: randomUUID(),
      createRequestId: randomUUID(),
      cwd: "/tmp",
      model: { provider: "mock", model: "m" },
      members: [
        {
          roleId,
          name: "写手",
          instructions: "文章",
          createRequestId: randomUUID(),
        },
      ],
    }),
    async () => {},
    () => 20,
  );
}
function input(r, member = false) {
  return SubmitSchema.parse({
    teamId: r.config.teamId,
    requestId: randomUUID(),
    body: member ? "@写手 写文" : "@写手 引用文本",
    mentions: member
      ? [{ actor: { kind: "member", roleId }, offset: 0, length: 3 }]
      : [],
  });
}
test("feat03 场景1,2,3,5,6 / feat04 场景1,2,5,6: owner default and silent member, fresh executions", async () => {
  const r = room();
  const seen = [];
  const exec = new TeamExecutor(
    async (r, t, s, signal, start) => {
      seen.push({ t, s });
      start();
      return { outcome: "completed", body: "完整正文 @写手" };
    },
    () => 8,
  );
  for (const member of [false, true, false, true]) {
    const sub = await r.submit(input(r, member));
    exec.schedule(r, sub);
    await exec.drain();
  }
  assert.deepEqual(
    seen.map((x) => x.t.actor.kind),
    ["team-owner", "member", "team-owner", "member"],
  );
  assert.equal(new Set(seen.map((x) => x.t.taskId)).size, 4);
  assert.equal(r.messages.length, 8);
  assert.equal(r.view().working.length, 0);
});
test("feat03 场景4 / feat04 场景7 / feat07 场景3,4: execution errors become actor-specific durable notices", async () => {
  const r = room();
  const exec = new TeamExecutor(
    async () => {
      throw Error("能力不可用");
    },
    () => 8,
  );
  for (const member of [false, true]) {
    exec.schedule(r, await r.submit(input(r, member)));
    await exec.drain();
  }
  assert.deepEqual(
    r.view().notices.map((n) => n.actor.kind),
    ["team-owner", "member"],
  );
  assert.ok(r.view().notices.every((n) => /能力不可用/.test(n.text)));
  assert.equal(r.view().working.length, 0);
});
test("feat06 场景6,9,12 / feat08 场景1,2,6: pending start, overlapping member tasks and confirmed stop", async () => {
  const r = room();
  const releases = [];
  const exec = new TeamExecutor(
    async (_r, _t, _s, signal, start) => {
      start();
      await new Promise((resolve) => releases.push(resolve));
      return {
        outcome: signal.aborted ? "stopped" : "completed",
        body: signal.aborted ? undefined : "结束",
      };
    },
    () => 2,
  );
  exec.schedule(r, await r.submit(input(r, true)));
  exec.schedule(r, await r.submit(input(r, true)));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.view().working.length, 1);
  exec.stop(r);
  assert.equal(r.view().working.length, 1);
  releases[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(r.view().working.length, 1);
  releases[1]();
  await exec.drain();
  assert.equal(r.view().working.length, 0);
  assert.equal(r.view().notices.length, 2);
});
