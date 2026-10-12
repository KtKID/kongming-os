import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TeamRoom, planSubmission } from "../lib/src/team/index.js";
import { CreatedSchema, SubmitSchema } from "../lib/src/protocol/index.js";
const roleId = randomUUID();
const team = () =>
  CreatedSchema.parse({
    kind: "created",
    version: 1,
    teamId: randomUUID(),
    createRequestId: randomUUID(),
    cwd: "/tmp",
    model: { provider: "p", model: "m" },
    members: [
      {
        roleId,
        name: "写手",
        instructions: "写作",
        createRequestId: randomUUID(),
      },
    ],
  });
const submit = (room, body = "任务", mentions = []) =>
  SubmitSchema.parse({
    teamId: room.config.teamId,
    requestId: randomUUID(),
    body,
    mentions,
  });
test("feat02 场景2,6,8,9: owner identity, member de-duplication and durable creation idempotency", async () => {
  const events = [];
  const room = new TeamRoom(
    team(),
    async (event) => events.push(event),
    () => 20,
  );
  const request = submit(room);
  await room.submit(request);
  await room.submit(request);
  assert.equal(events.length, 1);
  assert.equal(room.messages.length, 1);
  assert.equal(room.tasks[0].actor.kind, "team-owner");
  assert.deepEqual(room.config.model, { provider: "p", model: "m" });
});
test("feat05 场景1,2,4,6,7: immutable public-only current-message-inclusive windows", async () => {
  let count = 20;
  const room = new TeamRoom(
    team(),
    async () => {},
    () => count,
  );
  for (let i = 1; i <= 25; i++) await room.submit(submit(room, `消息${i}`));
  let snapshot = room.submissions.at(-1).snapshot;
  assert.equal(snapshot.messages.length, 20);
  assert.equal(snapshot.messages[0].body, "消息6");
  assert.equal(snapshot.messages.at(-1).body, "消息25");
  count = 1;
  await room.submit(submit(room, "新任务"));
  assert.equal(room.submissions.at(-1).snapshot.messages.length, 1);
  assert.equal(snapshot.messages.at(-1).body, "消息25");
  assert.equal(
    snapshot.messages.every((x) => x.sender.kind === "user"),
    true,
  );
  const small = new TeamRoom(
    team(),
    async () => {},
    () => 20,
  );
  for (let i = 1; i <= 5; i++)
    await small.submit(submit(small, `较早消息${i}`));
  await small.submit(
    submit(small, "@写手 第6条", [
      { actor: { kind: "member", roleId }, offset: 0, length: 3 },
    ]),
  );
  assert.equal(small.submissions.at(-1).snapshot.messages.length, 6);
  assert.equal(
    small.submissions.at(-1).snapshot.messages.at(-1).body,
    "@写手 第6条",
  );
});
test("feat04 场景4,6,8: structured recipients, repeated mention and task validation", () => {
  const config = team();
  const member = { kind: "member", roleId };
  const input = SubmitSchema.parse({
    teamId: config.teamId,
    requestId: randomUUID(),
    body: "@写手 @写手 写文",
    mentions: [
      { actor: member, offset: 0, length: 3 },
      { actor: member, offset: 4, length: 3 },
    ],
  });
  assert.equal(planSubmission(config, [], input, 20).tasks.length, 1);
  assert.equal(
    planSubmission(config, [], { ...input, mentions: [] }, 20).tasks[0].actor
      .kind,
    "team-owner",
  );
  assert.throws(
    () =>
      planSubmission(
        config,
        [],
        { ...input, body: "@写手", mentions: [input.mentions[0]] },
        20,
      ),
    /task-empty/,
  );
  assert.throws(
    () =>
      planSubmission(
        config,
        [],
        {
          ...input,
          mentions: [
            {
              actor: { kind: "member", roleId: randomUUID() },
              offset: 0,
              length: 3,
            },
          ],
        },
        20,
      ),
    /member-unavailable/,
  );
});
test("feat02 场景7 / feat05 场景5: save failure retains public state and retries same submission once", async () => {
  let fail = true;
  const events = [];
  const room = new TeamRoom(
    team(),
    async (e) => {
      events.push(e);
      if (fail) throw Error("disk");
    },
    () => 20,
  );
  const input = submit(room);
  await assert.rejects(() => room.submit(input), /disk/);
  assert.equal(room.messages.length, 0);
  fail = false;
  await room.retrySave();
  await room.submit(input);
  assert.equal(room.messages.length, 1);
  assert.deepEqual(events[0], events[1]);
});
