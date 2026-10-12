/** 确定性模型夹具：真实 AgentLoop 使用真实工具、skill、取消和会话存储。 */
import {
  LlmAdapter,
  LlmError,
} from "../../../third_party/dsh/packages/llm/llm/lib/index.js";
import { appendFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
export const name = "kmh-team-fixture-provider";
export const inject = ["llm"];
export function textResponse(text) {
  return [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text },
    { type: "block-end", index: 0, block: { type: "text", text } },
    { type: "usage", usage: { inputTokens: 10, outputTokens: text.length } },
    { type: "finish", reason: { kind: "stop" } },
  ];
}
export function toolResponse(name, args) {
  const id = "team-fixture-call";
  return [
    { type: "block-start", index: 0, blockType: "tool-call" },
    {
      type: "tool-call-delta",
      index: 0,
      id,
      name,
      argumentsDelta: JSON.stringify(args),
    },
    {
      type: "block-end",
      index: 0,
      block: { type: "tool-call", id, name, arguments: JSON.stringify(args) },
    },
    { type: "usage", usage: { inputTokens: 10, outputTokens: 5 } },
    { type: "finish", reason: { kind: "tool-calls" } },
  ];
}
export class FixtureAdapter extends LlmAdapter {
  calls = [];
  providerInfo(provider) {
    return { id: provider, name: "Team fixture" };
  }
  async listModels(provider) {
    return ["fixture", "fixture-alternate"].map((id) => ({
      provider,
      id,
      name: id,
      inputModalities: ["text"],
    }));
  }
  async *stream(options) {
    this.calls.push(options);
    if (process.env.KMH_TEAM_FIXTURE_LOG)
      await appendFile(
        process.env.KMH_TEAM_FIXTURE_LOG,
        JSON.stringify({
          sessionId: options.sessionId,
          model: options.model,
          messages: options.messages,
          tools: options.tools,
        }) + "\n",
      );
    const lastUser = options.messages.findLast(
      (m) => m.role === "user" && m.source?.kind === "user",
    );
    const prompt =
      lastUser?.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n") ?? "";
    let task = prompt;
    try {
      const json = JSON.parse(prompt.slice(prompt.indexOf("\n") + 1));
      task = json.at(-1).body;
    } catch (error) {
      /* 普通会话的用户正文沿用原文。 */
    }
    const tools = options.messages
      .slice(options.messages.indexOf(lastUser) + 1)
      .filter((m) => m.role === "tool");
    if (
      task.includes("失败模拟") ||
      (task.includes("写手故障") && prompt.includes("「写手」"))
    )
      throw new LlmError("fixture unavailable", "AUTH");
    if (task.includes("过长模拟"))
      throw new LlmError("context too long", "CONTEXT_LENGTH");
    if (task.includes("等待停止")) {
      await delay(60000, undefined, { signal: options.signal });
    }
    if (task.includes("双成员") && prompt.includes("「写手」"))
      await delay(600, undefined, { signal: options.signal });
    if (task.includes("慢任务"))
      await delay(3000, undefined, { signal: options.signal });
    else await delay(150, undefined, { signal: options.signal });
    const name = task.includes("创建写手")
      ? "kmh_team_create_role"
      : task.includes("使用skill")
        ? "skill"
        : task.includes("检查文件")
          ? "read"
          : undefined;
    if (name && tools.length === 0) {
      const args =
        name === "kmh_team_create_role"
          ? { name: "写手", instructions: "撰写和修改博客文章" }
          : name === "skill"
            ? { name: "team-writing" }
            : { file_path: "team-input.txt" };
      yield* toolResponse(name, args);
      return;
    }
    const result = tools
      .map((m) =>
        m.content
          .filter((b) => b.type === "text")
          .map((b) => b.text)
          .join("\n"),
      )
      .join("\n");
    yield* textResponse(
      `### 完整回应\n${task}\n${result ? `能力结果：${result}\n` : ""}[成果链接](https://example.com/team-result)\n\n署名由团队保存。`,
    );
  }
}
export function apply(ctx) {
  const adapter = new FixtureAdapter();
  ctx.effect(() => ctx.llm.registerAdapter(["team-fixture"], adapter));
  ctx.inject(["skills"], (child) => {
    child.effect(() =>
      child.skills.register({
        name: "team-writing",
        description: "团队写作规范",
        content: "SKILL_WRITING_OK：保留完整正文",
        source: "fixture",
      }),
    );
  });
}
