# Kongming profiles

根目录 `launch.config.json` 选择 `cli`、`web`、`sdk` 短命令对应的 profile。`kmh-headless` 和 `kmh-sdk` 选择 DSH 的 headless 和 JSON-RPC 应用，再叠加 Kongming 自有 bundle；`kmh-web` 在 `cordis.patch.yml` 中完整展开 base、Web 和所有预设，端口等部署配置直接编辑该文件。Web 的原版对照和字段说明见 [kmh-web/README.md](kmh-web/README.md)。

启动器在 `KMH_HOME/profiles` 登记指向这里的链接，并在各 profile 的忽略目录 `node_modules` 注册本地 bundle。重复运行保持配置内容；已有目录冲突时保留原目录并报错。
