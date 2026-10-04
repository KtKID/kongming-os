# 采集与执行

## 1. 采集顺序

`ArtifactCollector` 按以下顺序读取 workflow 事实源：

1. `workflow.json`
2. `result.json`
3. `reports/index.json`
4. `reports/*.json`
5. `agents/*/result.json`
6. `agents/*/subagent.json`
7. `audit.jsonl`
8. child session JSONL
9. trace JSONL

token 聚合顺序：

1. `result.<mode>.child_agent_usage_totals`
2. `reports[].usage`
3. `agents/*/subagent.json.usage`
4. child session JSONL message usage
5. trace JSONL `usage` event

这个顺序对齐现有 Web workflow viewer 的投影模型，同时保留 trace 作为诊断补充。

## 2. 执行 lane

### `stub`

用途：

- CI 主门禁
- scorer 和 artifact 合同回归
- 低成本快速验证

执行方式：

- fake subagent
- fake source provider
- 固定 response script
- 固定 expected artifact

### `replay`

用途：

- 重放历史 workflow 目录
- 对 collector / scorer 做回归
- 支持两个 commit 的报告差异对比

执行方式：

- 直接读取 replay fixture 下的 workflow 目录
- 跳过真实 `AgentWorkflowManager.run_workflow_payload()`
- 输出同一套 `WorkflowBenchmarkResult`

### `real-provider-smoke`

用途：

- release gate
- 手动 benchmark
- 真实模型策略收益比较

执行约束：

- 固定 model preset
- 固定 temperature / reasoning effort
- 固定 max_turns
- 固定工具白名单
- 固定输入文件快照
- 每个 case 默认 3 次 repeats

## 3. BenchmarkManager

`BenchmarkManager` 是唯一公共入口。

```python
class BenchmarkManager:
    def run_suite(self, manifest_path: Path) -> WorkflowBenchmarkSuiteReport:
        ...

    def collect_existing_workflow(
        self,
        *,
        case: WorkflowBenchmarkCase,
        workflow_dir: Path,
    ) -> WorkflowBenchmarkResult:
        ...

    def write_report(
        self,
        *,
        suite_report: WorkflowBenchmarkSuiteReport,
        output_dir: Path,
    ) -> None:
        ...
```

内部组件：

- `CaseManifestLoader`
- `ArtifactCollector`
- `WorkflowBenchmarkScorer`
- `BenchmarkReportWriter`

## 4. 报告产物

```text
summary.json
case-results.jsonl
report.md
artifacts-index.json
```

`summary.json` 示例字段：

```json
{
  "suite_name": "agent-workflow-benchmark-p0",
  "suite_run_id": "awb-20260616T120000",
  "total_cases": 4,
  "passed_cases": 4,
  "failed_cases": 0,
  "metric_summary": {
    "score_avg": 92.5,
    "total_tokens": 128000,
    "workflow_elapsed_ms_p50": 32000,
    "subagent_failure_rate_avg": 0.0
  }
}
```

`case-results.jsonl` 一行一个 case result，便于后续趋势分析。

`report.md` 面向开发者阅读，按 mode 分组展示失败原因和指标 delta。

## 5. 与现有模块关系

- `AgentWorkflowManager` 负责真实 workflow 执行和 artifact 写入。
- `BenchmarkManager` 负责 case 读取、artifact 采集、评分和报告。
- `WorkflowRunViewerManager` 负责 Web 只读展示。
- 可复用的 host-neutral artifact reader 放在 `application.agent_workflows.benchmarking` 或后续提升为 `application.agent_workflows.artifacts`。
