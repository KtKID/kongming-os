# Kongming 的 DSH 底座

[当前架构](../architecture/kongming-runtime.md) 描述运行链路与维护归属，[插件索引](plugin-index.md) 按功能模块解释完整 Web 配置。

Kongming 引用完整 DSH 仓库，包含 packages、apps、vendor、native、构建工具、锁文件和测试。Git 子模块位于 `third_party/dsh`，来源为 `https://github.com/KtKID/deepseek-harness.git`，维护分支为 `kmh/runtime-core`；Kongming 的 Git 提交记录固定的子模块 SHA。

## 启动与构建

```sh
pnpm install --frozen-lockfile
pnpm run setup
pnpm run build
pnpm run cli "任务内容"
pnpm web
pnpm run sdk
```

`setup` 初始化固定版本子模块、安装子模块自己的锁定依赖，再登记 profile；`build` 依次构建 DSH 和 Kongming 自有插件。入口使用构建后的 `dsh` CLI 和受支持的 profile，子进程继承调用者工作目录、环境变量和模型凭据，返回真实退出状态。SDK 模式使用标准输入输出传输；启动器保留协议字节，同时保存进程输出。目录与父进程环境规则见[数据目录与运行记录](runtime-records.md)。

`pnpm hooks` 安装当前 Node Git 检查；原 Python 钩子保存在本地迁移备份中。

Web 后台管理使用 `./kmh.sh start|stop|restart|status`（其余子命令透传给 `scripts/kmh.mjs`，如 `./kmh.sh web` 前台启动、`./kmh.sh cli`），前置条件、运行记录和失败处理见 [Web 后台启停](runtime-records.md#web-后台启停)。

DSH 与 Kongming 使用各自的 pnpm 工作区和锁文件。Kongming 根工作区包含 `bundles/*` 与自有 `packages/*`，DSH 的 Cordis、基础包、native 和构建配置归子模块所有。

## DSH 技能

[DSH 技能接入](skills.md) 说明 Kongming 如何发现子模块技能、解析配套文件、执行翻译检查，以及处理初始化和链接问题。

## profile 与 bundle

根目录 `launch.config.json` 指定 `cli`、`web`、`sdk` 短命令对应的 profile。`profiles/kmh-headless` 选择 DSH base + headless，`profiles/kmh-sdk` 选择 base + sdk-app，两者最后叠加 `@kmh/bundle-kongming`。bundle 清单中的 `dsh.bundle.patch` 指向自身的 `cordis.patch.yml`，profile 的 `dependencies` 使用 `link:../../bundles/kongming` 选择本地包。

Web profile 的 bundles 为 `[]`，`profiles/kmh-web/cordis.patch.yml` 完整展开 base、Web、四个预设和 Kongming persona。编辑此文件管理 Web 的插件和部署配置：`webserver.config.port` 默认 `3080`，`web-runtime.config.openBrowser` 控制打开浏览器。原版配置保存在同目录 `upstream.cordis.yml`，字段说明见 [Web profile](../../profiles/kmh-web/README.md)。运行 `pnpm web` 启动，`pnpm config:web` 查看最终配置。

headless/SDK 的共同应用配置编辑 `bundles/kongming/cordis.patch.yml`，模式覆盖编辑相应 `profiles/<name>/cordis.patch.yml`。DSH 的 overlay 对目标条目的 config 整体替换，配置修改需要保留该条目所需的字段。机器偏好放在 `$KMH_HOME/cordis.patch.yml`，调用级覆盖通过 `--patch /absolute/path.yml` 提供。headless/SDK 层顺序为 DSH bundles → Kongming bundle → profile → home → 调用级 patch；Web 层顺序为完整 profile → home → 调用级 patch。

启动器在 `$KMH_HOME/profiles/<name>` 建立目录链接，运行数据目录由[KMH_HOME](runtime-records.md) 选择。profile 配置由 Kongming 版本控制，profile `node_modules` 和运行数据由 Git 忽略。已有同目标链接保持幂等；已有其他目录或目标时立即报错并保留原内容。运行 `dsh plugin --profile kmh-headless ...` 时，所选 profile 清单与 patch 的变化落在 Kongming，可按需审查和提交。

```sh
pnpm run profiles
pnpm run dsh --profile kmh-headless --dump-config
pnpm config:web
KMH_HOME=/absolute/runtime-home pnpm web
```

新增业务插件归 Kongming 的 `packages/`，bundle 的 dependencies 声明实际使用的插件；插件通过 DSH 已有的服务、事件与 effect 扩展。DSH 的外部链接包解析使用运行时依赖提供 peer，插件的 TypeScript 开发依赖需要另行声明对应 DSH 包的本地开发引用。

[`kmh-echo`](../../packages/kmh-echo/README.md) 是三个 profile 共用的函数式生命周期示例，配置与日志用法见包 README。[`codex-cli`](../../packages/codex-cli/README.md) 把本机官方 Codex CLI 接为 KMH 模型提供方（经 `codex app-server --stdio` 行协议）：KMH 主控提示、工具权限与回合推进，工具以 dynamic tools 回调执行；共享用户 `~/.codex` 的登录与配置，隔离注入全部经进程 `-c` 参数单次生效；需求与验收见 [spec](../spec/codex-cli-provider/spec.md)。修改自有插件后使用 `pnpm build:kmh` 快速构建，`pnpm typecheck:kmh`、`pnpm lint` 和 `pnpm format:check` 检查自有代码，`pnpm test` 验证插件和启动链路。

## 版本升级

运行数据目录和日志配置的迁移步骤见[运行数据目录升级](runtime-home-upgrade.md)。

在 DSH 维护仓库的 `kmh/runtime-core` 上合入经过评估的 upstream 更新，运行受影响检查并提交、推送自有 Fork。随后在 Kongming 更新子模块检出版本、执行 setup/build 和启动测试，再提交新的子模块指针。

Web 的完整配置由 Kongming 管理。升级时导出新版 DSH Web 配置，与 `profiles/kmh-web/upstream.cordis.yml` 比较，再审查并合入实际 profile；更新后的原版对照与实际配置一起提交。

```sh
git -C third_party/dsh fetch origin kmh/runtime-core
git -C third_party/dsh checkout --detach origin/kmh/runtime-core
git add third_party/dsh
pnpm run setup
pnpm run build
pnpm test
git commit -m 'chore(runtime-core): 更新底座固定版本'
```

`.gitmodules` 的 branch 字段提供升级来源，普通 setup 按 Kongming 索引中记录的 SHA 初始化；升级时先登记目标指针，再执行 setup 与检查，检查通过后提交。更新前审查子模块本地修改并保存需要的工作。维护仓库未提交的修改在对应提交产生并更新指针后进入 Kongming。
