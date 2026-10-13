---
description: kmh-web 使用的 DSH 基础服务、Web 插件和四个 Agent 预设的本地 Bundle 配置及升级入口。
---

# DSH Web Bundle

`@kmh/bundle-dsh-web` 集中提供 KMH 当前采用的 DSH 基础服务、GUI/API、Web 承载、standard/PTC/minimal/Cordis 四个预设和计算机操作插件。配置保留 KMH 已采用的启停状态、权限预设与中文提示词；原版 Web 展开配置位于 [upstream.cordis.yml](../../profiles/kmh-web/upstream.cordis.yml)，升级时用于审查差异。

[package.json](package.json) 的 `dsh.bundle.patch` 选择 [cordis.patch.yml](cordis.patch.yml)。[kmh-web 清单](../../profiles/kmh-web/package.json)通过 `link:../../bundles/dsh-web` 声明本地依赖，并将本 Bundle 放在开发预设、Inspector 和 dsh-context 之后。DSH 实现由固定版本子模块提供，计算机操作包的本地链接由 profile 声明。

## 配置与验证

修改 DSH 插件及四个基础预设时编辑本目录的 patch。KMH 自有插件、端口、欢迎版本、默认模型、子 Agent 模型选项和主题在 [Web profile](../../profiles/kmh-web/README.md)管理；profile 覆盖目标插件的完整 `config` 对象。

在 Kongming 根目录运行 `pnpm config:web` 查看合成配置，运行 `pnpm test` 验证启动链路。当前配置 HMR 监听 profile 清单、profile patch 和 home patch；修改本 Bundle 的 patch 后，通过重新启动 Web 加载配置。后台启停入口见 [Web 后台启停](../../docs/kmh/runtime-records.md#web-后台启停)。

升级 DSH 的固定子模块版本后，对比新版官方 Web 配置与原版对照，将选定变化合入本 Bundle，并核对 profile 覆盖项。完整底座升级流程见 [版本升级](../../docs/kmh/README.md#版本升级)。
