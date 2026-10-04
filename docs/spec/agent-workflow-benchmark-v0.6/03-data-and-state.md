# 数据与状态

## 1. WorkflowBenchmarkCase

```python
from dataclasses import dataclass, field
from typing import Any, Literal


BenchmarkLane = Literal["stub", "replay", "real-provider-smoke"]
WorkflowMode = Literal["parallel", "map_reduce", "roundtable_review", "deep_research"]


@dataclass(frozen=True)
class WorkflowBenchmarkCase:
    case_id: str
    title: str
    lane: BenchmarkLane
    mode: WorkflowMode
    objective: str
    payload: dict[str, Any]
    tags: tuple[str, ...] = ()
    repeats: int = 1
    budgets: dict[str, int] = field(default_factory=dict)
    fixtures: dict[str, str] = field(default_factory=dict)
    expected_artifacts: tuple[str, ...] = ()
    assertions: tuple[dict[str, Any], ...] = ()
    score_weights: dict[str, float] = field(default_factory=dict)
```

字段约束：

- `case_id` 稳定唯一，推荐形如 `workflow.map_reduce.basic.reduce`
- `lane` 对齐 `agent-eval-suite` 的执行 lane
- `mode` 对应 `AgentWorkflowManager.run_workflow_payload()` 支持的 strategy
- `payload` 是传给 workflow strategy 的原始 payload
- `assertions` 只放声明式断言

## 2. WorkflowBenchmarkSnapshot

```python
@dataclass
class WorkflowBenchmarkSnapshot:
    workflow_id: str
    workflow_dir: str
    mode: str
    workflow_json: dict[str, Any]
    result_json: dict[str, Any]
    report_index: dict[str, Any]
    reports: list[dict[str, Any]]
    agent_results: list[dict[str, Any]]
    subagent_records: list[dict[str, Any]]
    audit_events: list[dict[str, Any]]
    child_session_events: list[dict[str, Any]]
    trace_events: list[dict[str, Any]]
    diagnostics: list[dict[str, Any]] = field(default_factory=list)
```

`WorkflowBenchmarkSnapshot` 是 scorer 的唯一输入面。scorer 读取收敛后的事实记录，保持评分可复算。

## 3. WorkflowBenchmarkResult

```python
@dataclass
class WorkflowBenchmarkResult:
    case_id: str
    lane: BenchmarkLane
    mode: str
    workflow_id: str | None
    completed: bool
    score: float
    gate_status: Literal["passed", "failed", "warning"]
    metrics: dict[str, float | int | str | bool]
    grader_results: list[dict[str, Any]]
    artifacts: dict[str, str]
    diagnostics: list[dict[str, Any]]
```

## 4. SuiteReport

```python
@dataclass
class WorkflowBenchmarkSuiteReport:
    suite_name: str
    suite_run_id: str
    started_at: str
    finished_at: str
    total_cases: int
    passed_cases: int
    failed_cases: int
    mode_summary: dict[str, dict[str, int]]
    lane_summary: dict[str, dict[str, int]]
    metric_summary: dict[str, float]
    results: list[WorkflowBenchmarkResult]
    artifact_index: dict[str, list[str]]
```

## 5. 目录布局

```text
tests/
  fixtures/
    agent_eval/
      workflow_cases/
        workflow.parallel.basic.yaml
        workflow.map_reduce.basic.yaml
        workflow.roundtable_review.basic.yaml
        workflow.deep_research.basic.yaml
      workflow_replay/
      workflow_expected/

docs/
  agent-workflow-benchmark-v0.6/

<kongming_home>/
  benchmarks/
    agent-workflows/
      <suite_run_id>/
        summary.json
        case-results.jsonl
        report.md
        artifacts-index.json
```

## 6. Assertion 类型

| 类型 | 示例 | 说明 |
|---|---|---|
| `artifact_exists` | `{"path": "result.json"}` | 断言 artifact 存在 |
| `json_path_equals` | `{"path": "result.json", "json_path": "$.completed", "value": true}` | 精确字段断言 |
| `json_path_min` | `{"path": "deep_research/stats.json", "json_path": "$.selected_source_count", "min": 3}` | 阈值断言 |
| `audit_sequence` | `{"actions": ["workflow_started", "workflow_completed"]}` | 事件顺序断言 |
| `required_text` | `{"path": "review_board/final_report.md", "contains": ["..."]}` | 文本命中断言 |
| `mode_metric` | `{"metric": "subagent_failure_rate", "max": 0.0}` | 指标阈值断言 |
