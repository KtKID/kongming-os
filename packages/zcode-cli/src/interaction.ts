/** CLI 反向请求应答器：凭据头直答，审批与用户输入映射 KMH 公开服务。 */
import type { Context } from "@deepseek-ai/cordis";
import type { z } from "zod";
import type { ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import type {} from "@deepseek-ai/dsh-user-approval";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-user-questions";
import { SessionId as brandSessionId } from "@deepseek-ai/dsh-session";
import type { Agent } from "@deepseek-ai/dsh-agent/types";
import type { AskUserQuestionItem } from "@deepseek-ai/dsh-user-questions/types";
import { z as zod } from "zod";
import type { ModelEntry } from "./models.ts";

const providerRuntimeHeaders = zod.object({
  providerId: zod.string(),
  modelSelection: zod.object({
    providerId: zod.string(),
    modelId: zod.string(),
  }),
});
const permissionRequest = zod
  .object({
    requestId: zod.string().optional(),
    toolCallId: zod.string(),
    toolName: zod.string(),
    riskLevel: zod.enum(["low", "medium", "high", "critical"]),
    reason: zod.string(),
    input: zod.unknown(),
  })
  .passthrough();
const userInputRequest = zod.object({
  requestId: zod.string(),
  prompt: zod.string(),
  inputType: zod.enum(["text", "choice", "confirm"]).optional(),
  choices: zod.array(zod.string()).optional(),
});
/** KMH 审批四态 → ZCode 决策值；拒绝与不可用一律 deny（fail closed，方案 A）。 */
export function permissionDecisionOf(outcome: ApprovalOutcome): {
  decision: "allow" | "deny";
  reason?: string;
} {
  if (outcome === "allowed-once") return { decision: "allow" };
  return {
    decision: "deny",
    reason: "用户未批准或审批服务不可用",
  };
}
/** 审批请求展示信息（用户在 Web 审批条上看到的工具名与理由）。 */
export function permissionPromptOf(params: z.infer<typeof permissionRequest>): {
  toolName: string;
  reason: string;
} {
  const input = params.input;
  const summary =
    typeof input === "string"
      ? input.slice(0, 200)
      : JSON.stringify(input)?.slice(0, 300);
  const lines = [`工具：${params.toolName}`, `风险档：${params.riskLevel}`];
  if (summary !== undefined && summary !== "")
    lines.push(`输入摘要：${summary}`);
  if (params.reason !== "") lines.push(`原因：${params.reason}`);
  return { toolName: "ZCode 工具审批", reason: lines.join("\n") };
}
/** 用户输入请求 → 结构化问题（choice 展开选项，confirm 两选一，其余自由文本）。 */
export function userInputQuestionsOf(
  params: z.infer<typeof userInputRequest>,
): AskUserQuestionItem[] {
  const options =
    params.inputType === "confirm"
      ? [{ label: "确认" }, { label: "取消" }]
      : (params.choices ?? []).map((label) => ({ label }));
  return [
    {
      id: "answer",
      question: params.prompt,
      header: "ZCode",
      ...(options.length > 0 ? { options } : {}),
    },
  ];
}
/** 一次 CLI 请求的会话定位与凭据来源。 */
export interface InteractionDeps {
  /** CLI 会话 id → KMH 会话 id（绑定反查）。 */
  kmhSessionOf: (cliSessionId: string) => string | undefined;
  /** 当前账号凭据（凭据头应答用）。 */
  apiKey: () => Promise<string>;
  /** 目录（凭据头路由校验用）。 */
  catalog: () => readonly ModelEntry[];
  providerId: string;
}
/**
 * 反向请求应答器：一条长驻连接安装一次，处理审批、用户输入与凭据头。
 * 未覆盖的反向请求（MCP 授权、browser 等）抛错由传输层回执，CLI 按不可用处理。
 */
export class ZcodeInteractionBridge {
  constructor(
    private readonly ctx: Context,
    private readonly deps: InteractionDeps,
  ) {}
  /** 活跃 Agent；查不到（匿名请求、无 agent 服务）返回 undefined。 */
  private agentOf(cliSessionId: string | undefined): Agent | undefined {
    if (cliSessionId === undefined) return undefined;
    const kmhSessionId = this.deps.kmhSessionOf(cliSessionId);
    if (kmhSessionId === undefined) return undefined;
    return this.ctx.get("agents")?.get(brandSessionId(kmhSessionId));
  }
  /** 唯一分发入口；返回值即回执 result。 */
  async handle(
    method: string,
    params: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "interaction/requestProviderRuntimeHeaders") {
      const request = providerRuntimeHeaders.parse(params);
      if (
        request.providerId !== this.deps.providerId ||
        request.modelSelection.providerId !== this.deps.providerId ||
        !this.deps
          .catalog()
          .some((entry) => entry.nativeId === request.modelSelection.modelId)
      )
        throw new Error("ZCODE_AUTH_ROUTE_MISMATCH");
      return {
        headersApplied: true,
        requestAuth: { apiKey: await this.deps.apiKey() },
      };
    }
    if (method === "interaction/requestPermission") {
      const request = permissionRequest.parse(params);
      const agent = this.agentOf(
        typeof params.sessionId === "string" ? params.sessionId : undefined,
      );
      const approval = this.ctx.get("approval");
      if (agent === undefined || approval === undefined) {
        this.ctx.logger.warn(
          `zcode-cli approval unavailable (agent=${String(agent === undefined)}, service=${String(approval === undefined)}); failing closed: ${request.toolName}`,
        );
        return { decision: "deny", reason: "审批服务不可用" };
      }
      const outcome = await approval.request({
        agent,
        ...permissionPromptOf(request),
      });
      return permissionDecisionOf(outcome);
    }
    if (method === "interaction/requestUserInput") {
      const request = userInputRequest.parse(params);
      const agent = this.agentOf(
        typeof params.sessionId === "string" ? params.sessionId : undefined,
      );
      const service = this.ctx.get("userQuestions");
      if (agent === undefined || service === undefined) {
        this.ctx.logger.warn(
          `zcode-cli user questions unavailable (agent=${String(agent === undefined)}, service=${String(service === undefined)}); cancelling`,
        );
        return { cancelled: true };
      }
      try {
        const answer = await service.ask({
          questions: userInputQuestionsOf(request),
          agent,
        });
        const first = answer.answers[0];
        const value = [...(first?.selected ?? []), first?.custom].find(
          (item) => item !== undefined,
        );
        return value === undefined ? { cancelled: true } : { value };
      } catch {
        // 中止与服务失败都按取消回执，CLI 侧不再等待。
        return { cancelled: true };
      }
    }
    throw new Error("ZCODE_INTERACTION_UNSUPPORTED");
  }
}
