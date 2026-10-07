/** 桥接冒烟用的 OpenAI Responses fixture 服务：首个回合回工具调用，回传后回最终文本。 */
import { createServer } from "node:http";

/**
 * 启动 fixture 模型服务。
 * @param options.script - 首回合脚本："single"（默认）单工具挂起；
 *   "parallel" 同一响应并行返回两个工具调用，用于复现并行挂起场景。
 * @returns 服务句柄：base URL、已记录请求与关闭函数。
 */
export function startFixtureServer(options = {}) {
  const script = options.script ?? "single";
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
    // delayedText：首响应延迟返回最终文本，给测试在模型响应前注入
    // 原生通知的窗口（feat08 叙述 smoke）。
    if (sequence === 1 && script === "delayedText")
      await new Promise((resolve) => setTimeout(resolve, 600));
    res.writeHead(200, { "content-type": "text/event-stream" });
    const send = (event) =>
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    if (sequence === 1 && script === "parallel") {
      // 并行双工具：同一响应返回 echo 与 glob 两个调用；桥必须逐个挂起、
      // 分两次回执后续推（生产事故：并行挂起状态丢失后 CODEX_NO_PENDING_TOOL）。
      // 函数名用 kmh- 前缀声明名：模型侧看到的就是声明目录（D13）。
      const items = [
        {
          id: "fc_kmh",
          type: "function_call",
          name: "kmh-kmh_echo",
          arguments: '{"text":"hello"}',
          call_id: "call_kmh",
          status: "completed",
        },
        {
          id: "fc_glob",
          type: "function_call",
          name: "kmh-kmh_glob",
          arguments: '{"pattern":"sun.png"}',
          call_id: "call_glob",
          status: "completed",
        },
      ];
      const response = {
        id: "resp_bridge_parallel",
        status: "completed",
        output: items,
      };
      send({ type: "response.created", response: { ...response, status: "in_progress", output: [] } });
      items.forEach((item, index) => {
        send({ type: "response.output_item.added", output_index: index, item: { ...item, arguments: "", status: "in_progress" } });
        send({ type: "response.function_call_arguments.delta", item_id: item.id, output_index: index, delta: item.arguments });
        send({ type: "response.function_call_arguments.done", item_id: item.id, output_index: index, arguments: item.arguments });
        send({ type: "response.output_item.done", output_index: index, item });
      });
      send({ type: "response.completed", response });
    } else if (sequence === 1) {
      const item = {
        id: "fc_kmh",
        type: "function_call",
        name: "kmh-kmh_echo",
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
      // done 事件缺省会让 Codex 不持久化最终消息：跨进程 resume 后历史缺该条。
      send({ type: "response.output_item.done", output_index: 0, item });
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
