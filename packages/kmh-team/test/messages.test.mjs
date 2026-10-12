import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { TeamRoom } from "../lib/src/team/index.js";
import {
  publicInputDefinition,
  taskIndexDefinition,
  memberReplyDefinition,
  memberAssistantData,
  privateTeamInput,
} from "../lib/browser-types/src/client/messages.js";

const role = {
  roleId: randomUUID(),
  name: "开发者",
  instructions: "开发",
  createRequestId: randomUUID(),
};
const config = {
  kind: "created",
  version: 1,
  teamId: randomUUID(),
  createRequestId: randomUUID(),
  cwd: "/tmp",
  model: { provider: "fixture", model: "fixture" },
  members: [role],
};
const member = { kind: "member", roleId: role.roleId };
const event = (data, seq) => ({
  type: `kmh-team/${data.kind}`,
  data,
  seq,
  time: 1000 + seq,
});
const context = (definition, source, state) => {
  const match = {
    event: source,
    location: { kind: "session" },
    ...definition.match(source),
  };
  return {
    key: `${definition.kind}:${match.id}`,
    id: match.id,
    kind: definition.kind,
    start: match,
    matches: [match],
    current: new Map(),
    state,
  };
};
const start = (definition, source, tasks = new Map()) => {
  const base = context(definition, source);
  return {
    ...base,
    state: definition.start(base, base.start, {
      previous: () => ({ state: tasks }),
    }),
  };
};
async function fixture() {
  const room = new TeamRoom(
    config,
    async () => {},
    () => 20,
  );
  await room.submit({
    teamId: config.teamId,
    requestId: randomUUID(),
    body: "普通消息",
    mentions: [],
  });
  await room.submit({
    teamId: config.teamId,
    requestId: randomUUID(),
    body: "@开发者 完成任务",
    mentions: [{ actor: member, offset: 0, length: 4 }],
  });
  return room;
}
test("团队公开输入同时覆盖 owner 与仅成员点名；原生用户气泡各显示一次正文", async () => {
  const room = await fixture();
  const nodes = room.submissions.map((submission, i) =>
    publicInputDefinition.buildViewNode(
      start(publicInputDefinition, event(submission, i + 1)),
    ),
  );
  assert.deepEqual(
    nodes.map((node) => [node.kind, node.data.content[0].text]),
    [
      ["user", "普通消息"],
      ["user", "@开发者 完成任务"],
    ],
  );
  assert.equal(new Set(nodes.map((node) => node.key)).size, 2);
  assert.ok(
    nodes.every(
      (node) =>
        node.target === "chat" && node.data.source.kind === "kmh-team-public",
    ),
  );
  assert.equal(privateTeamInput(config, { kind: "user" }), true);
  assert.ok(nodes.every((node) => !privateTeamInput(config, node.data.source)));
  assert.equal(privateTeamInput(null, { kind: "user" }), false);
  assert.equal(privateTeamInput(undefined, { kind: "user" }), false);
});
test("成员结果保持完整 Markdown 与 task 身份；owner 结果继续由原有流式来源显示", async () => {
  const room = await fixture();
  const ownerTask = room.submissions[0].tasks[0];
  const memberTask = room.submissions[1].tasks[0];
  const body =
    "## 完整结果\n\n```ts\nconst answer = 42;\n```\n\n[成果](./result.md)";
  await room.finish(ownerTask, "completed", "owner 正文");
  await room.finish(memberTask, "completed", body);
  const ended = [...room.ended.values()];
  const ownerNode = memberReplyDefinition.buildViewNode(
    start(memberReplyDefinition, event(ended[0], 20)),
  );
  const childNode = memberReplyDefinition.buildViewNode(
    start(memberReplyDefinition, event(ended[1], 21)),
  );
  const expected = JSON.parse(
    readFileSync(
      new URL("./native-chat.expected.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    {
      inputs: room.submissions.map((submission, i) => {
        const node = publicInputDefinition.buildViewNode(
          start(publicInputDefinition, event(submission, i + 1)),
        );
        return { kind: node.kind, content: node.data.content };
      }),
      ownerReplay: ownerNode,
      member: {
        kind: childNode.kind,
        actor: childNode.data.actor.kind,
        body: childNode.data.body,
        blocks: memberAssistantData(childNode.data).blocks,
      },
    },
    expected,
  );
  assert.equal(ownerNode, null);
  assert.equal(childNode.kind, "kmh-team-member");
  assert.equal(childNode.id, memberTask.taskId);
  assert.equal(childNode.data.body, body);
  assert.deepEqual(memberAssistantData(childNode.data).blocks, [
    { kind: "text", text: body },
  ]);
  assert.equal(
    memberReplyDefinition.match({
      type: "tool/result",
      data: { text: "私有工具" },
    }),
    null,
  );
});
test("较早成员任务在后续提交后失败，署名仍绑定原任务；分页从 submission 开始也恢复任务身份", async () => {
  const room = await fixture();
  const first = room.submissions[1];
  let index = start(taskIndexDefinition, event(first, 30));
  await room.submit({
    teamId: config.teamId,
    requestId: randomUUID(),
    body: "后续 owner 请求",
    mentions: [],
  });
  const second = event(room.submissions[2], 40);
  index = {
    ...index,
    state: taskIndexDefinition.update(
      index,
      context(taskIndexDefinition, second).start,
    ),
  };
  const ended = {
    kind: "task-ended",
    version: 1,
    taskId: first.tasks[0].taskId,
    outcome: "failed",
    notice: "成员失败说明",
  };
  const result = memberReplyDefinition.buildViewNode(
    start(memberReplyDefinition, event(ended, 50), index.state),
  );
  assert.deepEqual(result.data.actor, member);
  assert.equal(result.data.body, "");
  assert.equal(result.data.notice, "成员失败说明");
  assert.equal(result.data.outcome, "failed");
});
