# 目标与边界

## 需求要点

- 用户需要一份 eval 环境搭建和运行设置说明，能直接指导本地和自动化流程。
- 默认自动化评测需要绕过人工等待，审批通过配置明确表达。
- 特定 case 可以打开审批，用于验证 approval 链路。
- profile 差异需要在报告中可见，避免两次 run 只靠 run id 区分。
- 方案优先通过 config、CLI 参数和 eval 脚本实现。
- 主业务代码只作为备选修改点，修改范围要有明确理由和测试。

## 系统目标

1. 评测者能从干净环境完成依赖安装、密钥配置、preset 校验、fixture run、真实模型 run。
2. 自动化任务能用固定命令跑完整 suite，产物可追踪到 profile、approval、config 和 preset。
3. profile 语义稳定：baseline-min 和 full 的差异由代码显式记录，报告可比较。
4. approval 语义稳定：默认 `auto_allow` 支持无人值守，`case` 支持题目级 interactive。
5. 主业务 runtime 保持通用安全链，eval 只控制底层 approval provider 和装配参数。

## 包含范围

- `repo:scripts/run_kongming_harness_eval.py` 的参数设计、profile 装配、approval 装配、metadata 输出。
- `repo:evals/harness-runtime-v0.1/README.md` 的环境搭建说明补充。
- `repo:evals/harness-runtime-v0.1/tasks/*.yaml` 的可选 `runtime` 字段。
- `repo:tests/` 下的 pytest 验证方案。
- 自动化命令模板和报告对比口径。

## 保持边界

- 主业务 `SessionEngine.build()` 的安全链固定装配保持现状。
- `src/safety/` 的 HardBlock、Boundary、Trust、Consent 顺序保持现状。
- provider、session、compactor 的通用配置模型保持主业务语义。
- 公开 benchmark、排行榜、外部评测平台接入留给后续 spec。

## 关键约束

| 约束 | 设计含义 |
|---|---|
| 配置优先 | 能用 `--profile`、`--approval-mode`、YAML 和 env 表达的行为放在 eval 层 |
| 主业务稳定 | `repo:src/runtime_assembly/session_engine.py` 的默认安全链语义不为 eval 单独分支 |
| 真实闭环 | `--preset` run 仍经过 `SessionEngine + Runner + SafetyGatedApproval` |
| 可重复 | 每次 run 记录完整环境快照和 case runtime options |
| 自动化友好 | 默认命令无交互、输出目录稳定、失败原因落到 JSON |
| 测试文件验证 | 后续实现用 pytest 覆盖，验证代码进入 `repo:tests/` |

## DoD

| DoD 条目 | 需要模块 | 需要 task |
|---|---|---|
| README 说明完整环境搭建、密钥、preset、命令、产物 | Eval Environment Setup | task-1 |
| CLI 支持 `--profile baseline-min|full` | Runtime Profile Control | task-2 |
| CLI 支持 `--approval-mode auto_allow|interactive|case` | Approval Control | task-3 |
| case YAML 支持可选 `runtime.approval_mode` | Approval Control, Artifact Metadata | task-3 |
| summary/report/trajectory 写入 profile 与 approval 元数据 | Artifact Metadata | task-4 |
| pytest 覆盖 profile、approval、metadata 和 fixture run | Automation Recipe | task-5 |
| 文档说明主业务硬编码点和修改方案 | Task Mapping | task-6 |

## 验收命令

```bash
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --mode fixture --profile baseline-min --approval-mode auto_allow --run-id fixture-baseline-min
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --mode fixture --profile full --approval-mode auto_allow --run-id fixture-full
uv run pytest tests/e2e/test_kongming_harness_eval_profiles.py -v
uv run pytest tests/e2e/test_kongming_harness_eval_approval_modes.py -v
```
