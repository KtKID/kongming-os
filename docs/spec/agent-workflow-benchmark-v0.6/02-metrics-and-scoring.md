# 指标与评分

## 1. 指标分层

### P0 指标

| 指标 | 来源 | 说明 |
|---|---|---|
| `completed` | `result.json` | workflow 是否完成 |
| `status` | `workflow.json` / `result.json` / `runs[]` | workflow 和子任务状态 |
| `artifact_missing_count` | workflow 目录 | 必需产物缺失数量 |
| `audit_sequence_ok` | `audit.jsonl` | 关键事件顺序是否完整 |
| `total_tokens` | mode extra / reports / subagent / session | token 总量 |
| `input_tokens` | usage 聚合 | 输入 token |
| `output_tokens` | usage 聚合 | 输出 token |
| `reasoning_tokens` | usage 聚合 | reasoning 输出 token |
| `workflow_elapsed_ms` | `started_at` / `finished_at` | workflow 墙钟耗时 |
| `subagent_elapsed_ms` | `agents/*/result.json` | 子任务耗时 |
| `subagent_failure_rate` | `runs[]` / `agent_failed` | 子任务失败比例 |
| `score` | scorer | 归一化任务质量分 |

### P1 指标

| 指标 | 说明 |
|---|---|
| `score_variance` | 多次运行的质量分方差 |
| `token_variance` | 多次运行的 token 方差 |
| `elapsed_variance` | 多次运行的耗时方差 |
| `critical_path_ms` | 并行子任务关键路径耗时 |
| `speedup_ratio` | 串行耗时估算 / 实际耗时 |
| `cost_proxy` | 基于固定价格表的成本估算 |
| `trace_usage_gap` | artifact usage 与 trace usage 的差异 |

## 2. 主评分

每个 case 产出 `0..100` 主评分。

| 维度 | 权重 | 评分依据 |
|---|---:|---|
| 任务正确性 | 40 | gold assertion、required finding、mode 状态 |
| 证据可信度 | 20 | source 命中、引用覆盖、claim-to-evidence 映射 |
| 编排健康 | 15 | 子任务完成率、重试、超时、audit 顺序 |
| 资源效率 | 15 | token 和耗时按 case budget 归一化 |
| 可诊断性 | 10 | artifact 完整、错误分类、per-child 明细 |

硬门槛：

| 条件 | 分数上限 |
|---|---:|
| schema 失败 | 40 |
| workflow 未完成 | 60 |
| 核心 artifact 缺失 | 70 |
| scoped workdir 或 grant 审计违规 | 30 |

资源效率：

```text
token_score = min(1, token_budget / actual_tokens)
time_score = min(1, time_budget_ms / actual_elapsed_ms)
efficiency = 0.6 * token_score + 0.4 * time_score
```

## 3. Mode 专属评分

### `parallel`

- 子任务完成率
- 每个报告是否写入 `reports/*.json`
- 失败子任务是否进入 `agent_failed`
- `reports/index.json` 是否覆盖全部 task

### `map_reduce`

- shard 覆盖率
- mapper 成功率
- reducer 输出是否包含必需 finding
- failed shard 是否进入结果和 audit
- retry / timeout 事件是否可追溯

### `roundtable_review`

- reviewer 覆盖率
- independent claim 数量
- rebuttal 命中率
- final report 是否吸收关键 claim
- `child_agent_usage_totals` 是否完整

### `deep_research`

- selected source 数量
- fetched / duplicate / failed source 统计
- fact 数量和 group 数量
- upheld / rejected group 比例
- `stats.json`、`phase_summaries.json`、report artifact 是否完整

## 4. 报告展示

报告按 `case_id + mode + commit + run_id` 聚合。

核心字段：

- `score`
- `completed`
- `total_tokens`
- `workflow_elapsed_ms`
- `subagent_failure_rate`
- `artifact_missing_count`
- `gate_status`
- `regression_reason`

对比字段：

- `baseline`
- `candidate`
- `delta`
- `delta_pct`
- `threshold`
