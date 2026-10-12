---
description: KMH 数据目录、运行日志与父进程环境的影响，以及启动和迁移后的验证方法。
---

# 数据目录与运行记录

`KMH_HOME` 直接指向最终数据目录。启动器按环境变量、仓库根 `.env.local` 的 `KMH_HOME` 行、系统账户默认 `~/.kmh` 的顺序解析，将同一绝对路径传给 `DSH_HOME`。显式设置支持绝对路径和 `~/` 前缀；相对路径会报错。切换目录需要重新启动 KMH。

```sh
KMH_HOME=/absolute/runtime-home pnpm web
```

需要持久覆盖又不随版本控制分发时，写入仓库根 `.env.local`（该文件被 git 忽略），每行一条 `KMH_HOME=路径`，`#` 开头的整行注释被忽略，空值回到默认目录：

```sh
KMH_HOME=~/.kmh-dev
```

环境变量始终优先于该文件，因此显式设置 `KMH_HOME` 的启动脚本（如独立部署的稳定实例）不受影响。

系统账户目录、KMH 数据目录与任务工作目录各自承担独立用途：系统账户目录保存操作系统和外部工具的用户身份，KMH 数据目录保存应用状态，任务工作目录决定 Agent 在哪个项目中执行操作。启动器通过系统账户信息解析默认目录，调用者的 `HOME` 与当前目录各自保留。

## 目录归属

cli、web、sdk 短命令所选的三个 profile 将运行记录配置到同一个数据目录。表中的路径相对于 `KMH_HOME`。

| 路径 | 内容与写入方 |
| --- | --- |
| `logs/<profile>-<时间>-<随机后缀>/` | 每次启动的 `stdout.log`、`stderr.log`、`launch.json` 与 `exit.json`，由 KMH 启动器写入 |
| `logs/launcher-error-<时间>-<随机后缀>/stderr.log` | 启动器异常记录 |
| `logs/plugins/runtime-<pid>.jsonl` | Cordis 插件的名称、级别、时间和文本，由 `@kmh/runtime-log` 写入 |
| `logs/kmh-echo/events-<pid>.log` | `kmh-echo` 生命周期记录 |
| `logs/plugin-manager/<profile>/` | 插件安装的 pnpm 与 Git 完整诊断；每次操作使用独占子目录 |
| `sessions/` | Session JSONL 日志及压缩文件，由 session-persistence 写入 |
| `storages/` | 设置、workspace、schedule 等非会话持久数据 |
| `attachments/v1/`、`cache/attachments/` | 附件与附件缓存 |
| `.credentials.yaml`、`.anonymous-user-id` | 模型凭据与匿名身份 |
| `zcode-cli/` | ZCode provider 的会话和工具状态，内部使用 `.zcode/v2/` |
| `codex-cli/` | Codex provider 的会话-thread 绑定（`codex-bindings.json`）、详情页选择（`codex-settings.json`）与裁剪后模型目录（`kmh-models.json`） |
| `spill/` | 超长工具输出与溢出文件 |
| `tmp/` | 使用系统临时目录 API 的 KMH 子进程临时文件 |
| `profiles/<name>` | 指向 Kongming 仓库 profile 源目录的链接 |

profile 的配置、依赖清单和安装协调状态仍由该 profile 拥有。链接后的 `package.json`、`cordis.patch.yml`、`node_modules/` 与 `.plugin-manager/run.json` 位于仓库 profile，安装锁由同一物理文件协调。不同数据目录访问同一份 profile 时共享这些配置和依赖。

Agent 创建的项目文件由任务工作目录和工具参数决定。外部程序自己的用户文件、操作系统诊断与第三方服务记录各自由对应程序管理；官方 CLI 子进程自行在用户 home 保存运行日志与模型 I/O 记录，不写入 KMH 数据目录，路径与检索方式见 [zcode-cli 包说明](../../packages/zcode-cli/README.md)与 [codex-cli 包说明](../../packages/codex-cli/README.md)（`~/.codex/sessions` 会话记录）。home 级 patch 或 `--patch` 可显式覆盖表中服务的路径；上述表格描述 cli、web、sdk 短命令所选 profile 的默认配置。

## 日志与失败处理

启动器同时将子进程输出逐字节写入私有日志并转发给调用端。SDK 标准输出保持原有 JSON-RPC 字节；调用端仍可保存自己的输出副本。`launch.json` 保存目录、运行模式与 Node 版本，`exit.json` 保存退出状态和信号；启动器仅在子进程结束后写入退出记录。启动器将停止信号转发给子进程并返回其退出状态。

日志目录创建失败会阻止启动。运行中写入进程输出失败会请求子进程停止并返回失败；插件日志写入失败会撤回对应导出器并报告原始错误。日志可能包含模型和工具内容，应按用户数据保存。新建私有目录权限为 `0700`，日志文件权限为 `0600`；已有文件的权限保持原状。

进程日志使用每次启动独占的目录，插件文件按进程编号追加。KMH 保留既有日志，长期运行时由部署方管理保留期限。正常运行的临时文件和 spill 清理由对应 provider 的策略负责。

## Web 后台启停

仓库根目录的 `kmh.sh` 管理脱离终端运行的 KMH Web，其余子命令透传给 `scripts/kmh.mjs`。执行前准备 Node.js、Python 3、Bash、`lsof` 和构建后的 DSH CLI、自有插件；supervisor 通过 `node scripts/kmh.mjs web --no-open` 加载 `launch.config.json` 选择的 Web profile。Kongming 维护该脚本，运行时实现与构建由 DSH 子模块提供。

```sh
./kmh.sh start
./kmh.sh status
./kmh.sh restart
./kmh.sh stop
```

也可以使用 `bash /absolute/path/to/kongming-agent/kmh.sh status` 从任意目录调用。脚本按自身文件位置定位仓库，转发调用环境、输出和退出状态；不带参数或传入 `-h/--help/help` 时展示可用操作。`start/stop/restart/status` 之外的子命令连同参数透传给 `scripts/kmh.mjs`（如 `./kmh.sh web` 前台启动 Web、`./kmh.sh cli`），由其校验参数并返回真实退出状态。

脚本默认检查 3080 端口。调整 profile 的 `webserver.config.port` 后，同时设置 `KMH_WEB_PORT` 为对应端口；该环境变量只选择启停脚本检查的端口。每次操作使用同一个 `KMH_HOME` 和 `KMH_WEB_PORT`。`KMH_HOME` 的解析规则与 KMH 启动器一致。

`KMH_HOME/logs/web-supervisor/` 保存 `web.pid`、`web-server.log` 与异常退出的 `crash-*.md`。正常停止释放 PID 记录；异常退出保存日志尾部，保留最近 50 份崩溃报告并等待人工处理。每次启动截断 supervisor 的运行日志；KMH 启动器另外保留前文定义的每次启动独占日志。

端口已被占用时启动报错。停止操作核对 PID 记录与 supervisor 命令，再通知受管进程组退出；supervisor 缺失或命令与 PID 记录不匹配时，脚本报错并保留现有进程。启动等待 60 秒、停止等待 20 秒后仍未达到预期状态时，检查 supervisor 日志、PID 和端口，再人工处理。`restart` 在停止成功后启动新进程。

## 父进程影响

数据目录由 KMH 启动器固定，任务和外部工具需要的环境继续转发。

| 输入 | 生效方式 |
| --- | --- |
| `KMH_HOME` | 非空值直接选择应用数据目录；空值先读取仓库根 `.env.local`，再使用系统账户默认目录 |
| `DSH_HOME` | 启动器覆盖为解析后的 `KMH_HOME` |
| `ZCODE_DATA_BASE_DIR` | 启动器覆盖为 `KMH_HOME/zcode-cli` |
| `TMPDIR`、`TMP`、`TEMP` | 启动器覆盖为 `KMH_HOME/tmp` |
| 当前工作目录 | 保留调用者目录，影响任务目录、项目 `.env` 与相对工具路径 |
| `HOME` | 保留调用者值，供外部工具查找登录信息与自身配置；KMH 默认数据目录通过系统账户信息解析 |
| 模型凭据 | DSH 按进程环境、工作目录 `.env`、数据目录 `.env` 的顺序读取，前层优先 |
| `PATH`、`SHELL` | 影响外部程序与 Shell 的选择 |
| `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 及其小写形式 | KMH 启动器统一设为空字符串，进程以直连方式访问网络；空值优先于数据目录 `.env`，防止代理被再次补入 |
| `NODE_USE_ENV_PROXY` | KMH 启动器固定为 `0` |
| TLS、其他 Node 启动选项 | 保留调用者设置，影响 TLS 信任与 Node 启动行为 |
| `DSH_PERMISSION_MODE`、`DSH_TOOLS_MODE` | 继续由 DSH 配置读取；以最终 profile 展开与 Session 设置为准 |
| `DSH_TELEMETRY_MODE`、`DSH_TELEMETRY_OTLP_URL`、`DSH_PRODUCT_ANALYTICS_OTLP_URL` | 影响遥测模式与接收端；运行记录的本地目录由 KMH 配置固定 |
| `DSH_CLIENT_VERSION` | 影响 Web 客户端显示与遥测版本 |
| macOS 隐私权限 | 由系统授权给实际启动程序，影响电脑操作与屏幕访问 |

`KMH_HOME` 在启动环境中设置。启动器解析数据目录后，DSH 才加载 `.env`；部署时应在启动命令或服务环境中选择该目录。

## 验证与适用范围

`pnpm profiles` 显示解析后的运行数据目录，`pnpm config:web` 展示 Web 最终配置。`pnpm test` 验证公开 SDK 入口中的目录隔离、真实 Session 持久化、日志保存、JSON-RPC 输出与退出行为；这项验证使用本地测试插件完成持久化，模型调用另行验证。

源码启动与构建后的 `pnpm cli`、`pnpm web`、`pnpm sdk` 共用 KMH 启动器。打包时必须包含 `scripts/runtime-home.mjs`、`scripts/runtime-logs.mjs`、`packages/runtime-log/` 和对应构建产物。DSH Desktop 的原生外壳采用自己的启动与崩溃记录机制；该外壳的日志路径由 DSH Desktop 文档负责。

旧目录保留与迁移见[运行数据目录升级](runtime-home-upgrade.md)。
