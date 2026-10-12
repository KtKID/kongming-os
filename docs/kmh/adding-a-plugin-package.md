---
description: 在 Kongming 新增 Cordis 插件或纯 bundle 时需要登记的包、构建、profile 依赖与验证入口。
---

# 新增 Kongming 自有包

自有插件和 bundle 放在根工作区的 `packages/` 或 `bundles/`。Cordis 插件提供运行代码，profile 通过插件实例加载它；bundle 在清单中声明有序 patch 文件，profile 通过 `dsh.profile.bundles` 选择它。DSH 内部包规范见[上游实操手册](../../third_party/dsh/docs/cookbook/adding-a-package.zh.md)。

## Cordis 插件接入

以 [runtime-log](../../packages/runtime-log/package.json)作为单入口参考；同时提供 Host/Client 的包参考 [codex-cli](../../packages/codex-cli/package.json)。导出路径随本包实际构建目录确定。

| 文件 | 登记内容 |
| --- | --- |
| `packages/<name>/package.json` | `exports` 指向实际构建产物；DSH 对等依赖以版本号声明，并在开发依赖中用本地 `link:` 引用同一批包；运行时直接依赖按参考包声明 |
| 包内 TypeScript 配置与源码 | 单入口参考 runtime-log；Host/Client 分别参考 codex-cli 的编译配置、`src/client/` 与 `./client` 导出 |
| 根 `package.json` | 在 `build:kmh`、`typecheck:kmh`、`lint`、`format:check` 的 filter 列表登记有相应脚本的代码包 |
| `profiles/<profile>/cordis.patch.yml` 或该 profile 选用的 bundle | 在目标作用域添加插件实例，声明 `id`、模块 `name`、配置与所需服务 |
| `profiles/<profile>/package.json` | `dependencies` 登记 `@kmh/<name>` 的 `link:../../packages/<name>` 引用；位于 `bundles/` 的包使用相应路径 |
| 根测试入口 | 放在 `tests/runtime/*.test.mjs` 的测试由根命令收集；包内测试目录需要在根 `package.json` 的 `test` 命令中显式登记，参考 Codex 与团队包 |
| 包 README | 记录配置、语义、失败处理、限制、扩展点与维护归属；能力导航链接到该 README |

包源码顶部用中文说明功能，函数注释说明输入、输出与失败行为。自有插件消费 DSH 服务和事件时遵循其 API 与生命周期要求；参照 [Cordis 机制](../../third_party/dsh/docs/cordis-primer.zh.md)与[防御规则](../../third_party/dsh/docs/defensive-patterns.zh.md)。

## 纯 bundle 接入

`packages/kmh-dev-preset` 是纯 bundle 的现行示例。它的 [package.json](../../packages/kmh-dev-preset/package.json)通过 `dsh.bundle.patch` 声明 `cordis.patch.yml`。在目标 profile 的 `dependencies` 登记包链接，并在 `dsh.profile.bundles` 中按组合顺序添加包名；参考 [Web profile 清单](../../profiles/kmh-web/package.json)。纯配置包按其清单提供 patch 文件，根构建与类型检查 filter 收集提供对应脚本的代码包。

bundle 的 patch 文件按清单顺序应用，再应用 profile、home 和调用级 patch。目标条目的 `config` 会被整体替换，覆盖时保留该条目需要的完整配置。

## 链接与构建

修改根包声明后运行 `pnpm install` 更新根锁文件；profile 的本地依赖通过 `pnpm run setup` 登记。setup 初始化 Git 记录的子模块版本并安装 DSH 锁定依赖，执行前保存子模块中需要保留的工作。新代码包通过 `pnpm build:kmh` 生成声明的产物，再重新启动 Web 以发现新的产物目录。已有插件的源码修改在手动构建后通过 [Web 插件热更新](README.md#web-插件热更新)应用。

启动器的 `prepareProfiles` 从各 profile 的 `dependencies` 建立本地包链接，loader 从所选 profile 的 `node_modules` 解析模块。根工作区负责自有包的构建和测试；profile 负责运行时插件与 bundle 的包解析。

## 验证入口

在 Kongming 根目录检查包导出时，将 profile 和包名替换为实际对象。子 shell 保持后续命令在仓库根目录执行：

```sh
(cd profiles/<profile> && node -e "import('@kmh/<name>').then(m => console.log(Object.keys(m)))")
```

对 Web 配置使用 `pnpm config:web` 核对合成条目，对运行实例结合插件面板与[运行日志](runtime-records.md)核对激活状态。模块导入失败时检查 profile 依赖、实际包链接与导出对应的产物。单包行为由根入口收集的测试验证，Web 用户流程使用实际浏览器验证。

本指南随包构建、依赖登记和 profile 接入方式更新。
