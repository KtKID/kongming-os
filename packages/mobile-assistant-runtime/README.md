# Mobile Assistant Runtime

`@kmh/mobile-assistant-runtime` 为小艺移动助手提供 SDK stdio 服务。它复用 DSH 的 SDK 通知、模型握手、Agent create/resume、附件持久化与会话写 ownership；`Config.preset` 必须指定已注册的助手 preset。

## 使用

通过 [kmh-mobile-assistant profile](../../profiles/kmh-mobile-assistant/README.md) 启动。SDK 方法为 `initialize`、`session/prompt`、`shutdown`。握手需要绝对 `cwd`、`provider` 与 `model`，可指定推理强度与输出 token 上限；输入为文本块和内联 PNG/JPEG/WebP/GIF 图片。非法 JSON 在请求入口拒绝，其他内容块报错。

同一进程中的同 id 输入复用 Agent；已有持久 id 调用 `ctx.agents.resume`，首次 id 调用 `ctx.agents.create`。恢复要求已存会话的 `agentPreset` 和 `cwd` 与当前配置相同，配置冲突、损坏历史和写 ownership 冲突明确失败。清除上下文由网关更换内部 id，旧 JSONL 历史继续保留。

需要权限批准的操作通过 `approval/ask` 回传网关。应答允许一次、拒绝或取消；通道不可用按 DSH 的 unavailable 语义结束。会话历史恢复继承 DSH 的持久记录，后台命令进程的运行状态由其自身服务管理。

`shutdown` 取消尚未发布的会话并等待全部 Agent 释放写 ownership，回执输出后等待根运行时清理并退出。SDK 初始化与 transport 启动由 DSH profile 管理，stdout 专用于 JSON-RPC。

## 验证

`pnpm --filter @kmh/mobile-assistant-runtime build`、`typecheck`、`lint`、`format:check` 覆盖本包。行为验证见 [bundle 验证说明](../../bundles/mobile-assistant/README.md#验证)。

## 开发备注

无。
