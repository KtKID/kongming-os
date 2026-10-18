# 小艺移动助手 Profile

`kmh-mobile-assistant` 组合 DSH base、SDK app 和 [Mobile Assistant Bundle](../../bundles/mobile-assistant/README.md)。默认 Agent preset 为 `mobile-assistant`，用于文件与记录为主的持续聊天助手。

## 启动与接入

在 Kongming 根目录构建后，通过现有启动器使用该 profile：

```sh
KMH_HOME=~/.hm-mobile-os node scripts/kmh.mjs dsh --profile kmh-mobile-assistant
```

进程等待 stdio JSON-RPC，实际使用由小艺网关持有管道。启动器转发调用者工作目录，默认模型配置为 `codex-cli / gpt-6.1-sol / medium`（中等思考强度），SDK initialize 的显式 provider/model/reasoningEffort 由网关传入；运行数据写入独立的 KMH_HOME。

网关的 `DSH_SDK_PROFILE` 选择 `kmh-mobile-assistant`，`DSH_MODE` 选择 `session`。持续沟通、持久映射、空闲回收、验证命令和部署注意事项见[小艺移动助手接入](../../docs/integrations/xiaoyi-mobile-assistant.md)。本 profile 接入 `@kmh/codex-cli` 与 `@kmh/zcode-cli`，并保留 runtime-log、助手 SDK runtime 与 DSH base 模型适配器。`KMH_CODEX_COMMAND` 与 `KMH_ZCODE_COMMAND` 可覆盖官方程序路径；macOS 默认使用 ChatGPT.app 内的 Codex，其他平台从 PATH 查找 codex，ZCode 从 PATH 查找 zcode。Codex 复用已有登录态，ZCode 账号配置遵循插件说明。Codex 工具开关由 `@kmh/codex-cli` 自行管理，见其 [工具选择](../../packages/codex-cli/README.md#工具选择)。

## MadeMe 工具

本 profile 的 `cordis.patch.yml` 以实例 `mcp-mademe` 接入 MadeMe 知识库的 5 个工具（`mcp__mademe__mademe_save_idea`、`mcp__mademe__mademe_list_recent_ideas`、`mcp__mademe__mademe_list_ideas_by_tag`、`mcp__mademe__mademe_save_article`、`mcp__mademe__mademe_list_tags`），与 kmh-web 为同一实例形态；实例配置、前提、重连策略与排障统一见 [Web 配置 · MadeMe 工具](../kmh-web/README.md#mademe-工具)。本 profile 是 SDK 进程、没有网页界面，因此不挂载只提供侧栏与内嵌面板的 `@kmh/mademe` 插件；走 CLI 的 `mademe-save` 技能继续保留，两者写入同一 Vault。

本 profile 同时关闭 DSH base 的 `mcp-resources` 实例：它会在有 MCP 服务接入时向模型挂出 `list_mcp_resources`、`list_mcp_resource_templates`、`read_mcp_resource` 三个工具，而 MadeMe 的 MCP 不提供 resources，调用只会得到 method not found。后续接入带 resources 的 MCP 服务时再在 patch 中启用。

生效时机：网关按会话拉起 KMH 进程，本条目在下一次拉起时生效，无需重启网关。Codex CLI 在会话创建时固定工具目录，不在目录内的工具既不发给 Codex、调用也返回 `TOOL_DISABLED`，因此**已有 Codex 会话看不到 MadeMe 工具，只有此后新建的会话才有**——小艺侧需要 `clearContext` 或换新的对话 id；ZCode CLI 等其他提供方没有这一快照机制。核对入口：`node --test tests/runtime/mobile-assistant.test.mjs` 以真实 profile 比对模型可见的完整工具快照 [mobile-assistant-tools.json](../../tests/runtime/expected/mobile-assistant-tools.json)（含这 5 个工具、不含资源工具）；`KMH_HOME=$(mktemp -d) node scripts/kmh.mjs dsh --profile kmh-mobile-assistant --dump-config` 可查看合成后的实例配置。

## 开发备注

无。
