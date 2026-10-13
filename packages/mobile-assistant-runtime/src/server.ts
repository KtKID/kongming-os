/** 移动助手沿用 DSH SDK 通知与模型握手，通过公开 Agent API 恢复持久会话。 */
import type { Context } from "@deepseek-ai/cordis";
import { z } from "zod";
import { isAbsolute } from "node:path";
import { brandString } from "@deepseek-ai/dsh-brand";
import type { AgentHandle, AgentSetup } from "@deepseek-ai/dsh-agent";
import { admitEncodedImages } from "@deepseek-ai/dsh-attachment";
import {
  createUserMessage,
  ReasoningEffortId,
  type ContentBlock,
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
  private route: InitializeParams | undefined;
  private readonly handles = new Map<string, AgentHandle>();
  private readonly opening = new Map<string, Promise<AgentHandle>>();
  private readonly abort = new AbortController();
  private closing: Promise<Record<string, never>> | undefined;

  /** 输入运行上下文、协议 peer 和 preset；会话的写 ownership 由 DSH 管理。 */
  constructor(
    private readonly mobileCtx: Context,
    peer: JsonRpcTransportPeer,
    private readonly preset: string,
  ) {
    super(mobileCtx, peer, { maxTokensAsSuccess: true });
  }

  /** 验证模型路由并记录握手；每个进程只接受一次初始化。 */
  override async initialize(
    params: InitializeParams,
  ): Promise<InitializeResult> {
    if (this.route !== undefined) throw new Error("移动助手 SDK 已初始化");
    if (this.abort.signal.aborted) throw new Error("移动助手 SDK 正在关闭");
    const result = await super.initialize(params);
    this.route = { ...params };
    return result;
  }

  /** 接收一轮文本/图片，返回持久输入回执；同 id 的已有历史通过 resume 加载。 */
  override async prompt(
    params: SessionPromptParams,
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
    const message = createUserMessage({ content, source: { kind: "user" } });
    handle.agent.followup(message);
    return { messageId: message.id };
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
