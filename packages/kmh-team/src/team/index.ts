/** 团队的持久公开记录、提交快照和当前执行任务。 */
import { randomUUID } from "node:crypto";
import {
  ActorSchema,
  SubmissionSchema,
  EndedSchema,
  LinkedSchema,
  actorKey,
  type TeamConfig,
  type Submit,
  type Submission,
  type TeamEvent,
  type Task,
  type TaskId,
  type PublicMessage,
  type Actor,
  type Outcome,
  type TeamView,
} from "../protocol/index.ts";

/** @param config - 当前团队。 @param messages - 已保存公开消息。 @param input - 已校验提交。 @param count - 本次固定窗口。 @returns 原子提交事件。 */
export function planSubmission(
  config: TeamConfig,
  messages: readonly PublicMessage[],
  input: Submit,
  count: number,
): Submission {
  if (input.teamId !== config.teamId) throw Error("team-mismatch");
  let cursor = 0;
  let content = "";
  const selected = new Map<string, Actor>();
  for (const mention of [...input.mentions].sort(
    (a, b) => a.offset - b.offset,
  )) {
    if (
      mention.offset < cursor ||
      mention.offset + mention.length > input.body.length
    )
      throw Error("mention-invalid");
    const actor = ActorSchema.parse(mention.actor);
    if (
      actor.kind === "member" &&
      !config.members.some((role) => role.roleId === actor.roleId)
    )
      throw Error("member-unavailable");
    content += input.body.slice(cursor, mention.offset);
    cursor = mention.offset + mention.length;
    selected.set(actorKey(actor), actor);
  }
  content += input.body.slice(cursor);
  if (content.trim() === "") throw Error("task-empty");
  if (selected.size === 0) selected.set("team-owner", { kind: "team-owner" });
  const userMessage: PublicMessage = {
    messageId: randomUUID(),
    publicSeq: messages.length + 1,
    sender: { kind: "user" },
    body: input.body,
  };
  const snapshot = {
    snapshotId: randomUUID(),
    contextMessageCount: count,
    cutPublicSeq: userMessage.publicSeq,
    messages: structuredClone([...messages, userMessage].slice(-count)),
  };
  return SubmissionSchema.parse({
    kind: "submission",
    version: 1,
    requestId: input.requestId,
    userMessage,
    snapshot,
    tasks: [...selected.values()].map((actor) => ({
      taskId: randomUUID(),
      actor,
      triggerMessageId: userMessage.messageId,
      snapshotId: snapshot.snapshotId,
    })),
  });
}

/** 单团队拥有提交写入链；执行状态以 taskId 集合保存，结果以事件身份去重。 */
export class TeamRoom {
  readonly hostEpoch = randomUUID();
  readonly messages: PublicMessage[] = [];
  readonly submissions: Submission[] = [];
  readonly tasks: Task[] = [];
  readonly ended = new Map<
    TaskId,
    Extract<TeamEvent, { kind: "task-ended" }>
  >();
  private readonly active = new Map<TaskId, Actor>();
  private chain: Promise<void> = Promise.resolve();
  private pending: TeamEvent | undefined;
  private readonly completions = new Map<
    TaskId,
    { task: Task; outcome: Outcome; body?: string; notice?: string }
  >();
  private failure: string | undefined;
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  constructor(
    readonly config: TeamConfig,
    private readonly save: (event: TeamEvent) => Promise<void>,
    private readonly count: () => number,
    events: readonly TeamEvent[] = [],
  ) {
    for (const event of events) this.fold(event);
  }
  /** 订阅完整视图变化；释放函数移除该订阅。 */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  /** 当前执行集合与已保存公开记录。 */
  view(): TeamView {
    return {
      team: this.config,
      messages: structuredClone(this.messages),
      notices: [...this.ended.values()].flatMap((e) =>
        e.notice === undefined
          ? []
          : [
              {
                taskId: e.taskId,
                triggerMessageId: this.task(e.taskId).triggerMessageId,
                actor: this.task(e.taskId).actor,
                outcome: e.outcome,
                text: e.notice,
              },
            ],
      ),
      working: [
        ...new Map(
          [...this.active.values()].map((actor) => [actorKey(actor), actor]),
        ).values(),
      ],
      hostEpoch: this.hostEpoch,
      revision: this.revision,
      ...(this.failure === undefined ? {} : { error: this.failure }),
    };
  }
  /** 每次提交冻结内容并在落盘后接纳；相同请求复用原任务。 */
  submit(input: Submit): Promise<Submission> {
    return this.enqueue(async () => {
      if (this.pending !== undefined) throw Error("save-pending");
      const existing = this.submissions.find(
        (s) => s.requestId === input.requestId,
      );
      if (existing !== undefined) {
        const candidate = planSubmission(
          this.config,
          this.messages,
          input,
          this.count(),
        );
        if (
          existing.userMessage.body !== input.body ||
          JSON.stringify(
            existing.tasks.map((t) => actorKey(t.actor)).sort(),
          ) !==
            JSON.stringify(candidate.tasks.map((t) => actorKey(t.actor)).sort())
        )
          throw Error("request-conflict");
        return existing;
      }
      const event = planSubmission(
        this.config,
        this.messages,
        input,
        this.count(),
      );
      await this.commit(event);
      return event;
    });
  }
  /** 实际进入任务执行时登记；等待任务保持普通状态。 */
  start(task: Task): void {
    if (this.ended.has(task.taskId)) return;
    this.active.set(task.taskId, task.actor);
    this.changed();
  }
  /** Child session 身份在成功保存后发布。 */
  link(task: Task, sessionId: string): Promise<void> {
    return this.enqueue(() => {
      if (this.pending !== undefined) throw Error("save-pending");
      return this.commit(
        LinkedSchema.parse({
          kind: "task-linked",
          version: 1,
          taskId: task.taskId,
          executionSessionId: sessionId,
          hostEpoch: this.hostEpoch,
        }),
      );
    });
  }
  /** 执行已实际结束；任务移出实际集合，完整正文与终态一起保存。 */
  finish(
    task: Task,
    outcome: Outcome,
    body?: string,
    notice?: string,
  ): Promise<void> {
    if (this.active.delete(task.taskId)) this.changed();
    if (!this.ended.has(task.taskId) && !this.completions.has(task.taskId))
      this.completions.set(task.taskId, {
        task,
        outcome,
        ...(body === undefined ? {} : { body }),
        ...(notice === undefined ? {} : { notice }),
      });
    return this.enqueue(() => this.drainCompletions());
  }
  private async drainCompletions(): Promise<void> {
    if (this.pending !== undefined) return;
    for (const { task, outcome, body, notice } of this.completions.values()) {
      if (this.ended.has(task.taskId)) {
        this.completions.delete(task.taskId);
        continue;
      }
      const text = body?.trim();
      const event = EndedSchema.parse({
        kind: "task-ended",
        version: 1,
        taskId: task.taskId,
        outcome: !text && outcome === "completed" ? "failed" : outcome,
        ...(text
          ? {
              reply: {
                messageId: randomUUID(),
                publicSeq: this.messages.length + 1,
                sender: task.actor,
                body,
              },
            }
          : {}),
        ...(notice
          ? { notice }
          : text
            ? {}
            : {
                notice:
                  outcome === "completed"
                    ? "回应为空，请重新点名。"
                    : "回应失败或已停止，请重新发送或点名。",
              }),
      });
      await this.commit(event);
    }
  }

  /** 仅重试待保存事件，执行任务身份与完整回复保持原值。 */
  retrySave(): Promise<void> {
    return this.enqueue(async () => {
      if (this.pending !== undefined) await this.commit(this.pending);
      await this.drainCompletions();
    });
  }
  /** 恢复后的旧任务形成持久中断通知；读取团队保持静默。 */
  interruptUnfinished(): Promise<void> {
    return this.enqueue(async () => {
      for (const task of this.tasks)
        if (!this.ended.has(task.taskId))
          await this.commit(
            EndedSchema.parse({
              kind: "task-ended",
              version: 1,
              taskId: task.taskId,
              outcome: "interrupted",
              notice: "上次回应因 KMH 重启而中断，请重新发送或点名。",
            }),
          );
    });
  }
  /** 已接纳任务与其本次固定快照。 */
  submissionFor(task: Task): Submission {
    const value = this.submissions.find(
      (s) => s.snapshot.snapshotId === task.snapshotId,
    );
    if (value === undefined) throw Error("snapshot-missing");
    return value;
  }
  private task(id: TaskId): Task {
    const task = this.tasks.find((t) => t.taskId === id);
    if (task === undefined) throw Error("task-missing");
    return task;
  }
  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const result = this.chain.then(run);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  private async commit(event: TeamEvent): Promise<void> {
    this.pending = event;
    try {
      await this.save(event);
    } catch (error) {
      this.failure = String(error);
      this.changed();
      throw error;
    }
    this.pending = undefined;
    this.failure = undefined;
    this.fold(event);
    this.changed();
  }
  private fold(event: TeamEvent): void {
    switch (event.kind) {
      case "created":
        break;
      case "submission":
        if (!this.submissions.some((s) => s.requestId === event.requestId)) {
          this.submissions.push(event);
          this.messages.push(event.userMessage);
          this.tasks.push(...event.tasks);
        }
        break;
      case "task-linked":
        break;
      case "task-ended":
        if (!this.ended.has(event.taskId)) {
          this.ended.set(event.taskId, event);
          this.completions.delete(event.taskId);
          if (event.reply !== undefined) this.messages.push(event.reply);
        }
        break;
    }
  }
  private changed(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }
}
