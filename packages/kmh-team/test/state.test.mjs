import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TeamRoom } from "../lib/src/team/index.js";
import { CreatedSchema, SubmitSchema } from "../lib/src/protocol/index.js";
const roleId = randomUUID();
function room(save = async () => {}) {
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
          name: "程序员",
          instructions: "检查项目",
          createRequestId: randomUUID(),
        },
      ],
    }),
    save,
    () => 20,
  );
}
async function task(r) {
  return (
    await r.submit(
      SubmitSchema.parse({
        teamId: r.config.teamId,
        requestId: randomUUID(),
        body: "@程序员 任务",
        mentions: [{ actor: { kind: "member", roleId }, offset: 0, length: 4 }],
      }),
    )
  ).tasks[0];
}
test("feat06 场景1,3,7,8,9,10,11: complete body exactly once and task-set status across delayed ends / rooms", async () => {
  const a = room(),
    b = room();
  const old = await task(a),
    current = await task(a);
  assert.equal(a.view().working.length, 0);
  a.start(old);
  a.start(current);
  assert.equal(a.view().working.length, 1);
  assert.equal(b.view().working.length, 0);
  await a.finish(old, "completed", "**完整正文**\n[成果](https://example.org)");
  assert.equal(a.view().working.length, 1);
  await a.finish(old, "completed", "duplicate");
  assert.equal(a.messages.length, 3);
  assert.equal(a.view().working.length, 1);
  await a.finish(current, "completed", "新的正文");
  assert.equal(a.view().working.length, 0);
  assert.equal(
    a.messages.at(-2).body,
    "**完整正文**\n[成果](https://example.org)",
  );
});
test("feat06 场景4,5 / feat08 场景3,4: empty result notice, durable replay and interrupted recovery", async () => {
  const events = [];
  const r = room(async (e) => events.push(e));
  const t1 = await task(r);
  await r.finish(t1, "completed", "");
  const t2 = await task(r);
  r.start(t2);
  const restored = new TeamRoom(
    r.config,
    async (e) => events.push(e),
    () => 20,
    events,
  );
  await restored.interruptUnfinished();
  assert.equal(restored.view().working.length, 0);
  assert.equal(restored.view().notices.length, 2);
  assert.match(restored.view().notices[1].text, /中断/);
  await restored.interruptUnfinished();
  assert.equal(restored.view().notices.length, 2);
});
test("feat08 场景5: failed result flush keeps both completions for persistence-only retry", async () => {
  let fail = false;
  const saved = [];
  const r = room(async (e) => {
    if (fail) throw Error("disk full");
    saved.push(e);
  });
  const first = await task(r),
    second = await task(r);
  r.start(first);
  r.start(second);
  fail = true;
  await assert.rejects(() => r.finish(first, "completed", "正文一"));
  await r.finish(second, "completed", "正文二");
  assert.equal(r.view().working.length, 0);
  assert.equal(r.messages.length, 2);
  fail = false;
  await r.retrySave();
  assert.deepEqual(
    r.messages.slice(-2).map((m) => m.body),
    ["正文一", "正文二"],
  );
});
