/** 提供移动助手回归所需的五个 MadeMe MCP 工具；调用写入用例独占记录，协议错误原样返回。 */
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const names = ['mademe_list_ideas_by_tag', 'mademe_list_recent_ideas', 'mademe_list_tags', 'mademe_save_article', 'mademe_save_idea'];
const tools = names.map(name => ({ name, description: `移动助手回归：${name}`, inputSchema: { type: 'object', properties: {}, additionalProperties: false } }));

/** 处理单个 MCP 请求；返回初始化、工具清单或调用结果，未知方法以协议错误结束。 */
function respond(frame) {
  if (frame.id === undefined) return;
  let result;
  switch (frame.method) {
    case 'initialize':
      result = { protocolVersion: frame.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'mobile-mademe-fixture', version: '1.0.0' } };
      break;
    case 'ping': result = {}; break;
    case 'tools/list': result = { tools }; break;
    case 'tools/call':
      if (!names.includes(frame.params.name)) throw new Error(`未知工具：${frame.params.name}`);
      appendFileSync(process.env.KMH_MADEME_FIXTURE_LOG, JSON.stringify(frame.params) + '\n');
      result = { content: [{ type: 'text', text: 'MOBILE_MADEME_TOOL_RESULT' }] };
      break;
    default:
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: `未知方法：${frame.method}` } }) + '\n');
      return;
  }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result }) + '\n');
}

for await (const line of createInterface({ input: process.stdin })) respond(JSON.parse(line));
