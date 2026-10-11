# relay-dsh-plugin-codex 分层架构分析（对照 @kmh/codex-cli）

- 分析对象：`proj/common/relay-dsh-plugin-codex` v0.2.5-rc.1（MIT，Node ≥22.13）
- 对照对象：本包 `@kmh/codex-cli`
- 日期：2026-10-08；全部结论基于对两个项目源码的实际阅读，关键文件行数：internal/plugin-sdk.mjs 304 行、plugin.mjs 307 行、dsh-plugin.js 105 行、host-plugin.js 53 行、app-server-client.mjs 332 行
- 性质：只读对比分析，未修改任何代码

## 一、边界对照总结

两个插件与 DSH、Codex 的对接骨架高度同构，五个关键架构决策一致：

- 下边界同为 `codex app-server --stdio` 常驻子进程 + 行协议 JSON-RPC + `initialize → initialized → thread/turn` 原语
- LLM 适配器面同为 `ctx.llm.registerAdapter` + `stream(options)` 异步生成器 + `purpose` 旁路走临时会话（我方 `streamAuxiliary`）
- 审批桥同为 approval.request + userQuestions.ask 映射，fail-closed（服务缺失一律 decline）
- 工具桥方向相同：Codex dynamicTools 声明 → `item/dynamicTool/call` 服务端请求 → 挂起回执续推（其 `respondDynamicTool` 对应我方 `resumeWithToolResults`）；前缀防冲突同目标不同实现（`relay_mcp__` 别名回映射 vs 我方 `kmh-` 平铺真名 + 声明表，见 decisions.md D13）
- 会话绑定同为 1 session ↔ 1 thread 持久落盘、fork 优先（我方失败回退 thread/start + 重建文本，稍宽）

实质差异集中在四个维度：

| 维度 | relay | @kmh/codex-cli |
|---|---|---|
| 内部分层 | execution 纯协议层（零 DSH import）+ dsh 胶合层，capability 契约连接 | 单包耦合，turn.ts 既管协议又产 DSH StreamChunk |
| 原生活动展示 | DSH 原生 `tool/call` 信封走 `tool.call.toolview` slot，禁止塞 assistant markdown | 文本叙述块进 assistant 流（native-items.ts） |
| 隔离深度 | 几乎不隔离（仅关 code_mode_host、shell_snapshot，analytics 开启），模型目录动态 `model/list` | 十几条 `-c` 全量隔离 + vendored catalog 裁剪副本 + 原生工具逐项选择 |
| 功能面 | session import/sync（NDJSON 进度 + Bearer 鉴权）、客户端大面、两代 DSH API 兼容层 | 详情页逐项选择、状态小球、生图投影链、token 用量样本队列 |
| 子进程管理 | 自管 spawn + SIGTERM | `ctx.subprocess` 受管服务（符合"不改 DSH 底层"红线） |

## 二、分层深挖：三层文件 + 一个迷你插件宿主

```
DSH 宿主（cordis）
   │  apply(ctx, config) ── host-plugin.js（组装根，53 行）
   ▼
┌─────────────────────────────────────────────────┐
│ 自己的迷你 PluginHost（internal/plugin-sdk.mjs）  │
│                                                 │
│ ② relay.dsh.codex（dsh-plugin.js）              │
│    requires: relay.execution.codex.v1 ^1.0.0    │
│    LLM 适配器/审批桥/工具桥/导入/HTTP 路由        │
│                 │ 只通过 capability 门面对话      │
│                 ▼                               │
│ ① relay.execution.codex（plugin.mjs）           │
│    provides: relay.execution.codex.v1           │
│    CodexRuntimeController + CodexSessionRuntime │
│         │                                       │
│         ▼                                        │
│ ⓪ app-server-client.mjs（协议裸客户端）          │
└─────────────────────────────────────────────────┘
   │  stdin/stdout 行协议 JSON-RPC
   ▼
codex app-server --stdio（常驻子进程）
```

### ⓪ app-server-client.mjs：协议裸客户端（对应我方 connection.ts + protocol.ts 传输部分）

spawn 子进程（可执行文件经 codex-command.mjs 解析：codexCommand > RELAY_CODEX_COMMAND > auto，ChatGPT.app/Codex.app 内置 → PATH → bundled npm 包回退一次）、readline 逐行解析 JSON-RPC、initialize 握手、挂起请求表、request/respond/respondError。对上只暴露四个 EventEmitter 事件：`notification`（CLI 推来的通知）、`serverRequest`（CLI 反向请求，如审批）、`diagnostic`、`exit`。

值得注意：握手 capabilities 带 `optOutNotificationMethods`，**显式关掉约 70 个 `codex/event/*` 旧版通知**（agent_message_delta、task_started、exec_command_begin 等 TUI 时代事件流，与 v2 `agentMessage/delta` 重复）。在协议层剪噪音。我方做法是 handleNotification 的 switch default 静默忽略——效果相同，方向相反（它告诉 CLI 别发，我方照单全收再扔掉）。

### ① execution 层（plugin.mjs + session-runtime.mjs）：会说话但不认识 DSH

两块：

**CodexSessionRuntime（状态机）**：在裸客户端之上维护 sessions 表、挂起请求表、模型列表、连接状态、中断记录；把协议消息翻译成四类领域事件——`activity`、`request`、`change`、`connectionStatus`；对外方法是会话语义原语（createSession/forkSession/resumeSession/sendMessage/interruptTurn/respondDynamicTool…）。对应我方 turn.ts 的进程/队列/通知处理部分，但不含 DSH StreamChunk 投影。

**CodexRuntimeController（进程管家）**，两件大事：

1. **热重载**：设置改 `codexCommand` 触发 `reload()`——等 `runtime.isReloadSafe()`（当前 turn 到安全点）→ 新命令起新进程 → `adoptStateFrom` 迁移会话状态 → 关旧进程。换 Codex 可执行文件不重启 DSH、不打断在跑的对话。我方改 `command` 配置需重启 web。
2. 把 runtime 包装成 **`Object.freeze` 纯函数门面**作为 capability 值提供：

```js
executionCapability(runtime) = Object.freeze({
  whenReady, status, subscribeStatus, listModels,
  hasSession, getSession, patchSession,
  createSession, forkSession, resumeSession,
  sendMessage, interruptTurn, releaseSession,
  resolveRequest, respondDynamicTool, rejectRequest,
  subscribeActivity, subscribeRequest,
})
```

**这个门面就是两层之间的全部接口**：全是会话/turn/审批原语，没有一个 DSH 类型（无 StreamChunk、无 LlmAdapter、无 ctx）。因此该层可脱离宿主直接 `node --test`，也可被非 DSH 宿主复用。

### ② dsh 胶合层（dsh-plugin.js）：认识 DSH，不碰协议细节

激活第一件事 `capabilities.require("relay.execution.codex.v1")` 拿门面，然后组装全部 DSH 语义：LLM 适配器、`llm/stream` 抢先钩子（global+prepend）、agent 生命周期挂接（created/selected/disposed）、审批/工具的服务端请求处理（handleCodexServerRequest）、session↔thread 绑定存储（CodexLinkStore，~/.relay/codex-dsh-links.json）、import/sync/status 三个 HTTP 路由。从不 spawn 进程、从不直接碰行协议——CLI 原始通知已被 execution 层折叠为 activity/request 事件。

### capability 拓扑（internal/plugin-sdk.mjs）：进程内迷你插件系统

非 DSH 机制，是该包自写的插件系统，核心四条：

1. **版本化契约**：capability 注册必须带 semver；消费方 require 带范围（如 `^1.0.0`），不满足范围**激活时立即报错**（"requires relay.execution.codex.v1 ^1.0.0 (found 2.0.0)"），不拖到运行时 undefined 崩溃。execution 改接口升 major，胶合层没跟上即 fail-fast。
2. **拓扑排序激活**：`resolveActivationOrder` 按 requires/optional 依赖边 DFS 排序 + 环检测，保证 execution 先激活先注册，dsh 后激活才拿得到。
3. **访问控制**：每个插件拿到的 capabilities 是按自身 manifest 裁剪的视图——未声明过的能力 require 直接抛错。
4. **事务性回滚**：激活链任一步失败，已激活插件逆序 dispose、capability 注销，`defer(cleanup)` 登记的清理函数逆序执行。

host-plugin.js（组装根）把两个内部插件塞进 PluginHost：`host.activate([createCodexExecutionPlugin(...), createDshCodexPlugin(ctx, config)])`，外层 `ctx.effect` 包 `host.dispose()`；settings.installSection 的 onChange 触发 controller.reload。

## 三、与我方代码的精确对照

| relay | @kmh/codex-cli | 差别本质 |
|---|---|---|
| app-server-client.mjs | connection.ts + protocol.ts 传输部分 | 基本等价 |
| CodexSessionRuntime | turn.ts 的进程/队列/通知处理 | 等价，但 turn.ts 同时把通知翻译成 DSH StreamChunk |
| execution 门面（capability 值） | 无显式对应物 | 我方两层边界是隐式的（类边界） |
| dsh-plugin.js + codex-adapter.js | adapter.ts + approval.ts + index.ts | 等价 |

关键差异一句话：**我方有同样的物理分层（文件/类），但没有契约层**——turn.ts 直接 import `StreamChunk` from `@deepseek-ai/dsh-llm` 并 yield DSH 形状的块，协议层和宿主层在类型上焊死；relay 的焊点是纯 JS 门面对象 + semver，两边可独立演进。

## 四、可借鉴点（按性价比排序）

1. **turn.ts 拆两半**：通知处理只发中立事件（我方 `Queued` 类型已是雏形，但携带 StreamChunk），对外暴露类似门面的 `CodexRuntime` 接口，adapter.ts 只消费该接口。协议排查（如 D23 流式定位）时可直接 new runtime 接假胶合层，不再手搓探针。不必照搬 304 行 plugin-sdk（单插件场景过度设计）。
2. **热重载安全点**：`isReloadSafe()` + `adoptStateFrom` 的换进程流程，可平移到"改 command 配置不重启 web"。
3. **optOutNotificationMethods**：initialize 时显式关旧版通知流，减少行协议噪音（我方目前全收再忽略）。
4. （远期）**活动展示信封化**：tool/call 信封 + toolview slot 替代文本叙述块，是产品语义取舍，非必需。

## 五、已知未知

- relay 的描述与源码未涉及流式增量与 reasoning summary 的处理，无法判断其是否同样存在"伪流式重放"与 `model_reasoning_summary` 缺注入问题（D23 定案，见 docs/spec/decisions.md）；若其也未处理，则这两个坑是本对接路线的共性问题。
