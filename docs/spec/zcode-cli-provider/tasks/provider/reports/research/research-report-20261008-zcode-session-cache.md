---
description: ZCode 原生 session 复用与提示缓存的源码核实与本机实测：会话复用成立、kmh 全量路径缓存实测为零、协议缺口精确到参数级，feat08 出路收敛为 A/B 两条。
---

# ZCode 原生 session 复用与提示缓存核实

> Report ID: 20261008-zcode-session-cache
> 回指任务: task-zcode-session（dev-report 已随 session-suspend 插件退役移除；feat08 T1 表述修正结论归档于本报告）
> 核实日期：2026-10-08（Asia/Shanghai）
> 源码基线：`other/ZCode` commit `29628c9`（v3.14.3）；本机 CLI 0.16.9（SHA256 `fad4c35c…`，版本对应关系沿用 task dev-report 已核实结论）
> 实测数据：`~/.zcode/cli/rollout/model-io-*.jsonl`（本机现存请求记录）

## 背景与问题

用户对 feat08 T1 的红灯结论提出两条质疑：CLI 不能复用同一个 session 这一说法是否成立；每次全量传入历史是否造成缓存失效。本报告逐条读官方源码并辅以本机 rollout 实测回答，为 feat08 的接入模式选择（出路 A/B）提供依据。

## 结论

1. **会话复用成立。** CLI 协议的 session 是一等公民：`session/create`、`session/send`、`session/resume` 齐全，历史由 CLI 侧 sqlite 持久化，跨进程恢复已被 T1 真机测试证实（"原 session 跨进程恢复保留两条消息"）。
2. **缓存实测为零，且比"失效"更糟：kmh 现用路径从来没有建立过缓存。** 本机 `querySource:"kmh"` 请求 inputTokens 42375、cacheReadTokens 0；同机原生会话（`main_turn`）cacheReadTokens 稳定在 64K–105K。结构性原因见证据二。
3. **T1 表述需要修正。** 红灯的准确含义不是"CLI 不能复用 session"，而是"KMH 现接入模式（KMH 掌管循环、工具与 persona）在协议面上拿不到会话"：systemPrompt 注入、工具结果回注、generateText 会话绑定三个口子，一个都不存在。

## 证据一：session 复用在协议面成立

协议方法表与 schema（`other/ZCode/packages/shared/src/zcode-protocol/index.ts`）：

| 接口                                                    | 关键参数                                                                                           | 位置               |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------ |
| `session/create`                                        | `mcpServers`（可注册外部工具）、`toolAllowlist`/`toolDenylist`、`mode`、`model`、`importedHistory` | index.ts:1559-1580 |
| `session/resume`                                        | 跨进程恢复；`mcpServers` 与工具面约束必须与 create 同参传递                                        | index.ts:1583-1598 |
| `session/send`                                          | 仅 `content`（新增文本字符串）+ 附件 + 模型选择；无消息数组、无工具结果                            | index.ts:1731-1749 |
| `session/fork` / `session/compact` / `session/setModel` | 历史分叉、压缩、换模型                                                                             | index.ts:1808 起   |

CLI 服务端分发表确认全部接口已注册（`apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server.ts:569-641`）。`importedHistory` 仅接受 `user`/`assistant` 纯文本消息（index.ts:726-732），工具调用链与 system 提示无法导入。

## 证据二：缓存机制只存在于原生会话管线

四条源码事实构成闭环：

1. 原生 loop 的上下文构建器为 stable 段打显式 `cache_control: {type: "ephemeral"}` 断点并按 stable/dynamic 分层（`apps/zcode-cli/packages/core/src/context/builder.ts:242-272`）；turn 循环记录命中（`turn-model-step.ts:448`）。
2. `workspace/generateText` 是裸管道：调用方消息原样直传 `model.generateText`，不走 context builder，`modelRequestSessionType: "other"`（`apps/zcode-cli/packages/core/src/runtime/methods/workspace-generate-text.ts:162-219`）。
3. 协议 schema 堵死自救路：generateText 消息 content 为纯字符串 `.strict()`（index.ts:2047-2065），调用方无法携带 cache_control 块；模型层只透传不添加（`anthropic-stream-compat.ts:46`）。
4. GLM Coding Plan 网关代理到 Anthropic Messages 协议端点（`open.bigmodel.cn/api/anthropic/v1/messages` 及 z.ai 同路径，`official-coding-plan-gateway.ts:24-29`）；该协议语义下提示缓存依赖显式断点。

## 证据三：本机实测

| 会话文件                | querySource   | cacheReadTokens | inputTokens                    |
| ----------------------- | ------------- | --------------- | ------------------------------ |
| model-io-sess_2db45aee… | kmh ×1        | 0               | 42375（5 条消息，output 3300） |
| model-io-sess_ccc68a08… | kmh ×1        | 0               | —                              |
| model-io-sess_5c78a55d… | main_turn ×49 | 102208–105792   | —                              |
| model-io-sess_8655d99d… | main_turn ×2  | 45120 / 53952   | —                              |
| model-io-sess_16585a17… | main_turn ×7  | 64704–76160     | —                              |

同一台机器、同一后端：原生会话每轮复用十万级前缀，kmh 路径按全价支付整个对话前缀，成本随对话变长线性恶化。

## 协议面互斥：KMH 需要的三件事拆在两个面

| 能力                         | session 面（create/send/resume） | generateText 面（KMH 现用）             |
| ---------------------------- | -------------------------------- | --------------------------------------- |
| 会话复用 + 跨进程恢复        | ✓                                | ✗（schema 无 sessionId 字段）           |
| 增量发送（只发新内容）       | ✓                                | ✗（每次全量）                           |
| 显式缓存断点                 | ✓（原生 loop 自动构建）          | ✗（消息纯字符串，带不了 cache_control） |
| systemPrompt 注入            | ✗（无此参数）                    | ✓                                       |
| 工具结果回注（KMH 执行工具） | ✗（工具由原生 loop 经 MCP 执行） | ✓                                       |

codex 能两全是因为 app-server 的 `sendUserTurn` 接受 `baseInstructions` + tools 且工具结果可回注：`packages/codex-cli/src/adapter.ts:121-190` 中 `diffIncrement` 差分 → `turn.start(新文本, threadId)` / `resumeWithToolResults(结果)` / 基线丢失时 `rebuildFromBinding`。zcode 协议没有对应物。

## 出路

**出路 A：MCP 托管模式（当前 CLI 即可用，职责边界大改）。** KMH 工具经 `mcpServers` 注册，用户输入走 `session/send`，原生 loop 跑整轮；会话复用、增量、缓存断点全部直接获得。代价：zcode 会话的循环、persona、审批链移交 CLI（systemPrompt 无注入口、`importedHistory` 无法重建工具链），KMH 对 zcode 会话降级为"客户端 + 工具宿主"；session-suspend 对它也只能管"下一轮输入放行"，管不到进行中的原生工具执行。需要用户拍板。

**出路 B：上游开口子（保持 KMH 掌环）。** 任一即可：generateText 消息放开块结构 + cache_control 透传（模型层透传能力已存在，只差协议 schema，改动最小且直接解决缓存）；或 session/send 增加工具结果回注 + systemPrompt（即 codex 模式）。可向 ZCode 官方提需求或等版本演进。

**建议顺序**：先拍板 A/B；若选 B，现状（缓存为零但功能可用）可维持等待上游，同时在本报告基础上修订 task dev-report 的 T1 表述，避免后续按"CLI 不能复用 session"的错误框架推进。

## 证据索引

- 协议 schema：`other/ZCode/packages/shared/src/zcode-protocol/index.ts`（1559 create / 1583 resume / 1731 send / 2047-2073 消息与工具 schema / 2075 generateText / 726 importedHistory）
- CLI 分发：`other/ZCode/apps/zcode-cli/packages/bootstrap/src/zcode-protocol/server.ts:569-641`
- generateText 实现：`other/ZCode/apps/zcode-cli/packages/core/src/runtime/methods/workspace-generate-text.ts`
- 缓存断点：`other/ZCode/apps/zcode-cli/packages/core/src/context/builder.ts:242-272`；透传：`other/ZCode/apps/zcode-cli/packages/adapters/src/model/anthropic-stream-compat.ts:46`；网关端点：`other/ZCode/apps/zcode-cli/packages/adapters/src/model/official-coding-plan-gateway.ts:24-29`
- codex 参照：[packages/codex-cli/src/adapter.ts](../../../../../../../packages/codex-cli/src/adapter.ts)
- 实测日志：`~/.zcode/cli/rollout/model-io-sess_{2db45aee,ccc68a08,5c78a55d,8655d99d,16585a17}*.jsonl`

## 限制

- 源码结论限定 commit `29628c9`（v3.14.3）与本机 CLI 0.16.9；版本升级后 schema 需复核。
- kmh 样本为单请求会话，未覆盖同会话第二轮；缓存为零的判定以结构性证据（该路径无法携带断点）为主、日志为辅。
- Anthropic 协议"无断点即无缓存"以协议语义与本机实测为准；若 GLM 网关未来引入透明前缀缓存，需重测。
