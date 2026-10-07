/** 模型目录：分页聚合与 KMH 模型元数据映射。 */
import {
  ReasoningEffortId,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
} from "@deepseek-ai/dsh-llm";
import type { CodexConnection } from "./connection.ts";
import { ModelListResult } from "./protocol.ts";

/** 目录条目的插件侧形态。 */
export interface CodexModelEntry {
  id: string;
  displayName: string;
  /** 模型声明的推理等级；空表示不可调节。 */
  efforts: string[];
  defaultEffort?: string;
}
/** 推理等级的展示名。 */
const effortName: Record<string, string> = {
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "XHigh",
  max: "Max",
  ultra: "Ultra",
};

/**
 * 拉取并聚合模型目录（含分页）。
 * @param connection - 已建立的连接。
 * @param signal - 中止信号。
 * @returns 按 CLI 返回顺序排列的目录条目。
 * @throws CODEX_MODEL_LIST_FAILED 请求失败或响应不合法。
 */
export async function fetchCatalog(
  connection: CodexConnection,
  signal: AbortSignal,
): Promise<CodexModelEntry[]> {
  const entries: CodexModelEntry[] = [];
  let cursor: string | undefined;
  try {
    for (let page = 0; page < 20; page++) {
      const params: Record<string, unknown> = { includeHidden: false };
      if (cursor !== undefined) params.cursor = cursor;
      const raw: unknown = await connection.request(
        "model/list",
        params,
        signal,
      );
      const result = ModelListResult.parse(raw);
      for (const model of result.data) {
        const entry: CodexModelEntry = {
          id: model.id,
          displayName: model.displayName ?? model.id,
          efforts: (model.reasoningEfforts ?? []).map((effort) =>
            typeof effort === "string" ? effort : effort.reasoningEffort,
          ),
        };
        if (model.defaultReasoningEffort !== undefined)
          entry.defaultEffort = model.defaultReasoningEffort;
        entries.push(entry);
      }
      cursor = result.nextPageCursor;
      if (cursor === undefined) break;
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CODEX_"))
      throw error;
    throw new Error(
      `CODEX_MODEL_LIST_FAILED: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return entries;
}
/** 目录条目映射为 KMH 模型列表项。 */
export function toLlmModels(
  provider: string,
  entries: readonly CodexModelEntry[],
): LlmModelInfo[] {
  return entries.map((entry) => ({
    provider,
    id: entry.id,
    name: entry.displayName,
    inputModalities: ["text"],
  }));
}
/** 目录条目映射为解析结果；推理等级取模型声明的可选值。 */
export function resolveLlmModel(
  provider: string,
  entry: CodexModelEntry | undefined,
  defaultMaxTokens: number,
): LlmResolvedModelInfo {
  if (entry === undefined) throw new Error("CODEX_MODEL_UNKNOWN");
  const efforts = entry.efforts.map((effort) => ({
    id: ReasoningEffortId(effort),
    name: effortName[effort] ?? effort,
  }));
  return {
    provider,
    id: entry.id,
    name: entry.displayName,
    inputModalities: ["text"],
    defaultMaxTokens,
    ...(efforts.length > 0
      ? {
          reasoning: {
            efforts,
            defaultEffort: ReasoningEffortId(
              entry.defaultEffort ?? entry.efforts[0] ?? "medium",
            ),
          },
        }
      : {}),
  };
}
