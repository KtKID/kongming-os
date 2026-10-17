/** 移动助手沿用 DSH SDK 通知与模型握手，通过公开 Agent API 恢复持久会话。 */
import type { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isAbsolute, join } from "node:path";
import { createTaskRuntime, TaskControlError } from "./task-state.js";
import { createTaskStore } from "./task-store.js";
import {
  SdkCapabilitiesSchema,
  type SdkCapabilities,
  SessionObservationSchema,
  SessionControlResultSchema,
  taskFailureDetail,
  type TaskDetail,
  type SessionObservation,
  type SessionQuery,
  type SessionControl,
  type SessionControlResult,
  TaskIdentitySchema,
  type TaskIdentity,
  type TaskQuery,
  type TaskControl,
  type TaskSnapshot,
} from "./protocol.js";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { AgentHandle, AgentSetup } from "@deepseek-ai/dsh-agent";
import { admitEncodedImages } from "@deepseek-ai/dsh-attachment";
import {
  createUserMessage,
  ReasoningEffortId,
  type ContentBlock,
  type MessageId,
} from "@deepseek-ai/dsh-llm";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type {} from "@deepseek-ai/dsh-session-persistence";
import type {} from "@deepseek-ai/dsh-agent-preset-registry";
import { HarnessSdkJsonRpcServer } from "@deepseek-ai/dsh-sdk-jsonrpc-server";
import type {
  InitializeParams,
  InitializeResult,
  JsonRpcTransportPeer,
  SessionPromptParams,
  SessionPromptResult,
} from "@deepseek-ai/dsh-sdk-protocol";

/** 移动助手接受的模型握手字段；非法 JSON 在 SDK 入口拒绝。 */
export const InitializeSchema = z
  .object({
    cwd: z.string().refine(isAbsolute, "工作目录必须是绝对路径"),
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoningEffort: z.string().min(1).transform(ReasoningEffortId).optional(),
    maxTokens: z.number().int().positive().optional(),
  })
  .transform(({ cwd, provider, model, reasoningEffort, maxTokens }) => ({
    cwd,
    provider,
    model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    ...(maxTokens === undefined ? {} : { maxTokens }),
  }));

/** 网关发送文本和内联图片，图片经 DSH attachment 服务持久化。 */
export const PromptSchema = z.object({
  sessionId: z.string().min(1),
  task: TaskIdentitySchema.optional(),
  contentBlocks: z.array(
    z.discriminatedUnion("type", [
      z.object({ type: z.literal("text"), text: z.string() }),
      z.object({
        type: z.literal("image"),
        data: z.string(),
        mimeType: z.enum([
          "image/png",
          "image/jpeg",
          "image/webp",
          "image/gif",
        ]),
      }),
    ]),
  ),
});

/** 绑定助手 preset 的 SDK server，复用 DSH 的协议事件和模型配置验证。 */
export class MobileAssistantServer extends HarnessSdkJsonRpcServer {
  private readonly sessionEpoch = randomUUID();
  private readonly sessionContexts = new Map<string, string>();
  private readonly awaitingTurn = new Set<string>();
  private readonly executions = new Map<string, string>();
  private readonly activeInputs = new Map<string, string>();
  private readonly activeTasks = new Map<string, TaskIdentity>();
  private readonly observations = new Map<string, SessionObservation>();
  private readonly sessionOperations = new Map<
    string,
    { fingerprint: string; result: Promise<SessionControlResult> }
  >();
  private readonly controlling = new Set<string>();
  private route: InitializeParams | undefined;
  private readonly handles = new Map<string, AgentHandle>();
  private readonly opening = new Map<string, Promise<AgentHandle>>();
  private readonly abort = new AbortController();
  private closing: Promise<Record<string, never>> | undefined;
  private tasks: ReturnType<typeof createTaskRuntime> | undefined;
  private readonly submitting = new Set<string>();
  private readonly submissions = new Map<
    string,
    { task: TaskIdentity; settled: Promise<void> }
  >();

  /** 输入运行上下文、协议 peer 和 preset；会话的写 ownership 由 DSH 管理。 */
  constructor(
    private readonly mobileCtx: Context,
    private readonly mobilePeer: JsonRpcTransportPeer,
    private readonly preset: string,
  ) {
    super(mobileCtx, mobilePeer, { maxTokensAsSuccess: true });
    mobileCtx.on("session/event", (session, event) => {
      const id = String(session.id);
      if (event.type === "turn/start") {
        if (!this.awaitingTurn.delete(id))
          this.executions.set(id, randomUUID());
      }
      if (
        event.type === "user/message" &&
        this.activeInputs.get(id) !== String(event.data.id)
      )
        this.activeTasks.delete(id);
      this.publishSession(id);
      this.tasks?.onEvent(String(session.id), event).catch(() => {
        this.mobileCtx.logger.warn("TASK_INDEX_WRITE_FAILED");
      });
    });
    mobileCtx.on("agent/status", ({ agent, status }) => {
      const id = String(agent.session.id);
      if (status === "running") {
        this.executions.set(id, randomUUID());
        this.awaitingTurn.add(id);
      }
      this.publishSession(id);
    });
  }

  /** 验证模型路由并记录握手；每个进程只接受一次初始化。 */
  override async initialize(
    params: InitializeParams,
  ): Promise<InitializeResult & SdkCapabilities> {
    if (this.route !== undefined) throw new Error("移动助手 SDK 已初始化");
    if (this.abort.signal.aborted) throw new Error("移动助手 SDK 正在关闭");
    const result = await super.initialize(params);
    this.route = { ...params };
    this.taskState();
    return {
      ...result,
      ...SdkCapabilitiesSchema.parse({
        kmhTaskControl: { version: 1 },
        kmhSessionObservation: { version: 1 },
      }),
    };
  }

  /** 接收一轮文本/图片，返回持久输入回执；同 id 的已有历史通过 resume 加载。 */
  override async prompt(
    params: SessionPromptParams & { task?: TaskIdentity | undefined },
  ): Promise<SessionPromptResult> {
    if (
      params.task !== undefined &&
      (this.submitting.has(params.sessionId) ||
        this.taskState().isStopping(params.sessionId) ||
        this.controlling.has(params.sessionId))
    )
      throw new TaskControlError(
        "TASK_BUSY",
        "当前会话正在接纳或停止任务，请等待确认",
      );
    let settled: (() => void) | undefined;
    if (params.task !== undefined) {
      this.bindSession({
        sessionId: params.sessionId,
        contextId: params.task.contextId,
      });
      this.activeTasks.set(params.sessionId, params.task);
      this.submitting.add(params.sessionId);
      const pending = new Promise<void>((resolve) => {
        settled = resolve;
      });
      this.submissions.set(params.sessionId, {
        task: params.task,
        settled: pending,
      });
    }
    try {
      return await this.acceptPrompt(params);
    } finally {
      if (params.task !== undefined) {
        this.submitting.delete(params.sessionId);
        this.submissions.delete(params.sessionId);
        settled?.();
        this.publishSession(params.sessionId);
      }
    }
  }

  private async acceptPrompt(
    params: SessionPromptParams & { task?: TaskIdentity | undefined },
  ): Promise<SessionPromptResult> {
    const handle = await this.acquire(params.sessionId);
    const content: ContentBlock[] = [];
    for (const block of params.contentBlocks) {
      if (block.type === "text") content.push(block);
      else if (block.type === "image" && "data" in block) {
        const attachments = this.mobileCtx.get("attachments");
        if (attachments === undefined)
          throw new Error("移动助手图片输入需要 attachment 服务");
        const refs = await admitEncodedImages(attachments, [
          { data: block.data, mediaType: block.mimeType },
        ]);
        const attachment = refs[0];
        if (attachment === undefined)
          throw new Error("移动助手图片存储未返回引用");
        content.push({ type: "image", attachment });
      } else throw new Error("移动助手 SDK 输入仅支持文本与内联图片");
    }
    if (
      this.abort.signal.aborted ||
      this.mobileCtx.agents.get(handle.agent.id) !== handle.agent
    ) {
      throw new Error("移动助手会话已关闭");
    }
    if (
      params.task !== undefined &&
      (handle.agent.status !== "idle" ||
        this.taskState().isStopping(params.sessionId))
    )
      throw new TaskControlError(
        "TASK_BUSY",
        "当前会话仍在执行或挂起，请先停止或继续原任务",
      );
    const message = createUserMessage({ content, source: { kind: "user" } });
    if (params.task === undefined) {
      this.activeTasks.delete(params.sessionId);
      this.activeInputs.delete(params.sessionId);
      handle.agent.followup(message);
      return { messageId: message.id };
    }
    const binding = {
      ...params.task,
      version: 1 as const,
      internalSessionId: params.sessionId,
      messageId: String(message.id),
      beforeSeq: Number(handle.agent.session.seq) - 1,
      admission: "intent" as const,
      createdAt: Date.now(),
    };
    await this.taskState().admit(binding);
    if (handle.agent.status !== "idle")
      throw new TaskControlError(
        "TASK_BUSY",
        "接纳期间会话开始了其他执行，请核对原任务",
      );
    this.activeInputs.set(params.sessionId, String(message.id));
    handle.agent.followup(message);
    await this.taskState().accepted(binding);
    await this.mobileCtx.sessionPersistence.flush();
    return { messageId: message.id };
  }

  /** 查询只恢复已有会话的观察句柄；恢复过程保持原输入，执行由明确动作触发。 */
  private taskState(): ReturnType<typeof createTaskRuntime> {
    if (this.tasks !== undefined) return this.tasks;
    const home = process.env.DSH_HOME;
    if (home === undefined || !isAbsolute(home))
      throw new Error("DSH_HOME 必须为移动任务提供绝对数据目录");
    this.tasks = createTaskRuntime({
      store: createTaskStore(join(home, "mobile-assistant", "tasks")),
      observeAgent: async (id) => {
        if (
          !this.handles.has(id) &&
          (await this.mobileCtx.sessionPersistence.stat(
            brandString<SessionId>(id),
          )) === undefined
        )
          throw new TaskControlError(
            "TASK_STATUS_UNAVAILABLE",
            "原任务的持久会话暂时不可读",
          );
        const agent = (await this.acquire(id)).agent;
        if (this.mobileCtx.agents.get(agent.id) !== agent)
          throw new TaskControlError(
            "TASK_STATUS_UNAVAILABLE",
            "原任务执行句柄已经释放",
          );
        return agent;
      },
      readEvents: async (id) => {
        const handle = await this.mobileCtx.sessionPersistence.open(
          brandString<SessionId>(id),
          "read",
        );
        try {
          return (await handle.read()).events;
        } finally {
          await handle.close();
        }
      },
      flush: () => this.mobileCtx.sessionPersistence.flush(),
    });
    return this.tasks;
  }

  /** 空会话可显式准备；已有会话按原身份打开，查询保持原输入。 */
  async getSession(query: SessionQuery): Promise<SessionObservation> {
    this.bindSession(query);
    try {
      if (
        query.prepare !== true &&
        !this.handles.has(query.sessionId) &&
        (await this.mobileCtx.sessionPersistence.stat(
          brandString<SessionId>(query.sessionId),
        )) === undefined
      )
        throw new TaskControlError(
          "TASK_STATUS_UNAVAILABLE",
          "原会话资料暂不可读，可重新检查",
        );
      await this.acquire(query.sessionId);
      return this.observeSession(query.sessionId);
    } catch (error) {
      return this.observeSession(
        query.sessionId,
        taskFailureDetail("TASK_STATUS_UNAVAILABLE", error, "执行实例暂不可用"),
      );
    }
  }

  private bindSession(query: SessionQuery): void {
    const context = this.sessionContexts.get(query.sessionId);
    if (context !== undefined && context !== query.contextId)
      throw new TaskControlError("TASK_PROTOCOL_ERROR", "会话归属不匹配");
    this.sessionContexts.set(query.sessionId, query.contextId);
  }

  private observeSession(id: string, error?: TaskDetail): SessionObservation {
    const handle = this.handles.get(id);
    const available =
      error === undefined &&
      handle !== undefined &&
      this.mobileCtx.agents.get(handle.agent.id) === handle.agent;
    const previous = this.observations.get(id);
    let ref = this.executions.get(id);
    if (ref === undefined) {
      ref = randomUUID();
      this.executions.set(id, ref);
    }
    const task = this.activeTasks.get(id);
    const value = SessionObservationSchema.parse({
      kind: "session-observation",
      version: 1,
      contextId: this.sessionContexts.get(id),
      epoch: this.sessionEpoch,
      revision: previous?.revision ?? 0,
      agentAvailable: available,
      ...(available ? { status: handle?.agent.status, executionRef: ref } : {}),
      ...(available && handle?.agent.status !== "idle" && task !== undefined
        ? { activeTaskId: task.taskId }
        : {}),
      submissionPending:
        this.submitting.has(id) ||
        (handle?.agent.status === "idle" &&
          (handle.agent.inbox.nextTurn.length > 0 ||
            handle.agent.inbox.nextStep.length > 0)),
      ...(available
        ? {}
        : {
            detail: error ?? {
              code: "TASK_STATUS_UNAVAILABLE",
              message: "执行实例已经释放，可重新检查",
            },
          }),
    });
    if (
      previous === undefined ||
      JSON.stringify({ ...previous, revision: 0 }) !==
        JSON.stringify({ ...value, revision: 0 })
    )
      value.revision++;
    this.observations.set(id, value);
    return value;
  }

  private publishSession(id: string): void {
    if (!this.sessionContexts.has(id) || !this.handles.has(id)) return;
    this.mobilePeer.notify("kmh/session/status", {
      sessionId: id,
      observation: this.observeSession(id),
    });
  }

  /** 操作去重先核对同一目标；同步比较后调用公开 Agent 控制，收尾后返回当前事实。 */
  controlSession(
    params: SessionControl,
    operation: "cancel" | "resume",
  ): Promise<SessionControlResult> {
    this.bindSession(params);
    const key = JSON.stringify([params.sessionId, params.operationId]);
    const fingerprint = JSON.stringify([
      operation,
      params.expectedExecutionRef,
    ]);
    const previous = this.sessionOperations.get(key);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint)
        return Promise.reject(
          new TaskControlError(
            "TASK_PROTOCOL_ERROR",
            "操作标识已经用于另一个目标",
          ),
        );
      return previous.result;
    }
    const result = this.performSessionControl(params, operation);
    this.sessionOperations.set(key, { fingerprint, result });
    return result;
  }

  private async performSessionControl(
    params: SessionControl,
    operation: "cancel" | "resume",
  ): Promise<SessionControlResult> {
    const base = {
      kind: "session-control" as const,
      operationId: params.operationId,
      operation,
    };
    await this.submissions.get(params.sessionId)?.settled;
    const observation = await this.getSession(params);
    if (!observation.agentAvailable)
      return SessionControlResultSchema.parse({
        ...base,
        outcome: "failed",
        observation,
        detail: observation.detail,
      });
    if (observation.executionRef !== params.expectedExecutionRef)
      return SessionControlResultSchema.parse({
        ...base,
        outcome: "target-changed",
        observation,
        detail: {
          code: "TASK_BUSY",
          message: "当前执行目标已变化，请核对后主动操作",
        },
      });
    if (this.controlling.has(params.sessionId))
      return SessionControlResultSchema.parse({
        ...base,
        outcome: "failed",
        observation,
        detail: { code: "TASK_BUSY", message: "当前会话控制尚在处理" },
      });
    const handle = this.handles.get(params.sessionId);
    if (handle === undefined)
      throw new TaskControlError("TASK_STATUS_UNAVAILABLE", "执行实例已经释放");
    this.controlling.add(params.sessionId);
    try {
      const task = this.activeTasks.get(params.sessionId);
      let snapshot: TaskSnapshot | undefined;
      if (operation === "cancel") {
        const input = this.activeInputs.get(params.sessionId);
        const removed =
          input !== undefined &&
          handle.agent.inbox.remove(brandString<MessageId>(input));
        handle.agent.cancel({ kind: "user" }, { keepInbox: true });
        await handle.agent.whenIdle();
        if (task !== undefined) {
          if (removed) await this.taskState().stoppedPending(task);
          snapshot = await this.getTask({
            ...task,
            sessionId: params.sessionId,
          });
        }
      } else {
        handle.agent.unsuspend();
      }
      await this.mobileCtx.sessionPersistence.flush();
      return SessionControlResultSchema.parse({
        ...base,
        outcome: "completed",
        observation: this.observeSession(params.sessionId),
        ...(snapshot === undefined ? {} : { task: snapshot }),
      });
    } catch (error) {
      return SessionControlResultSchema.parse({
        ...base,
        outcome: "failed",
        observation: this.observeSession(params.sessionId),
        detail: taskFailureDetail(
          operation === "cancel" ? "TASK_STOP_FAILED" : "TASK_RESUME_FAILED",
          error,
          "控制失败",
        ),
      });
    } finally {
      this.controlling.delete(params.sessionId);
      this.publishSession(params.sessionId);
    }
  }

  /** 按任务绑定查询实际结果，正文从原会话记录重建。 */
  async getTask(task: TaskQuery): Promise<TaskSnapshot> {
    await this.waitForSubmission(task);
    return this.taskState().get(task);
  }
  /** 真实中止并等待活动收尾；重复请求复用原操作。 */
  async cancelTask(task: TaskControl): Promise<TaskSnapshot> {
    await this.waitForSubmission(task);
    return this.taskState().cancel(task);
  }
  /** 显式释放挂起输入；草稿由手机另行发送。 */
  resumeTask(task: TaskControl): Promise<TaskSnapshot> {
    return this.taskState().resume(task);
  }

  /** 查询与停止等待同一输入的接纳收尾，涵盖图片 I/O 和首次会话创建。 */
  private async waitForSubmission(task: TaskQuery): Promise<void> {
    const pending = this.submissions.get(task.sessionId);
    if (
      pending?.task.taskId === task.taskId &&
      pending.task.contextId === task.contextId
    )
      await pending.settled;
  }

  private async acquire(id: string): Promise<AgentHandle> {
    if (this.route === undefined) throw new Error("移动助手 SDK 尚未初始化");
    if (this.abort.signal.aborted) throw new Error("移动助手 SDK 正在关闭");
    const existing = this.handles.get(id);
    if (existing !== undefined) return existing;
    const pending = this.opening.get(id);
    if (pending !== undefined) return pending;
    const opening = this.open(id, this.route);
    this.opening.set(id, opening);
    try {
      const handle = await opening;
      this.handles.set(id, handle);
      return handle;
    } finally {
      this.opening.delete(id);
    }
  }

  private async open(
    id: string,
    route: InitializeParams,
  ): Promise<AgentHandle> {
    const sessionId = brandString<SessionId>(id);
    const stored = await this.mobileCtx.sessionPersistence.stat(sessionId, {
      signal: this.abort.signal,
    });
    const setup: AgentSetup = async (agentCtx) => {
      await this.mobileCtx.agentPresets.mount(agentCtx, this.preset);
    };
    const agentOptions = {
      provider: route.provider,
      model: route.model,
      ...(route.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: ReasoningEffortId(route.reasoningEffort) }),
      ...(route.maxTokens === undefined ? {} : { maxTokens: route.maxTokens }),
    };
    if (stored !== undefined) {
      if (stored.header.agentPreset !== this.preset)
        throw new Error(`持久会话 ${id} 的 preset 与 ${this.preset} 不匹配`);
      if (stored.header.cwd !== route.cwd)
        throw new Error(`持久会话 ${id} 的工作目录与 SDK 握手不匹配`);
      return this.mobileCtx.agents.resume({
        resumeSessionId: sessionId,
        agentOptions,
        setup,
        signal: this.abort.signal,
      });
    }
    return this.mobileCtx.agents.create({
      sessionId,
      meta: { cwd: route.cwd, agentPreset: this.preset },
      agentOptions,
      setup,
      signal: this.abort.signal,
    });
  }

  /** 取消尚未发布的会话并等待全部已发布 Agent 释放写 ownership；重复调用复用关闭任务。 */
  override shutdown(): Promise<Record<string, never>> {
    this.closing ??= this.closeAll();
    return this.closing;
  }

  private async closeAll(): Promise<Record<string, never>> {
    this.abort.abort();
    await Promise.allSettled(this.opening.values());
    const results = await Promise.allSettled(
      [...this.handles.values()].map((handle) => handle.dispose()),
    );
    this.handles.clear();
    await super.shutdown();
    const failures = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    if (failures.length > 0)
      throw new AggregateError(
        failures.map((result): unknown => result.reason),
        "移动助手会话关闭失败",
      );
    return {};
  }
}
