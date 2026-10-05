---
description: KMH_HOME 默认目录、相对路径与 kmh-echo 必填日志配置的升级步骤。
---

# 运行数据目录升级

## 变更

旧启动器默认使用仓库中的 `.kmh/`，新版默认使用系统账户的 `~/.kmh/`。`KMH_HOME` 直接指向数据目录，显式配置接受绝对路径或 `~/` 前缀。旧的相对目录配置需要改为绝对路径。

新版启动器固定 DSH、ZCode 和临时文件的根目录，将启动输出、插件日志与安装诊断保存至选定的数据目录。三个 profile 已配置相应服务。`kmh-echo.config.file` 成为必填的绝对路径；自定义实例需要补齐该字段。目录和父进程环境的完整说明见[数据目录与运行记录](runtime-records.md)。

## 迁移

1. 停止使用旧目录的 KMH 进程。先选定一个最终数据目录；继续使用原数据时，在启动环境中设置 `KMH_HOME=/absolute/path/to/kongming-agent/.kmh`。
2. 使用新目录时，备份旧目录，再将需要保留的 `sessions/`、`storages/`、附件、缓存、凭据、身份文件、ZCode 状态和 home 级配置复制到新目录。目标目录已有数据时逐项检查冲突。启动器保留原有数据，目录迁移由使用者显式执行。
3. 新数据目录中的 `profiles/` 由启动器登记。迁移时保留仓库 profile 源文件，并让启动器为新目录创建链接。
4. 自定义 `kmh-echo` 实例在其 patch 中提供 `config.file: !!js dshHomePath('logs', 'kmh-echo', 'events.log')`。
5. 运行 `pnpm build:kmh` 构建新增日志插件，运行 `pnpm profiles` 确认目标目录，再启动所需模式。检查 `logs/` 新增的启动记录与界面中的已有会话，确认使用了所选数据目录。

本次变更还需要构建 DSH 插件管理器的新增日志配置。维护 checkout 通过 DSH 的构建流程生成底座，再构建 KMH 插件；底座安装诊断位置说明见[插件管理器](../../third_party/dsh/packages/boot/plugin-manager/README.zh.md)。
