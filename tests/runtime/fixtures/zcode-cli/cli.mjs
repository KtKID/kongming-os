#!/usr/bin/env node
import { createInterface } from "node:readline";
import {
  writeFileSync,
  mkdirSync,
  readFileSync,
  existsSync,
  rmSync,
  appendFileSync,
} from "node:fs";
import { join } from "node:path";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
const home = process.env.ZCODE_DATA_BASE_DIR;
const credential = join(home, ".zcode/v2/credentials.json");
const provider =
  process.env.KMH_FIXTURE_PROVIDER || "account:zai-individual-coding-plan";
const mode = process.env.KMH_FIXTURE_MODE;
function encrypt(text) {
  const key = createHash("sha256")
    .update(process.env.ZCODE_CREDENTIAL_SECRET)
    .digest();
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(text, "utf8"),
    cipher.final(),
  ]);
  return (
    "enc:v1:" +
    iv.toString("base64url") +
    "." +
    cipher.getAuthTag().toString("base64url") +
    "." +
    encrypted.toString("base64url")
  );
}
if (process.argv[2] === "login") {
  console.error(
    "Open this URL to sign in:\n" +
      (process.env.KMH_FIXTURE_AUTHORIZE_URL ||
        "https://zcode.z.ai/authorize?flow=test-only"),
  );
  if (mode === "waiting") setInterval(() => {}, 1000);
  else if (mode === "fail") {
    console.error("private-secret-from-cli");
    process.exitCode = 1;
  } else {
    setTimeout(() => {
      mkdirSync(join(home, ".zcode/v2"), { recursive: true });
      writeFileSync(
        credential,
        JSON.stringify({
          [`account-provider:${provider}:identity`]: encrypt("fixture-user"),
          [`account-provider:coding-plan:${provider}:account:fixture-user:api-key`]:
            encrypt("fixture-secret"),
        }),
      );
      console.log(JSON.stringify({ status: "ready", provider: "zai" }));
    }, 40);
  }
} else if (process.argv[2] === "logout") {
  rmSync(credential, { force: true });
  console.log(JSON.stringify({ status: "logged_out" }));
} else if (process.argv[2] === "app-server") {
  appendFileSync(
    join(home, "server-envs.jsonl"),
    JSON.stringify({
      nodeProxy: process.env.NODE_USE_ENV_PROXY,
      httpProxy: process.env.HTTP_PROXY,
      noProxy: process.env.NO_PROXY,
    }) + "\n",
  );
  // 记录本进程工作目录，供会话 cwd 跟随测试断言。
  appendFileSync(join(home, "server-cwds.jsonl"), process.cwd() + "\n");
  const rl = createInterface({ input: process.stdin });
  let waiting;
  let currentRequest;
  function send(frame) {
    process.stdout.write(JSON.stringify(frame) + "\n");
  }
  for await (const line of rl) {
    const frame = JSON.parse(line);
    if (frame.jsonrpc !== undefined) {
      send({
        id: frame.id,
        error: { code: -1, message: "strict native framing" },
      });
      continue;
    }
    if (frame.method === "provider/updateAccountConfig") {
      const registration = frame.params.providers[provider];
      if (
        Object.keys(registration).some(
          (key) => !["access", "builtinModelIds"].includes(key),
        ) ||
        mode === "registration-fail"
      ) {
        send({
          id: frame.id,
          error: {
            code: -32603,
            message:
              "Unrecognized key: api; credential fixture-secret account fixture-user",
          },
        });
        continue;
      }
      const personal = JSON.parse(
        readFileSync(process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, "utf8"),
      );
      const overlay = personal.config.providerConfigRules.providerRules.find(
        (entry) => entry.providerId === provider,
      );
      if (overlay?.config.api.type !== "openai-chat-completions")
        throw new Error("personal endpoint required");
      appendFileSync(
        join(home, "registrations.jsonl"),
        JSON.stringify(frame.params) + "\n",
      );
      appendFileSync(
        join(home, "personal-configs.jsonl"),
        JSON.stringify(personal) + "\n",
      );
      if (frame.params.states[provider].current !== true)
        throw new Error("current required");
      send({ id: frame.id, result: { applied: true } });
    } else if (frame.method === "runtime/capabilities")
      send({ id: frame.id, result: { version: "fixture" } });
    else if (frame.method === "workspace/generateText") {
      // GLM-5.3-Flash 的无效档位经官方选择解析后产生缺少档位错误。
      if (
        !["low", "high", "max"].includes(
          frame.params.selection.options?.reasoningLevel,
        )
      ) {
        send({
          id: frame.id,
          error: {
            code: -32603,
            message: `Reasoning level is required for ${provider}/${frame.params.selection.modelId}`,
            data: { code: "invalid_model_request" },
          },
        });
        continue;
      }
      // 镜像真实 CLI 0.16.9：maxOutputTokens 必填，且不超过个人配置规则与内置
      // 上限（GLM-5.3-Flash 内置 128000）合并后的最大值，越界返回同一错误文案。
      const personal = JSON.parse(
        readFileSync(process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE, "utf8"),
      );
      const modelRule =
        personal.config.modelConfigRules.providerModelRules.find(
          (entry) =>
            entry.providerId === provider &&
            entry.modelId === frame.params.selection.modelId,
        );
      const ceiling = Math.max(
        128000,
        modelRule?.config?.optionSpecs?.maxOutputTokens?.max ?? 0,
      );
      const requested = frame.params.maxOutputTokens;
      if (
        requested === undefined ||
        !Number.isInteger(requested) ||
        requested <= 0 ||
        requested > ceiling
      ) {
        send({
          id: frame.id,
          error: {
            code: -32603,
            message: "maxOutputTokens is outside the model option range",
          },
        });
        continue;
      }
      appendFileSync(
        join(home, "requests.jsonl"),
        JSON.stringify(frame.params) + "\n",
      );
      if (mode === "hang") continue;
      waiting = frame.id;
      currentRequest = frame.params;
      send({
        id: "headers",
        method: "interaction/requestProviderRuntimeHeaders",
        params: {
          providerId: provider,
          modelSelection: { providerId: provider, modelId: "GLM-5.3-Flash" },
        },
      });
    } else if (frame.id === "headers") {
      if (frame.result?.requestAuth?.apiKey !== "fixture-secret")
        throw new Error("missing native auth");
      send({
        id: waiting,
        result: {
          text:
            mode === "loop"
              ? currentRequest.messages.some((m) => m.role === "tool")
                ? "KMH read complete"
                : ""
              : "KMH raw reply",
          ...(mode === "loop" &&
          !currentRequest.messages.some((m) => m.role === "tool")
            ? {
                toolCalls: [
                  {
                    id: "read-1",
                    name: "read",
                    input: { file_path: join(home, "sample.txt") },
                  },
                ],
              }
            : {}),
          usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
          finishReason:
            mode === "loop" &&
            !currentRequest.messages.some((m) => m.role === "tool")
              ? "tool-calls"
              : "stop",
        },
      });
    }
  }
}
