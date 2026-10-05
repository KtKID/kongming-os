# kmh-echo

Kongming 自有函数式 Cordis 插件，将自身生命周期阶段名字逐行追加到本地文件。headless、Web 和 SDK 三个 profile 均加载一个实例。

| 名字     | 触发时机                          |
| -------- | --------------------------------- |
| `apply`  | 插件入口执行                      |
| `effect` | 生命周期 effect 初始化            |
| `update` | 自身的 `internal/update` 监听执行 |
| `unload` | effect 清理函数执行               |

`apply`、`effect`、`unload` 是本插件的阶段标签，`update` 对应 Cordis 的 `internal/update`。每次配置更新依次追加 `update`、`unload`、`apply`、`effect`；直接重启依次追加 `unload`、`apply`、`effect`。卸载追加一次 `unload`，并撤回更新监听。

## 文件与配置

`config.file` 为必填的运行主机绝对路径。三个 KMH profile 将记录写入数据目录的 `logs/kmh-echo/`，目录规则见[运行记录](../../docs/kmh/runtime-records.md)。插件自动创建父目录，每次同步追加并刷新文件到磁盘；已有内容保留。新目录权限为 `0700`，新文件权限为 `0600`。文件保留与清理由部署方管理。

更新日志路径时，旧文件记录 `update` 和 `unload`，新文件记录 `apply` 和 `effect`。目录创建与写入错误由 Cordis 的加载、更新或清理路径报告。输出文件仅包含阶段名字，SDK 的标准输出由 JSON-RPC 服务使用。

在 `profiles/<name>/cordis.patch.yml` 中配置实例：

```yaml
- id: kmh-echo
  config:
    file: !!js dshHomePath('logs', 'kmh-echo', 'events.log')
```

也可将上述内容保存到本地 overlay，通过 `pnpm sdk --patch /absolute/echo.patch.yml` 覆盖路径。Web 实例在完整配置中，profile 清单通过 `link:../../packages/kmh-echo` 声明包。

## 构建与验证

在 Kongming 根目录运行：

```sh
pnpm install --frozen-lockfile
pnpm build:kmh
pnpm typecheck:kmh
pnpm lint
pnpm test
pnpm sdk

```

`pnpm build` 依次构建 DSH 底座和 Kongming 插件。插件复用子模块的 Cordis 与 Schemastery，本地包依赖使用 `link:`，底座的构建产物由 DSH 管理。测试覆盖真实 Cordis 生命周期、三次更新的监听清理、文件保留、路径校验、profile 配置，以及公开 SDK 启动和 shutdown。
