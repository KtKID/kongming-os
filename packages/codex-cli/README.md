---
description: 在 KMH 使用本机官方 Codex CLI 登录的模型：挂载配置、隔离开关、原生工具审批与逐项选择、生图展示、token 用量与会话连接状态小球，以及差分续聊与故障排查入口。
---

# @kmh/codex-cli

## 概述

在 KMH 里使用本机官方 Codex CLI 的模型对话：KMH 保留系统提示、工具权限与回合控制，Codex 承担模型推理与原生历史管理。工具以动态工具回调交回 KMH 执行；多轮对话经差分游标只投增量，进程重启后续聊不丢上下文。

选择本包的代价与边界：共享用户 `~/.codex`（登录、配置、原生会话记录都在那边），用户配置的 MCP 设备对模型可见；一切隔离经进程 `-c` 参数注入，仅影响单次调用，不修改任何 Codex 配置文件。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [验证插件](#verify-the-plugin)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

---

<a id="use-this-package"></a>

## 使用本包

### 何时选择

需要用已在本机 Codex 登录的 OpenAI 模型（gpt-6 系列等）且保持 KMH 主控时选择本包。模型凭据走 DeepSeek 官方 API 时改用上游 llm provider；需要 ZCode 侧模型时改用 `@kmh/zcode-cli`。

### 配置

在 `profiles/<name>/cordis.patch.yml` 挂载（kmh-web 已内置）：

```yaml
- id: kmh-codex-cli
  name: "@kmh/codex-cli"
  config:
    # 本机 PATH 里的 codex 损坏时改为绝对路径（如 ChatGPT.app 自带二进制）
    command: codex
    cwd: !!js process.cwd()
    dataDir: !!js dshHomePath('codex-cli')
```

| 配置键                   | 默认值    | 含义                                                                                                     |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------- |
| `command`                | `codex`   | 官方 CLI 可执行文件；损坏或不在 PATH 时写绝对路径                                                        |
| `cwd`                    | 必填      | 无会话身份时子进程的工作目录；会话请求跟随会话自身目录                                                   |
| `dataDir`                | 必填      | 绑定记录与裁剪目录的数据目录                                                                             |
| `model`                  | `""`      | 空=模型目录首选；非空固定为该模型                                                                        |
| `nativeToolsEnabled`     | `false`   | 旧总开关：仅作逐项选择的迁移默认（true=已支持项全选），详情页保存后以 `dataDir/codex-settings.json` 为准 |
| `defaultMaxTokens`       | `1000000` | 会话默认输出上限                                                                                         |
| `reasoningSummary`       | `auto`    | 官方思考摘要模式：auto、concise、detailed、none；none 关闭可见摘要请求                                   |
| `startupTimeoutMs`       | `20000`   | 启动与 initialize 握手时限                                                                               |
| `requestTimeoutMs`       | `360000`  | 单次生成总时限，包含排队、启动与官方重试；主对话、标题及压缩评估共用此限制，收尾另有时限                 |
| `cancelReceiptTimeoutMs` | `5000`    | 停止后等待 interrupted 终止通知的时限                                                                    |
| `cleanupTimeoutMs`       | `5000`    | 进程干净退出的等待时限，超时强制回收                                                                     |
| `probeTimeoutMs`         | `15000`   | 测试连接与目录探针时限                                                                                   |
| `probeMaxTokens`         | `1`       | 测试连接请求传递的输出上限                                                                               |
| `loginTimeoutMs`         | `1200000` | 官方授权页完成登录的等待时限                                                                             |
| `graceMs`                | `1500`    | 子进程托管终止宽限                                                                                       |
| `env`                    | `{}`      | 追加到 CLI 进程的环境变量                                                                                |

### 会话能力

- **流式正文与思考摘要**：正文、可提供的思考摘要随官方 CLI 增量返回。用户选择的推理等级传入每次官方回合；摘要内容以模型实际提供为准。
- **原生工具审批**：启用原生命令执行或文件修改后，「请求审批」使用工作区沙箱，额外权限申请在 KMH 弹出审批卡片；「帮我审批」对应官方 `--approve-for-me`，使用工作区沙箱与 Codex 自动审查，通过后执行、拒绝后返回结果；「完全权限」使用完整访问范围并跳过审批询问；「仅可查看」使用只读沙箱，额外权限申请交用户决定。设置在下一回合读取，KMH 工具继续遵循宿主权限策略。
- **图片直接入会话**：原生图片生成的产物作为图片块出现在对话里（附实际像素尺寸说明），可点击查看与保存原图。
- **token 用量与会话状态**：每轮回复显示用量药丸（含缓存命中率）；会话底部连接小球以绿、灰、红区分通信、停止与异常。官方重试期间直接显示“连接失败，正在重试”与原因，恢复输出后回绿；最终失败保留原因，用户可再次发送。等待首段响应和重试期间均可停止。超时返回 `CODEX_REQUEST_TIMEOUT`，随后中断与进程回收分别受收尾时限约束。

### 详情页

Web 插件管理区提供 Codex CLI 卡片：CLI 版本（对照支持基线 0.160.0）、账号状态与凭据来源、默认模型、最近连接测试结果、原生能力逐项选择（命令执行、文件修改、查看图片、网络搜索与独立的原生技能，每项显示可用状态），以及登录/取消登录/退出账号/测试连接。调整立即保存并下一回合生效，进行中的回合保持原选择；原生图片生成默认保留。账号状态按 `~/.codex/auth.json` 存在性判定，打开页面不发起模型请求；退出账号作用于本机官方 Codex CLI 的登录态。

---

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释该包如何实现上述行为；可观察约定已在[使用本包](#use-this-package)中说明。

数据流：DSH agent-loop 每次调用携带全量历史，adapter 用差分游标（逐条消息指纹）对齐已投前缀，只把尾部增量投给 Codex——新用户输入发起 turn，工具结果作为挂起中 `item/tool/call` 服务端请求的延迟回执写回，同一 turn 内续推；system 提示与工具目录在 thread 创建时一次性绑定。会话与 Codex thread 的绑定（thread id、游标、fork 边界）持久化在 `dataDir/codex-bindings.json`，进程重启后恢复；历史被改写（编辑/重发）时经 `thread/fork` 原生分叉重建，失败则新建 thread 并注入序列化的重建历史。

隔离在每次进程启动时经 `-c` 参数注入：vendored 官方模型目录按"直通"形态改写（消灭原生 shell、Code Mode、多 agent 等），功能与捆绑技能逐项关闭，会话范围发现的原生技能与用户钩子按路径/键逐个禁用；裁剪范围由详情页保存的逐项选择决定，未选中的原生能力仍被关闭；旧总开关 `nativeToolsEnabled` 打开时等价于已支持项全选、跳过全部原生裁剪。

token 用量：`turn/completed` 的 turn 不携带用量（0.162 wire 实测），逐响应用量来自 `thread/tokenUsage/updated`（`last` 分项）。桥维护未消费样本队列，每个 step 收尾（工具挂起或回合终局）恰产出一条 usage chunk：队列空补零样本、终局合并全部剩余，保证各步样本之和恒等于回合总量且携带 `totalTokens`（KMH 折算校验必需）。

会话底部状态由 `conversation.composer.dock` 公开槽位（order 2）注册的 `LiveBall` 展示，2 秒轮询 `GET /api/codex-cli/live`，按当前 sessionId 过滤。Host 与 Client 共用 `live-state.ts` 的响应校验；`retrying` 标记官方重试，`streaming` 在等待重试期间保持 true。宿主停止以 `AgentCancelCause` 对象经 `signal.reason` 传递；流等待监听中止信号并清理监听器。请求超时覆盖排队等待；取消排队项后，后继项仍等待当前消费方交还执行权。重试次数与退避由官方 CLI 管理。

图片生成结果的展示：Codex 原生 `image_gen.imagegen` 工具在默认隔离下即对模型可用（托管 API 调用，无本地执行与审批）。生成产物由 Codex 落盘到 `~/.codex/generated_images/<threadId>/`；桥在收到对应 `item/completed` 通知时读取落盘文件、经宿主附件服务（`ctx.attachments.saveImages`）落成 `ImageAttachmentRef`，并以 image 内容块送回 KMH，会话内直接展示该图片（2026-10-08 真机闭环：叙述块、image 块与尺寸附注并存渲染）。投影是展示增强：读取或入库失败时跳过并告警（落盘路径即恢复入口），生成与续推链路不受影响；同一生图项按 id 去重，一回合多张图片逐项展示。注意：image 块使用独立流块索引（`<id>:image`）——与叙述块共用 item id 的索引会让组装器按先关先赢丢弃 image 块。

| 模块                                                | 职责                                             |
| --------------------------------------------------- | ------------------------------------------------ |
| `src/connection.ts`                                 | 行协议连接：进程、握手、双向请求分发、回收       |
| `src/cursor.ts`                                     | 差分游标：前缀对齐与增量切分                     |
| `src/turn.ts`                                       | 回合状态机：挂起回执、续推、interrupt、fork 重建 |
| `src/isolation.ts`                                  | 工具/技能/钩子隔离的参数生成与核对               |
| `src/adapter.ts`                                    | LlmAdapter：模型映射、流投影、会话驱动           |
| `src/approval.ts`                                   | 审批桥：原生审批请求转 KMH 用户决定              |
| `src/tool-registry.ts` / `src/capabilities.ts`      | kmh- 工具声明表与原生能力逐项选择                |
| `src/native-items.ts` / `src/image-delivery.ts`     | 原生执行叙述与生图产物投影                       |
| `src/session-store.ts`                              | 绑定与游标持久化                                 |
| `src/account.ts` / `src/probe.ts` / `src/status.ts` | 账号操作、测试连接、版本基线检查                 |
| `src/web.ts` / `src/client/`                        | 详情页路由、详情卡片与状态小球                   |

### 构建与验证

在 Kongming 根目录运行：

```sh
pnpm build:kmh
pnpm typecheck:kmh
pnpm lint
pnpm test
```

测试位于主仓 `tests/runtime/codex-cli.test.mjs`，含真实 CLI 冒烟（本机存在官方 Codex CLI 时执行，否则跳过）：差分投递 → 工具挂起 → 回执续推 → 最终回复，并核对模型只声明 KMH 工具与已接受的 MCP 设备。运行中的排查入口：`~/.codex/sessions/<日期>/rollout-*.jsonl`（`originator: kmh_codex_cli` 标识插件的会话）、`/api/codex-cli/status` 与 `/api/codex-cli/live`（连接状态）路由、KMH 数据目录的 `codex-cli/`。Client 改动需要重新构建并在浏览器实际验证。

</details>

---

<a id="verify-the-plugin"></a>

## 验证插件

完成仓库初始化和 DSH 构建后，在仓库根目录运行本包测试。测试需要本机官方 Codex CLI；`KMH_CODEX_BINARY` 可以指定程序绝对路径，默认检查 ChatGPT.app 内程序及 PATH。程序缺失时测试明确报错。

```sh
KMH_CODEX_TEST_TMP=/private/tmp/kmh-codex-retry-20261009 pnpm --filter @kmh/codex-cli test
```

测试位于 [`test/`](test/stream-reasoning.test.mjs)，使用真实 Cordis 服务、插件 adapter 和官方 app-server，模型响应来自本地 Responses 服务。完成门控制响应结束时机，分别核对官方通知与插件增量在完成前到达；调用结束后读取原生 session，检查首次、恢复、重建的思考等级及摘要模式。官方 `ultra` 在 session 中保留原值，在 Responses 请求中映射为 `max`。[重试测试](test/retry-status.test.mjs)覆盖真实 503、恢复、重试耗尽、首段前停止、重试期间停止，以及主请求和辅助请求超时；客户端 bundle 渲染测试检查中英文可见原因。生产模型访问与浏览器显示由真实环境验收。

`KMH_CODEX_TEST_TMP` 必须为绝对路径，省略时使用系统临时目录下的 `kmh-codex-cli-tests`。每项 smoke 建立独立子目录，并将 `CODEX_HOME` 指向其 `codex-home/`；测试保留这些目录，登录与响应服务使用隔离的测试配置。

| 记录                                               | 内容                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `codex-home/sessions/**/*.jsonl`                   | 官方原生 session，包含 `turn_context.effort`、`summary` 与任务结束记录 |
| `upstream.jsonl`                                   | 本地模型服务收到的实际请求                                             |
| `notifications.jsonl`                              | 官方 app-server 通知及接收时间                                         |
| `app-server.stdout.jsonl`、`app-server.stderr.log` | 原始通信与进程诊断                                                     |
| `plugin-stream.jsonl`                              | 流式用例的插件输出、时间及当时上游是否完成                             |

根目录 `pnpm test` 同时执行本包测试。维护者可以在复查结束后删除对应临时子目录。

本轮需求与实际验证记录见 [流式与思考等级回归](../../docs/spec/codex-cli-provider/tasks/task-stream-reasoning-regression.md)和[重试、停止与超时](../../docs/spec/codex-cli-provider/tasks/task-retry-status.md)。

---

<a id="further-exploration"></a>

## 进一步探索

- [需求与验收场景](../../docs/spec/codex-cli-provider/spec.md)——功能行为的唯一事实源，任务拆解在其 tasks/ 下。
- [生效技术决策](../../docs/spec/codex-cli-provider/decisions.md)——执行归属、共享登录、隔离、审批、进度与图片交付的最终决策及依据。
- [运行记录](../../docs/kmh/runtime-records.md)——数据目录与日志路径的通用规则。
- [Kongming 的 DSH 底座](../../docs/kmh/README.md)——自有插件与 profile 的装配关系。
- [`@kmh/zcode-cli`](../zcode-cli/README.md)——相邻模型提供方，凭据体系与取舍的对照。

官方协议：Codex app-server v2（`codex app-server --stdio` 行协议），支持基线为 0.160.0；包内测试核对本机指定版本的协议和原生会话行为。

---

<a id="model-experience"></a>

## 模型体验

### 模型看到什么

模型接收 KMH 组装的 system 提示与工具目录，两者在 thread 创建时一次性绑定。KMH 工具以动态工具回调声明，执行交回 KMH 的权限与审批链。默认隔离下原生 shell、改文件、多 agent 等工具不再声明；逐项开启的原生能力与 KMH 工具并存，其提权操作同样进入 KMH 审批。用户在 `~/.codex` 配置的 MCP 设备对模型可见；原生图片生成工具在默认隔离下即可用。

### Token 影响

多轮对话经差分游标只投增量，已投前缀不重复计费。每轮回复显示用量药丸（含缓存命中率）；各步用量样本之和恒等于回合总量。会话默认输出上限为 `defaultMaxTokens`（1000000）。上下文压缩由 Codex 在业务 thread 内原生执行；KMH 侧发起的压缩评估与标题生成走独立临时会话，不触碰业务绑定。

### KV Cache 影响

业务 thread 原生续推：KMH 不重放全量历史，新增输入与工具结果追加在 Codex 侧历史之后，前缀可复用。历史被改写（编辑/重发）时经 `thread/fork` 分叉重建，从新基线重新累积；工具表在会话中途变化同样要等基线重建后模型才可见。

---

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

这些限制说明何时需要特别留意；它们是当前包约束，不是任务积压。

- **支持基线为官方 CLI 0.160.0**——vendored 模型目录随包分发；包内测试验证指定 CLI 的协议、流式与原生日志，真实模型服务由部署环境验收。
- **共享 `~/.codex` 的连带**——用户 MCP 设备可见（`-c` 无法压掉且清空覆盖会重置用户禁用状态，已拍板接受）；用户与项目级钩子在每回合前经探针发现并逐键禁用，只覆盖当轮发现的键。
- **工具目录绑定在 thread 创建时**——会话中途工具表变化要等基线重建后模型才可见。
- **登录状态按凭据存在性判定**——只检查 `~/.codex/auth.json` 存在与可解析，不校验有效性；「测试连接」才发起真实模型请求。
- **只读红线**——绝不写入或修改用户 `~/.codex`；一切注入经 `-c` 进程参数单次生效。
- **待验证**——真实压缩触发观察（需真模型长上下文）、分钟级工具挂起时 Codex 侧超时行为。

---

<a id="dev-note"></a>

## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

- canonical namespace 注册的模型侧名称是无点拼接，已回退平铺真名。

</details>
