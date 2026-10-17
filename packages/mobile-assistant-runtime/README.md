---
description: 移动助手SDK的会话三态观察、目标保护控制和原任务结果恢复接口。
---

# Mobile Assistant Runtime

`@kmh/mobile-assistant-runtime` 为小艺移动助手提供 SDK stdio 服务。它复用 DSH 的 SDK 通知、模型握手、Agent create/resume、附件持久化与会话写 ownership；`Config.preset` 必须指定已注册的助手 preset。

## 使用

通过 [kmh-mobile-assistant profile](../../profiles/kmh-mobile-assistant/README.md) 启动。SDK 方法为 `initialize`、`session/prompt`、`kmh/task/get`、`kmh/task/cancel`、`kmh/task/resume`、`kmh/session/get`、`kmh/session/cancel`、`kmh/session/resume`、`shutdown`。握手需要绝对 `cwd`、`provider` 与 `model`，可指定推理强度与输出 token 上限；输入为文本块和内联 PNG/JPEG/WebP/GIF 图片。非法 JSON 在请求入口拒绝，其他内容块报错。

同一进程中的同 id 输入复用 Agent；已有持久 id 调用 `ctx.agents.resume`，首次 id 调用 `ctx.agents.create`。恢复要求已存会话的 `agentPreset` 和 `cwd` 与当前配置相同，配置冲突、损坏历史和写 ownership 冲突明确失败。清除上下文由网关更换内部 id，旧 JSONL 历史继续保留。

需要权限批准的操作通过 `approval/ask` 回传网关。应答允许一次、拒绝或取消；通道不可用按 DSH 的 unavailable 语义结束。会话历史恢复继承 DSH 的持久记录，后台命令进程的运行状态由其自身服务管理。

`shutdown` 取消尚未发布的会话并等待全部 Agent 释放写 ownership，回执输出后等待根运行时清理并退出。SDK 初始化与 transport 启动由 DSH profile 管理，stdout 专用于 JSON-RPC。

## 任务协议和恢复

[唯一 Zod 协议源](src/protocol.ts) 定义任务结果、会话三态观察、原因码、快照和控制请求。初始化应答通过 `kmhTaskControl.version=1` 声明能力；带 `task: {taskId, contextId}` 的输入每会话只接纳一条，执行中、停止中和挂起阶段返回 `TASK_BUSY`。

`kmhSessionObservation.version=1` 声明独立会话观察能力。`kmh/session/get` 接收 `sessionId` 和 `contextId`；`prepare=true` 可以显式准备首次空会话。已有会话按原内部身份恢复，实例或原资料暂不可读时返回 `agentAvailable=false` 及已有来源码和说明。查询返回当前 Agent 的 `idle/running/suspended`、观察实例与递增版本、执行目标标识和接纳事实；`kmh/session/status` 通知采用同一观察结构。

`kmh/session/cancel` 和 `kmh/session/resume` 还需要 `operationId` 与 `expectedExecutionRef`。服务核对当前执行目标后调用公开 Agent 控制；停止等待实际收尾，继续推进电脑已有挂起输入。同一操作标识和目标复用原结果，标识被用于不同动作或目标时明确报错。目标已变化时返回 `target-changed` 及当前观察，调用方据此主动决定后续操作。会话观察和原任务结果分别维护，原任务查询继续使用原 `taskId`。

任务薄索引位于 `DSH_HOME/mobile-assistant/tasks`，仅保存任务与原会话、输入和轮次的定位、接纳阶段，以及执行前移除已确认的事实。正文、思考和结束原因从原会话日志读取；查询会恢复已有 Agent 观察句柄，原输入保持原样。持有其他写 ownership 时返回状态暂不可取，缺索引保持未知。

`kmh/task/cancel` 校验原任务归属，移除该输入仍待处理的消息，调用公开 `Agent.cancel(user, {keepInbox:true})`，等待 `whenIdle()` 并核对原结束记录。确认停止与收到请求分别处理；其他已有输入留在挂起会话，由 `kmh/task/resume` 显式继续。旧任务的控制操作保持旧归属，已完成任务继续返回原结果。服务关闭后原会话和薄索引继续用于查询。

从仓库根生成 Harmony 网关校验、ArkTS 类型/运行时校验和中文状态目录：

```sh
pnpm --filter @kmh/mobile-assistant-runtime build
node packages/mobile-assistant-runtime/scripts/sync-protocol.mjs --harmony-root /absolute/path/to/Harmony
node packages/mobile-assistant-runtime/scripts/sync-protocol.mjs --harmony-root /absolute/path/to/Harmony --check
```

生成文件包含源摘要，协议修改后重新生成，手动修改生成文件会使检查失败。

## 验证

`pnpm --filter @kmh/mobile-assistant-runtime build`、`typecheck`、`lint`、`format:check` 覆盖本包。运行 `pnpm --filter @kmh/mobile-assistant-runtime test` 验证协议、日志投影、薄索引、真实 Agent 中止和挂起继续、真实模型连接与 bash 工具的取消传播、SDK 重启后原结果恢复。模型服务使用隔离的本地测试应答。其他行为验证见 [bundle 验证说明](../../bundles/mobile-assistant/README.md#验证)。

## 开发备注

无。
