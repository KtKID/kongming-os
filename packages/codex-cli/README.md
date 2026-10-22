---
description: 在 KMH 使用本机官方 Codex CLI 登录的模型：挂载配置、隔离开关、原生工具审批与逐项选择、生图展示、token 用量与会话连接状态小球，以及差分续聊与故障排查入口。
---

# @kmh/codex-cli

## 概述

在 KMH 里使用本机官方 Codex CLI 的模型对话：KMH 保留系统提示、工具权限与回合控制，Codex 承担模型推理与原生历史管理。工具以动态工具回调交回 KMH 执行；创建 KMH 会话时固定工具选择，后续回合恢复同一 Codex 会话和原工具，Codex 续用自己的历史。

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

### 工具选择

工具选择由本包自行管理：profile Config 的 `toolSelection` 记录 KMH（harness）与原生（native）两列的逐项开关；本包读取该配置，在拉起官方 CLI 时只把选中的 KMH 工具交给 Codex，原生工具按选择经 `-c` 隔离参数注入。Codex 详情卡片当前展示原生技能开关并写回 `/api/codex-cli/config`；完整开关清单的可视化由独立的 `cli-tools-selector` 插件提供（优先适配本包），为后续工作。KMH 工具按名称识别：公开工具注册表不暴露插件来源，新写入的 harness 行 `source` 固定为 `harness`，旧配置中的其他来源 id 按名称回退匹配。

首次使用会把已有 `codex-settings.json` 粗粒度工具选择导入 profile Config；原生技能保留原来的独立设置。配置中未出现的 KMH 工具默认开启（导入只覆盖当时可见的工具，缺行不关掉既有工具），未出现的原生工具默认关闭。工具开关仅对普通新建会话生效，已有会话保留创建时选择。准备失败或版本冲突明确报错；修正运行条件后可重试原会话，调整工具选择后普通新建会话。

### 配置

默认使用插件 [bin 目录中的固定官方 CLI](bin/README.md)，每次启动精确核对完整版本号；当前部署版本为 `0.163.0-alpha.10.2`，平台为 macOS arm64。程序与配套资源由插件目录持有，现有 Codex 登录、配置与原生会话目录继续沿用。

在 `profiles/<name>/cordis.patch.yml` 挂载（kmh-web 已内置）：

```yaml
- id: kmh-codex-cli
  name: "@kmh/codex-cli"
  config:
    # 默认使用插件自带启动器；显式 command 可指定其他经过验证的程序。
    cwd: !!js process.cwd()
    dataDir: !!js dshHomePath('codex-cli')
```

| 配置键                   | 默认值    | 含义                                                                                                                               |
| ------------------------ | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `command`                | `codex`   | 官方 CLI 可执行文件；损坏或不在 PATH 时写绝对路径                                                                                  |
| `cwd`                    | 必填      | 无会话身份时子进程的工作目录；会话请求跟随会话自身目录                                                                             |
| `dataDir`                | 必填      | 绑定记录与裁剪目录的数据目录                                                                                                       |
| `model`                  | `""`      | 空=模型目录首选；非空固定为该模型                                                                                                  |
| `nativeToolsEnabled`     | `false`   | 旧总开关：首次迁移的默认值；逐项选择以 profile Config 的 `toolSelection` 为准                                                      |
| `toolSelection`          | 首次导入  | `version: 1` 与 `harness`、`native` 选择数组；每项包含 `source`、`name`、`enabled`，由 Settings 写入 profile 的 `cordis.patch.yml` |
| `defaultMaxTokens`       | `1000000` | 会话默认输出上限                                                                                                                   |
| `reasoningSummary`       | `auto`    | 官方思考摘要模式：auto、concise、detailed、none；none 关闭可见摘要请求                                                             |
| `startupTimeoutMs`       | `20000`   | 启动与 initialize 握手时限                                                                                                         |
| `requestTimeoutMs`       | `360000`  | 单次生成总时限，包含排队、启动与官方重试；主对话、标题及压缩评估共用此限制，收尾另有时限                                           |
| `cancelReceiptTimeoutMs` | `5000`    | 停止后等待 interrupted 终止通知的时限                                                                                              |
| `cleanupTimeoutMs`       | `5000`    | 进程干净退出的等待时限，超时强制回收                                                                                               |
| `probeTimeoutMs`         | `15000`   | 测试连接、目录探针与官方额度读取时限                                                                                               |
| `probeMaxTokens`         | `1`       | 测试连接请求传递的输出上限                                                                                                         |
| `loginTimeoutMs`         | `1200000` | 官方授权页完成登录的等待时限                                                                                                       |
| `graceMs`                | `1500`    | 子进程托管终止宽限                                                                                                                 |
| `env`                    | `{}`      | 追加到 CLI 进程的环境变量                                                                                                          |

### 会话能力

- **流式正文与思考摘要**：正文、可提供的思考摘要随官方 CLI 增量返回。用户选择的推理等级传入每次官方回合；摘要内容以模型实际提供为准。
- **原生工具审批**：启用原生命令执行或文件修改后，「请求审批」使用工作区沙箱，额外权限申请在 KMH 弹出审批卡片；「帮我审批」对应官方 `--approve-for-me`，使用工作区沙箱与 Codex 自动审查，通过后执行、拒绝后返回结果；「完全权限」使用完整访问范围并跳过审批询问；「仅可查看」使用只读沙箱，额外权限申请交用户决定。设置在下一回合读取，KMH 工具继续遵循宿主权限策略。
- **图片直接入会话**：原生图片生成的产物作为图片块出现在对话里（附实际像素尺寸说明），可点击查看与保存原图。
- **token 用量与会话状态**：每轮回复显示用量药丸（含缓存命中率）；会话底部连接小球以绿、灰、红区分通信、停止与异常。官方重试期间直接显示“连接失败，正在重试”与原因，恢复输出后回绿；最终失败保留原因，用户可再次发送。等待首段响应和重试期间均可停止。超时返回 `CODEX_REQUEST_TIMEOUT`，随后中断与进程回收分别受收尾时限约束。官方已接纳的输入在确认停止或超时后仍计为已投递：用同一份历史再次发送返回 `CODEX_SESSION_HISTORY_MISMATCH: empty-increment`，用户追加新输入即可继续原会话，这一事实在重启后保留。

### 详情页

Web 插件管理区提供 Codex CLI 卡片：CLI 版本（对照支持基线 0.160.0）、账号状态与凭据来源、默认模型、最近连接测试结果、原生能力逐项选择（命令执行、文件修改、查看图片、网络搜索与独立的原生技能，每项显示可用状态），以及登录/取消登录/退出账号/测试连接。工具调整立即保存，对之后普通新建的会话生效；原生技能独立调整，在下一回合生效。原生图片生成默认保留。账号状态按 `~/.codex/auth.json` 存在性判定，打开页面不发起模型请求；退出账号作用于本机官方 Codex CLI 的登录态。

### 额度与显示设置

现有插件详情页展示账号实际提供的额度周期、剩余进度、重置时间、额外 Credits、消费上限和可用重置卡。官方返回的零值保持为零，缺失值显示“账号暂未提供”；卡片只提供查看能力。Credits 的到期日期以官方数据为准，当前 CLI 未提供时标为未知。

额度由官方 CLI 的 `account/read` 与 `account/rateLimits/read` 读取，详情页与输入框共用宿主缓存。自动更新、点击刷新和多个窗口共同遵守五分钟最短间隔，失败也保留冷却；刷新期间及失败后保留原数据和原成功时间。界面显示下次可刷新时间。浏览器读取最多等待 30 秒，超时显示“额度读取超时”并结束加载；成功记录继续保留。只有实际在途时显示“正在读取额度”，冷却中的空快照显示“状态待更新”。设置读取采用同一等待上限，重新连接后可恢复。账号状态变化清除旧账号数据。

会话输入框通过公开模型目录订阅当前确认的选择。来源为 `codex-cli` 时默认显示百分比，切换来源或会话时随选择更新；普通模型复用主额度，Spark 和 Reserve 采用各自分组。窄输入框显示剩余最低的周期，悬浮、点击或键盘聚焦可查看全部周期与重置时间。

详情页支持百分比、进度条、关闭，以及提醒开关和两个周期的独立阈值（1–100 整数，默认各 20%）。最近五分钟内且尚未到重置时间的结果，剩余严格低于阈值时在详情进度条与输入框同步变红。设置由宿主配置持久化，保存失败保留草稿与原文原因。远程只读浏览器采用宿主已接受的显示偏好，并展示保存限制。

字段和分组规则参考 `dsh-codex-subscription` 的 `usage.js`、`sidebar-quota.js`，并核对官方 CLI 0.162 生成协议。参考版本为 `f73887098e75a8f1929b886a11b22470c1572dbd`。展示范围见[额度展示规格](../../docs/spec/codex-cli-quota-display/spec.md)；官方 CLI 方法、本地接口、字段映射及模型和设置服务统一记录在[接口接入清单](../../docs/spec/codex-cli-quota-display/tech-design.md#quota-interface-map)。

---

<a id="understand-the-implementation"></a>

## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释该包如何实现上述行为；可观察约定已在[使用本包](#use-this-package)中说明。

数据流：Codex 在现有 `agent/created` 通知中保存创建时的工具选择、来源和完整声明，首条消息前也保留这份记录。只有选中的 Harness 工具进入请求：适配器发起请求时按会话快照准备本回合策略（`tool-policy.ts` 的 `prepare`），过滤 `options.tools` 后再交给 Codex；同一快照经公开的 `tools.guard` 控制直接、桥接和嵌套调用，参数漂移或未选中的调用返回 `TOOL_DISABLED`。默认选择修改后，已有会话继续读取自己的记录；普通新建会话读取新默认。`session-store.ts` 保存原工具、Codex 编号、消息处理位置和原生回合切点，收到编号后先保存再发送业务输入。记录损坏、原会话缺失或原工具信息缺失时明确报错并保留原记录。

隔离在进程启动时经 `-c` 参数和按策略生成的模型目录注入。`0.162.0-alpha.17.2` 的 `exec_command`、`write_stdin`、`shell_command` 共用命令控制并联动；`apply_patch`、`view_image` 独立调整。`update_plan` 保持 CLI 固定状态，`web_search` 和 MCP 保留既有 CLI 控制并显示原因。其他版本的控制显示待核实，准备失败明确返回错误；任务重试使用原会话选择。

token 用量：`turn/completed` 的 turn 不携带用量（0.162 wire 实测），逐响应用量来自 `thread/tokenUsage/updated`（`last` 分项）。桥维护未消费样本队列，每个 step 收尾（工具挂起或回合终局）恰产出一条 usage chunk：队列空补零样本、终局合并全部剩余，保证各步样本之和恒等于回合总量且携带 `totalTokens`（KMH 折算校验必需）。

会话底部状态由 `conversation.composer.dock` 公开槽位（order 2）注册的 `LiveBall` 展示，2 秒轮询 `GET /api/codex-cli/live`，按当前 sessionId 过滤。Host 与 Client 共用 `live-state.ts` 的响应校验；`retrying` 标记官方重试，`streaming` 在等待重试期间保持 true。宿主停止以 `AgentCancelCause` 对象经 `signal.reason` 传递；流等待监听中止信号并清理监听器。请求超时覆盖排队等待；取消排队项后，后继项仍等待当前消费方交还执行权。重试次数与退避由官方 CLI 管理。游标在官方确认接纳输入后立即推进并写入绑定文件，不等待本回合输出结束；确认中断时（用户停止或消费方提前结束流）把待投递摘要记为已投递，下一次差分不再包含该输入。差分切分允许真实用户输入后尾随 system/developer 运行时上下文并并入同一次投递，尾随 assistant 消息仍判定基线丢失。

图片生成结果的展示：Codex 原生 `image_gen.imagegen` 工具在默认隔离下即对模型可用（托管 API 调用，无本地执行与审批）。生成产物由 Codex 落盘到 `~/.codex/generated_images/<threadId>/`；桥在收到对应 `item/completed` 通知时读取落盘文件、经宿主附件服务（`ctx.attachments.saveImages`）落成 `ImageAttachmentRef`，并以 image 内容块送回 KMH，会话内直接展示该图片（2026-10-08 真机闭环：叙述块、image 块与尺寸附注并存渲染）。投影是展示增强：读取或入库失败时跳过并告警（落盘路径即恢复入口），生成与续推链路不受影响；同一生图项按 id 去重，一回合多张图片逐项展示。注意：image 块使用独立流块索引（`<id>:image`）——与叙述块共用 item id 的索引会让组装器按先关先赢丢弃 image 块。

| 模块                                                | 职责                                             |
| --------------------------------------------------- | ------------------------------------------------ |
| `src/connection.ts`                                 | 行协议连接：进程、握手、双向请求分发、回收       |
| `src/cursor.ts`                                     | 差分游标：前缀对齐与增量切分                     |
| `src/turn.ts`                                       | 回合状态机：挂起回执、续推、interrupt、原生 fork |
| `src/isolation.ts`                                  | 工具/技能/钩子隔离的参数生成与核对               |
| `src/adapter.ts`                                    | LlmAdapter：模型映射、流投影、会话驱动           |
| `src/approval.ts`                                   | 审批桥：原生审批请求转 KMH 用户决定              |
| `src/tool-registry.ts` / `src/capabilities.ts`      | kmh- 工具声明表与原生能力逐项选择                |
| `src/native-items.ts` / `src/image-delivery.ts`     | 原生执行叙述与生图产物投影                       |
| `src/session-store.ts`                              | 绑定与游标持久化                                 |
| `src/account.ts` / `src/probe.ts` / `src/status.ts` | 账号操作、测试连接、版本基线检查                 |
| `src/web.ts` / `src/client/`                        | 详情页路由、详情卡片与状态小球                   |

额度详情、显示设置和输入框浮层遵循 [统一 Web 样式](../../third_party/dsh/docs/web-styling.md)。局部样式位于 `src/client/quota.module.css`，构建器将生成的样式嵌入 `lib/client.js`，插件卸载时一同释放。界面与验证记录见 [统一额度界面任务](../../docs/spec/codex-cli-quota-display/tasks/task-quota-ui.md)。

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

### 会话工具记录升级

`codex-bindings.json` 新增创建时工具信息和原生回合对应记录，首条消息前的记录可以暂时没有 `threadId`。已保存但缺少原工具信息的旧记录会报告 `CODEX_SESSION_STATE_INCOMPLETE`；损坏文件报告 `CODEX_SESSION_STATE_CORRUPT`。原文件和原生会话保留，插件不会用当前开关补造旧配置或自动创建替代会话；用户可普通新建 KMH 会话继续任务。改变读取行为与新增字段由本说明承接，DSH Session 格式代际保持原样。

完成仓库初始化和 DSH 构建后，在仓库根目录运行本包测试。测试需要本机官方 Codex CLI；`KMH_CODEX_BINARY` 可以指定程序绝对路径，默认检查 ChatGPT.app 内程序及 PATH。程序缺失时测试明确报错。

```sh
KMH_CODEX_TEST_TMP=/private/tmp/kmh-codex-retry-20261009 pnpm --filter @kmh/codex-cli test
```

测试位于 [`test/`](test/stream-reasoning.test.mjs)，使用真实 Cordis 服务、插件 adapter 和官方 app-server，模型响应来自本地 Responses 服务。完成门控制响应结束时机，分别核对官方通知与插件增量在完成前到达；调用结束后读取原生 session，检查首次、恢复和原生分叉的思考等级及摘要模式。官方 `ultra` 在 session 中保留原值，在 Responses 请求中映射为 `max`。[重试测试](test/retry-status.test.mjs)覆盖真实 503、恢复、重试耗尽、首段前停止、重试期间停止，以及主请求和辅助请求超时（超时后同一份历史不再重跑，追加新输入才发起下一次请求）；客户端 bundle 渲染测试检查中英文可见原因。[停止恢复测试](test/task-stop-recovery.test.mjs)覆盖真实 Agent 在输入被接纳后停止、下一条输入不重复投递、重启后继续，以及消费方提前结束流后部分输出与绑定保留。生产模型访问与浏览器显示由真实环境验收。

`KMH_CODEX_TEST_TMP` 必须为绝对路径，省略时使用系统临时目录下的 `kmh-codex-cli-tests`。每项 smoke 建立独立子目录，并将 `CODEX_HOME` 指向其 `codex-home/`；测试保留这些目录，登录与响应服务使用隔离的测试配置。

| 记录                                               | 内容                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------- |
| `codex-home/sessions/**/*.jsonl`                   | 官方原生 session，包含 `turn_context.effort`、`summary` 与任务结束记录 |
| `upstream.jsonl`                                   | 本地模型服务收到的实际请求                                             |
| `notifications.jsonl`                              | 官方 app-server 通知及接收时间                                         |
| `app-server.stdout.jsonl`、`app-server.stderr.log` | 原始通信与进程诊断                                                     |
| `plugin-stream.jsonl`                              | 流式用例的插件输出、时间及当时上游是否完成                             |

根目录 `pnpm test` 同时执行本包测试。维护者可以在复查结束后删除对应临时子目录。[会话工具回归](test/tool-policy.test.mjs)覆盖真实配置编辑、原 ID 恢复、原生文件修改、持久化重启、原生分叉、长消息与缺失会话；[存储测试](test/session-store.test.mjs)覆盖文件损坏、写入失败和串行保存。

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

同一 KMH 会话的后续回合恢复保存的 Codex thread，完整发送新增输入和工具回执；原生历史与压缩结果由 Codex 维护。每轮用量药丸报告实际 token 与缓存命中。辅助压缩评估和标题生成保留独立请求路径。

### KV Cache 影响

工具声明只在首次 `thread/start` 传入；后续 `thread/resume` 保持原编号、原工具及原生历史。详细原始执行事件受 CLI 恢复能力限制，界面按普通通知显示可提供的进度与结果。跨回合缓存命中由提供方决定。声明指纹包含来源、名称、完整参数、原生版本与所选控制。

---

<a id="known-limitations-and-deferred-work"></a>

## 已知限制与延期工作

这些限制说明何时需要特别留意；它们是当前包约束，不是任务积压。

- **支持基线为官方 CLI 0.160.0**——vendored 模型目录随包分发；包内测试验证指定 CLI 的协议、流式与原生日志，真实模型服务由部署环境验收。
- **共享 `~/.codex` 的连带**——用户 MCP 设备可见（`-c` 无法压掉且清空覆盖会重置用户禁用状态，已拍板接受）；用户与项目级钩子在每回合前经探针发现并逐键禁用，只覆盖当轮发现的键。
- **恢复时的记录能力**——部分 CLI 版本仅在新建时提供详细原始工具事件；恢复保持原会话，进度按实际通知展示。
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

<details>
<summary>额度分组规则参考许可</summary>

参考 `dsh-codex-subscription/src/sidebar-quota.js` 的模型匹配规则，保留原 MIT 许可：

```text
MIT License

Copyright (c) 2026 WSL043

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

</details>
