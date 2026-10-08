/** 分段 Responses 服务：完成门由测试释放，记录上游实际请求。 */
import { createServer } from "node:http";
import { zstdDecompressSync } from "node:zlib";
import { appendFileSync } from "node:fs";

/** 创建手动完成的异步门。 */
function gate() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/** 启动本地模型服务；gated 为 true 时逐段等待测试放行。 */
export async function startModelServer(
  requestLog,
  gated = false,
  options = {},
) {
  const first = gate();
  const reasoningContinuation = gate();
  const second = gate();
  const completion = gate();
  const requests = [];
  let completed = false;
  let failures = options.failures ?? 0;
  const server = createServer(async (request, response) => {
    try {
      const buffers = [];
      for await (const buffer of request) buffers.push(buffer);
      const bytes = Buffer.concat(buffers);
      const body = JSON.parse(
        (request.headers["content-encoding"] === "zstd"
          ? zstdDecompressSync(bytes)
          : bytes
        ).toString(),
      );
      requests.push(body);
      appendFileSync(
        requestLog,
        JSON.stringify({ at: Date.now(), body }) + "\n",
      );
      if (request.method !== "POST" || !request.url.endsWith("/responses")) {
        response.writeHead(404).end();
        return;
      }
      const sequence = requests.length;
      if (failures > 0) {
        failures--;
        response.writeHead(503, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: { message: "fixture unavailable", type: "server_error" },
          }),
        );
        return;
      }
      if (options.holdFirst) await first.promise;
      const send = (event) =>
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      const summaryEnabled =
        body.reasoning?.summary && body.reasoning.summary !== "none";
      const reasoning = {
        type: "reasoning",
        id: `reason-${sequence}`,
        summary: [{ type: "summary_text", text: "Think carefully." }],
        content: [],
      };
      const text = {
        type: "message",
        id: `message-${sequence}`,
        role: "assistant",
        content: [{ type: "output_text", text: "FIRST SECOND" }],
      };
      const output = summaryEnabled ? [reasoning, text] : [text];
      const textIndex = summaryEnabled ? 1 : 0;
      const result = {
        id: `response-${sequence}`,
        status: "completed",
        output,
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          total_tokens: 120,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: summaryEnabled ? 5 : 0 },
        },
      };
      response.writeHead(200, { "content-type": "text/event-stream" });
      send({
        type: "response.created",
        response: { ...result, status: "in_progress", output: [] },
      });
      if (summaryEnabled) {
        send({
          type: "response.output_item.added",
          output_index: 0,
          item: { ...reasoning, summary: [] },
        });
        send({
          type: "response.reasoning_summary_part.added",
          item_id: reasoning.id,
          output_index: 0,
          summary_index: 0,
          part: { type: "summary_text", text: "" },
        });
        send({
          type: "response.reasoning_summary_text.delta",
          item_id: reasoning.id,
          output_index: 0,
          summary_index: 0,
          delta: "Think ",
        });
        if (gated) await reasoningContinuation.promise;
        send({
          type: "response.reasoning_summary_text.delta",
          item_id: reasoning.id,
          output_index: 0,
          summary_index: 0,
          delta: "carefully.",
        });
        send({
          type: "response.reasoning_summary_text.done",
          item_id: reasoning.id,
          output_index: 0,
          summary_index: 0,
          text: "Think carefully.",
        });
        send({
          type: "response.output_item.done",
          output_index: 0,
          item: reasoning,
        });
      }
      send({
        type: "response.output_item.added",
        output_index: textIndex,
        item: { ...text, content: [] },
      });
      send({
        type: "response.output_text.delta",
        item_id: text.id,
        output_index: textIndex,
        delta: "FIRST ",
      });
      if (gated) await second.promise;
      send({
        type: "response.output_text.delta",
        item_id: text.id,
        output_index: textIndex,
        delta: "SECOND",
      });
      if (gated) await completion.promise;
      send({
        type: "response.output_item.done",
        output_index: textIndex,
        item: text,
      });
      send({ type: "response.completed", response: result });
      completed = true;
      response.end("data: [DONE]\n\n");
    } catch (error) {
      response.destroy(error);
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    base: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    get completed() {
      return completed;
    },
    advanceReasoning: reasoningContinuation.release,
    advanceFirst: first.release,
    recover() {
      failures = 0;
    },
    advance: second.release,
    finish: completion.release,
    async close() {
      first.release();
      reasoningContinuation.release();
      second.release();
      completion.release();
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
