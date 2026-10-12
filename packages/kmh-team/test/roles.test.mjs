import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { RoleStore } from "../lib/src/roles/index.js";

function memoryTable() {
  const records = new Map();
  return {
    records,
    get: (id) => records.get(id),
    entries: () => records.entries(),
    put: async (id, role) => {
      records.set(id, structuredClone(role));
    },
  };
}
test("feat01 场景1,2,6: UI/tool create, durable readback and idempotency", async () => {
  const table = memoryTable();
  const roles = new RoleStore(table);
  const input = {
    requestId: randomUUID(),
    name: "写手",
    instructions: "撰写文章",
  };
  const role = await roles.create(input);
  assert.equal((await roles.create(input)).roleId, role.roleId);
  assert.deepEqual(new RoleStore(table).list(), [role]);
});
test("feat01 场景4,5: invalid data or save failure preserves the previous records", async () => {
  const table = memoryTable();
  const roles = new RoleStore(table);
  await assert.rejects(
    roles.create({ requestId: randomUUID(), name: " ", instructions: "x" }),
  );
  table.put = async () => {
    throw new Error("storage-failed");
  };
  await assert.rejects(
    roles.create({ requestId: randomUUID(), name: "写手", instructions: "x" }),
    /storage-failed/,
  );
  assert.deepEqual(roles.list(), []);
});
test("feat01 场景3: stable role identity can be independently snapshotted by two teams", async () => {
  const roles = new RoleStore(memoryTable());
  const role = await roles.create({
    requestId: randomUUID(),
    name: "程序员",
    instructions: "检查代码",
  });
  const a = roles.select([role.roleId]);
  const b = roles.select([role.roleId]);
  assert.deepEqual(a, b);
  assert.notEqual(a[0], b[0]);
});

import { createRoleTool, roleDomain } from "../lib/src/roles/tool.js";
import { Context } from "@deepseek-ai/cordis";
import { JsonStorageBackend } from "../../../third_party/dsh/packages/storage/storage-json/lib/index.js";
import { DomainFacility } from "@deepseek-ai/dsh-storage-domain";
import Storage from "../../../third_party/dsh/packages/storage/storage/lib/index.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("feat01 场景1,2,6: real storage-domain JSON restart and registered tool authorization", async () => {
  const dir = await mkdtemp(join(tmpdir(), "kmh-role-"));
  const ctx = new Context();
  await ctx.plugin(Storage);
  const backend = new JsonStorageBackend(dir);
  ctx.storage.backend.register("json", backend);
  const facility = new DomainFacility(ctx, { backend: "json" });
  let domain = await facility.open(roleDomain);
  const store = new RoleStore(domain.table("roles"));
  const tool = createRoleTool(store);
  const exec = {
    callId: "call-role-1",
    agent: { id: "main", session: { header: { origin: "user" } } },
  };
  const response = await tool.execute(
    { name: "写手", instructions: "修改文章" },
    exec,
  );
  assert.match(JSON.stringify(response), /写手/);
  assert.equal(store.list().length, 1);
  await assert.rejects(
    () =>
      tool.execute(
        { name: "另一个", instructions: "修改" },
        { ...exec, agent: { session: { header: { origin: "subagent" } } } },
      ),
    /owner-required/,
  );
  await domain.close();
  domain = await facility.open(roleDomain);
  assert.equal(new RoleStore(domain.table("roles")).list()[0].name, "写手");
  await domain.close();
  await backend.close();
  await ctx.fiber.dispose();
  await rm(dir, { recursive: true });
});
