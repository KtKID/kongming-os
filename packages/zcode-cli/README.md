# @kmh/zcode-cli

通过本机官方 ZCode CLI 的 `workspace/generateText` 接口运行 KMH 模型请求。KMH 提供系统提示、工具定义、上下文与工具执行；CLI 提供模型通信，账号模块接入官方登录流程。

模型不写死：登录后插件查询账号模型端点（`{apiBaseUrl}/models`），与官方 CLI 内置配置中对应 Coding Plan 模板的模型清单取交集作为可用目录，目录首选即默认模型（BigModel 套餐当前为 `GLM-5.3`）。`model` 配置留空表示自动；填入具体 ID 则固定该模型。思考等级为 `high`。默认账号为 BigModel Individual Coding Plan，请求地址为 `https://open.bigmodel.cn/api/coding/paas/v4`。插件通过官方 CLI 的个人配置设置地址，再通过账号注册接口提供权益和模型信息。

## 使用

```sh
pnpm build:kmh
pnpm web
```

在现有「插件」列表打开 `kmh/zcode-cli`。点击「微信 / BigModel 登录」，二维码在当前配置区展开；在电脑打开「官方授权页」，选择微信登录并扫描官方显示的登录码。插件二维码用于打开授权页。授权完成后显示「已登录」；点击「测试连接」后，成功显示「模型请求已验证」。

模型选择器提供登录账号的动态模型目录（按官方模板顺序，官方模板缺失时按端点返回倒序）和 High 思考等级；重新登录后目录随新账号刷新。选择 ZCode 后，普通 KMH 会话继续使用原有 Agent 预设；宿主声明的工具全量透传给 CLI。系统消息由 KMH 组装并原样传递，宿主提供对应工具并执行返回的调用。

账号资料持久保存在插件数据目录，重启后仍可读取。数据目录没有账号时，插件只读借用桌面端 `~/.zcode/v2/credentials.json` 中的同套餐登录，配置区显示凭据来源为「复用桌面端登录」；桌面端重新登录后插件随下次读取自动更新。借用读取失败（文件缺失、格式变化或密钥不匹配）一律显示未登录，在插件内登录一次即写回插件数据目录并优先于借用。退出只清除插件数据目录，不影响桌面端登录。登录与连接测试分别执行。登录默认等待人工授权 20 分钟，超时显示 `ZCODE_LOGIN_TIMEOUT`；登录完成后模型连接显示「待验证」，点击「测试连接」即可检查。连接测试发送 `ping`、空工具列表，向 CLI 传递输出上限 1，并使用 `low` 思考等级（该模型支持 `low / high / max`）；思考 token 由模型产生；登录完成后开始计算独立的 15 秒探测时限，超时显示 `ZCODE_PROBE_TIMEOUT` 并保留已登录状态。登录进行中调用探测会返回 `ZCODE_LOGIN_REQUIRED`。会话请求未指定思考等级时使用配置的 `reasoningLevel`（默认 `high`）。模型目录首次解析发生在登录后的首次连接测试或模型请求；账号端点不可用时自动模式显示 `ZCODE_MODELS_ENDPOINT_FAILED`，显式 `model` 配置则跳过目录、退化为单模型请求。目录中选中模型返回套餐未开放（如官方错误码 1311）时，界面透出官方提示，改选目录内其他模型即可。界面显示插件错误码以及官方 CLI 返回的错误码和提示，凭据经过过滤。取消登录会等待登录流程结束，重试产生新的尝试身份。

官方 CLI 使用自身代理传输。插件为该子进程固定设置 `NODE_USE_ENV_PROXY=0`，保留宿主提供的 HTTP、HTTPS 代理地址和绕过列表。

每次模型请求在会话输入区下方显示当前阶段（「启动模型通道」「等待模型回复」），等待超过 `slowRequestMs` 追加慢请求提示，KMH 侧重试续接同一请求并显示「第 N 次尝试」。请求的终止原因至少区分用户停止、启动超时、模型请求总超时（`ZCODE_REQUEST_TIMEOUT`）、提供方错误、模型通道提前退出、宿主卸载与清理失败；首个生效原因保持不变，本机进程回收结果独立记录。认证后的 `GET /api/zcode-cli/requests` 返回全部请求的状态快照（阶段、尝试次数、等待起点与终止信息），客户端据此轮询展示。

## 配置

```yaml
- id: kmh-zcode-cli
  name: "@kmh/zcode-cli"
  config:
    cwd: !!js process.cwd()
    dataDir: !!js dshHomePath('zcode-cli')
```

`cwd` 与 `dataDir` 必须是绝对路径。`command` 默认 `zcode`，由宿主 subprocess 服务查找，真实路径用于发现官方 builtin 配置。其他安装形式可提供 `builtinConfigFile`。`personalConfigFile` 可指定已有官方个人配置作为来源；插件保留源文件，在数据目录生成 `kmh-model-provider.json`，为所选账号加入地址配置，并为动态目录里的每个模型加入规则把 `maxOutputTokens` 校验上限抬到 `defaultMaxTokens`（目录 ID 与源文件中官方大写拼写按小写归一后继承既有选项）。来源格式错误会显示 `ZCODE_PERSONAL_CONFIG_INVALID`。

带会话身份的模型请求把子进程工作目录和 `workspace` 标识切换到该会话创建时的工作目录（宿主 `sessions` 服务提供）。请求不带会话身份、宿主未挂载 `sessions`、会话头部没有目录或目录已被删除时，回落到配置的 `cwd`，请求不因此失败。登录、退出与连通测试始终使用配置的 `cwd`。

官方 CLI 0.16.9 将 `workspace/generateText` 的 `maxOutputTokens` 当必填项校验，缺省或超过合并后上限都会拒绝请求。因此插件对每条模型请求恒定携带输出上限：会话未指定时使用 `defaultMaxTokens`（默认 1000000），连接测试使用 `probeMaxTokens`。若调用方显式传入大于 `defaultMaxTokens` 的上限，需同步调高该配置值。

| 配置                            | 默认值                                      | 用途                                                               |
| ------------------------------- | ------------------------------------------- | ------------------------------------------------------------------ |
| model                           | （空）                                      | 空=登录后按动态目录自动选择；填 ID 固定该模型（如 glm-5.3-flash）  |
| providerId                      | account:bigmodel-individual-coding-plan     | 官方 Coding Plan 账号；支持 account:zai-individual-coding-plan     |
| apiBaseUrl                      | https://open.bigmodel.cn/api/coding/paas/v4 | 传给官方 CLI 的模型地址；Z.ai 账号需配置自己的 Coding Plan 地址    |
| reasoningLevel                  | high                                        | 官方模型思考等级                                                   |
| defaultMaxTokens                | 1000000                                     | 会话默认输出上限；个人配置同步抬高官方 CLI 的校验上限              |
| requestTimeoutMs                | 360000                                      | 模型请求总时限；从接收请求起算，到期停止并报 ZCODE_REQUEST_TIMEOUT |
| slowRequestMs                   | 30000                                       | 等待超过该时长在请求状态中标记慢请求                               |
| probeTimeoutMs / probeMaxTokens | 15000 / 1                                   | 连通测试时限和传递的输出上限                                       |
| loginTimeoutMs                  | 1200000                                     | 等待人工授权的时限                                                 |
| graceMs                         | 1500                                        | 进程结束宽限时间                                                   |
| maxLoginOutputBytes             | 32768                                       | 登录输出总上限                                                     |
| env                             | {}                                          | 官方 CLI 的显式环境设置                                            |

本机 CLI 0.16.9 的 `login` 命令使用 Z.ai 授权。BigModel 登录调用官方 OAuth 初始化、轮询和 Coding Plan 密钥解析服务，协议来源为固定版本的 [CLI OAuth](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/adapters/src/auth/cli-oauth.ts) 和 [账号密钥解析](https://github.com/zai-org/ZCode/blob/29628c9acdb81b703bbd4080c207a0e7ce5e276e/apps/zcode-cli/packages/adapters/src/auth/coding-plan-api-key.ts)。账号接口使用宿主网络，模型请求由本机官方 app-server 完成。

凭据保存在 `dataDir/.zcode/v2/credentials.json`，包含官方格式的加密账号身份和 Coding Plan 密钥；两端使用同一密码方案，未显式配置 `ZCODE_CREDENTIAL_SECRET` 时同机同用户的默认密钥一致，因此桌面端凭据可直接解开。登录令牌只在当次 Host 内存中保留。Host 在内存中响应 CLI 鉴权回调，Web 状态、错误及会话保持凭据隔离。退出调用官方 `logout --json`，作用于插件自己的数据目录。桌面端凭据键名（套餐段不带 `account:` 前缀）为逆向观察所得而非官方契约，官方变更格式时借用静默失效，表现为未登录，在插件内重新登录即可恢复。

当前真实验证版本为官方 CLI **0.16.9**。模型目录来自账号端点与官方内置模板，两者随账号套餐与 CLI 版本演进；目录中的模型需对应 Coding Plan 权益，端点列出但套餐未开放的模型在请求时由官方拒绝。官方账号存储和 app-server 协议随 CLI 版本演进。密码模块来自固定上游版本，来源和 Apache 许可证见 `vendor/zcode/NOTICE` 与 `vendor/zcode/LICENSE`。

## 子进程运行记录

官方 CLI 子进程自行保存两类记录，均写入用户 home 的 `~/.zcode/cli/`，与桌面端和独立 CLI 共用；插件设置的 `dataDir`（`ZCODE_DATA_BASE_DIR`）只作用于凭据与个人配置，不改变这两个位置。`log/zcode-<日期>.jsonl` 是按天滚动的进程运行日志，插件拉起的进程产生的记录可用 `"querySource":"kmh"` 字段过滤。`rollout/model-io-sess_<会话>.jsonl` 是模型 I/O 记录，每次模型请求追加一行完整 JSON，包含请求体（工具声明与消息原文）、响应文本和耗时。两类文件含对话明文，应按用户数据保存；空闲的 app-server 不写运行日志，日志中没有记录不代表子进程未启动。

CLI 0.16.9 没有日志路径命令行参数。运行日志目录可由环境变量 `ZCODE_LOG_DIR` 重定向（为 0.16.9 打包源码逆向所得而非官方契约），经插件配置 `env` 注入子进程生效；rollout 目录在同一源码中硬编码用户 home，无对应变量。插件直接排空 app-server 的 stderr，`ZCODE_LOG_CONSOLE` 的控制台日志输出在本插件中不可见。

## 独立分发

```sh
pnpm --filter @kmh/zcode-cli build
pnpm --dir packages/zcode-cli pack --out /tmp/kmh-zcode-cli.tgz
```

包公开导出 provider、`./client` 和可选的 `./prompt`。安装者需要兼容 Cordis/DSH 服务、官方 CLI 和自己的账号。包包含编译产物、类型、文档与许可证；运行数据留在每位使用者的数据目录。

宿主提供 `llm` 与 `subprocess`；`connection` 提供认证后的账号 API。标准 Client 加载器加载 `./client`，账号控件进入现有 Plugins 配置区。`./prompt` 通过 systemPrompt 的 complete section 注册“你是 kmh agent，底层是 zcode cli 里的模型”的完整提示，供安装者显式挂载；常规 KMH Web 使用其现有提示组成。

## 验证

`tests/runtime/zcode-cli.test.mjs` 覆盖工具声明透传、系统文本保留、工具往返、官方账号注册字段、模型目录解析（官方模板交集、端点失败回退、按请求选择模型）、个人配置保留、错误展示数据、取消、重试、超时、会话工作目录跟随与回落、桌面端凭据借用优先级与失败回落、Client 工厂。真实浏览器和模型验证结果见任务开发报告。
