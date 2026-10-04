# Task 映射

## 总体结论

本 spec 适合拆成 6 个小 task。前 4 个 task 只碰 eval 脚本、eval README 和测试；第 5 个 task 负责自动化文档；第 6 个 task 是主业务代码备选方案评估。

## task 列表

| 顺序 | task | 文件范围 | 前置依赖 | 是否可进 x-req | 说明 |
|---:|---|---|---|---|---|
| 1 | `harness-eval-env-docs` | `repo:evals/harness-runtime-v0.1/README.md` | 无 | 是 | 写清依赖、密钥、preset、命令、产物 |
| 2 | `harness-eval-profile-cli` | `repo:scripts/run_kongming_harness_eval.py` + tests | task-1 | 是 | 增加 `--profile baseline-min|full` |
| 3 | `harness-eval-approval-mode` | `repo:scripts/run_kongming_harness_eval.py` + task schema tests | task-2 | 是 | 增加 `--approval-mode auto_allow|interactive|case` |
| 4 | `harness-eval-artifact-metadata` | `repo:scripts/run_kongming_harness_eval.py` + report tests | task-2, task-3 | 是 | summary/report/trajectory 写环境快照 |
| 5 | `harness-eval-automation-recipes` | eval README + optional automation docs | task-4 | 是 | 固化 CI/nightly/手动对比命令 |
| 6 | `harness-eval-runtime-hardcode-review` | `repo:src/runtime_assembly/session_engine.py` 只读评估，必要时提最小 patch | task-2 | 可选 | 处理脚本层表达不足 |

## 推荐开发顺序

1. 先补 README，让当前用户能按现有能力跑 fixture 和 preset。
2. 再实现 profile CLI，baseline-min 用脚本侧 `AgentSpec`、`InMemorySession`、Noop compactor。
3. 再实现 approval mode，默认保持 `auto_allow`。
4. 再补 artifact metadata，保证 profile 对比有证据。
5. 最后写自动化 recipe 和 nightly 使用说明。

## 每个 task 的验收口径

### 1. `harness-eval-env-docs`

- README 包含依赖安装、`.env`、preset、fixture、真实模型、输出目录、失败排查。
- README 明确 `SafetyGatedApproval` 仍在链路中，默认 consent 自动通过。
- README 明确 `compactor.enabled: false` 是当前 full 默认状态。

### 2. `harness-eval-profile-cli`

- parser 支持 `--profile baseline-min|full`，默认 `full`。
- baseline-min 使用空 instructions、memory session、Noop compactor。
- full 保持当前 eval instructions、file session、config compactor。
- pytest 断言 `instructions=""` 没有被默认 prompt 替换。

### 3. `harness-eval-approval-mode`

- parser 支持 `--approval-mode auto_allow|interactive|case`，默认 `auto_allow`。
- task YAML 可选 `runtime.approval_mode`。
- `case` 模式按题目字段选择 provider。
- pytest 覆盖缺省、auto_allow、interactive 三条路径。

### 4. `harness-eval-artifact-metadata`

- `summary.json` 包含 profile、approval_mode、config_path、preset、session_backend、compactor_mode。
- `trajectory.json.runtime.metadata` 包含 task 级 effective approval 和 profile。
- `report.md` 运行信息区展示 profile 与 approval。

### 5. `harness-eval-automation-recipes`

- README 有 fixture smoke、single preset run、baseline/full 对比、case approval run 四类命令。
- 文档说明非零 exit code 的含义和 artifacts 收集方式。

### 6. `harness-eval-runtime-hardcode-review`

- 只有脚本层无法表达空 instructions 或 Noop compactor 时进入。
- 修改方案优先暴露可注入参数或公共 Noop helper。
- 验证覆盖 `repo:tests/e2e/test_history_compact_runner.py` 相关语义。

## 风险与 PoC

| 风险 | 等级 | PoC |
|---|---|---|
| baseline-min 空 instructions 被默认 prompt 替换 | 高 | 先写 pytest 捕获 LLMRequest messages |
| interactive approval 在非 TTY 自动化中挂起 | 中 | `--approval-mode interactive` 启动前检测 TTY |
| case 级 runtime 字段破坏旧题目 schema | 中 | runtime 字段设为可选，旧题目保持通过 |
| full 与 baseline-min 差异被误读 | 中 | report 强制展示 session_backend 和 compactor_mode |

## 当前建议

`harness-eval-env-docs`、`harness-eval-profile-cli`、`harness-eval-approval-mode`、`harness-eval-artifact-metadata` 可以进入 x-req。`harness-eval-runtime-hardcode-review` 保留在方案层，等脚本层实现遇到真实阻塞后再启动。
