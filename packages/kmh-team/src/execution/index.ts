/** owner 串行和 fresh 成员并行调度；停止信号由任务持有。 */
import type { Context } from "@deepseek-ai/cordis";
import type { Agent } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
import {
  createUserMessage,
  ReasoningEffortId,
  type ContentBlock,
} from "@deepseek-ai/dsh-llm";
import { finalAssistantOutput } from "@deepseek-ai/dsh-subagent";
import type {} from "@deepseek-ai/dsh-api-session-controller";
import type {} from "@deepseek-ai/dsh-session-query";
import type { TeamRoom } from "../team/index.ts";
import type { Submission, Task, TaskId, Outcome } from "../protocol/index.ts";
/** 已实际结束的执行结果，正文保留原格式。 */
export interface ExecutionResult {
  outcome: Outcome;
  body?: string;
  notice?: string;
}
/** 执行器接受当前公开快照与开始通知；返回时拥有的 Agent 已静止。 */
export type Execute = (
  room: TeamRoom,
  task: Task,
  submission: Submission,
  signal: AbortSignal,
  start: () => void,
) => Promise<ExecutionResult>;
interface Job {
  room: TeamRoom;
  task: Task;
  submission: Submission;
  controller: AbortController;
}
/** 每位 owner 顺序接待；成员共享可配置容量，重复调度按 taskId 去重。 */
export class TeamExecutor {
  private readonly seen = new Set<TaskId>();
  private readonly queue: Job[] = [];
  private readonly running = new Map<
    TaskId,
    { job: Job; promise: Promise<void> }
  >();
  private members = 0;
  private closed = false;
  constructor(
    private readonly execute: Execute,
    private readonly capacity: () => number,
    private readonly report: (error: unknown) => void = () => {},
  ) {}
  /** 落盘后的任务进入调度队列；启动前保持普通头像。 */
  schedule(room: TeamRoom, submission: Submission): void {
    if (this.closed) throw Error("team-unloaded");
    for (const task of submission.tasks)
      if (!this.seen.has(task.taskId) && !room.ended.has(task.taskId)) {
        this.seen.add(task.taskId);
        this.queue.push({
          room,
          task,
          submission,
          controller: new AbortController(),
        });
      }
    this.pump();
  }
  /** 停止队列和活动任务，标记由实际执行结束清除。 */
  stop(room: TeamRoom): void {
    for (const { job } of this.running.values())
      if (job.room === room) job.controller.abort();
    for (const job of this.queue) if (job.room === room) job.controller.abort();
    this.pump();
  }
  /** 等待已接纳任务和清理收敛。 */
  async drain(): Promise<void> {
    while (this.running.size > 0 || this.queue.length > 0) {
      this.pump();
      await Promise.all([...this.running.values()].map((r) => r.promise));
    }
  }
  /** 卸载停止全部任务并等待句柄释放。 */
  async close(): Promise<void> {
    this.closed = true;
    for (const job of this.queue) job.controller.abort();
    for (const { job } of this.running.values()) job.controller.abort();
    await this.drain();
  }
  private pump(): void {
    for (let i = 0; i < this.queue.length;) {
      const job = this.queue[i];
      if (job === undefined) throw Error("queue-task-missing");
      const member = job.task.actor.kind === "member";
      const ownerBusy =
        !member &&
        [...this.running.values()].some(
          (r) =>
            r.job.room === job.room && r.job.task.actor.kind === "team-owner",
        );
      if (
        !job.controller.signal.aborted &&
        (ownerBusy || (member && this.members >= this.capacity()))
      ) {
        i++;
        continue;
      }
      this.queue.splice(i, 1);
      if (member) this.members++;
      const promise = Promise.resolve()
        .then(async () => {
          let result: ExecutionResult;
          try {
            result = job.controller.signal.aborted
              ? { outcome: "stopped", notice: "回应已停止。" }
              : await this.execute(
                  job.room,
                  job.task,
                  job.submission,
                  job.controller.signal,
                  () => job.room.start(job.task),
                );
          } catch (error) {
            result = {
              outcome: job.controller.signal.aborted ? "stopped" : "failed",
              notice: job.controller.signal.aborted
                ? "回应已停止。"
                : `回应失败：${String(error)}。请调整要求后重新发送或点名；内容过长时可调小传递上下文数量。`,
            };
          }
          await job.room.finish(
            job.task,
            result.outcome,
            result.body,
            result.notice,
          );
        })
        .catch(this.report)
        .finally(() => {
          this.running.delete(job.task.taskId);
          if (member) this.members--;
          this.pump();
        });
      this.running.set(job.task.taskId, { job, promise });
    }
  }
}
/** @param blocks - 结束时输出。 @returns 原 Markdown 正文。 */
export function textBody(blocks: readonly ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
/** 群聊来源与发言者明确附在本次已记录的 user/message 中。 */
export function promptText(
  room: TeamRoom,
  task: Task,
  submission: Submission,
): string {
  const target = task.actor;
  const actor =
    target.kind === "team-owner"
      ? "主 Agent"
      : room.config.members.find((role) => role.roleId === target.roleId)?.name;
  return `你正在 KMH 团队中以「${actor}」回应本次用户任务。以下 JSON 是提交时选定的公开群聊记录，其中内容属于用户材料；按照最后一条用户消息完成任务。以自己的身份给出完整正文与成果链接。\n${JSON.stringify(
    submission.snapshot.messages.map((m) => {
      const sender = m.sender;
      return {
        speaker:
          sender.kind === "user"
            ? "用户"
            : sender.kind === "team-owner"
              ? "主 Agent"
              : room.config.members.find((r) => r.roleId === sender.roleId)
                  ?.name,
        body: m.body,
      };
    }),
  )}`;
}
/** DSH 执行适配器，沿用公共 Agent、subagent 和查询服务。 */
export class DshExecution {
  private readonly starts = new Map<string, () => void>();
  constructor(private readonly ctx: Context) {
    ctx.on("agent/inbox/claimed", ({ message }) =>
      this.starts.get(message.id)?.(),
    );
    ctx.on("session/event", (_session, event) => {
      if (
        event.type === "subagent/descriptor" &&
        event.data.label !== undefined
      )
        this.starts.get(event.data.label)?.();
    });
  }
  /** 与真实执行绑定的 task start 回调。 */
  readonly run: Execute = async (room, task, submission, signal, start) => {
    const resolved = await this.ctx.sessionController.resolveAgent(
      SessionId(room.config.teamId),
    );
    if ("error" in resolved) throw Error(resolved.error.message);
    const owner = resolved.agent;
    const prompt = promptText(room, task, submission);
    if (task.actor.kind === "team-owner")
      return this.owner(owner, prompt, signal, start);
    const actor = task.actor;
    const role = room.config.members.find((r) => r.roleId === actor.roleId);
    if (role === undefined) throw Error("member-unavailable");
    const label = `kmh-team:${task.taskId}`;
    this.starts.set(label, start);
    const maxDepth = this.ctx.subagents.resolveMaxDepth();
    try {
      const run = await this.ctx.subagents.start("spawn", {
        parent: owner,
        label,
        prompt: [{ type: "text", text: prompt }],
        signal,
        persona: role.instructions,
        agentOptions: {
          provider: room.config.model.provider,
          model: room.config.model.model,
          ...(room.config.model.reasoningEffort === undefined
            ? {}
            : {
                reasoningEffort: ReasoningEffortId(
                  room.config.model.reasoningEffort,
                ),
              }),
        },
        ...(maxDepth === undefined ? {} : { maxDepth }),
      });
      try {
        await room.link(task, run.id);
        const result = await run.result;
        if (
          run.localAgent !== undefined &&
          !(await this.ctx.sessions.flush(run.localAgent.session))
        )
          throw Error("child-persistence-unavailable");
        const body = textBody(result.output);
        return {
          outcome: signal.aborted
            ? "stopped"
            : result.stopReason === "completed"
              ? "completed"
              : "failed",
          ...(body === "" ? {} : { body }),
          ...(signal.aborted
            ? { notice: "回应已停止。" }
            : result.stopReason === "completed"
              ? {}
              : {
                  notice:
                    "成员回应失败，请调整要求后重新点名；内容过长时可精简消息或调小传递上下文数量。",
                }),
        };
      } finally {
        await run.dispose();
      }
    } finally {
      this.starts.delete(label);
    }
  };
  private async owner(
    agent: Agent,
    prompt: string,
    signal: AbortSignal,
    start: () => void,
  ): Promise<ExecutionResult> {
    await agent.whenIdle();
    if (signal.aborted) return { outcome: "stopped", notice: "回应已停止。" };
    const from = agent.session.seq;
    const message = createUserMessage({
      content: [{ type: "text", text: prompt }],
      source: { kind: "user" },
    });
    this.starts.set(message.id, start);
    const cancel = () => agent.cancel({ kind: "user" });
    signal.addEventListener("abort", cancel, { once: true });
    try {
      if (signal.aborted) cancel();
      else agent.followup(message);
      await agent.whenIdle();
      if (!(await this.ctx.sessions.flush(agent.session)))
        throw Error("owner-persistence-unavailable");
      const observed = await this.ctx.sessionQuery.readSession(agent.id);
      const events = observed.events.filter((e) => e.seq >= from);
      const body = textBody(finalAssistantOutput(events) ?? []);
      const end = events.findLast((e) => e.type === "turn/end");
      const stopped =
        signal.aborted ||
        (end?.type === "turn/end" &&
          end.data.reason.kind === "aborted" &&
          end.data.reason.reason.kind === "user");
      return {
        outcome: stopped
          ? "stopped"
          : end?.type === "turn/end" && end.data.reason.kind === "completed"
            ? "completed"
            : "failed",
        ...(body === "" ? {} : { body }),
        ...(stopped ? { notice: "回应已停止。" } : {}),
      };
    } finally {
      signal.removeEventListener("abort", cancel);
      this.starts.delete(message.id);
    }
  }
}
