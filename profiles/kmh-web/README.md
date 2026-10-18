# Kongming Web 配置

完整插件的功能分组、通用与 GUI/Web 作用域见 [插件索引](../../docs/kmh/plugin-index.md)，应用启动与维护归属见 [当前架构](../../docs/architecture/kongming-runtime.md)。

运行 `pnpm web` 启动，运行 `pnpm config:web` 查看最终合成配置。根目录 `launch.config.json` 的 `profiles.web` 选择此 profile；[DSH Web Bundle](../../bundles/dsh-web/README.md)提供基础插件树，本目录 `cordis.patch.yml` 管理 KMH 自有插件和部署覆盖。

Web 使用已有构建产物，修改插件源码后手动构建；新产物通过 [Web 插件热更新](../../docs/kmh/README.md#web-插件热更新) 应用。HMR 的代码目录由启动器提供，配置文件继续由现有 profile 监听应用。

[package.json](package.json) 的 `dsh.profile.bundles` 按顺序选择 `@kmh/dev-preset`、`@deepseek-ai/dsh-experimental-inspector-profile`、`dsh-context` 和 `@kmh/bundle-dsh-web`。开发预设由[本地 bundle 配置](../../packages/kmh-dev-preset/cordis.patch.yml)提供，Inspector 与 dsh-context 分别由清单所选包提供；DSH 插件与四个基础预设由 [DSH Web Bundle 配置](../../bundles/dsh-web/cordis.patch.yml)提供。随后应用本目录 patch，再应用 home 和调用级 patch。`!!js` 保留运行时服务引用，DSH 负责插件实现和依赖解析。新增 Kongming 插件时，在此 profile 的 dependencies 声明包，再在本目录 patch 中添加插件实例。

## 计算机操作

此 profile 启用 `@deepseek-ai/dsh-computer-use` 与 `@deepseek-ai/dsh-experimental-computer-use-cua-driver-native`。两项依赖通过 `link:` 指向 DSH 子模块中的包；启动器在启动前建立本地包链接。profile 的依赖声明和 DSH Web Bundle 中的插件条目共同组成接入配置，原生提供方注册 `cua_driver_native__` 前缀的工具。

原生驱动随 npm 依赖安装，安装时保持 optional dependencies 启用，并向启动 Web 的宿主应用授予 macOS 辅助功能与屏幕录制权限。截图传给模型还要求模型声明图像输入能力。运行条件与限制见 [原生驱动说明](../../third_party/dsh/packages/experimental/computer-use-cua-driver-native/README.md)。

修改依赖后结束现有 Web 进程，再运行 `pnpm web` 启动，到设置 → 内置插件 → 全局插件中确认两个实例的运行状态为“运行中”。启动日志出现 `failed to import` 时，核对本目录的依赖声明、对应 `node_modules` 链接和目标包 exports 声明的构建产物；启动记录位于 `$KMH_HOME/logs/`，默认 `~/.kmh/logs/`。Kongming 维护此 profile 与包链接，DSH 子模块维护插件和原生 SDK 的版本。

## 启动设置

直接修改本目录 patch 的部署覆盖项，profile HMR 会应用保存后的设置：

```yaml
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  config:
    host: 127.0.0.1
    port: 60000
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
```

`webserver.config.port` 控制监听端口，`host` 支持 `127.0.0.1` 和 `0.0.0.0`。Bundle 中的 `web-runtime.config.openBrowser` 默认引用 `ctx.webStartup.openBrowser`，运行 `node scripts/kmh.mjs web --no-open` 会在本次启动关闭浏览器交接；`printUrl` 控制输出地址，`surfaceContext` 控制模型的 Web 环境信息，`trustedHosts` 声明受信任的访问域名。需要部署覆盖时，在本目录 patch 添加 `web-runtime` 条目并写出完整 `config`，保留原有字段，再添加 `publicUrl: https://example.com/` 等部署值。

## 插件实例与可配置字段

```yaml
- id: ui-settings-general
  name: '@deepseek-ai/dsh-client-ui-settings-general'
  config:
    welcomeNoticeVersion: '2026-09-28.1'
```

`id` 是插件实例的定位标识，后续 patch 通过它选择条目；`name` 是 DSH 加载的插件包名。编辑 `config` 设置插件公开的配置；保留上述 `id` 和 `name` 可继续使用官方对应的 patch 和实现。

此插件当前的完整配置定义只有 `welcomeNoticeVersion`，表示已经确认的欢迎提示版本，浏览器确认提示时会保存它。完整字段定义见 [ui-settings-general 源码](../../third_party/dsh/packages/client/ui-settings-general/src/index.ts)。其他插件分别在自己的源码中声明 `Config`；DSH Web Bundle 保存基础插件配置，本目录 patch 保存部署覆盖，源码声明可选字段和默认值。

配置树通过 `pnpm config:web` 查看，精确字段与默认值以对应插件源码的 `Config` 为准；插件激活状态结合插件面板与运行日志核对。

## 原版对照与升级

[upstream.cordis.yml](upstream.cordis.yml) 保存固定 DSH 版本的原版 Web 完整配置，包含 base 与 Web bundle 的全部配置和四个预设，用于查阅和升级比较。实际启动合成清单选择的 Bundles 与 [cordis.patch.yml](cordis.patch.yml)。四个基础预设的 Kongming persona 在 DSH Web Bundle 中管理，欢迎版本由本目录 patch 覆盖；headless/SDK 通过 `bundles/kongming` 管理共同 persona。

更新 DSH 子模块后，导出新版原配置，与 `upstream.cordis.yml` 比较，再把选定变化合入 DSH Web Bundle，并核对本目录的覆盖项。执行 `pnpm test` 与 Web 启动检查。Bundle 的配置由 Kongming 维护，上游配置变化经过明确审查；修改其 patch 后重新启动 Web。机器偏好 `$KMH_HOME/cordis.patch.yml` 和调用级 patch 按 DSH 的顺序在 profile 配置后应用。

## CLI 执行记录

Web profile 单独挂载 `@kmh/codex-cli-trace`，会话内入口为「Codex Trace」。数据来源、配置与故障处理统一见[插件说明](../../packages/codex-cli-trace/README.md)。

## MadeMe 工具

本目录 patch 以实例 `mcp-mademe` 把 MadeMe 知识库的 5 个工具接入助手：`mcp__mademe__mademe_save_idea`、`mcp__mademe__mademe_list_recent_ideas`、`mcp__mademe__mademe_list_ideas_by_tag`、`mcp__mademe__mademe_save_article`、`mcp__mademe__mademe_list_tags`。服务是 MadeMe-web 仓库自带的本机 stdio MCP，DSH 启动时把它拉起为子进程：

```yaml
- id: mcp-mademe
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: mademe
    transport: stdio
    command: /opt/homebrew/bin/node
    args: ['/Volumes/machub_app/proj/MadeMe-web/mcp/dist/index.js']
```

前提是 `args` 指向的入口已构建（在 MadeMe-web 的 `mcp/` 目录运行 `npm run build`），MadeMe-web 的 `cli/bin/mademe-cli` 存在，且其 `.env.local` 已配置 Vault 路径。服务按自身文件位置定位 MadeMe-web 项目根并以此为工作目录调用 CLI，本条目不需要 `cwd` 与 `env`。工具契约、错误码与排障见 MadeMe-web 的 `mcp/README.md`（仓库外文档，位于 `args` 所指目录的上一级）。[kmh-mobile-assistant profile](../kmh-mobile-assistant/README.md#mademe-工具) 声明同一实例，其 SDK 场景的差异在该页说明。

重启 Web 后两处核对：`$KMH_HOME/logs/web-supervisor/web-server.log` 出现 `[mademe-mcp] 0.1.0 ready via stdio (cli: …, cwd: …)`；设置 → Built-in plugins → Global plugins 中搜索 `mcp`，`mcp-mademe` 条目的 Status 为 Running。工具以 DSH 的 `mcp__<serverName>__<tool>` 规则命名，即上述 5 个名字。入口文件或 CLI 缺失时子进程启动即退出，工具不出现，mcp-client 按重连策略重试：间隔 0.5 秒起倍增、上限 30 秒、连续 10 次失败即放弃并注销工具（合计约两分钟）。在此窗口内修复文件会自动恢复；超过窗口后必须重启 Web。改路径、换 Node 或停用时直接编辑本条目后重启 Web。`serverName` 必须保持 `mademe` 且在所有 mcp-client 实例中唯一，改名会改变工具名，重名会让实例加载失败。`@kmh/mademe` 插件只负责侧栏入口与内嵌面板，停用它不影响工具，见[插件说明](../../packages/kmh-mademe/README.md)。
