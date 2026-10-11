---
description: 核对 DSH 子 agent 的内部模型通道与外部 CLI 委派路径，说明 Codex 已有能力、ZCode 接入缺口及移动端管家第一版的候选接线。
---

# DSH 子 agent 与 CLI 委派源码调研

DSH 支持将独立 CLI 作为子 agent。现有 `subagent-codex` 直接启动官方 Codex CLI，父 agent 收到最终文本报告。`spawn` 与 `fork` 则创建 DSH 内部 agent，默认继承父级模型通道。移动端管家可以使用 API 模型，同时通过委派工具将任务交给外部 CLI。

本文对应 [第一版需求规格](spec.md)，核对日期为 2026-10-11。本次范围为源码读取、两种已安装 CLI 的帮助检查和文档检查；账号推理、真实工具执行与完整管家链路由后续验收确认。

## 用户已确认的技术约束

管家只能通过 API 调用模型。实际任务全部委派给 Codex 或 ZCode，用户指定 CLI 时按用户选择执行。委派能力通过插件 tool 提供，参数定义与启动格式由插件维护。第一版执行者是独立 CLI；CLI 的工作过程留在执行端，最终报告作为工具结果交给管家，由管家整理主对话回复。

## 核对范围

主要核对 KMH 实际引用的 `third_party/dsh`，其 HEAD 为 `9de374a8f3ea3564c71eb8c9cd007c8ac563b452`。另核对独立 DSH 工作区 `/Volumes/machub_app/proj/agent/deepseek-harness`，其 HEAD 为 `ede2c76885626c1695a2878757d1b1c35998987b`。两处的 `subagent-codex/src/index.ts`、`run.ts`、`wire.ts`、`subagent/src/child-agent.ts` 和 `tool-subagent/src/index.ts` 内容一致。

## 两个 provider 分别选择什么

`tool-subagent.config.provider` 选择执行任务的后端，例如 `spawn`、`fork`、`codex`、`claude-code` 或 `acp`。`tool-subagent.config.agentOptions.provider` 选择 DSH 内部子 agent 的模型通道。两项配置分别控制运行方式和模型来源，来源见 [tool-subagent 配置](../../../third_party/dsh/packages/subagent/tool-subagent/src/index.ts#L47) 与 [委派调用](../../../third_party/dsh/packages/subagent/tool-subagent/src/index.ts#L563)。

| 路径 | 任务在哪里执行 | 模型如何选择 | 父 agent 收到什么 |
| --- | --- | --- | --- |
| `provider: spawn` / `fork` | DSH 内部 agent | 默认继承父级 provider、model、推理等级与输出上限；显式 agentOptions 可以覆盖 | 子 agent 的结果 |
| `provider: codex` | 独立官方 Codex CLI | Codex 自身配置或 provider 实例配置的 model | 最终回答；失败时返回终止状态与安全诊断 |
| `provider: claude-code` | 官方 Agent SDK 驱动的独立 Claude Code CLI | Claude Code 自身配置或 provider 实例配置的 model | 最终回答或失败结果 |
| `provider: acp` | 配置指定的独立程序 | 由该程序及其配置决定 | ACP 执行结果；程序需实现 ACP 协议 |

### spawn / fork 的模型继承

[resolveChildAgentOptions](../../../third_party/dsh/packages/subagent/subagent/src/child-agent.ts#L99) 读取父级当前 provider、model、reasoningEffort、maxTokens，再叠加显式子级选项；[进程内 driver](../../../third_party/dsh/packages/subagent/subagent-in-process-driver/src/index.ts#L134) 把这些选项传给 `agents.create()`。因此，API 管家的默认 spawn 子 agent 使用相同 API 模型通道；显式选择 CLI 模型适配器时，子 agent 经相应适配器发起模型请求。

`AgentOptions` 的基础声明包含 provider、model、reasoningEffort 和 maxTokens，见 [类型定义](../../../third_party/dsh/packages/core/agent/src/runtime-types.ts#L26)。API 地址与认证属于被选择的模型 provider 配置，例如 [DeepSeek API 配置解析](../../../third_party/dsh/packages/llm/llm-deepseek-api-key/src/config.ts#L37)。继承相同 provider 就会使用该 provider 的连接配置；`baseURL` 由模型适配器解析并用于请求，见 [DeepSeek 请求](../../../third_party/dsh/packages/llm/llm-deepseek/src/adapter.ts#L120)。

### Codex CLI 的直接委派

[CodexProvider.start](../../../third_party/dsh/packages/subagent/subagent-codex/src/index.ts#L73) 从父会话取得工作目录，使用该 provider 自己的 model、permissionMode、env 和 disposeGraceMs，然后调用 `startCodexRun()`。这条调用的完整运行参数见同文件第 95–108 行。

[codexAppServerArgv](../../../third_party/dsh/packages/subagent/subagent-codex/src/run.ts#L135) 将命令固定为 Node 加包内官方 Codex wrapper，再附上 `app-server --stdio`；[启动代码](../../../third_party/dsh/packages/subagent/subagent-codex/src/run.ts#L225) 通过 `ctx.subprocess` 拉起进程。协议顺序为 [initialize](../../../third_party/dsh/packages/subagent/subagent-codex/src/wire.ts#L267)、[thread/start](../../../third_party/dsh/packages/subagent/subagent-codex/src/wire.ts#L288) 和 [turn/start](../../../third_party/dsh/packages/subagent/subagent-codex/src/wire.ts#L310)。Codex 在自己的临时 thread 中承担完整任务。

[collectOutput](../../../third_party/dsh/packages/subagent/subagent-codex/src/wire.ts#L392) 优先选择 `final_answer` 文本，并兼容 phase 为空的回答；[消息选择](../../../third_party/dsh/packages/subagent/subagent-codex/src/wire.ts#L646) 只记录相应的 agentMessage。返回的文本经 `tool-subagent` 成为父会话的工具结果，父模型随后整理回复。这满足“CLI 汇报给管家”的基本数据流。

### Codex 现有实现的限制

当前实现为每个任务新建进程、临时 thread 和一次 turn。后续任务可以携带成果交接文本；同一原生 thread 的续聊与恢复需要新增能力。源码创建时声明 `ephemeral: true`，见 [thread/start](../../../third_party/dsh/packages/subagent/subagent-codex/src/wire.ts#L288)。

CLI 后端支持的共享可选能力由 `NO_START_CAPABILITIES` 声明，见 [CodexProvider](../../../third_party/dsh/packages/subagent/subagent-codex/src/index.ts#L63)。配置 `agentOptions` 或 `backgroundMode: continuable` 会在 [tool-subagent 的能力检查](../../../third_party/dsh/packages/subagent/tool-subagent/src/index.ts#L328) 被拒绝。模型、provider 名称及权限固定在各实例配置中，通用委派工具的每个实例绑定一个后端。

该包固定依赖 `@openai/codex` 版本 `0.153.4`，见 [包清单](../../../third_party/dsh/packages/subagent/subagent-codex/package.json)。它使用包内程序；KMH 当前 `@kmh/codex-cli` 使用的宿主程序配置属于另一条接入路径。人工审批桥接、原生会话续接、超时和版本升级是后续技术设计的检查项，现行限制集中在 [包 README](../../../third_party/dsh/packages/subagent/subagent-codex/README.md#known-limitations-and-deferred-work)。

## ZCode 的接入缺口

当前 [DSH 子 agent 包目录](../../../third_party/dsh/packages/subagent/README.md#packages) 包含 Codex、Claude Code、ACP 和 DSH SDK 等后端。本次在两处工作区的 `packages/subagent` 清单中均未发现 ZCode 专用后端。

KMH 已有 `@kmh/zcode-cli` 注册在 `ctx.llm`，见 [插件入口](../../../packages/zcode-cli/src/index.ts#L97)。它的 `stream()` 将 [relayTurn 输出](../../../packages/zcode-cli/src/index.ts#L70) 转为调用会话的模型正文与思考流；[session 中继](../../../packages/zcode-cli/src/session.ts#L538) 把原生事件送进流式投影器。这是模型适配器路径。

本机已安装的 ZCode 帮助输出声明 `--prompt`、`--json` 和 `--mode`；本轮执行帮助命令得到版本 `0.16.9`。仓库内参考源码的 [prompt 调用入口](../../../other/ZCode/apps/zcode-cli/packages/cli/src/run.ts#L498) 运行完整任务，[JSON 汇总输出](../../../other/ZCode/apps/zcode-cli/packages/cli/src/prompt-command.ts#L373) 包含 response、sessionId、traceId 和 projection。它提供封装“运行任务后取报告”的候选入口。安装版的实际输出、账号选择、权限、停止与进程回收仍需单独实测；参考源码中的汇总字段作为后续验证依据。

通用 ACP 后端允许配置程序和参数，见 [配置](../../../third_party/dsh/packages/subagent/subagent-acp/src/index.ts#L26)。它要求子程序提供 ACP 协议。ZCode 的现有 app-server 使用自身 session 协议，直接兼容 ACP 的能力仍待确认。

## 第一版的接入建议

推荐复用 DSH 的 `tool-subagent` / `ctx.subagents` 作为委派入口，并选择外部 CLI 后端。Codex 可从已有 `subagent-codex` 开始核对适配；ZCode 补一个 KMH 自有 CLI 委派插件，作为独立后端注册。管家调用已定义参数的任务工具，后端封装进程启动、协议和报告收集。

这条候选路径保持三项职责：管家通过 API 对话，tool-subagent 负责委派，外部 CLI 独立执行任务。Codex 与 ZCode 各绑定独立工具实例，用户的 CLI 选择用于约束实际使用的工具。最终文本和任务结果进入工具结果，CLI 中间事件留在执行端。

## 待技术设计确认

- 选择直接复用现有 Codex 后端，或由 KMH 自有插件统一两种 CLI 的版本、停止与报告行为。
- 确认用户指定 CLI 如何成为运行时约束，以及管家 API 通道和可用工具的限制方式。
- 确认 ZCode 的安装版非交互任务输出与原生 session 协议两条候选入口，选择报告稳定且支持停止的一条。
- 确认任务超时、权限确认、部分完成报告、运行中切换和成果交接的完整验收路径。

## 本轮验证

已逐源码核对直接 CLI 启动、内部模型继承、Codex 最终回答选择、能力限制和 ZCode 当前注册位置。已读取本机 Codex exec 与 ZCode 的帮助输出。已核对两处 DSH 的五个核心文件内容一致。本轮产物为需求规格与源码调研，后续开发以经过评审的规格和技术设计为输入。
