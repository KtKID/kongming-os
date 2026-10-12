/** 固定角色的保存入口，统一界面和主 Agent 的创建请求。 */
import { randomUUID } from "node:crypto";
import {
  CreateRoleSchema,
  RoleSchema,
  type CreateRole,
  type Role,
  type RoleId,
} from "../protocol/index.ts";

/** 角色库使用的已校验持久表。 */
export interface RoleTable {
  entries(): IterableIterator<[string, Role]>;
  put(key: RoleId, value: Role): Promise<void>;
}

/** 每次写入完成后才返回成功；同一请求身份复用原结果。 */
export class RoleStore {
  private chain: Promise<void> = Promise.resolve();
  constructor(private readonly table: RoleTable) {}
  /** 返回已保存配置副本。 */
  list(): Role[] {
    return [...this.table.entries()].map(([, role]) => structuredClone(role));
  }
  /** 验证字段、请求去重并保存；存储错误向调用者传播。 */
  create(raw: CreateRole): Promise<Role> {
    const run = this.chain.then(async () => {
      const input = CreateRoleSchema.parse(raw);
      const existing = this.list().find(
        (role) => role.createRequestId === input.requestId,
      );
      if (existing !== undefined) {
        if (
          existing.name !== input.name ||
          existing.instructions !== input.instructions
        )
          throw new Error("request-conflict");
        return existing;
      }
      const role = RoleSchema.parse({
        roleId: randomUUID(),
        name: input.name,
        instructions: input.instructions,
        createRequestId: input.requestId,
      });
      await this.table.put(role.roleId, role);
      return role;
    });
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  /** 按品牌化身份选择建群角色；缺失角色拒绝创建。 */
  select(ids: readonly RoleId[]): Role[] {
    const roles = this.list();
    return [...new Set(ids)].map((id) => {
      const role = roles.find((value) => value.roleId === id);
      if (role === undefined) throw new Error("role-not-found");
      return role;
    });
  }
}
