# kongming-os

kongming-os 用于构建可组合的 Agent 运行环境，当前应用层沿用 KMH 插件、配置与启动入口。Kongming 的后端由完整 DeepSeek Harness 提供。Kongming 管理启动入口、profile、自有 bundle 和业务插件；DSH 底座以 Git 子模块固定版本。

## 当前依赖状态

Codex CLI 与 Web Bundle 只依赖固定子模块提交中的 DSH 公开包，不需要额外的 DSH 扩展；Codex 工具开关由 `@kmh/codex-cli` 自行读取配置并在拉起官方 CLI 时过滤工具。当前 KMH 的启动、配置与维护说明见 [底座接入](docs/kmh/README.md)。

## 安装与启动

需要 Git、Node.js `^22.19 || >=24` 和 pnpm `11.7.0`。

```sh
git clone --recurse-submodules https://github.com/KtKID/kongming-os.git
cd kongming-os
pnpm install --frozen-lockfile
pnpm run setup
pnpm run build
pnpm run cli --help
pnpm run cli "检查当前项目"
pnpm web
```

`cli` 使用 DSH 的一次性 headless 任务入口，`web` 使用 DSH 自带 Web，`sdk` 使用 DSH JSON-RPC 入口。模型凭据可放在忽略的 `.env` 中，也可通过环境变量提供；DSH 官方模型使用 `DEEPSEEK_API_KEY`。自有客户端插件通过 `./client` 导出接入 DSH Web，当前能力见[插件索引](docs/kmh/plugin-index.md)。

`pnpm run setup` 在 Git 子模块布局下会停在 DSH 根 `postinstall` 的 lefthook 安装（报 `core.worktree` 与 `extensions.worktreeConfig` 冲突）；此时依赖已装齐，lefthook 只是 DSH 自己的 Git 钩子。在 `third_party/dsh` 内运行 `pnpm install --frozen-lockfile --ignore-scripts` 补齐安装状态后继续 `pnpm run build`。Web profile 清单里的注册表 Bundle（如 `dsh-context`）随根目录工作区安装，依赖归属见[启动与构建](docs/kmh/README.md#启动与构建)。Codex 插件的固定程序安装入口见[运行包说明](packages/codex-cli/bin/README.md#安装)。

## 目录归属

| 目录                 | 职责                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `third_party/dsh/`   | 完整 DSH Git 子模块，自有 Fork 的 `kmh/runtime-core` 维护分支                             |
| `profiles/`          | Kongming 管理的 profile 清单、依赖与模式覆盖                                              |
| `bundles/dsh-web/`   | Web 的 DSH 基础插件树、四个基础预设和 persona                                             |
| `bundles/kongming/`  | Kongming 应用层 bundle，当前定义产品 persona                                              |
| `packages/`          | Kongming 自有模型、日志、提示词、团队插件与开发预设 bundle                                |
| `scripts/kmh.mjs`    | 安装、构建、profile 注册与启动                                                            |
| `launch.config.json` | cli、web、sdk 短命令对应的 profile                                                        |
| `.kmh/`              | 旧运行数据与本地迁移备份，Git 忽略；当前数据目录见[运行记录](docs/kmh/runtime-records.md) |

可提交的 profile 直接位于 Kongming；启动时在 `$KMH_HOME/profiles/` 建立指向这些目录的链接。profile 中的本地包链接按其 dependencies 登记，包含自有插件、bundle 和声明的 DSH 本地包；DSH 自带依赖使用子模块自己的安装。重复启动保留 profile 内容，已有独立 profile 目录冲突时立即报错。

Web 基础配置位于 `bundles/dsh-web/cordis.patch.yml`，包含 base、Web 和四个基础预设；`profiles/kmh-web/cordis.patch.yml` 管理 KMH 自有插件与部署覆盖，Bundle 组合由同目录 `package.json` 的 `dsh.profile.bundles` 选择。端口编辑 `webserver.config.port`，默认 `60000`；浏览器打开方式编辑 `web-runtime.config.openBrowser`。原版对照位于同目录 `upstream.cordis.yml`，字段说明见 [Web 配置](profiles/kmh-web/README.md)。

```sh
pnpm run profiles
pnpm config:web
KMH_HOME=/absolute/runtime-directory pnpm web
pnpm run dsh --profile kmh-headless --dump-config
pnpm test
```

当前系统说明见 [Kongming 架构](docs/architecture/kongming-runtime.md)，完整 Web 插件说明见 [插件索引](docs/kmh/plugin-index.md)，配置与升级流程见 [DSH 底座接入](docs/kmh/README.md)。

运行 `pnpm hooks` 安装当前 Node Git 钩子：提交时检查暂存格式与脚本语法，推送前运行启动集成测试。
