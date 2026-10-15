/** 隔离的 CLI 会话语料；只构造测试记录，不调用 CLI。 */
import { mkdtemp, mkdir, writeFile, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export const nativeId = "native-a";
export function sampleRecords() {
  const rows = [];
  let ordinal = 0;
  const add = (type, payload) =>
    rows.push({
      type,
      payload,
      timestamp: "2026-10-15T00:00:00.000Z",
      ordinal: ordinal++,
    });
  add("session_meta", { id: nativeId, cli_version: "0.162.0-alpha.17.2" });
  for (const [
    nativeTurnId,
    effort,
    inputs,
    outputs,
    caches,
    reasons,
    duration,
    ttft,
    tools,
  ] of [
    [
      "turn-a",
      "low",
      [56946, 58284],
      [42, 23],
      [0, 56832],
      [18, 0],
      14812,
      11571,
      ["kmh-skill"],
    ],
    [
      "turn-b",
      "high",
      [58350, 58487, 60358, 62722, 64926],
      [112, 63, 2305, 84, 106],
      [0, 57856, 57856, 59904, 61952],
      [60, 11, 259, 32, 56],
      37341,
      9904,
      ["kmh-read", "kmh-read", "kmh-write", "kmh-read"],
    ],
  ]) {
    add("event_msg", { type: "task_started", turn_id: nativeTurnId });
    add("turn_context", {
      turn_id: nativeTurnId,
      model: "gpt-5.6-luna",
      effort,
    });
    add("response_item", {
      type: "message",
      id: nativeTurnId + "-user",
      role: "user",
      content: [
        {
          type: "input_text",
          text:
            nativeTurnId === "turn-a"
              ? "这是测试调用codex-cli插件，你好"
              : "翻译 SKILL.md",
        },
      ],
      internal_chat_message_metadata_passthrough: { turn_id: nativeTurnId },
    });
    const totals = {
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_write_input_tokens: 0,
      output_tokens: 0,
      reasoning_output_tokens: 0,
      total_tokens: 0,
    };
    for (let i = 0; i < inputs.length; i++) {
      if (i < tools.length) {
        const name = tools[i],
          callId = nativeTurnId + "-call-" + i,
          args =
            name === "kmh-skill"
              ? { name: "using-superpowers" }
              : {
                  file_path: "SKILL.md",
                  limit: i === 0 ? 4000 : 2000,
                  content: name === "kmh-write" ? "中文内容" : undefined,
                };
        const failed = nativeTurnId === "turn-b" && i === 0;
        add("response_item", {
          type: "function_call",
          call_id: callId,
          name,
          arguments: JSON.stringify(args),
          internal_chat_message_metadata_passthrough: { turn_id: nativeTurnId },
        });
        add("event_msg", {
          type: "item_completed",
          thread_id: nativeId,
          turn_id: nativeTurnId,
          item: {
            type: "DynamicToolCall",
            id: callId,
            tool: name,
            arguments: args,
            status: failed ? "failed" : "completed",
            success: !failed,
            duration: { secs: 0, nanos: 57526375 },
            content_items: [
              {
                type: "inputText",
                text: failed ? "limit must be <= 2000" : "已读取中文内容",
              },
            ],
          },
          started_at_ms: 100,
          completed_at_ms: 158,
        });
        add("response_item", {
          type: "function_call_output",
          call_id: callId,
          output: failed ? "limit must be <= 2000" : "已读取中文内容",
          internal_chat_message_metadata_passthrough: { turn_id: nativeTurnId },
        });
      }
      const usage = {
        input_tokens: inputs[i],
        cached_input_tokens: caches[i],
        cache_write_input_tokens: 0,
        output_tokens: outputs[i],
        reasoning_output_tokens: reasons[i],
        total_tokens: inputs[i] + outputs[i],
      };
      for (const k of Object.keys(totals)) totals[k] += usage[k];
      add("token_usage_record", {
        thread_id: nativeId,
        turn_id: nativeTurnId,
        response_id: nativeTurnId + "-response-" + i,
        usage,
        turn_token_usage: { ...totals },
      });
      add("event_msg", {
        type: "token_count",
        info: { total_token_usage: { ...totals }, last_token_usage: usage },
      });
    }
    add("response_item", {
      type: "message",
      id: nativeTurnId + "-reply",
      role: "assistant",
      content: [{ type: "output_text", text: "任务已完成" }],
      internal_chat_message_metadata_passthrough: { turn_id: nativeTurnId },
    });
    add("event_msg", {
      type: "task_complete",
      turn_id: nativeTurnId,
      duration_ms: duration,
      time_to_first_token_ms: ttft,
    });
  }
  return rows;
}
export function encode(rows) {
  return rows.map((x) => JSON.stringify(x) + "\n").join("");
}
export async function fixture(t, rows = sampleRecords()) {
  const dir = await mkdtemp(join(tmpdir(), "kmh-codex-trace-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const codexHome = join(dir, "codex");
  const folder = join(codexHome, "sessions", "2026", "10", "15");
  await mkdir(folder, { recursive: true });
  const file = join(
    folder,
    "rollout-2026-10-15T00-00-00-" + nativeId + ".jsonl",
  );
  const bindingsFile = join(dir, "codex-bindings.json");
  await writeFile(
    bindingsFile,
    JSON.stringify({
      "session-a": {
        threadId: nativeId,
        fingerprints: [],
        previousThreadIds: ["ignored-old"],
      },
    }),
  );
  await writeFile(file, encode(rows));
  return {
    dir,
    codexHome,
    bindingsFile,
    file,
    sessionId: "session-a",
    refreshIntervalMs: 1000,
    rows,
    append: (chunk) => appendFile(file, chunk),
  };
}
