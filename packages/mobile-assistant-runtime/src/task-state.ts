/** 从原会话日志投影任务结果，并通过公开 Agent 能力执行受归属保护的停止和继续。 */
import { createHash, randomUUID } from "node:crypto";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { MessageId } from "@deepseek-ai/dsh-llm";
import type { TaskStore } from "./task-store.js";
import {
  TaskSnapshotSchema,
  projectTurnReason,
  type TaskBinding,
  type TaskControl,
  type TaskIdentity,
  type TaskQuery,
  type TaskSnapshot,
  type TaskProjection,
  type SessionState,
  type TaskCode,
} from "./protocol.js";

/** 控制失败保持明确分类，transport 将其转换为可展示的错误响应。 */
export class TaskControlError extends Error {
  constructor(
    readonly code: TaskCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "TaskControlError";
  }
}

/** 从合法的日志前缀读取所属 turn；原消息之前的历史及其他 turn 继续保持其归属。 */
export function projectTask(
  binding: TaskBinding,
  events: readonly SessionEvent[],
  status: SessionState,
  epoch: string,
  revision: number,
): TaskSnapshot {
  let turn = binding.turn;
  let nearestTurn: number | undefined;
  for (const event of events) {
    if (event.seq <= binding.beforeSeq) continue;
    if (event.type === "turn/start") nearestTurn = event.data.turn;
    if (event.type === "user/message" && event.data.id === binding.messageId)
      turn = nearestTurn;
  }
  let projection: TaskProjection = { outcome: { kind: "pending" } };
  let answer = "";
  let reasoning = "";
  let sawEnd = false;
  let sawStart = false;
  for (const event of events) {
    if (event.seq <= binding.beforeSeq) continue;
    if (event.type === "turn/start" && event.data.turn === turn)
      sawStart = true;
    if (event.type === "assistant/message" && event.data.turn === turn) {
      const hasTool = event.data.message.content.some(
        (block) => block.type === "tool-call",
      );
      for (const block of event.data.message.content) {
        if (block.type === "text") {
          if (hasTool) reasoning += block.text;
          else answer += block.text;
        } else if (block.type === "reasoning") reasoning += block.text;
      }
    }
    if (event.type === "tool/call" && event.data.turn === turn)
      reasoning += `\n调用工具 ${event.data.name}\n${event.data.arguments}\n`;
    if (event.type === "tool/result" && event.data.turn === turn) {
      for (const block of event.data.message.content) {
        if (block.type === "text") reasoning += block.text;
      }
    }
    if (event.type === "turn/end" && event.data.turn === turn) {
      projection = projectTurnReason(event.data.reason);
      sawEnd = true;
    }
  }
  if (!sawEnd && status === "unavailable")
    projection = {
      outcome: { kind: "unknown", endConfirmed: false },
      detail: {
        code: "TASK_STATUS_UNAVAILABLE",
        message: "当前暂时无法核对原任务执行情况，可重新检查",
      },
    };
  else if (!sawEnd && status !== "running")
    projection = {
      outcome: { kind: "unknown", endConfirmed: false },
      detail: {
        code: "TASK_STATUS_UNKNOWN",
        message: sawStart
          ? "原任务结束记录尚未取得，可重新检查"
          : "原任务尚未找到完整的执行记录，可重新检查",
      },
    };
  if (!sawStart && binding.stoppedBeforeTurn === true) {
    sawEnd = true;
    projection = projectTurnReason({
      kind: "aborted",
      reason: { kind: "user", reason: "原任务的待处理输入已停止" },
    });
  }
  if (projection.outcome.kind === "completed" && answer === "")
    projection.detail = {
      code: "TASK_EMPTY_RESULT",
      message: "任务已结束，未收到回答正文",
      sourceReason: "completed",
    };
  return TaskSnapshotSchema.parse({
    version: 1,
    taskId: binding.taskId,
    contextId: binding.contextId,
    epoch,
    revision,
    ...projection,
    sessionState: status,
    executionStopped: sawEnd
      ? true
      : status === "running"
        ? false
        : status === "unavailable"
          ? null
          : true,
    contentCursor: events.at(-1)?.seq ?? binding.beforeSeq,
    answer,
    reasoning,
    answerAvailability:
      sawEnd && projection.outcome.kind === "completed" && answer !== ""
        ? "complete"
        : answer !== ""
          ? "partial"
          : sawEnd
            ? "unavailable"
            : "temporarily-unavailable",
  });
}

/** 缺少登记只能产生未知快照，后续控制保留原任务标识。 */
function unavailable(
  identity: TaskIdentity,
  epoch: string,
  code: TaskCode,
  message: string,
): TaskSnapshot {
  return TaskSnapshotSchema.parse({
    ...identity,
    version: 1,
    epoch,
    revision: 0,
    outcome: { kind: "unknown", endConfirmed: false },
    sessionState: "unavailable",
    executionStopped: null,
    contentCursor: -1,
    answer: "",
    reasoning: "",
    answerAvailability: "temporarily-unavailable",
    detail: { code, message },
  });
}

export interface TaskRuntimeDeps {
  store: TaskStore;
  observeAgent: (sessionId: string) => Promise<Agent>;
  readEvents: (sessionId: string) => Promise<readonly SessionEvent[]>;
  flush: () => Promise<void>;
}

/** 一进程内的当前任务定位与控制去重；正文始终从会话日志读取。 */
export function createTaskRuntime(deps: TaskRuntimeDeps) {
  const epoch = randomUUID();
  let revision = 0;
  const revisions = new Map<string, { digest: string; revision: number }>();
  const current = new Map<string, TaskBinding>();
  const quiescent = new Set<string>();
  const canceling = new Map<string, Promise<TaskSnapshot>>();
  const key = (task: TaskIdentity): string =>
    JSON.stringify([task.contextId, task.taskId]);
  const stamp = (snapshot: TaskSnapshot): TaskSnapshot => {
    const id = key(snapshot);
    const digest = createHash("sha256")
      .update(JSON.stringify({ ...snapshot, revision: 0 }))
      .digest("hex");
    const previous = revisions.get(id);
    if (previous?.digest !== digest)
      revisions.set(id, { digest, revision: ++revision });
    return { ...snapshot, revision: revisions.get(id)?.revision ?? revision };
  };
  const bindingFor = async (
    task: TaskIdentity,
  ): Promise<TaskBinding | undefined> =>
    deps.store.get(task.contextId, task.taskId);
  const get = async (task: TaskIdentity | TaskQuery): Promise<TaskSnapshot> => {
    try {
      const binding = await bindingFor(task);
      if (binding === undefined) {
        const snapshot = unavailable(
          task,
          epoch,
          "TASK_STATUS_UNKNOWN",
          "当前查不到原任务定位，实际结束仍待确认",
        );
        if ("sessionId" in task) {
          try {
            const status = (await deps.observeAgent(task.sessionId)).status;
            snapshot.sessionState = status;
            snapshot.executionStopped = status !== "running";
            snapshot.detail = {
              code: "TASK_STATUS_UNKNOWN",
              message:
                status === "running"
                  ? "原任务定位缺失，当前会话仍有执行，任务归属待确认"
                  : "原任务结果待确认，KMH 已核对当前会话没有执行中的活动",
            };
          } catch {
            /* 写 ownership 或记录缺失时继续保持未知。 */
          }
        }
        return stamp(snapshot);
      }
      let status: SessionState = "unavailable";
      try {
        status = (await deps.observeAgent(binding.internalSessionId)).status;
      } catch {
        /* 写 ownership 冲突等情况保留 unavailable。 */
      }
      await deps.flush();
      const events = await deps.readEvents(binding.internalSessionId);
      return stamp(projectTask(binding, events, status, epoch, 0));
    } catch {
      return stamp(
        unavailable(
          task,
          epoch,
          "TASK_STATUS_UNAVAILABLE",
          "原任务定位或会话记录暂时无法读取，可重新检查",
        ),
      );
    }
  };
  const ownsLatestTurn = async (binding: TaskBinding): Promise<boolean> => {
    await deps.flush();
    const events = await deps.readEvents(binding.internalSessionId);
    let target = binding.turn;
    let latest: number | undefined;
    for (const event of events) {
      if (event.type === "turn/start") latest = event.data.turn;
      if (event.type === "user/message" && event.data.id === binding.messageId)
        target = latest;
    }
    return (
      latest === undefined ||
      latest === target ||
      events.every((event) => event.seq <= binding.beforeSeq)
    );
  };
  return {
    get,
    async admit(binding: TaskBinding): Promise<void> {
      const existing = await bindingFor(binding);
      if (existing !== undefined)
        throw new TaskControlError(
          "TASK_BUSY",
          "同一任务已经接纳，请核对原任务",
        );
      const previous = current.get(binding.internalSessionId);
      if (
        previous !== undefined &&
        canceling.has(key(previous)) &&
        !quiescent.has(key(previous))
      )
        throw new TaskControlError(
          "TASK_BUSY",
          "原任务仍在停止收尾，请等待确认",
        );
      await deps.store.put(binding);
      current.set(binding.internalSessionId, binding);
    },
    async stoppedPending(task: TaskIdentity): Promise<void> {
      const binding = await bindingFor(task);
      if (binding !== undefined && binding.turn === undefined)
        await deps.store.put({ ...binding, stoppedBeforeTurn: true });
    },
    async accepted(binding: TaskBinding): Promise<void> {
      await deps.store.put({ ...binding, admission: "accepted" });
    },
    async onEvent(sessionId: string, event: SessionEvent): Promise<void> {
      const binding = current.get(sessionId);
      if (
        binding === undefined ||
        event.seq <= binding.beforeSeq ||
        binding.turn !== undefined
      )
        return;
      if (event.type === "turn/start") {
        binding.turn = event.data.turn;
        await deps.store.put(binding);
      }
    },
    cancel(task: TaskControl): Promise<TaskSnapshot> {
      const id = key(task);
      const pending = canceling.get(id);
      if (pending !== undefined) return pending;
      const operation = (async () => {
        const binding = await bindingFor(task);
        if (binding === undefined) {
          const state = await get(task);
          if (state.executionStopped === true) return state;
          throw new TaskControlError(
            "TASK_STOP_FAILED",
            "TASK_STATUS_UNKNOWN：原任务归属待确认，无法确认目标执行已停止",
          );
        }
        const agent = await deps.observeAgent(binding.internalSessionId);
        const state = await get(task);
        const active = current.get(binding.internalSessionId);
        // 已结束或新任务拥有当前活动时，只返回原任务结果。
        if (
          state.outcome.kind !== "pending" &&
          !(state.outcome.kind === "unknown" && !state.outcome.endConfirmed)
        )
          return state;
        if (
          (active !== undefined && key(active) !== key(task)) ||
          !(await ownsLatestTurn(binding))
        )
          throw new TaskControlError(
            "TASK_STOP_FAILED",
            "原任务已被新的执行替代，请核对原结果",
          );
        const removed = agent.inbox.remove(
          brandString<MessageId>(binding.messageId),
        );
        agent.cancel({ kind: "user" }, { keepInbox: true });
        await agent.whenIdle();
        quiescent.add(id);
        if (removed && binding.turn === undefined)
          await deps.store.put({ ...binding, stoppedBeforeTurn: true });
        await deps.flush();
        return get(task);
      })();
      canceling.set(id, operation);
      operation
        .finally(() => {
          if (canceling.get(id) === operation) {
            canceling.delete(id);
            quiescent.delete(id);
          }
        })
        .catch(() => undefined);
      return operation;
    },
    async resume(task: TaskControl): Promise<TaskSnapshot> {
      const binding = await bindingFor(task);
      if (binding === undefined) return get(task);
      const agent = await deps.observeAgent(binding.internalSessionId);
      const active = current.get(binding.internalSessionId);
      if (
        (active !== undefined && key(active) !== key(task)) ||
        !(await ownsLatestTurn(binding))
      )
        return get(task);
      agent.unsuspend();
      return get(task);
    },
    isStopping(sessionId: string): boolean {
      const binding = current.get(sessionId);
      return (
        binding !== undefined &&
        canceling.has(key(binding)) &&
        !quiescent.has(key(binding))
      );
    },
  };
}
