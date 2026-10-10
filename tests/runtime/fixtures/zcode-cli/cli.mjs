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
  // session 协议桩：会话表跨进程持久（镜像真实 CLI 的数据目录会话存储），
  // 事件脚本按 mode 驱动流式/审批/挂起等形态。
  const sessionsFile = join(home, "fixture-sessions.json");
  function loadSessions() {
    try {
      return new Set(JSON.parse(readFileSync(sessionsFile, "utf8")));
    } catch {
      return new Set();
    }
  }
  function saveSession(id) {
    const all = loadSessions();
    all.add(id);
    writeFileSync(sessionsFile, JSON.stringify([...all]));
  }
  const sessions = loadSessions();
  let eventSeq = 0;
  let activePrompt = undefined;
  // 镜像真实 CLI 信封：判别字段 type 在信封层，payload 只带本体字段。
  function emit(sessionId, type, payload = {}) {
    send({
      method: "session/event",
      params: {
        sessionId,
        seq: ++eventSeq,
        type,
        payload,
        timestamp: Date.now(),
      },
    });
  }
  function emitTurnScript(sessionId, content, inputId) {
    if (mode === "session-flat") {
      // 非增量回合：零 model.streaming 事件，正文只随终态 response 出现。
      emit(sessionId, "turn.started", {
        turnNumber: 0,
        input: content,
        inputId,
      });
      setTimeout(() => {
        emit(sessionId, "turn.completed", {
          inputId,
          resultType: "success",
          response: "整段只在终态出现的正文",
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            totalTokens: 110,
            cacheReadTokens: 60,
          },
        });
        activePrompt = undefined;
      }, 30);
      return;
    }
    const steps = [
      () =>
        emit(sessionId, "turn.started", {
          turnNumber: 0,
          input: content,
          inputId,
        }),
      () =>
        emit(sessionId, "model.streaming", { kind: "reasoning_start" }),
      () =>
        emit(sessionId, "model.streaming", {
          kind: "reasoning_delta",
          delta: "思考片段",
        }),
      () =>
        emit(sessionId, "model.streaming", { kind: "reasoning_end" }),
      () => emit(sessionId, "model.streaming", { kind: "text_start" }),
      () =>
        emit(sessionId, "model.streaming", {
          kind: "text_delta",
          delta: "你好",
        }),
    ];
    let delay = 15;
    for (const step of steps) {
      setTimeout(step, delay);
      delay += 15;
    }
    if (mode === "session-hang") return; // 无终态：等待停止通道介入
    if (mode === "session-fail") {
      setTimeout(
        () => {
          emit(sessionId, "turn.failed", {
            inputId,
            error: { message: "fixture turn blew up" },
          });
          activePrompt = undefined;
        },
        delay + 40,
      );
      return;
    }
    setTimeout(() => {
      if (mode === "session-tool") {
        // 工具审批：先发反向审批请求，收到应答后再收尾。
        send({
          id: "perm-1",
          method: "interaction/requestPermission",
          params: {
            requestId: "perm-req-1",
            sessionId,
            toolCallId: "tc-1",
            toolName: "Bash",
            riskLevel: "medium",
            reason: "run ls",
            input: { command: "ls" },
            options: [
              {
                optionId: "allow",
                kind: "allow",
                name: "允许",
                response: { decision: "allow" },
              },
            ],
          },
        });
        return;
      }
      emit(sessionId, "model.streaming", { kind: "text_delta", delta: "，世界" });
      setTimeout(() => {
        emit(sessionId, "model.streaming", { kind: "text_end" });
        emit(sessionId, "turn.completed", {
          inputId,
          resultType: mode === "session-cancel" ? "cancelled" : "success",
          usage: {
            inputTokens: 100,
            outputTokens: 10,
            totalTokens: 110,
            cacheReadTokens: 60,
          },
        });
        activePrompt = undefined;
      }, 15);
    }, delay + 10);
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
    if (frame.method === "workspace/cancelGenerateText") {
      // 记录收到的取消请求供测试断言官方通道确实被使用。
      appendFileSync(
        join(home, "cancels.jsonl"),
        JSON.stringify(frame.params) + "\n",
      );
      // 镜像官方 CLI：按 operationId 查在途请求表——命中即中止并回 cancelled:true，
      // 未知编号回 cancelled:false（请求已落定或从未注册）。
      const operationId = frame.params?.operationId;
      if (
        mode === "race" &&
        waiting !== undefined &&
        currentRequest?.operationId === operationId
      ) {
        // 竞态：取消到达时请求已在 CLI 侧完成——回 cancelled:false 并补发结果。
        const pendingId = waiting;
        waiting = undefined;
        send({ id: frame.id, result: { operationId, cancelled: false } });
        send({
          id: pendingId,
          result: {
            text: "completed before stop",
            usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
            finishReason: "stop",
          },
        });
      } else if (
        mode === "hang" &&
        waiting !== undefined &&
        currentRequest?.operationId === operationId
      ) {
        const pendingId = waiting;
        waiting = undefined;
        send({
          id: pendingId,
          error: { code: -32603, message: "Workspace model request cancelled" },
        });
        send({ id: frame.id, result: { operationId, cancelled: true } });
      } else {
        send({ id: frame.id, result: { operationId, cancelled: false } });
      }
    } else if (frame.method === "provider/updateAccountConfig") {
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
    else if (frame.method === "session/create") {
      appendFileSync(
        join(home, "session-creates.jsonl"),
        JSON.stringify(frame.params) + "\n",
      );
      const sessionId = `sess-fx-${process.pid}-${Date.now()}`;
      sessions.add(sessionId);
      saveSession(sessionId);
      send({
        id: frame.id,
        result: { session: { sessionId }, messages: [] },
      });
    } else if (frame.method === "session/resume") {
      appendFileSync(
        join(home, "session-resumes.jsonl"),
        JSON.stringify(frame.params) + "\n",
      );
      const sessionId = frame.params?.sessionId;
      if (typeof sessionId === "string" && sessions.has(sessionId)) {
        send({
          id: frame.id,
          result: { session: { sessionId }, messages: [] },
        });
      } else {
        send({
          id: frame.id,
          error: { code: -32001, message: "Session not found" },
        });
      }
    } else if (frame.method === "session/subscribe") {
      appendFileSync(
        join(home, "session-subscribes.jsonl"),
        JSON.stringify(frame.params) + "\n",
      );
      send({
        id: frame.id,
        result: {
          sessionId: frame.params.sessionId,
          eventSeq: eventSeq,
          events: [],
        },
      });
    } else if (frame.method === "session/send") {
      const content = frame.params?.content;
      const reasoningLevel =
        frame.params?.modelSelection?.options?.reasoningLevel;
      if (typeof content !== "string" || content === "") {
        send({
          id: frame.id,
          error: { code: -32602, message: "content required" },
        });
        continue;
      }
      if (reasoningLevel !== undefined && !["low", "high", "max"].includes(reasoningLevel)) {
        send({
          id: frame.id,
          error: {
            code: -32603,
            message: `Reasoning level is required for ${provider}/${frame.params.modelSelection.modelId}`,
            data: { code: "invalid_model_request" },
          },
        });
        continue;
      }
      if (activePrompt !== undefined) {
        send({
          id: frame.id,
          error: {
            code: -32010,
            message: "A prompt is already running for this session",
          },
        });
        continue;
      }
      appendFileSync(
        join(home, "session-sends.jsonl"),
        JSON.stringify(frame.params) + "\n",
      );
      const sessionId = frame.params.sessionId;
      activePrompt = sessionId;
      send({
        id: frame.id,
        result: { accepted: true, sessionId, stateRevision: 1 },
      });
      const inputId = frame.params.inputId ?? "input-fx";
      // 通道退出：send 受理后进程直接结束，模拟 CLI 崩溃/被杀。
      if (mode === "session-exit") {
        setTimeout(() => process.exit(3), 30);
        continue;
      }
      emitTurnScript(sessionId, content, inputId);
    } else if (frame.method === "session/stop") {
      appendFileSync(
        join(home, "session-stops.jsonl"),
        JSON.stringify(frame.params) + "\n",
      );
      activePrompt = undefined;
      send({ id: frame.id, result: { stopped: true } });
    } else if (frame.id === "perm-1") {
      // 审批应答回执：记录决定后按允许/拒绝收尾回合。
      appendFileSync(
        join(home, "permission-replies.jsonl"),
        JSON.stringify(frame.result ?? frame.error) + "\n",
      );
      const sessionId = activePrompt;
      if (typeof sessionId !== "string") continue;
      emit(sessionId, "model.streaming", { kind: "text_delta", delta: "，世界" });
      emit(sessionId, "model.streaming", { kind: "text_end" });
      emit(sessionId, "turn.completed", {
        inputId: "input-fx",
        resultType: "success",
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      });
      activePrompt = undefined;
    } else if (frame.method === "workspace/generateText") {
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
      // hang/exit 也登记在途请求，供取消处理器按 operationId 查表。
      waiting = frame.id;
      currentRequest = frame.params;
      // 模拟模型通道提前退出：请求在途时进程直接结束。
      if (mode === "exit") process.exit(3);
      if (mode === "hang") continue;
      send({
        id: "headers",
        method: "interaction/requestProviderRuntimeHeaders",
        params: {
          providerId: provider,
          modelSelection: {
            providerId: provider,
            modelId: currentRequest.selection.modelId,
          },
        },
      });
    } else if (frame.id === "headers") {
      if (frame.result?.requestAuth?.apiKey !== "fixture-secret")
        throw new Error("missing native auth");
      if (mode === "race") continue;
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
