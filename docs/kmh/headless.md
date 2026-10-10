---
description: 外部脚本与服务经 kmh 启动器以 headless 单次进程调用 Kongming：调用入口、KMH_HOME 与 profile 参数、输入输出契约、机器前提与失败模式，网关与自动化集成按此接入。
---

# Headless 外部调用

## 概述

外部程序可以在不启动 Web 的情况下，以一次性子进程调用 Kongming 完成单条任务：任务文本经命令行参数传入，进程结束时标准输出携带最终答案。调用方只需要三个要素——启动器路径、`KMH_HOME` 数据目录、profile 名称；profile 注册、环境映射与数据目录创建由启动器在每次运行时自动完成。本页给出经实测的调用形态、输入输出契约与失败边界，供网关与自动化脚本集成使用。

## 目录

- [调用入口与参数](#调用入口与参数)
- [输入输出契约](#输入输出契约)
- [机器前提](#机器前提)
- [失败模式与边界](#失败模式与边界)
- [网关集成示例](#网关集成示例)
- [进一步探索](#进一步探索)

## 调用入口与参数

启动器是仓库根的 `kmh.sh`，或等价的 `node scripts/kmh.mjs`；`dsh` 子命令把参数原样转发给底层 CLI。每次运行时启动器解析 `KMH_HOME`、注册 profile 链接，并把该目录映射为底座的数据根。

```bash
KMH_HOME=~/.hm-mobile /absolute/path/to/kmh.sh dsh --profile kmh-mobile "只回复两个字：ok"
```

| 参数 / 环境 | 说明 |
|---|---|
| `KMH_HOME` | 运行数据目录，按进程环境变量 > 仓库根 `.env.local` > 默认 `~/.kmh` 三层解析。值必须是绝对路径或 `~/` 开头（`~` 由启动器展开），目录不存在时自动创建。启动器同时把它映射为 `DSH_HOME`，并将 `ZCODE_DATA_BASE_DIR`、`TMPDIR` 固定在该目录下。 |
| `--profile` | 选择应用组合，见下表。 |
| 任务文本 | 命令行最后一个位置参数；缺失或空白时进程拒绝运行并以退出码 1 结束。 |
| `--patch <文件>` | 可重复的调用级 cordis overlay；完整组合层序与机器偏好位置见 [DSH 接入与升级](README.md#profile-与-bundle)。 |
| 进程工作目录 | 底座以 cwd 为默认 workspace 根，并加载 cwd 的 `.env`（其中含调用方保留变量时会拒绝运行）。调用方必须使用隔离目录，不能指向带自身 `.env` 的项目根。 |

可选 profile：

| profile | 模型提供方与默认模型 | 适用 |
|---|---|---|
| `kmh-mobile` | `@kmh/zcode-cli` 与 `@kmh/codex-cli`；默认 `zcode-cli / glm-5.3-flash` | 外部网关与自动化调用的推荐入口 |
| `kmh-headless` | 上游默认 `deepseek-official / deepseek-flash`，需要 `DEEPSEEK_API_KEY` | 已有 DeepSeek 官方凭据的调用 |

组合预检不启动运行时，可用于验证 profile 与 overlay 的叠加结果：

```bash
KMH_HOME=~/.hm-mobile /absolute/path/to/kmh.sh dsh --profile kmh-mobile --dump-config
```

## 输入输出契约

- 任务文本经 argv 传入，进程不读 stdin。
- stdout 在任务完成时输出最终答案，可能分多批到达。退出码为 0 但 stdout 为空时，调用方应按失败处理。
- stderr 流式写出推理增量（`dsh: reasoning:` 段）与错误行（`dsh: <code>: <message>`）。调用方必须持续消费 stderr，否则约 64KB 的管道写满后会阻塞子进程；其内容可能敏感，不得透传给终端用户或写入调用方日志。
- 退出码：任务完成为 0；中止、失败、任务文本缺失为 1。
- 每次调用一个进程，进程退出即会话结束，跨调用没有对话记忆；需要多轮记忆的调用方应改用 SDK 会话形态（`kmh-sdk` profile 的 JSON-RPC stdio 协议）。
- 启动器为每次调用在 `KMH_HOME/logs/` 下保存 stdout/stderr 副本与退出信息，会话内容按[运行数据与记录](runtime-records.md)的结构落盘。

## 机器前提

- 仓库已完成 `pnpm install --frozen-lockfile`、`pnpm run setup`、`pnpm build`；未构建时启动器在拉起 CLI 前直接报错退出。
- `zcode-cli` 提供方要求本机安装 ZCode.app 且桌面端已登录：凭据只读借用自桌面登录，CLI 经 PATH 发现。
- `codex-cli` 提供方依赖 ChatGPT.app 自带的官方 CLI（可执行路径写在 profile 中）。该 CLI 随 App 自动更新，版本漂移可能使提供方暂时不可用，调用会以 `CODEX_SERVER_ERROR` 失败。

## 失败模式与边界

- 凭据缺失：stderr 报 `MISSING_CREDENTIAL`（指明缺失的 provider 与变量名）、退出码 1；凭据无效报 AUTH 401。按报错补齐凭据后重试。
- 需要审批的工具动作会被拒绝（fail-closed）：headless 组合没有交互应答者，审批桥对拒绝与不可用一律回 deny；只读类动作通常不触发审批。
- 经 `zcode-cli` 的模型运行在 ZCode CLI 自带的工具集与多步循环里（工作区为进程 cwd），KMH 插件侧工具不参与；形态细节见 [zcode-cli 包说明](../../packages/zcode-cli/README.md)。

## 网关集成示例

小艺网关（`xiaoyi2agent-server`）以三项配置接入本入口，完整参数以其仓库 `docs/development.md` 为准：

```bash
DSH_COMMAND=["node","/absolute/path/to/kongming-agent/scripts/kmh.mjs","dsh"]
DSH_PROFILE=kmh-mobile
KMH_HOME=~/.hm-mobile   # 经网关进程环境继承传入子进程
```

网关自行拼装 `--profile` 与任务文本；`dsh` 透传形态下启动器不注入 `--profile`，并转发调用方工作目录、信号与真实退出码。

## 进一步探索

- [DSH 接入与升级](README.md)：安装、短命令、profile 与 bundle 组合规则。
- [profiles 目录](../../profiles/README.md)：各 profile 的定义与 kmh-mobile 的模型配置。
- [运行数据与记录](runtime-records.md)：`KMH_HOME` 的目录结构、会话存储与调用日志。
