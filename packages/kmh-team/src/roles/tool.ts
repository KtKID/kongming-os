/** 主 Agent 的角色创建工具及持久表声明。 */
import { createHash } from "node:crypto";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { defineDomain, domainTable } from "@deepseek-ai/dsh-storage-domain";
import { RoleSchema, type RoleId, type Role } from "../protocol/index.ts";
import type { RoleStore } from "./index.ts";

/** 固定角色的持久格式；写入由 storage-domain 负责。 */
export const roleDomain = defineDomain({
  name: "kmh_team_roles",
  version: 1,
  tables: { roles: domainTable<RoleId, Role>(RoleSchema) },
});
/** @param store - 共享持久角色库。 @returns 主 Agent 可调用的创建工具。 */
export function createRoleTool(store: RoleStore) {
  return defineTool({
    name: "kmh_team_create_role",
    description:
      "创建并持久保存一位可加入团队的固定 Agent 角色。填写名称与职责。",
    parameters: {
      name: { type: "string", required: true },
      instructions: { type: "string", required: true },
    },
    output: {
      schema: { type: "string" },
      render: (_args, value) => [{ type: "text", text: value }],
    },
    execute: async (args, exec) => {
      if (
        exec.agent === undefined ||
        exec.agent.session.header.origin === "subagent"
      )
        throw new Error("owner-required");
      const hash = createHash("sha256")
        .update(`${exec.agent.id}:${exec.callId}`)
        .digest("hex");
      const requestId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      return JSON.stringify(await store.create({ requestId, ...args }));
    },
    presentCall: () => ({ card: "generic", title: "创建 Agent 角色" }),
  });
}
