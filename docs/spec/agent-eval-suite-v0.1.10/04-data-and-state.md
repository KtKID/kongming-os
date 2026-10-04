# 数据与状态

## 1. CaseSpec

```python
from dataclasses import dataclass, field
from typing import Literal, Any


ExecutionLane = Literal["stub", "replay", "real-provider-smoke"]
HostMode = Literal["cli", "web", "runtime-only"]


@dataclass(frozen=True)
class CaseSpec:
    case_id: str
    title: str
    lane: ExecutionLane
    host_mode: HostMode
    objective: str
    tags: tuple[str, ...] = ()
    user_input: str = ""
    session_seed: tuple[dict[str, Any], ...] = ()
    llm_script: tuple[dict[str, Any], ...] = ()
    enabled_tools: tuple[str, ...] = ()
    config_overrides: dict[str, Any] = field(default_factory=dict)
    fixtures: dict[str, Any] = field(default_factory=dict)
    expectations: dict[str, Any] = field(default_factory=dict)
    artifacts: tuple[str, ...] = ()
```

**字段约束**：

- `case_id`：稳定唯一，推荐形如 `safety.permission.ask.reject`
- `lane`：决定执行器和 grader 严格度
- `host_mode`：决定走 `Runner`、CLI 还是 web thread
- `llm_script`：`stub` lane 必填；`replay` lane 放录制响应；`real-provider-smoke` 为空
- `expectations`：只放声明式断言，不放执行逻辑

## 2. ExecutionRecord

```python
@dataclass
class ExecutionRecord:
    case_id: str
    lane: ExecutionLane
    host_mode: HostMode
    passed: bool
    result_status: str
    final_text: str | None
    turn_count: int
    events: list[dict[str, Any]]
    prompt_debug_paths: list[str]
    session_artifacts: list[str]
    extra_artifacts: list[str]
    metadata: dict[str, Any] = field(default_factory=dict)
```

**为什么它重要**：

- `ExecutionRecord` 是 grader 的唯一输入面。
- grader 不直接读 runtime 内部对象，只读收敛后的事实记录。

## 3. GraderResult

```python
@dataclass(frozen=True)
class GraderResult:
    case_id: str
    grader_name: str
    passed: bool
    score: float
    message: str
    evidence: dict[str, Any] = field(default_factory=dict)
```

**score 约定**：

- 确定性断言：`0.0` 或 `1.0`
- 语义 grader：`0.0 ~ 1.0`
- suite 默认以 `passed` 为准，`score` 供细分分析

## 4. SuiteReport

```python
@dataclass
class SuiteReport:
    suite_name: str
    started_at: str
    finished_at: str
    total_cases: int
    passed_cases: int
    failed_cases: int
    lane_summary: dict[str, dict[str, int]]
    tag_summary: dict[str, dict[str, int]]
    results: list[GraderResult]
    artifact_index: dict[str, list[str]]
```

## 5. 断言目录

当前框架推荐把断言分成五类：

| 类型 | 说明 | 适用面 |
|---|---|---|
| `result_status` | `completed/failed`、最终文本片段、turn 数 | 所有 case |
| `event_sequence` | 关键事件顺序 | runner / safety / stream / web |
| `event_payload` | 关键 payload 字段 | safety / trace / skill / scheduler |
| `artifact_shape` | session JSONL、prompt-debug、thread file、review file | context / web / evolution |
| `semantic` | 输出语义是否符合目标 | 真实 provider 或复杂 text task |

## 6. 推荐目录布局

这套设计直接贴合当前 repo：

```text
tests/
  unit/
    test_agent_eval_schema.py
    test_agent_eval_graders.py
    test_agent_eval_report.py
  e2e/
    test_agent_eval_stub.py
    test_agent_eval_replay.py
    test_agent_eval_smoke.py
  fixtures/
    agent_eval/
      cases/
        core.plain_chat.single_turn.yaml
        safety.permission.ask.reject.yaml
        web.thread.resume.yaml
      llm_scripts/
      replay_payloads/
      expected_artifacts/
  manual/
    README.md
```

## 7. 与当前事实源的关系

这套数据结构直接消费当前 repo 已有事实源：

- `trace.jsonl`
- `.kongming/debug/prompt-debug-*.json`
- `.kongming/sessions/<session>/*.jsonl`
- web thread file
- `.kongming/evolution/reviews/*.json`
- `evolution-nutrients.jsonl`

当前框架已经把这些文件做成稳定证据面，所以测试集应该把它们视作一等输入。
