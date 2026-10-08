---
description: 在 KMH 使用本机官方 Codex CLI 登录的模型：挂载配置、隔离开关、原生工具审批与逐项选择、生图展示、token 用量与会话连接状态小球，以及差分续聊与故障排查入口。
---

# @kmh/codex-cli

在 KMH 里使用本机官方 Codex CLI 的模型对话：KMH 保留系统提示、工具权限与回合控制，Codex 承担模型推理与原生历史管理。工具以动态工具回调交回 KMH 执行；多轮对话经差分游标只投增量，进程重启后续聊不丢上下文。

选择本包的代价与边界：共享用户 `~/.codex`（登录、配置、原生会话记录都在那边），用户配置的 MCP 设备对模型可见；一切隔离经进程 `-c` 参数注入，仅影响单次调用，不修改任何 Codex 配置文件。

## 目录

- [用途](#用途)
- [实现说明](#实现说明)
- [验证](#验证)
- [归属与相关文档](#归属与相关文档)
- [开发备注](#开发备注)

---

<a id="用途"></a>

## 用途

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

| 配置键                   | 默认值    | 含义                                                      |
| ------------------------ | --------- | --------------------------------------------------------- |
| `command`                | `codex`   | 官方 CLI 可执行文件；损坏或不在 PATH 时写绝对路径         |
| `cwd`                    | 必填      | 无会话身份时子进程的工作目录；会话请求跟随会话自身目录    |
| `dataDir`                | 必填      | 绑定记录与裁剪目录的数据目录                              |
| `model`                  | `""`      | 空=模型目录首选；非空固定为该模型                         |
| `nativeToolsEnabled`     | `false`   | 旧总开关：仅作逐项选择的迁移默认（true=已支持项全选），详情页保存后以 `dataDir/codex-settings.json` 为准 |
| `startupTimeoutMs`       | `20000`   | 启动与 initialize 握手时限                                |
| `requestTimeoutMs`       | `360000`  | 单次推理请求时限                                          |
| `cancelReceiptTimeoutMs` | `5000`    | 停止后等待 interrupted 终止通知的时限                     |
| `cleanupTimeoutMs`       | `5000`    | 进程干净退出的等待时限，超时强制回收                      |
| `probeTimeoutMs`         | `15000`   | 测试连接与目录探针时限                                    |
| `loginTimeoutMs`         | `1200000` | 官方授权页完成登录的等待时限                              |
| `graceMs`                | `1500`    | 子进程托管终止宽限                                        |
| `env`                    | `{}`      | 追加到 CLI 进程的环境变量                                 |

### 会话能力

- **原生工具审批**：权限模式为「请求审批」时，Codex 原生命令执行、文件修改等提权操作在 KMH 弹出审批卡片，批准后执行、拒绝后模型收到结果继续任务；「帮我审批」「完全权限」两档不询问直接执行。
- **图片直接入会话**：原生图片生成的产物作为图片块出现在对话里（附实际像素尺寸说明），可点击查看与保存原图。
- **token 用量与会话状态**：每轮回复显示用量药丸（含缓存命中率）；会话底部「第 n 轮第 n 步」行最右的连接状态小球——绿=CLI 通信中、灰=已停止（进程回收）、红=停止未确认或回合异常。

### 详情页

Web 插件管理区提供 Codex CLI 卡片：CLI 版本（对照支持基线 0.160.0）、账号状态与凭据来源、默认模型、最近连接测试结果、原生能力逐项选择（命令执行、文件修改、查看图片、网络搜索与独立的原生技能，每项显示可用状态），以及登录/取消登录/退出账号/测试连接。调整立即保存并下一回合生效，进行中的回合保持原选择；原生图片生成默认保留。账号状态按 `~/.codex/auth.json` 存在性判定，打开页面不发起模型请求；退出账号作用于本机官方 Codex CLI 的登录态。

---

<a id="实现说明"></a>

## 实现说明

<details>
<summary>实现细节 — 点击展开</summary>

数据流：DSH agent-loop 每次调用携带全量历史，adapter 用差分游标（逐条消息指纹）对齐已投前缀，只把尾部增量投给 Codex——新用户输入发起 turn，工具结果作为挂起中 `item/tool/call` 服务端请求的延迟回执写回，同一 turn 内续推；system 提示与工具目录在 thread 创建时一次性绑定。会话与 Codex thread 的绑定（thread id、游标、fork 边界）持久化在 `dataDir/codex-bindings.json`，进程重启后恢复；历史被改写（编辑/重发）时经 `thread/fork` 原生分叉重建，失败则新建 thread 并注入序列化的重建历史。

隔离在每次进程启动时经 `-c` 参数注入：vendored 官方模型目录按"直通"形态改写（消灭原生 shell、Code Mode、多 agent 等），功能与捆绑技能逐项关闭，会话范围发现的原生技能与用户钩子按路径/键逐个禁用；开关打开时跳过全部裁剪。压缩由 Codex 在 thread 内原生处理，KMH 侧压缩请求被明确拒绝。

token 用量：`turn/completed` 的 turn 不携带用量（0.162 wire 实测），逐响应用量来自 `thread/tokenUsage/updated`（`last` 分项）。桥维护未消费样本队列，每个 step 收尾（工具挂起或回合终局）恰产出一条 usage chunk：队列空补零样本、终局合并全部剩余，保证各步样本之和恒等于回合总量且携带 `totalTokens`（KMH 折算校验必需）。

会话底部状态小球：`conversation.composer.dock` 公开槽位（order 2，排在活动/用量药丸右侧）注册 `LiveBall`，2 秒轮询 `GET /api/codex-cli/live` 按当前 sessionId 过滤。绿=回合进行中或工具步间进程在线；灰=回合完成/CLI 确认中断后进程回收；红=停止未确认（interrupt 超时）或回合异常中断。宿主停止以 `AgentCancelCause` 普通对象经 `signal.reason` 抛达，按 `{kind}` 识别。

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

</details>

---

<a id="验证"></a>

## 验证

在 Kongming 根目录运行：

```sh
pnpm build:kmh
pnpm typecheck:kmh
pnpm lint
pnpm test
```

测试含真实 CLI 冒烟（本机存在官方 Codex CLI 时执行，否则跳过）：差分投递 → 工具挂起 → 回执续推 → 最终回复，并核对模型只声明 KMH 工具与已接受的 MCP 设备。运行中的排查入口：`~/.codex/sessions/<日期>/rollout-*.jsonl`（`originator: kmh_codex_cli` 标识插件的会话）、`/api/codex-cli/status` 与 `/api/codex-cli/live`（连接状态）路由、KMH 数据目录的 `codex-cli/`。

---

<a id="归属与相关文档"></a>

## 归属与相关文档

- [需求与验收场景](../../docs/spec/codex-cli-provider/spec.md) — 功能行为的唯一事实源，任务拆解在其 tasks/ 下。
- [运行记录](../../docs/kmh/runtime-records.md) — 数据目录与日志路径的通用规则。
- [Kongming 的 DSH 底座](../../docs/kmh/README.md) — 自有插件与 profile 的装配关系。
- 官方协议：Codex app-server v2（`codex app-server --stdio` 行协议），行为以本包锁定的 0.160.0 实测为准。

<a id="开发备注"></a>

## 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

- 已接受边界：用户 MCP 设备可见（`-c` 无法压掉且清空覆盖会重置用户禁用状态）；`dynamicTools` 绑定在 thread 创建时，会话中途工具表变化要等基线重建后模型才可见；canonical namespace 注册的模型侧名称是无点拼接，已回退平铺真名。
- 待验证：真压缩触发观察（需真模型长上下文）、分钟级工具挂起时 Codex 侧超时行为、0.162-alpha 二进制持续观察（异常时第一怀疑对象）。
- 测试残留：2026-10-07 早期冒烟（未加独立 home 前）在 `~/.codex/sessions/2026/10/07/` 留有约 12 个 fixture 会话文件，用户确认保留。

</details>
