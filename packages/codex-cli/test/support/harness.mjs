/** 使用真实 Cordis 服务与官方 CLI，所有测试记录保存在独立临时目录。 */
import { Context } from "@deepseek-ai/cordis";
import { BlockAssembler } from "@deepseek-ai/dsh-llm";
import { LocalSubprocessRuntime } from "../../../../third_party/dsh/packages/subprocess/subprocess-local/lib/index.js";
import { Config, CodexCli, CodexAdapter } from "../../lib/src/index.js";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { startModelServer } from "./model-server.mjs";

/** 优先使用显式指定的官方程序，缺失时测试明确失败。 */
function codexBinary() {
  if (process.env.KMH_CODEX_BINARY) return process.env.KMH_CODEX_BINARY;
  const app =
    "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
  if (existsSync(app)) return app;
  const result = spawnSync(
    process.platform === "win32" ? "where" : "which",
    ["codex"],
    { encoding: "utf8" },
  );
  if (result.status === 0) return result.stdout.trim().split(/\r?\n/)[0];
  throw new Error("Set KMH_CODEX_BINARY to the official Codex CLI executable");
}

/** 等待可观察条件；超时给出具体条件名。 */
export async function until(predicate, label, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out: ${label}`);
    await delay(10);
  }
}

/** 建立真实插件服务；测试结束回收进程并保留 session 与通信日志。 */
export async function harness(t, name, options = {}) {
  const command = codexBinary();
  const base =
    process.env.KMH_CODEX_TEST_TMP ?? join(tmpdir(), "kmh-codex-cli-tests");
  if (!isAbsolute(base))
    throw new Error("KMH_CODEX_TEST_TMP must be an absolute path");
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const root = mkdtempSync(join(base, `${name}-`));
  const cwd = join(root, "workspace");
  const codexHome = join(root, "codex-home");
  mkdirSync(cwd);
  mkdirSync(codexHome, { mode: 0o700 });
  const server = await startModelServer(
    join(root, "upstream.jsonl"),
    options.gated,
    options,
  );
  writeFileSync(
    join(codexHome, "config.toml"),
    [
      'model = "gpt-6-sol"',
      'model_reasoning_effort = "xhigh"',
      'model_reasoning_summary = "none"',
      'model_provider = "fixture"',
      "[model_providers.fixture]",
      'name = "Plugin regression fixture"',
      `base_url = "${server.base}"`,
      'env_key = "KMH_CODEX_TEST_KEY"',
      'wire_api = "responses"',
      "requires_openai_auth = false",
      "supports_websockets = false",
      "request_max_retries = 0",
      "stream_max_retries = 1",
    ].join("\n") + "\n",
    { mode: 0o600 },
  );
  const ctx = new Context();
  const subprocess = new LocalSubprocessRuntime(ctx);
  const spawn = subprocess.spawn.bind(subprocess);
  const notifications = [];
  const children = [];
  subprocess.spawn = (spec) => {
    const child = spawn(spec);
    children.push(child);
    let remainder = "";
    child.stdout.on("data", (buffer) => {
      appendFileSync(join(root, "app-server.stdout.jsonl"), buffer);
      remainder += buffer.toString();
      const lines = remainder.split("\n");
      remainder = lines.pop();
      for (const line of lines) {
        const frame = JSON.parse(line);
        if (frame.method) {
          const observed = { at: Date.now(), ...frame };
          notifications.push(observed);
          appendFileSync(
            join(root, "notifications.jsonl"),
            JSON.stringify(observed) + "\n",
          );
        }
      }
    });
    child.stderr.on("data", (buffer) =>
      appendFileSync(join(root, "app-server.stderr.log"), buffer),
    );
    return child;
  };
  t.diagnostic(`artifacts: ${root}`);
  t.after(async () => {
    server.advanceFirst();
    server.advanceReasoning();
    server.advance();
    server.finish();
    await ctx.fiber.dispose();
    await Promise.allSettled(children.map((child) => child.done));
    await server.close();
  });
  const config = Config({
    command,
    cwd,
    dataDir: join(root, "plugin-data"),
    reasoningSummary: options.summary ?? "auto",
    startupTimeoutMs: 20000,
    cleanupTimeoutMs: 2000,
    cancelReceiptTimeoutMs: 3000,
    requestTimeoutMs: options.requestTimeoutMs ?? 30000,
    env: {
      CODEX_HOME: codexHome,
      KMH_CODEX_TEST_KEY: "fixture-key",
      HTTP_PROXY: "",
      HTTPS_PROXY: "",
      ALL_PROXY: "",
      NO_PROXY: "127.0.0.1,localhost",
    },
  });
  const runtime = new CodexCli(ctx, config);
  const adapter = new CodexAdapter(runtime);
  return {
    root,
    codexHome,
    ctx,
    config,
    runtime,
    adapter,
    server,
    notifications,
    children,
  };
}

/** 收集一次真实插件调用，返回组装后的 assistant 内容。 */
export async function run(adapter, options) {
  const assembler = new BlockAssembler();
  const chunks = [];
  for await (const chunk of adapter.stream({
    provider: "codex-cli",
    model: "gpt-6-sol",
    tools: [],
    signal: AbortSignal.timeout(30000),
    ...options,
  })) {
    chunks.push(chunk);
    assembler.push(chunk);
  }
  return {
    chunks,
    message: { role: "assistant", content: assembler.blocks() },
  };
}

/** 读取指定 thread 的原生持久化记录，解析失败直接报错。 */
export function nativeSession(codexHome, threadId) {
  const directory = join(codexHome, "sessions");
  const visit = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? visit(join(dir, entry.name))
        : [join(dir, entry.name)],
    );
  const file = visit(directory).find((path) =>
    path.endsWith(`${threadId}.jsonl`),
  );
  if (!file)
    throw new Error(
      `Native session log missing for ${threadId} under ${directory}`,
    );
  return {
    file,
    records: readFileSync(file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  };
}
