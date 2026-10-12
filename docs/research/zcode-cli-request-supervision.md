---
description: ZCode 原生会话中继的请求监督现状、停止确认含义及仍待实施的记录与恢复目标。
---

# ZCode 请求监督现状与后续目标

本文按当前源码区分已实现能力与后续目标。模型中继、配置和使用限制的归属为 [ZCode 包说明](../../packages/zcode-cli/README.md)，验收需求归属为[监督规格](../spec/kmh-zcode-cli-request-supervision/spec.md)，各任务报告记录对应实施时的验证结果。

## 当前请求路径

模型调用由 [adapter](../../packages/zcode-cli/src/index.ts) 转入 [relayTurn](../../packages/zcode-cli/src/runtime.ts)，使用 `session/create`、订阅事件、`session/send` 和恢复协议。每个 KMH 会话绑定专属 CLI 会话及 app-server 连接，连接可跨回合复用，空闲回收后按绑定恢复。连通探测使用独立的 `workspace/generateText` 路径。

KMH 决定发送时机并投影返回事件；CLI 持有原生上下文、工具执行和内部 Agent 回合。当前 KMH 系统提示与宿主工具接入仍有缺口，具体限制见[包说明](../../packages/zcode-cli/README.md#已知限制)。新增工具和权限能力需要同时核对 CLI 会话接入及宿主审批桥。

## 已实现的监督能力

[请求监督器](../../packages/zcode-cli/src/supervisor.ts)区分终止原因，保存阶段、等待时间、尝试次数及停止信息。首个终止原因与后续清理结果分别记录。认证接口 `GET /api/zcode-cli/requests` 提供状态快照，客户端按当前会话过滤并展示慢请求和停止状态。字段及默认时限以包说明和 [Config](../../packages/zcode-cli/src/config.ts) 为准。

请求状态和旧裸模型协议停止链路的实施记录分别见 [task-request-state](../spec/kmh-zcode-cli-request-supervision/tasks/task-request-state/dev-report.md) 与 [task-stop-chain](../spec/kmh-zcode-cli-request-supervision/tasks/task-stop-chain/dev-report.md)。这些报告中的测试计数和真机结果对应报告日期的实现；当前原生中继路径使用 [session.ts](../../packages/zcode-cli/src/session.ts)，路径变化后的验证以对应测试和新的运行证据为准。

## 当前停止确认的含义

用户停止在途中继回合时，插件发送有界等待的 `session/stop`，将成功回执记为停止确认。现有 `exitConfirmed` 和 `cleanupResult` 在这条路径表达 CLI 回合停止回执；进程树清空需要独立的进程观察证据。CLI 会话与连接可继续复用，空闲回收和宿主释放另行管理进程生命周期。

DSH 拥有宿主队列、暂停和继续语义；CLI 拥有原生会话停止语义。变更停止行为时分别核对两侧结果，明确确认对象、失败状态及恢复条件。停止之前已完成的文件修改和外部请求保留其实际影响；云端计算与计费状态依赖服务方提供的回执。

## 仍待实施或重新评审的目标

| 目标 | 当前归属与状态 |
| --- | --- |
| 请求生命周期落盘、详情、脱敏导出及保留策略 | [task-request-records](../spec/kmh-zcode-cli-request-supervision/tasks/task-request-records/dev-checklist.md) 清单仍待实施；规划的 `logs/zcode-cli/<sessionId>/<requestId>/` 属于目标目录 |
| 宿主重启后的未确认请求调查、身份核对和恢复 | [task-restart-recovery](../spec/kmh-zcode-cli-request-supervision/tasks/task-restart-recovery/dev-checklist.md) 清单仍待实施；需要独立验证跨进程恢复与受管范围观察 |
| 最小初始化及原生能力约束 | [task-minimal-init](../spec/kmh-zcode-cli-request-supervision/tasks/task-minimal-init/dev-checklist.md) 基于旧裸模型路径，需要按当前原生工具执行职责重新评审关闭项和允许范围 |
| 本机进程范围清空保证 | 原生回合停止回执、直接进程退出、受管范围清空分别记录与验证；采用整体回收时需定义会话恢复和重新连接行为 |
| KMH persona 与宿主工具接入 | 先确定受支持的 CLI 会话接入方式，再验证权限、单次执行、日志和恢复；当前限制由包说明维护 |

## 验收入口

当前中继测试位于 [zcode-cli-session.test.mjs](../../tests/runtime/zcode-cli-session.test.mjs)，覆盖事件投影、会话复用与恢复、停止、审批及权限映射。后续能力需补充等待中停止、缺失回执、并发会话隔离、宿主卸载、重启恢复和真实浏览器验证；已有任务报告提供历史证据，新增验收匹配当前协议和实现。

官方 CLI 的运行日志和模型 I/O 记录路径见[包说明](../../packages/zcode-cli/README.md#子进程运行记录)，KMH 的启动与插件日志见[运行记录](../kmh/runtime-records.md)。请求状态的长期保存与重启重建按上表待实施项推进。
