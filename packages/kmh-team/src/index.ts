/** kmh-team 插件：持久角色、团队入口和点名执行。 */
import type { Context } from "@deepseek-ai/cordis";
import z from "@deepseek-ai/schemastery";
import { ReasoningEffortId } from "@deepseek-ai/dsh-llm";
import { SessionId, type Session } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-settings";
import type {} from "@deepseek-ai/dsh-client-connection";
import {
  CreateTeamSchema,
  CreatedSchema,
  EventSchema,
  SubmitSchema,
  type TeamId,
  type TeamEvent,
  type CreateTeam,
} from "./protocol/index.ts";
import { RoleStore } from "./roles/index.ts";
import { roleDomain, createRoleTool } from "./roles/tool.ts";
import { TeamRoom } from "./team/index.ts";
import { DshExecution, TeamExecutor } from "./execution/index.ts";
import { mountProjection } from "./projection/index.ts";
import { mountWeb } from "./web.ts";
/** 插件名与设置命名空间。 */
export const name = "kmh-team";
/** 部署可配置的窗口及 fresh 成员执行容量。 */
export const Config = z.object({
  contextMessageCount: z
    .number()
    .step(1)
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(20)
    .volatile(),
  memberMaxParallel: z
    .number()
    .step(1)
    .min(1)
    .max(Number.MAX_SAFE_INTEGER)
    .default(8)
    .volatile(),
});
export type Config = ReturnType<typeof Config>;
/** 现有能力提供持久化、模型选择、执行和 Web 接入。 */
export const inject = [
  "llm",
  "sessions",
  "storageDomain",
  "sessionController",
  "sessionQuery",
  "sessionProjections",
  "subagents",
  "settings",
  "connection",
  "tools",
];

/** 自有插件运行时；每个团队保留同一持久写入者与执行调度。 */
export class TeamRuntime {
  readonly rooms = new Map<TeamId, TeamRoom>();
  readonly executor: TeamExecutor;
  private readonly creations = new Map<string, Promise<TeamRoom>>();
  private readonly loads = new Map<TeamId, Promise<TeamRoom>>();
  private readonly appended = new WeakSet<TeamEvent>();
  private readonly pendingCreates = new Map<
    string,
    { key: string; room: TeamRoom; session: Session; event: TeamEvent }
  >();
  private closed = false;
  constructor(
    readonly ctx: Context,
    readonly config: Config,
    readonly roles: RoleStore,
  ) {
    this.executor = new TeamExecutor(
      new DshExecution(ctx).run,
      () => config.memberMaxParallel.get(),
      (error) => ctx.logger.error(`kmh-team: ${String(error)}`),
    );
    ctx.on("agent/created", async ({ agent, source }) => {
      if (source === "resume") {
        const observed = await ctx.sessionQuery.readSession(agent.id);
        if (observed.events.some((e) => e.type === "kmh-team/created"))
          agent.cancel({ kind: "user" });
      }
      return undefined;
    });
  }
  /** 建群的请求身份同时作为会话身份，失败重试继续原写入者。 */
  create(raw: CreateTeam): Promise<TeamRoom> {
    if (this.closed) return Promise.reject(Error("team-unloaded"));
    const input = CreateTeamSchema.parse(raw);
    const key = JSON.stringify(input);
    const old = this.creations.get(key);
    if (old !== undefined) return old;
    const operation = this.createOnce(input);
    this.creations.set(key, operation);
    void operation.catch(() => {
      this.creations.delete(key);
    });
    return operation;
  }
  private async createOnce(input: CreateTeam): Promise<TeamRoom> {
    const id = SessionId(input.requestId);
    const waiting = this.pendingCreates.get(input.requestId);
    if (waiting !== undefined) {
      if (waiting.key !== JSON.stringify(input))
        throw Error("request-conflict");
      await this.save(waiting.session, waiting.event);
      this.pendingCreates.delete(input.requestId);
      this.rooms.set(waiting.room.config.teamId, waiting.room);
      return waiting.room;
    }
    const members = this.roles.select(input.memberRoleIds);
    const catalog = await this.ctx.sessionController.modelCatalog();
    if (
      !catalog.groups.some(
        (group) =>
          group.id === input.model.provider &&
          group.models.some((model) => model.id === input.model.model),
      )
    )
      throw Error("model-unavailable");
    await this.ctx.llm.resolveCallConfig({
      provider: input.model.provider,
      model: input.model.model,
      ...(input.model.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(input.model.reasoningEffort) }),
    });
    const created = await this.ctx.sessionController.create({
      sessionId: id,
      cwd: input.cwd,
      ...(input.preset === undefined ? {} : { agentPreset: input.preset }),
    });
    const result = await this.ctx.sessionController.resolveAgent(
      created.sessionId,
    );
    if ("error" in result) throw Error(result.error.message);
    const existing = await this.ctx.sessionQuery.readSession(id);
    const old = existing.events.find((e) => e.type === "kmh-team/created");
    if (old !== undefined) {
      const saved = CreatedSchema.parse(old.data);
      if (
        saved.cwd !== input.cwd ||
        JSON.stringify(saved.model) !== JSON.stringify(input.model) ||
        JSON.stringify(saved.members.map((r) => r.roleId)) !==
          JSON.stringify(input.memberRoleIds)
      )
        throw Error("request-conflict");
      const room = await this.load(saved.teamId);
      await room.retrySave();
      return room;
    }
    await this.ctx.sessionController.selectModel({
      sessionId: id,
      provider: input.model.provider,
      model: input.model.model,
      ...(input.model.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: input.model.reasoningEffort }),
      persistDefault: false,
    });
    const event = CreatedSchema.parse({
      kind: "created",
      version: 1,
      teamId: id,
      createRequestId: input.requestId,
      cwd: input.cwd,
      ...(created.agentPreset === undefined
        ? {}
        : { ownerPreset: created.agentPreset }),
      model: input.model,
      members,
    });
    const room = new TeamRoom(
      event,
      (e) => this.save(result.agent.session, e),
      () => this.config.contextMessageCount.get(),
    );
    this.pendingCreates.set(input.requestId, {
      key: JSON.stringify(input),
      room,
      session: result.agent.session,
      event,
    });
    await this.save(result.agent.session, event);
    this.pendingCreates.delete(input.requestId);
    this.rooms.set(event.teamId, room);
    return room;
  }
  /** 读回团队并标记上个主机的未完成任务；恢复过程保持成员静默。 */
  load(id: TeamId): Promise<TeamRoom> {
    const live = this.rooms.get(id);
    if (live !== undefined) return Promise.resolve(live);
    const pending = this.loads.get(id);
    if (pending !== undefined) return pending;
    const run = this.loadOnce(id);
    this.loads.set(id, run);
    void run.finally(() => this.loads.delete(id)).catch(() => {});
    return run;
  }
  private async loadOnce(id: TeamId): Promise<TeamRoom> {
    const observed = await this.ctx.sessionQuery.readSession(SessionId(id));
    const events = observed.events
      .filter((e) => e.type.startsWith("kmh-team/"))
      .map((e) => EventSchema.parse(e.data));
    const config = events.find((e) => e.kind === "created");
    if (config === undefined) throw Error("team-not-found");
    const resolved = await this.ctx.sessionController.resolveAgent(
      SessionId(id),
    );
    if ("error" in resolved) throw Error(resolved.error.message);
    const room = new TeamRoom(
      config,
      (e) => this.save(resolved.agent.session, e),
      () => this.config.contextMessageCount.get(),
      events,
    );
    this.rooms.set(id, room);
    await room.interruptUnfinished();
    return room;
  }
  /** 有效提交保存后调度，重复提交复用同一组任务。 */
  async submit(raw: unknown): Promise<void> {
    if (this.closed) throw Error("team-unloaded");
    const input = SubmitSchema.parse(raw);
    const room = await this.load(input.teamId);
    const submission = await room.submit(input);
    if (room.messages.length === 1)
      await this.ctx.sessionController.rename({
        sessionId: SessionId(room.config.teamId),
        title: [...input.body.trim()].slice(0, 10).join(""),
      });
    this.executor.schedule(room, submission);
  }
  /** 排空执行后才允许角色存储卸载。 */
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([
      ...this.creations.values(),
      ...this.loads.values(),
    ]);
    await this.executor.close();
  }
  private async save(session: Session, event: TeamEvent): Promise<void> {
    if (!this.appended.has(event)) {
      switch (event.kind) {
        case "created":
          session.append("kmh-team/created", event, { ignorable: true });
          break;
        case "submission":
          session.append("kmh-team/submission", event, { ignorable: true });
          break;
        case "task-linked":
          session.append("kmh-team/task-linked", event, { ignorable: true });
          break;
        case "task-ended":
          session.append("kmh-team/task-ended", event, { ignorable: true });
          break;
      }
      this.appended.add(event);
    }
    if (!(await this.ctx.sessions.flush(session)))
      throw Error("team-persistence-unavailable");
  }
}
/** @param ctx - Cordis 拥有者。 @param config - 已校验并可热更新的配置。 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(roleDomain);
  const roles = new RoleStore(domain.table("roles"));
  const runtime = new TeamRuntime(ctx, config, roles);
  ctx.effect(() => async () => {
    await runtime.close();
    await domain.close();
  });
  mountProjection(ctx);
  ctx.effect(() => ctx.tools.register(createRoleTool(roles)));
  mountWeb(ctx, runtime);
}
