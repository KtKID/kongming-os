# Kongming profiles

根目录 `launch.config.json` 选择 `cli`、`web`、`sdk` 短命令对应的 profile。`kmh-headless` 和 `kmh-sdk` 选择 DSH 的 headless 和 JSON-RPC 应用，再叠加 Kongming 自有 bundle；`kmh-web` 在 `cordis.patch.yml` 中展开 base、Web 和四个基础预设，并通过 `package.json` 的 `dsh.profile.bundles` 选择附加 bundle，端口等部署配置编辑 profile patch。Web 的原版对照和字段说明见 [kmh-web/README.md](kmh-web/README.md)。

`kmh-mobile` 是外部网关单次调用的专用 profile：headless 组合叠加 `@kmh/zcode-cli` 与 `@kmh/codex-cli` 两组模型提供方，默认模型 `zcode-cli` / `glm-5.3-flash`（凭据分别复用本机 ZCode 桌面登录与 `~/.codex` 登录）。它由调用方经 `--profile kmh-mobile` 指定，不进 `launch.config.json`，与 `kmh-headless` 互不影响；不挂 kmh-echo 调试插件。

启动器在 `KMH_HOME/profiles` 登记指向这里的链接，并按各 profile 的 dependencies 在忽略目录 `node_modules` 注册本地插件与 bundle 链接。重复运行保持配置内容；已有目录冲突时保留原目录并报错。
