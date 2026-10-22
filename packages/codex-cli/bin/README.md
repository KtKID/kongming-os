---
description: 插件固定 Codex CLI 运行包的位置、完整版本检查、当前平台与本地运行包的维护方法。
---

# 固定 Codex CLI 运行包

插件默认执行本目录的 `codex` 启动器。固定版本由 `version` 保存；当前为 `0.163.0-alpha.10.2`，已部署平台为 macOS arm64。聊天、登录、额度、模型目录与探针都通过插件同一个 `Config.command` 执行。

## 目录与校验

完整官方运行包位于 `0.163.0-alpha.10.2/darwin-arm64/`，保留 `codex-package.json`、`bin/`、`CodexCLI.app/`、`codex-path/` 和 `codex-resources/` 的原始相对位置。程序及配套资源共46个文件，340,775,935字节。复制来源为当前本机桌面应用随附的官方运行包；复制后逐文件 SHA-256 对比一致，主程序哈希记录在 [runtime-receipt.json](runtime-receipt.json)。

启动器按 `version` 和当前平台定位运行包，先执行官方 `--version`，精确匹配完整版本字符串后以 `exec` 转交原参数、输入输出及退出状态。alpha 后缀参与匹配。版本失配返回 `CODEX_VERSION_MISMATCH`；运行包缺失返回 `CODEX_BUNDLED_RUNTIME_MISSING`；当前平台尚无部署支持时返回 `CODEX_BUNDLED_PLATFORM_UNSUPPORTED`，这些失败使用退出码78。

官方原生工具清单继续位于 `vendor/native-tools/<实际版本>.json`。本次清单从固定程序发给隔离本地模型服务的真实请求采集，并以执行拒绝测试核对工具隔离；其运行证据见[本次任务](../../../docs/spec/codex-cli-provider/tasks/task-pinned-cli-bin.md)。

## 本地部署与升级

完整运行包保留在 Git 忽略目录中；启动器、固定版本、复制收据和工具清单随源码维护。当前包发布白名单包含整个 `bin`，打包前须在上述版本和平台目录部署完整运行包。新 checkout 应先准备运行包；缺失提示直接给出所需路径。其他平台可显式配置经过验证的 `command`，对应工具清单继续参与检查。

升级时先准备目标官方运行包，核对实际版本与来源，再更新固定版本、复制收据和对应工具清单。执行插件工具隔离及会话回归，验证成功后切换版本；本机 Codex 登录、配置和原生会话目录继续由现有机制管理。目录只承载程序和资源。

## 维护入口

`codex` 负责程序定位、版本检查和进程转交；`version` 是固定版本的权威值；`runtime-receipt.json` 保存本次复制来源、规模与主程序校验值。Config 从自身包目录解析本目录，显式 `command` 覆盖继续可用。
