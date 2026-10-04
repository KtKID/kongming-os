# 数据与状态

## 1. EvalProfile

```python
EvalProfile = Literal["baseline-min", "full"]
```

| 值 | 语义 |
|---|---|
| `baseline-min` | 最小 runtime 切片，空 instructions、memory session、Noop compactor |
| `full` | 当前 harness 默认切片，eval instructions、file session、config compactor |

## 2. EvalApprovalMode

```python
EvalApprovalMode = Literal["auto_allow", "interactive", "case"]
TaskApprovalMode = Literal["auto_allow", "interactive"]
```

| 值 | 语义 |
|---|---|
| `auto_allow` | 所有 consent 请求自动通过 |
| `interactive` | 所有 consent 请求交给人工 prompt |
| `case` | 每题读取 `runtime.approval_mode`，缺省走 `auto_allow` |

## 3. Task Runtime Options

题目 YAML 增加可选 `runtime` 对象：

```yaml
runtime:
  approval_mode: interactive
  max_turns: 80
  profile: full
```

首版只要求 `approval_mode`。`max_turns` 和 `profile` 可作为后续扩展字段，首版 schema 可以拒绝未实现字段，也可以先保留到 metadata。

## 4. EvalEnvironmentSnapshot

```python
@dataclass(frozen=True)
class EvalEnvironmentSnapshot:
    suite: str
    run_id: str
    config_path: str
    mode: str
    preset: str | None
    profile: str
    approval_mode: str
    instructions_mode: str
    session_backend: str
    compactor_mode: str
    trace_output_path: str
```

**写入规则**：

- suite 级 snapshot 写入 `summary.json`。
- task 级 snapshot 写入 `trajectory.json.runtime.metadata`。
- `report.md` 只展示人类需要的字段。

## 5. RuntimeProfileResolution

```python
@dataclass(frozen=True)
class RuntimeProfileResolution:
    profile: str
    instructions: str
    instructions_mode: str
    agent_spec: AgentSpec | None
    session_factory: Callable[[str], Session]
    session_backend: str
    message_compactor: MessageCompactor | None
    compactor_mode: str
```

**baseline-min 建议值**：

| 字段 | 值 |
|---|---|
| `instructions` | `""` |
| `instructions_mode` | `empty` |
| `agent_spec` | 显式 `AgentSpec(name="harness-baseline-min", instructions="", ...)` |
| `session_backend` | `memory` |
| `compactor_mode` | `noop-script` |

**full 建议值**：

| 字段 | 值 |
|---|---|
| `instructions` | 当前 eval system instructions |
| `instructions_mode` | `eval_default` |
| `agent_spec` | `None` |
| `session_backend` | `file` |
| `compactor_mode` | `config` |

## 6. ApprovalResolution

```python
@dataclass(frozen=True)
class ApprovalResolution:
    suite_mode: str
    task_mode: str
    effective_mode: str
    provider_name: str
```

**解析规则**：

| suite mode | task runtime | effective mode |
|---|---|---|
| `auto_allow` | 任意 | `auto_allow` |
| `interactive` | 任意 | `interactive` |
| `case` | 缺省 | `auto_allow` |
| `case` | `approval_mode: auto_allow` | `auto_allow` |
| `case` | `approval_mode: interactive` | `interactive` |

## 7. Artifact Layout

```text
runs/<run-id>/
  summary.json
  tasks.json
  report.md
  trace.jsonl
  sessions/
  tasks/<task-id>/
    trajectory.json
    kongming_home/
```

baseline-min 的 `sessions/` 可以为空，因为 memory session 是 profile 语义的一部分。`trajectory.json` 仍是单题事实源。

## 8. 状态流转

状态流转见 `diagrams.md` 的 “Runtime Profile 状态流转”。
