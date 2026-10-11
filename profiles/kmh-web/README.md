# Kongming Web 配置

完整插件的功能分组、通用与 GUI/Web 作用域见 [插件索引](../../docs/kmh/plugin-index.md)，应用启动与维护归属见 [当前架构](../../docs/architecture/kongming-runtime.md)。

运行 `pnpm web` 启动，运行 `pnpm config:web` 查看最终合成配置。根目录 `launch.config.json` 的 `profiles.web` 选择此 profile；本目录 `cordis.patch.yml` 完整列出 base、Web 应用、standard/PTC/minimal/Cordis 四个预设及 Kongming persona。

自有插件代码修改通过 [Web 插件热更新](../../docs/kmh/README.md#web-插件热更新) 自动应用；`pnpm web --no-watch` 选择已有构建产物。HMR 的代码目录由启动器提供，配置文件继续由现有 profile 监听应用。

`package.json` 的 `dsh.profile.bundles` 选择附加 bundle，当前选择 `@kmh/dev-preset`（开发模式预设，插件树与 standard 一致，见 `packages/kmh-dev-preset/cordis.patch.yml`）；完整插件树由 `cordis.patch.yml` 的 `insert` 加入。此文件中的 `!!js` 保留运行时服务引用，DSH 负责插件实现和依赖解析。新增 Kongming 插件时，在此 profile 的 dependencies 声明包，再在完整配置中添加插件实例。

## 计算机操作

此 profile 启用 `@deepseek-ai/dsh-computer-use` 与 `@deepseek-ai/dsh-experimental-computer-use-cua-driver-native`。两项依赖通过 `link:` 指向 DSH 子模块中的包；启动器在启动前建立本地包链接。依赖声明和 `cordis.patch.yml` 中的插件条目共同组成接入配置，原生提供方注册 `cua_driver_native__` 前缀的工具。

原生驱动随 npm 依赖安装，安装时保持 optional dependencies 启用，并向启动 Web 的宿主应用授予 macOS 辅助功能与屏幕录制权限。截图传给模型还要求模型声明图像输入能力。运行条件与限制见 [原生驱动说明](../../third_party/dsh/packages/experimental/computer-use-cua-driver-native/README.md)。

修改依赖后结束现有 Web 进程，再运行 `pnpm web` 启动，到设置 → 内置插件 → 全局插件中确认两个实例的运行状态为“运行中”。启动日志出现 `failed to import` 时，核对本目录的依赖声明、对应 `node_modules` 链接和目标包的 `lib/index.js`；启动记录位于 `$KMH_HOME/logs/`，默认 `~/.kmh/logs/`。Kongming 维护此 profile 与包链接，DSH 子模块维护插件和原生 SDK 的版本。

## 启动设置

直接修改完整配置中的条目，profile HMR 会应用保存后的设置：

```yaml
- id: webserver
  name: '@deepseek-ai/dsh-host-webserver'
  config:
    host: 127.0.0.1
    port: 3080
    compression: gzip
    compressionLevel: 1
    compressionThresholdBytes: 1024
```

`webserver.config.port` 控制监听端口，`host` 支持 `127.0.0.1` 和 `0.0.0.0`。`web-runtime.config.openBrowser` 控制自动打开浏览器，`printUrl` 控制输出地址，`surfaceContext` 控制模型的 Web 环境信息，`trustedHosts` 声明受信任的访问域名；需要公布域名时，在 `web-runtime.config` 添加 `publicUrl: https://example.com/`。当前 profile 使用文件内的部署值；日常修改这些字段并运行 `pnpm web`。

## 插件实例与可配置字段

```yaml
- id: ui-settings-general
  name: '@deepseek-ai/dsh-client-ui-settings-general'
  config:
    welcomeNoticeVersion: '2026-09-28.1'
```

`id` 是插件实例的定位标识，后续 patch 通过它选择条目；`name` 是 DSH 加载的插件包名。编辑 `config` 设置插件公开的配置；保留上述 `id` 和 `name` 可继续使用官方对应的 patch 和实现。

此插件当前的完整配置定义只有 `welcomeNoticeVersion`，表示已经确认的欢迎提示版本，浏览器确认提示时会保存它。完整字段定义见 [ui-settings-general 源码](../../third_party/dsh/packages/client/ui-settings-general/src/index.ts)。其他插件分别在自己的源码中声明 `Config`；完整配置列出所有已组合的插件及配置，源码声明可选字段和默认值。

当前固定版本的 DSH `--dump-config-schema` 对四个 agent 预设报告 `unrecognized Loader tree carrier`，原版 Web 与本 profile 的字段导出都存在此限制。可选字段以对应插件源码的 `Config` 为准；配置合成和实际 Web 启动已分别验证。

## 原版对照与升级

[upstream.cordis.yml](upstream.cordis.yml) 保存固定 DSH 版本的原版 Web 完整配置，包含 base 与 Web bundle 的全部配置和四个预设；用于查阅和升级比较。实际启动使用 [cordis.patch.yml](cordis.patch.yml)。Kongming persona 和欢迎版本已直接写入实际配置，后续 Web 修改在此文件管理；headless/SDK 继续通过 `bundles/kongming` 管理共同 persona。

更新 DSH 子模块后，导出新版原配置，与 `upstream.cordis.yml` 比较，再把需要的变化合入实际配置并执行 `pnpm test` 与 Web 启动检查。保留完整 profile 使上游配置变化经过 Kongming 的明确审查。机器偏好 `$KMH_HOME/cordis.patch.yml` 和调用级 patch 仍按 DSH 的顺序在此配置后应用。
