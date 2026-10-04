# 验证与演进

## 验证策略

首版验证分四层：

| 层级 | 目标 | 测试文件建议 |
|---|---|---|
| 参数解析 | CLI 参数和默认值稳定 | `repo:tests/unit/test_kongming_harness_eval_cli.py` |
| profile 装配 | baseline-min / full 传入正确 runtime kwargs | `repo:tests/e2e/test_kongming_harness_eval_profiles.py` |
| approval 装配 | auto_allow / interactive / case 解析正确 | `repo:tests/e2e/test_kongming_harness_eval_approval_modes.py` |
| 产物元数据 | summary/report/trajectory 字段完整 | `repo:tests/e2e/test_kongming_harness_eval_artifacts.py` |

## 必跑命令

```bash
uv run pytest tests/unit/test_kongming_harness_eval_cli.py -v
uv run pytest tests/e2e/test_kongming_harness_eval_profiles.py -v
uv run pytest tests/e2e/test_kongming_harness_eval_approval_modes.py -v
uv run pytest tests/e2e/test_kongming_harness_eval_artifacts.py -v
```

## fixture 验证

fixture 模式用于验证 harness 环境和产物，无需真实模型密钥：

```bash
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --mode fixture --profile baseline-min --approval-mode auto_allow --run-id fixture-baseline-min
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --mode fixture --profile full --approval-mode auto_allow --run-id fixture-full
```

期望：

- 两次 run 都产出 `summary.json`、`tasks.json`、`report.md`。
- `summary.json.profile` 分别是 `baseline-min` 和 `full`。
- `summary.json.approval_mode` 都是 `auto_allow`。
- `trajectory.json.runtime.metadata` 包含 task 级 effective approval。

## 真实模型验证

真实模型模式用于验证 provider、preset、tool_call 和评分：

```bash
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --preset minimax-m3 --profile baseline-min --approval-mode auto_allow --run-id minimax-baseline-min
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --preset minimax-m3 --profile full --approval-mode auto_allow --run-id minimax-full
```

对比字段：

| 字段 | 看什么 |
|---|---|
| `passed` / `score` | profile 带来的通过率差异 |
| `turn_count` | instructions 和 session 对收敛轮次的影响 |
| token metadata | profile 成本差异 |
| tool events | tool_execution case 是否真实调用工具 |
| session artifacts | full file session 的回放证据 |

## approval case 验证

新增一题或改造一题，加可选 runtime 字段：

```yaml
runtime:
  approval_mode: interactive
```

运行：

```bash
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --mode fixture --approval-mode case --run-id fixture-case-approval
```

期望：

- 带 `runtime.approval_mode: interactive` 的题使用 interactive provider。
- 其他题使用 `AutoAllowApproval()`。
- `trajectory.json.runtime.metadata.effective_approval_mode` 记录真实模式。

## 自动化流程

CI / nightly 默认使用无人值守：

```bash
uv run python scripts/run_kongming_harness_eval.py --suite evals/harness-runtime-v0.1 --preset minimax-m3 --profile full --approval-mode auto_allow
```

自动化环境要求：

- 运行前执行 `make install` 或 `uv sync --all-extras`。
- 设置对应 preset 的 API key env。
- 输出目录保留完整 run artifacts。
- 非零 exit code 按“有 case 未通过”处理，仍收集报告。

## 演进路径

| 阶段 | 内容 | 状态 |
|---|---|---|
| v0.1 | CLI profile + approval mode + 元数据 | 可进入 x-req |
| v0.2 | 多 preset 批量矩阵和 profile diff 报告 | 方案层 |
| v0.3 | case 级 config overrides | 方案层 |
| v0.4 | CI/nightly 产物索引和趋势图 | 方案层 |
