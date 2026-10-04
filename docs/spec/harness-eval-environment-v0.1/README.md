# harness-eval-environment-v0.1

> 状态：方案确认
> 目标：把 Kongming runtime eval 的环境搭建、配置入口、审批自动化和产物对比规则整理成可执行方案。
> 创建时间：2026-06-24

## 需求要点

- 评测流程需要一份清晰的本地环境搭建说明，覆盖依赖安装、模型 preset、密钥、运行命令和产物位置。
- 自动化 eval 默认走无人值守路径，审批通过脚本层配置控制。
- 需要支持按 case 打开审批，用于专门验证 approval 体验和 trace。
- baseline-min 与 full profile 需要定义成可复现的运行切片，报告里要记录 profile、approval、session、instructions、compactor 等差异。
- 现有主业务代码里已经有安全链固定装配，eval 层优先通过配置和脚本装配控制行为。
- 如遇脚本层配置无法表达的硬编码点，给出最小代码修改方案，主业务代码保持稳定。

## 系统目标

本 spec 将 `repo:scripts/run_kongming_harness_eval.py` 从“能跑评测的脚本”升级为“可复现评测环境入口”。它保留真实 `SessionEngine + Runner` 闭环，给评测者提供稳定的环境准备、profile 切片、审批模式和报告元数据。

## 最小可用路径

配置 `repo:config/setting.yaml` 的 `web.llm_presets` 与 `.env` 密钥后，执行 `uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --preset minimax-m3 --profile full --approval-mode auto_allow`，产出带 profile 和 approval 元数据的 `summary.json` / `report.md` / `trajectory.json`。

## 模块导航

| 模块 | 状态 | 文档 | 是否可进 task | 说明 |
|---|---|---|---|---|
| Eval Environment Setup | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | 环境依赖、配置文件、密钥和运行命令 |
| Runtime Profile Control | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | baseline-min / full 的装配差异 |
| Approval Control | 方案确认 | [02-module-breakdown.md](./02-module-breakdown.md) | 是 | auto_allow / interactive / case 三种审批模式 |
| Artifact Metadata | 方案确认 | [04-data-and-state.md](./04-data-and-state.md) | 是 | run summary、trajectory、report 的新增字段 |
| Automation Recipe | 方案确认 | [05-validation-and-evolution.md](./05-validation-and-evolution.md) | 是 | CI / nightly / 手动对比的命令与校验 |
| Task Mapping | 方案确认 | [90-task-map.md](./90-task-map.md) | 是 | 实施顺序和主业务代码触碰边界 |

## 当前事实

| 事实 | 说明 |
|---|---|
| 真实入口 | `repo:scripts/run_kongming_harness_eval.py` |
| 配置入口 | `repo:config/setting.yaml` + `KONGMING_*` env + 仓库根 `.env` |
| preset 来源 | `web.llm_presets`，通过 `--preset <id>` 选择 |
| task 隔离 | 每题设置独立 `KONGMING_HOME` 到 `runs/<run-id>/tasks/<task-id>/kongming_home` |
| session 落盘 | 当前脚本强制 file session 到 `runs/<run-id>/sessions` |
| approval 现状 | 当前脚本传入 `AutoAllowApproval()`，无人值守通过 consent；`SafetyGatedApproval` 链路始终存在 |
| compactor 现状 | `config/setting.yaml` 默认 `compactor.enabled: false`，full 默认也是 Noop |
| instructions 现状 | 脚本硬编码 eval system instructions |

## 当前建议

先做 eval 脚本和文档层改造：新增 `--profile`、`--approval-mode`、case 级 `runtime.approval_mode`，并把报告元数据补齐。主业务代码保留现有安全链装配；只有当脚本层无法创建空 instructions profile 时，再引入脚本侧 `AgentSpec` 明确传入空 instructions。
