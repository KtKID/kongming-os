/** 原生审批桥（feat09）：Codex 审批类服务端请求转 KMH 用户决定（D18）。 */
import type { Context } from "@deepseek-ai/cordis";
import type { z } from "zod";
import type { ApprovalOutcome } from "@deepseek-ai/dsh-user-approval";
import type {} from "@deepseek-ai/dsh-user-approval";
import type {} from "@deepseek-ai/dsh-agent";
import type {} from "@deepseek-ai/dsh-user-questions";
import type { Agent } from "@deepseek-ai/dsh-agent/types";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type {
  AskUserQuestionAnswer,
  AskUserQuestionItem,
} from "@deepseek-ai/dsh-user-questions/types";
import {
  CommandExecutionRequestApprovalParams,
  FileChangeRequestApprovalParams,
  McpServerElicitationRequestParams,
  PermissionsRequestApprovalParams,
  ToolRequestUserInputParams,
  fieldOf,
} from "./protocol.ts";

/** KMH 审批四态 → Codex 命令/文件审批决定值。 */
export function commandDecisionOf(
  outcome: ApprovalOutcome,
): "accept" | "decline" | "cancel" {
  if (outcome === "allowed-once") return "accept";
  if (outcome === "cancelled") return "cancel";
  // rejected 与 unavailable 都拒绝：缺入口 fail closed，模型收到拒绝可继续。
  return "decline";
}
/** 审批请求展示信息（approval.request 的 toolName 与 reason，用户可见）。 */
export interface ApprovalPrompt {
  toolName: string;
  reason: string;
}
/** 命令执行审批的展示信息：命令、工作目录与申请原因。 */
export function commandApprovalPromptOf(
  params: z.infer<typeof CommandExecutionRequestApprovalParams>,
): ApprovalPrompt {
  const lines = [`命令：${params.command ?? "（未提供）"}`];
  if (params.cwd !== null && params.cwd !== undefined)
    lines.push(`工作目录：${params.cwd}`);
  lines.push("申请权限：执行该原生命令（来源 Codex 原生工具）");
  if (params.reason !== null && params.reason !== undefined)
    lines.push(`原因：${params.reason}`);
  return { toolName: "codex 命令执行审批", reason: lines.join("\n") };
}
/** 文件修改审批的展示信息。 */
export function fileChangeApprovalPromptOf(
  params: z.infer<typeof FileChangeRequestApprovalParams>,
): ApprovalPrompt {
  const lines = ["申请权限：修改文件（来源 Codex 原生工具）"];
  if (params.grantRoot !== null && params.grantRoot !== undefined)
    lines.push(`授权根：${params.grantRoot}（批准仅本次生效）`);
  if (params.reason !== null && params.reason !== undefined)
    lines.push(`原因：${params.reason}`);
  return { toolName: "codex 文件修改审批", reason: lines.join("\n") };
}
/** 权限申请审批的展示信息：请求范围原样展示供审阅。 */
export function permissionsApprovalPromptOf(
  params: z.infer<typeof PermissionsRequestApprovalParams>,
): ApprovalPrompt {
  const lines = [`工作目录：${params.cwd}`];
  lines.push(
    `申请权限范围：${JSON.stringify(params.permissions)}（批准仅授予该范围）`,
  );
  if (params.reason !== null && params.reason !== undefined)
    lines.push(`原因：${params.reason}`);
  return { toolName: "codex 权限申请审批", reason: lines.join("\n") };
}
/** 用户中止 → cancel，其余失败（含无应答者）→ decline。 */
function elicitationActionOf(error: unknown): "decline" | "cancel" {
  const code = fieldOf(error, "code");
  return code === "ASK_ABORTED" ? "cancel" : "decline";
}
/** 对象守卫（unknown → record）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
 * 原生审批桥：把审批类服务端请求交给 KMH 公开服务决定。
 * 审批走 `approval.request()`（需活跃 Agent 与开放 turn），用户输入与
 * MCP 确认走 `userQuestions.ask()`（需要结构化答案）；两者缺失时
 * fail closed。每个服务端请求由行协议保证恰有一次回执（一次性语义）；
 * 停止/中断经 signal 传导为 cancelled / ASK_ABORTED。
 */
export class CodexApprovalBridge {
  constructor(
    private readonly ctx: Context,
    private readonly sessionId: SessionId | undefined,
    private readonly signal: AbortSignal | undefined,
  ) {}
  /** 会话的活跃 Agent；查不到（临时会话、无 agent 服务）返回 undefined。 */
  private agentOf(): Agent | undefined {
    if (this.sessionId === undefined) return undefined;
    return this.ctx.agents?.get(this.sessionId);
  }
  /** 经 KMH 审批服务决定一次请求；无入口时 fail closed 并记录可读原因。 */
  private async decide(prompt: ApprovalPrompt): Promise<ApprovalOutcome> {
    const agent = this.agentOf();
    const approval = this.ctx.approval;
    if (agent === undefined || approval === undefined) {
      this.ctx.logger.warn(
        `codex-cli approval unavailable (agent=${String(agent === undefined)}, service=${String(approval === undefined)}); failing closed: ${prompt.toolName}`,
      );
      return "unavailable";
    }
    return await approval.request({
      agent,
      toolName: prompt.toolName,
      reason: prompt.reason,
      ...(this.signal === undefined ? {} : { signal: this.signal }),
    });
  }
  /** item/commandExecution/requestApproval → Codex 决定回执。 */
  async handleCommandApproval(params: unknown): Promise<unknown> {
    const decision = commandDecisionOf(
      await this.decide(
        commandApprovalPromptOf(
          CommandExecutionRequestApprovalParams.parse(params),
        ),
      ),
    );
    return { decision };
  }
  /** item/fileChange/requestApproval → Codex 决定回执。 */
  async handleFileChangeApproval(params: unknown): Promise<unknown> {
    const decision = commandDecisionOf(
      await this.decide(
        fileChangeApprovalPromptOf(
          FileChangeRequestApprovalParams.parse(params),
        ),
      ),
    );
    return { decision };
  }
  /** item/permissions/requestApproval → 授权回执（批准=请求范围/拒绝=空）。 */
  async handlePermissionsApproval(params: unknown): Promise<unknown> {
    const parsed = PermissionsRequestApprovalParams.parse(params);
    const outcome = await this.decide(permissionsApprovalPromptOf(parsed));
    // 只授予用户明确批准的范围（原样请求的 profile），scope 取最窄 turn。
    const granted =
      outcome === "allowed-once" && isRecord(parsed.permissions)
        ? parsed.permissions
        : {};
    return { permissions: granted, scope: "turn" };
  }
  /** item/tool/requestUserInput → 结构化答案回执。 */
  async handleUserInput(params: unknown): Promise<unknown> {
    const parsed = ToolRequestUserInputParams.parse(params);
    const questions: AskUserQuestionItem[] = parsed.questions.map(
      (question) => ({
        id: question.id,
        question: question.question,
        ...(question.header === "" ? {} : { header: question.header }),
        ...((question.options ?? []).length > 0
          ? {
              options: (question.options ?? []).map((option) => ({
                label: option.label,
                ...(option.description === undefined
                  ? {}
                  : { description: option.description }),
              })),
            }
          : {}),
      }),
    );
    return await this.askQuestions(questions, (answer) => {
      const answers: Record<string, { answers: string[] }> = {};
      for (const item of answer.answers)
        answers[item.id] = {
          answers: [
            ...item.selected,
            ...(item.custom === undefined ? [] : [item.custom]),
          ],
        };
      return { answers };
    });
  }
  /** mcpServer/elicitation/request → accept/decline/cancel + content 回执。 */
  async handleElicitation(params: unknown): Promise<unknown> {
    const parsed = McpServerElicitationRequestParams.parse(params);
    return await this.askQuestions(elicitationQuestionsOf(parsed), (answer) =>
      elicitationContentOf(parsed, answer),
    );
  }
  /** 经用户问题服务取得结构化答案并组装回执；中止取消、无应答者拒绝。 */
  private async askQuestions(
    questions: AskUserQuestionItem[],
    build: (answer: AskUserQuestionAnswer) => Record<string, unknown>,
  ): Promise<unknown> {
    const agent = this.agentOf();
    const service = this.ctx.userQuestions;
    if (agent === undefined || service === undefined) {
      this.ctx.logger.warn(
        `codex-cli user questions unavailable (agent=${String(agent === undefined)}, service=${String(service === undefined)}); declining`,
      );
      return { action: "decline" };
    }
    try {
      const answer = await service.ask({
        questions,
        agent,
        ...(this.signal === undefined ? {} : { signal: this.signal }),
      });
      return { action: "accept", ...build(answer) };
    } catch (error) {
      return { action: elicitationActionOf(error) };
    }
  }
}
/** elicitation 请求的表单属性表（schema.properties）；无表单返回 undefined。 */
function elicitationPropertiesOf(
  params: z.infer<typeof McpServerElicitationRequestParams>,
): Record<string, unknown> | undefined {
  const schema = isRecord(params.requestedSchema)
    ? params.requestedSchema
    : undefined;
  const raw = fieldOf(schema, "properties");
  return isRecord(raw) ? raw : undefined;
}
/** elicitation 问题映射：表单属性逐个成题（枚举→选项，其余自填）。 */
function elicitationQuestionsOf(
  params: z.infer<typeof McpServerElicitationRequestParams>,
): AskUserQuestionItem[] {
  const base = { question: params.message ?? `${params.serverName} 请求确认` };
  if (params.url !== undefined)
    return [
      {
        ...base,
        id: "url",
        header: params.serverName,
        options: [
          { label: "已完成授权", description: params.url },
          { label: "取消" },
        ],
      },
    ];
  const properties = elicitationPropertiesOf(params);
  if (properties === undefined)
    return [{ ...base, id: "elicit", header: params.serverName }];
  const questions: AskUserQuestionItem[] = [];
  for (const [name, definition] of Object.entries(properties)) {
    if (!isRecord(definition)) continue;
    const values = fieldOf(definition, "enum");
    const title = fieldOf(definition, "title");
    const options =
      Array.isArray(values) && values.every((item) => typeof item === "string")
        ? values.map((item) => ({ label: item }))
        : undefined;
    const question: AskUserQuestionItem = {
      ...base,
      id: name,
      header: params.serverName,
    };
    if (typeof title === "string" && title !== "") question.detail = title;
    if (options !== undefined) question.options = options;
    questions.push(question);
  }
  return questions.length > 0
    ? questions
    : [{ ...base, id: "elicit", header: params.serverName }];
}
/** elicitation 答案组装为 content 对象（按 schema 属性名与类型取值）。 */
function elicitationContentOf(
  params: z.infer<typeof McpServerElicitationRequestParams>,
  answer: AskUserQuestionAnswer,
): { content?: unknown } {
  const properties = elicitationPropertiesOf(params);
  if (properties === undefined) return {};
  const content: Record<string, unknown> = {};
  for (const item of answer.answers) {
    const value = [
      ...item.selected,
      ...(item.custom === undefined ? [] : [item.custom]),
    ][0];
    if (value === undefined) continue;
    const type = fieldOf(fieldOf(properties, item.id), "type");
    if (type === "number") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) content[item.id] = parsed;
    } else if (type === "boolean") content[item.id] = value === "true";
    else content[item.id] = value;
  }
  return { content };
}
