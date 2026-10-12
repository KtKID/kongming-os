/** 对独立支持 profile 执行认证后的真实 HTTP smoke；结果写入指定临时证据文件。 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, readFile } from "node:fs/promises";
const login = new URL(process.env.KMH_TEAM_TEST_URL);
const base = login.origin;
const exchange = await fetch(login, { redirect: "manual" });
const cookie = exchange.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie);
async function api(action, body, teamId) {
  const response = await fetch(
    `${base}/api/kmh-team/${action}${teamId ? `?teamId=${teamId}` : ""}`,
    {
      headers: {
        Cookie: cookie,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      method: body ? "POST" : "GET",
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
  const result = await response.json();
  if (!response.ok) throw Error(result.message);
  return result;
}
const evidence = [];
const record = (name, details) => evidence.push({ name, details });
const before = await api("bootstrap");
const role = before.roles.find((r) => r.name === "程序员");
assert.ok(role);
const create = {
  requestId: randomUUID(),
  cwd: "/tmp/kmh-team-browser-home",
  model: { provider: "team-fixture", model: "fixture-alternate" },
  memberRoleIds: [role.roleId],
};
await assert.rejects(
  api("create", {
    ...create,
    requestId: randomUUID(),
    model: { provider: "team-fixture", model: "unavailable-model" },
  }),
  /model-unavailable/,
);
await assert.rejects(
  api("create", {
    ...create,
    requestId: randomUUID(),
    memberRoleIds: [randomUUID()],
  }),
  /role-not-found/,
);
record("不可用模型和失效角色拒绝创建", { rejected: 2 });
const [first, duplicate] = await Promise.all([
  api("create", create),
  api("create", create),
]);
assert.equal(first.team.teamId, duplicate.team.teamId);
const id = first.team.teamId;
record("建群去重与空团队可恢复", {
  teamId: id,
  members: first.team.members.length,
  working: first.working,
});
const only = await api("create", {
  ...create,
  requestId: randomUUID(),
  memberRoleIds: [],
});
assert.equal(only.team.members.length, 0);
record("仅 owner 团队", only.team.teamId);
const submit = async (body, actors = [], target = id, req = randomUUID()) => {
  const input = {
    teamId: target,
    requestId: req,
    body,
    mentions: actors.map((actor, i) => ({ actor, offset: i * 3, length: 3 })),
  };
  await api("submit", input);
  return input;
};
async function settled(target = id, min) {
  for (let i = 0; i < 300; i++) {
    const view = await api("view", undefined, target);
    if (view.working.length === 0 && view.messages.length >= min) return view;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw Error("settle timeout");
}
await submit("owner 唯一接待", [], only.team.teamId);
const single = await settled(only.team.teamId, 2);
assert.equal(single.messages[1].sender.kind, "team-owner");
await submit("@主 明确owner", [{ kind: "team-owner" }], only.team.teamId);
const explicitOwner = await settled(only.team.teamId, 4);
assert.equal(explicitOwner.messages[3].sender.kind, "team-owner");
let config = await api("config");
assert.equal(config.contextMessageCount, 5);
await api("config", { contextMessageCount: 20, revision: config.revision });
for (let i = 1; i <= 12; i++) {
  await submit(`第${i}轮普通消息`);
  await settled(id, i * 2);
}
const member = { kind: "member", roleId: role.roleId };
const input = await submit("@程 第25条窗口", [member]);
await api("submit", input);
let view = await settled(id, 26);
assert.equal(view.messages.length, 26);
assert.equal(view.messages[25].sender.roleId, role.roleId);
const calls = (await readFile(process.env.KMH_TEAM_FIXTURE_LOG, "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse);
const memberCall = calls.findLast((c) =>
  JSON.stringify(c.messages).includes("第25条窗口"),
);
const prompt = memberCall.messages.findLast(
  (m) => m.role === "user" && m.source?.kind === "user",
).content[0].text;
const snapshot = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
assert.equal(snapshot.length, 20);
assert.equal(snapshot.at(-1).body, "@程 第25条窗口");
assert.equal(snapshot[0].body, view.messages[5].body);
assert.equal(memberCall.model, "fixture-alternate");
record("默认20条含本次，重复提交只运行一次", {
  teamId: id,
  windowCount: 20,
  firstPublicSeq: 6,
  lastPublicSeq: 25,
  model: memberCall.model,
});
config = await api("config");
await api("config", { contextMessageCount: 1, revision: config.revision });
await submit("@程 慢任务", [member]);
for (let i = 0; i < 100; i++) {
  if ((await api("view", undefined, id)).working.length === 1) break;
  await new Promise((r) => setTimeout(r, 10));
}
config = await api("config");
await api("config", { contextMessageCount: 5, revision: config.revision });
await submit("owner 在成员工作时继续回应");
view = await settled(id, 30);
assert.equal(view.messages.length, 30);
const updatedCalls = (await readFile(process.env.KMH_TEAM_FIXTURE_LOG, "utf8"))
  .trim()
  .split("\n")
  .map(JSON.parse);
const slow = updatedCalls.findLast(
  (c) =>
    JSON.stringify(c.messages).includes("慢任务") &&
    c.messages
      .findLast((m) => m.role === "user" && m.source?.kind === "user")
      ?.content[0]?.text.includes("「程序员」"),
);
const slowPrompt = slow.messages.findLast(
  (m) => m.role === "user" && m.source?.kind === "user",
).content[0].text;
assert.equal(
  JSON.parse(slowPrompt.slice(slowPrompt.indexOf("\n") + 1)).length,
  1,
);
record("提交窗口冻结且 owner 可继续接待", {
  countAtSubmit: 1,
  countAfterChange: 5,
  messages: view.messages.length,
});
await submit("@程 失败模拟", [member]);
await new Promise((r) => setTimeout(r, 200));
view = await api("view", undefined, id);
assert.ok(view.notices.some((n) => n.outcome === "failed"));
record("失败说明与重新点名入口", { notices: view.notices });
await submit("@程 等待停止", [member]);
for (let i = 0; i < 100; i++) {
  if ((await api("view", undefined, id)).working.length === 1) break;
  await new Promise((r) => setTimeout(r, 10));
}
await api("stop", {}, id);
for (let i = 0; i < 100; i++) {
  view = await api("view", undefined, id);
  if (
    view.working.length === 0 &&
    view.notices.some((n) => n.outcome === "stopped")
  )
    break;
  await new Promise((r) => setTimeout(r, 10));
}
assert.equal(view.working.length, 0);
assert.ok(view.notices.some((n) => n.outcome === "stopped"));
record("真实取消与确认结束", view.notices);
const emptyStop = await api("stop", {}, id);
assert.equal(emptyStop.working, 0);
record("重复停止保持成果", { messages: view.messages.length });
await writeFile(
  process.env.KMH_TEAM_TEST_EVIDENCE,
  JSON.stringify({ base, teamId: id, evidence }, null, 2) + "\n",
);
console.log(`Web smoke PASS: ${evidence.length} records, team ${id}`);
