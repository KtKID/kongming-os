/** 桥接冒烟用的 OpenAI Responses fixture 服务：首个回合回工具调用，回传后回最终文本。 */
import { createServer } from "node:http";

/**
 * 启动 fixture 模型服务。
 * @returns 服务句柄：base URL、已记录请求与关闭函数。
 */
export function startFixtureServer() {
  const requests = [];
  let sequence = 0;
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const json = JSON.parse(Buffer.concat(chunks).toString());
    requests.push({ path: req.url, body: json });
    if (req.method !== "POST" || !req.url.endsWith("/responses")) {
      res.writeHead(404);
      res.end("{}");
      return;
    }
    sequence++;
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (event) =>
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (sequence === 1) {
      const item = {
        id: "fc_kmh",
        type: "function_call",
        name: "kmh_echo",
        arguments: '{"text":"hello"}',
        call_id: "call_kmh",
        status: "completed",
      };
      const response = {
        id: "resp_bridge",
        status: "completed",
        output: [item],
      };
      send({ type: "response.created", response: { ...response, status: "in_progress", output: [] } });
      send({ type: "response.output_item.added", output_index: 0, item: { ...item, arguments: "", status: "in_progress" } });
      send({ type: "response.function_call_arguments.delta", item_id: item.id, output_index: 0, delta: item.arguments });
      send({ type: "response.function_call_arguments.done", item_id: item.id, output_index: 0, arguments: item.arguments });
      send({ type: "response.output_item.done", output_index: 0, item });
      send({ type: "response.completed", response });
    } else {
      const text = "BRIDGE_OK";
      const item = { id: "msg_final", type: "message", role: "assistant", content: [{ type: "output_text", text }] };
      const response = { id: "resp_final", status: "completed", output: [item] };
      send({ type: "response.created", response: { ...response, status: "in_progress", output: [] } });
      send({ type: "response.output_item.added", output_index: 0, item });
      send({ type: "response.output_text.delta", item_id: item.id, output_index: 0, delta: text });
      send({ type: "response.completed", response });
    }
    res.end("data: [DONE]\n\n");
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}/v1`,
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}
