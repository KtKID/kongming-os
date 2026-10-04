# Task 映射

## 总体结论

`agent-workflow-benchmark-v0.6` 适合分三期实施。先产出可复算报告，再接真实执行，最后补趋势和 release gate。

## task 列表

| 阶段 | 建议 task 名 | 前置依赖 | 说明 |
|---|---|---|---|
| P0 | `agent-workflow-benchmark-offline` | 无 | 离线 collector、scorer、report writer |
| P1 | `agent-workflow-benchmark-runner` | P0 | `BenchmarkManager.run_suite()` 执行 `stub` / `replay` |
| P2 | `agent-workflow-benchmark-live-gate` | P1 | `real-provider-smoke`、多轮统计、baseline/candidate 对比 |

## P0 验收口径

- 新增 `src/application/agent_workflows/benchmarking/benchmark_manager.py`
- 新增合同结构：case、snapshot、result、suite report
- 支持读取已有 workflow 目录
- 支持通用指标：
  - `completed`
  - `workflow_elapsed_ms`
  - `total_tokens`
  - `subagent_failure_rate`
  - `artifact_missing_count`
- 支持基础 assertion：
  - `artifact_exists`
  - `json_path_equals`
  - `json_path_min`
  - `audit_sequence`
- 输出：
  - `summary.json`
  - `case-results.jsonl`
  - `report.md`
- 测试：
  - `tests/unit/test_agent_workflow_benchmark_contracts.py`
  - `tests/unit/test_agent_workflow_benchmark_collector.py`
  - `tests/unit/test_agent_workflow_benchmark_scoring.py`

## P1 验收口径

- `BenchmarkManager.run_suite()` 能执行 manifest
- `stub` lane 跑通
- `replay` lane 跑通
- 首批 4 个样例 case：
  - `workflow.parallel.basic`
  - `workflow.map_reduce.basic`
  - `workflow.roundtable_review.basic`
  - `workflow.deep_research.basic`
- mode 专属 scorer 覆盖：
  - `map_reduce`
  - `roundtable_review`
  - `deep_research`

## P2 验收口径

- `real-provider-smoke` lane 跑通
- 支持 repeats，输出 median / p90 / variance
- 支持 baseline 与 candidate 对比
- release gate 阈值：
  - 质量分下降超过 5% 标红
  - token 上升超过 15% 标红
  - 耗时上升超过 20% 标红
  - 完成率下降标红
- 可选接入 Web viewer 的 benchmark result 入口

## 推荐开发顺序

1. `agent-workflow-benchmark-offline`
2. `agent-workflow-benchmark-runner`
3. `agent-workflow-benchmark-live-gate`

P0 是当前最小可交付切片，能立刻把已有 workflow artifact 转成可复算 benchmark 报告。
