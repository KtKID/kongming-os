---
description: 在 KMH 使用本机官方 Codex CLI 登录的模型：挂载配置、隔离开关、账号与详情页行为，以及差分续聊与故障排查入口。
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
| `nativeToolsEnabled`     | `false`   | 原生 Codex 工具与技能总开关（详情页可切换，下一回合生效） |
| `startupTimeoutMs`       | `20000`   | 启动与 initialize 握手时限                                |
| `requestTimeoutMs`       | `360000`  | 单次推理请求时限                                          |
| `cancelReceiptTimeoutMs` | `5000`    | 停止后等待 interrupted 终止通知的时限                     |
| `cleanupTimeoutMs`       | `5000`    | 进程干净退出的等待时限，超时强制回收                      |
| `probeTimeoutMs`         | `15000`   | 测试连接与目录探针时限                                    |
| `loginTimeoutMs`         | `1200000` | 官方授权页完成登录的等待时限                              |
| `graceMs`                | `1500`    | 子进程托管终止宽限                                        |
| `env`                    | `{}`      | 追加到 CLI 进程的环境变量                                 |

### 详情页

Web 插件管理区提供 Codex CLI 卡片：CLI 版本（对照支持基线 0.160.0）、账号状态与凭据来源、默认模型、最近连接测试结果、原生工具开关，以及登录/取消登录/退出账号/测试连接。账号状态按 `~/.codex/auth.json` 存在性判定，打开页面不发起模型请求；退出账号作用于本机官方 Codex CLI 的登录态。

---

<a id="实现说明"></a>

## 实现说明

<details>
<summary>实现细节 — 点击展开</summary>

数据流：DSH agent-loop 每次调用携带全量历史，adapter 用差分游标（逐条消息指纹）对齐已投前缀，只把尾部增量投给 Codex——新用户输入发起 turn，工具结果作为挂起中 `item/tool/call` 服务端请求的延迟回执写回，同一 turn 内续推；system 提示与工具目录在 thread 创建时一次性绑定。会话与 Codex thread 的绑定（thread id、游标、fork 边界）持久化在 `dataDir/codex-bindings.json`，进程重启后恢复；历史被改写（编辑/重发）时经 `thread/fork` 原生分叉重建，失败则新建 thread 并注入序列化的重建历史。

隔离在每次进程启动时经 `-c` 参数注入：vendored 官方模型目录按"直通"形态改写（消灭原生 shell、Code Mode、多 agent 等），功能与捆绑技能逐项关闭，会话范围发现的原生技能与用户钩子按路径/键逐个禁用；开关打开时跳过全部裁剪。压缩由 Codex 在 thread 内原生处理，KMH 侧压缩请求被明确拒绝。

| 模块                                                | 职责                                             |
| --------------------------------------------------- | ------------------------------------------------ |
| `src/connection.ts`                                 | 行协议连接：进程、握手、双向请求分发、回收       |
| `src/cursor.ts`                                     | 差分游标：前缀对齐与增量切分                     |
| `src/turn.ts`                                       | 回合状态机：挂起回执、续推、interrupt、fork 重建 |
| `src/isolation.ts`                                  | 工具/技能/钩子隔离的参数生成与核对               |
| `src/adapter.ts`                                    | LlmAdapter：模型映射、流投影、会话驱动           |
| `src/session-store.ts`                              | 绑定与游标持久化                                 |
| `src/account.ts` / `src/probe.ts` / `src/status.ts` | 账号操作、测试连接、版本基线检查                 |
| `src/web.ts` / `src/client/`                        | 详情页路由与卡片                                 |

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

测试含真实 CLI 冒烟（本机存在官方 Codex CLI 时执行，否则跳过）：差分投递 → 工具挂起 → 回执续推 → 最终回复，并核对模型只声明 KMH 工具与已接受的 MCP 设备。运行中的排查入口：`~/.codex/sessions/<日期>/rollout-*.jsonl`（`originator: kmh_codex_cli` 标识插件的会话）、`/api/codex-cli/status` 路由、KMH 数据目录的 `codex-cli/`。

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
- 待验证：多轮 token 用量线性曲线、分钟级工具挂起时 Codex 侧超时行为、fork 分叉与崩溃恢复的端到端 smoke（单元与单轮冒烟已过）。
- 测试残留：2026-10-07 早期冒烟（未加独立 home 前）在 `~/.codex/sessions/2026/10/07/` 留有约 12 个 fixture 会话文件，用户确认保留。

</details>
