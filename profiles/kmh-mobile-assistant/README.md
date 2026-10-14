# 小艺移动助手 Profile

`kmh-mobile-assistant` 组合 DSH base、SDK app 和 [Mobile Assistant Bundle](../../bundles/mobile-assistant/README.md)。默认 Agent preset 为 `mobile-assistant`，用于文件与记录为主的持续聊天助手。

## 启动与接入

在 Kongming 根目录构建后，通过现有启动器使用该 profile：

```sh
KMH_HOME=~/.hm-mobile node scripts/kmh.mjs dsh --profile kmh-mobile-assistant
```

进程等待 stdio JSON-RPC，实际使用由小艺网关持有管道。启动器转发调用者工作目录，默认模型配置为 `codex-cli / gpt-6.1-sol / medium`（中等思考强度），SDK initialize 的显式 provider/model/reasoningEffort 由网关传入；运行数据写入独立的 KMH_HOME。

网关的 `DSH_SDK_PROFILE` 选择 `kmh-mobile-assistant`，`DSH_MODE` 选择 `session`。持续沟通、持久映射、空闲回收、验证命令和部署注意事项见[小艺移动助手接入](../../docs/integrations/xiaoyi-mobile-assistant.md)。本 profile 接入 `@kmh/codex-cli` 与 `@kmh/zcode-cli`，并保留 runtime-log、助手 SDK runtime 与 DSH base 模型适配器。`KMH_CODEX_COMMAND` 与 `KMH_ZCODE_COMMAND` 可覆盖官方程序路径；macOS 默认使用 ChatGPT.app 内的 Codex，其他平台从 PATH 查找 codex，ZCode 从 PATH 查找 zcode。Codex 复用已有登录态，ZCode 账号配置遵循插件说明。Codex 工具开关由 `@kmh/codex-cli` 自行管理，见其 [工具选择](../../packages/codex-cli/README.md#工具选择)。

## 开发备注

无。
