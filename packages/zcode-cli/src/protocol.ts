/** KMH messages and tool calls projected to the official raw generation endpoint. */
import { z } from "zod";
import {
  ToolCallId,
  type GenerateOptions,
  type StreamChunk,
} from "@deepseek-ai/dsh-llm";

const toolCall = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  input: z.json(),
});
/** Native generation result validated at the process boundary. */
export const GenerationResult = z.object({
  text: z.string(),
  toolCalls: z.array(toolCall).optional(),
  finishReason: z.string().optional(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
      totalTokens: z.number().int().nonnegative().optional(),
      cacheReadTokens: z.number().int().nonnegative().optional(),
      cacheWriteTokens: z.number().int().nonnegative().optional(),
      reasoningTokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
interface NativeMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: z.infer<typeof toolCall>[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}
/**
 * Preserve KMH prompt text, tool schemas and call/result correlation; refuse unsupported content.
 * Developer context is carried as a user message, matching the raw endpoint's role vocabulary.
 * @param options - Fully assembled and logged KMH request.
 * @returns Native messages and tool declarations.
 */
export function projectRequest(options: GenerateOptions): {
  messages: NativeMessage[];
  tools: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  }[];
} {
  if (options.temperature !== undefined)
    throw new Error("ZCode raw endpoint does not accept temperature");
  if (options.stop !== undefined)
    throw new Error("ZCode raw endpoint does not accept stop sequences");
  const messages: NativeMessage[] = [];
  if (options.system !== undefined)
    messages.push({ role: "system", content: options.system });
  const calls = new Map<string, string>();
  for (const message of options.messages) {
    const texts: string[] = [];
    const toolCalls: z.infer<typeof toolCall>[] = [];
    for (const block of message.content) {
      switch (block.type) {
        case "text":
          texts.push(block.text);
          break;
        case "tool-call":
          if (message.role !== "assistant")
            throw new Error("Tool call requires assistant role");
          calls.set(block.id, block.name);
          toolCalls.push({
            id: block.id,
            name: block.name,
            input: z.json().parse(JSON.parse(block.arguments)),
          });
          break;
        case "file":
        case "image":
        case "reasoning":
        case "tool-addition":
        case "tool-removal":
          throw new Error(`Unsupported ZCode content: ${block.type}`);
      }
    }
    const role = message.role === "developer" ? "user" : message.role;
    const native: NativeMessage = { role, content: texts.join("\n") };
    if (toolCalls.length) native.toolCalls = toolCalls;
    if (message.role === "tool") {
      const toolName = calls.get(message.toolCallId);
      if (toolName === undefined)
        throw new Error("Missing tool call correlation");
      native.toolName = toolName;
      native.toolCallId = message.toolCallId;
      if (message.isError !== undefined) native.isError = message.isError;
    }
    messages.push(native);
  }
  return {
    messages,
    tools: (options.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    })),
  };
}
/**
 * Convert one assembled native response to KMH stream events.
 * @param value - Untrusted process response.
 * @returns Text, tool call, usage and finish events.
 */
export function* projectResult(value: unknown): Generator<StreamChunk> {
  const result = GenerationResult.parse(value);
  let index = 0;
  if (result.text) {
    yield { type: "block-start", index, blockType: "text" };
    yield { type: "text-delta", index, text: result.text };
    yield {
      type: "block-end",
      index,
      block: { type: "text", text: result.text },
    };
    index++;
  }
  for (const call of result.toolCalls ?? []) {
    const id = ToolCallId(call.id);
    const args = JSON.stringify(call.input);
    yield { type: "block-start", index, blockType: "tool-call" };
    yield {
      type: "tool-call-delta",
      index,
      id,
      name: call.name,
      argumentsDelta: args,
    };
    yield {
      type: "block-end",
      index,
      block: { type: "tool-call", id, name: call.name, arguments: args },
    };
    index++;
  }
  const u = result.usage;
  if (u?.inputTokens !== undefined && u.outputTokens !== undefined) {
    const cached = u.cacheReadTokens ?? 0;
    const written = u.cacheWriteTokens ?? 0;
    if (cached + written > u.inputTokens)
      throw new Error("Invalid native token usage");
    yield {
      type: "usage",
      usage: {
        inputTokens: u.inputTokens - cached - written,
        outputTokens: u.outputTokens,
        ...(cached ? { cacheReadTokens: cached } : {}),
        ...(written ? { cacheWriteTokens: written } : {}),
        ...(u.reasoningTokens === undefined
          ? {}
          : { reasoningTokens: u.reasoningTokens }),
        ...(u.totalTokens === u.inputTokens + u.outputTokens
          ? { totalTokens: u.totalTokens }
          : {}),
      },
    };
  }
  const reason = result.finishReason;
  if ((result.toolCalls?.length ?? 0) > 0)
    yield { type: "finish", reason: { kind: "tool-calls" } };
  else if (reason === "length")
    yield { type: "finish", reason: { kind: "max-tokens" } };
  else if (reason === undefined || reason === "stop")
    yield { type: "finish", reason: { kind: "stop" } };
  else throw new Error(`Unsupported native finish reason: ${reason}`);
}
