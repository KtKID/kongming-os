---
description: zcode-cli 插件由全量无状态调用改为原生 session 中继模式的重构方案：绑定与增量发送、MCP 工具桥、审批映射、压缩与停止，替代旧全量路径与 session-suspend 插件。
---

# zcode-cli 中继模式重构方案

> 状态：方案定稿待确认；确认后按 x-req/x-dev 拆场景与清单。
> 日期：2026-10-08
> 依据：[session 复用与缓存核实报告](../spec/zcode-cli-provider/tasks/provider/reports/research/research-report-20261008-zcode-session-cache.md)、[DSH 5719 架构审查](dsh-5719-zcode-provider-architecture-review.md)。
> 源码基线：`other/ZCode` commit `29628c9`（v3.14.3）；DSH 子模块 `06df1bee3f`（四笔挂起改动已回退）。

## 定案摘要

本轮讨论已拍板的边界，后续开发不再重议：

| 决策项         | 结论                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------- |
| 插件形态       | 中继：只负责把 web 输入转送 CLI、把 CLI 结果转回 web                                                     |
| 队列/停止/编辑 | 全部用 DSH 官方 inbox 语义（停止 `keepInbox` 保留队列、逐条消费、官方 edit/remove/steer 命令），插件不碰 |
| 暂停/继续/补充 | 不实现；`packages/session-suspend` 退役                                                                  |
| 压缩           | CLI 原生 `session/compact`，web 只展示返回结果                                                           |
| 发送规则       | 同 session 只发增量（新消息文本）；换 session 全量重建                                                   |
| 裸唤醒         | 不存在的问题：web 发送本身就是唤醒                                                                       |
| 审批           | CLI 反向 RPC 透传，映射走 DSH 公开服务（见审批映射节）                                                   |
| 模型请求       | 会话复用 + 增量发送吃 CLI 原生前缀缓存；现状全量路径缓存实测为零，必须替换                               |

## 目标架构

```text
web UI ── DSH 会话（队列/停止/编辑全部官方行为）
          └─ DSH agent loop ── @kmh/zcode-cli（中继插件）
                                ├─ session-store：KMH 会话 ↔ CLI session 绑定与确认进度
                                ├─ 发送：session/send（协议只收新文本，天然增量）
                                ├─ 接收：会话事件订阅 → 文本/进度/usage 投影回 web
                                ├─ 工具桥：KMH 工具经宿主 HTTP MCP 端点注册进 mcpServers
                                └─ 审批应答器：interaction/requestPermission → DSH 公开服务
                          CLI 原生负责：agent loop、工具执行、compact、前缀缓存断点
```

职责一句话：**DSH 决定何时发（队列与轮次），CLI 决定怎么跑（loop 与工具），插件只搬运并桥接交互。**

## 与现状的差距

1. 现路径 `workspace/generateText` 每次全量重发，消息为纯字符串无法携带 `cache_control`，GLM Coding Plan 走 Anthropic 协议——缓存实测为零（inputTokens 42375、cacheReadTokens 0；同机原生会话 64K–105K）。
2. 现实现自建消息投影与全量提示组装（`projectRequest` 遍历完整消息数组），在中继模式下整体不需要。
3. `packages/session-suspend`（1958 行）与官方 inbox 能力重复，退役。

## 组件改造清单

**新建**

| 组件          | 职责                                                     | 要点                                                                                                                                    |
| ------------- | -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| session-store | KMH 会话 ↔ CLI session 绑定、已确认进度                  | 跨进程持久；恢复失败保留原绑定并显式报错                                                                                                |
| relay turn    | `session/create`、`session/send`（新文本）、事件订阅投影 | 停止用官方 `session/stop`；空轮与重复提交幂等                                                                                           |
| MCP 工具桥    | 把 DSH 工具声明经 MCP 暴露给 CLI                         | 首选宿主 HTTP MCP 端点（协议 `mcpServers` 支持 http/sse + headers，挂在现有 connection 服务上，工具执行留在 KMH 宿主）；stdio shim 备选 |
| 审批应答器    | 反向 RPC 应答                                            | 见下节；fail-closed                                                                                                                     |

**保留**：账号登录、模型目录、请求状态展示（turn 级监督仍有观测价值）、Client UI 骨架与本地化。

**删除**：generateText 全量路径与全量提示组装（连通性探测改用官方 `provider/testModelConnectivity`）；`packages/session-suspend` 整包与配套 spec（归档处理）。

## 审批映射（codex-cli 同款模式）

DSH 公开服务两条通道，web 端 UI 现成，插件不自己画界面：

| CLI 反向 RPC                                                                   | 映射目标                                                                                                                                           | 词汇映射                                                                                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `interaction/requestPermission`（toolName、input、reason、riskLevel、options） | `ctx.approval.request({ agent, toolName, reason })`（[user-approval](../../third_party/dsh/packages/interaction/user-approval/README.zh.md) seam） | allowed-once → allowOnce；rejected/unavailable → deny（与 CLI 默认 deny broker 的 fail-closed 语义对齐）；cancelled → deny |
| `interaction/requestUserInput`（ask_user_question）                            | `ctx.userQuestions.ask()`（结构化选项 + 自由文本，codex `handleUserInput` 同款映射）                                                               | 选项直译；中止 → cancel                                                                                                    |

展示文案由插件组装：`toolName` + riskLevel + input 摘要进 `reason`（codex `commandApprovalPromptOf` 模式）。

**词汇损失明示**：DSH user-approval 只有一次性授权（`allowed-once`），无 allow-always、无规则存储。两个处置：

- **方案 A（建议，codex 同款）**：丢弃 CLI 的 allow-always 选项——每把工具每次都问。简单、审计词汇完整。
- 方案 B：用 `userQuestions` 问三选一（允许一次/总是允许/拒绝），"总是"由插件自记规则应答后续请求。绕过审批审计词汇，复杂度增加；确有高频工具打扰再启用。

MCP 工具风险档由 KMH 侧控制：工具声明带 `readOnlyHint`/`destructiveHint` annotations，CLI 据此定 low/high/默认 medium。

## 已知缺口与取舍（需知情接受）

1. **persona**：`session/create` 无 systemPrompt 参数——中继会话使用 ZCode 自己的系统提示，KMH persona 注入不去。
2. **重建只支持纯文本**：`importedHistory` 只收 user/assistant 文本，工具调用链进不去；同 session 正常续无此问题。
3. **审批 fail-closed**：DSH 侧无应答者（如 headless 未组合）= CLI 收到拒绝继续跑；这是刻意的。
4. **会话记录粒度**：DSH 会话记录只含最终文本与审批审计；工具执行细节在 CLI 侧记录（rollout/会话存储）。

## 分阶段任务与验收

| 阶段          | 内容                                                                | 验收要点                                                                        |
| ------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| M0 冒烟       | 隔离 HOME 真机：create + send + 事件订阅                            | 同会话第二轮请求 usage 中 cacheReadTokens > 0（对照基线 0）                     |
| M1 绑定与增量 | session-store、重启 `session/resume`（mcpServers 同参）、同会话多轮 | 重启后同 session 续聊、上下文连续、绑定失败显式报错不吞                         |
| M2 工具与审批 | HTTP MCP 端点、工具往返、审批闭环                                   | KMH 工具被 CLI 调用并拿到结果；允许/拒绝/中止三路回执正确；无应答者 fail-closed |
| M3 停止与压缩 | `session/stop`、`session/compact` 结果展示                          | 停止后队列保留（官方行为回归）；压缩内容回传展示                                |
| M4 清理       | 删全量路径、session-suspend 退役归档、profile 与 README/spec 更新   | 全量测试绿；插件索引与架构文档同步                                              |

## 开放问题

1. allow-always 处置走方案 A 还是 B。
2. 现有请求监督 supervisor（进程回收、300s 超时链路）在中继模式的去留——`session/stop` 收敛更干净，可能只剩观测价值。
3. MCP 端点最终形态：HTTP（挂 webserver）还是 stdio shim。
4. 旧 `workspace/generateText` 路径是否保留为调试后门（默认不注册）。
