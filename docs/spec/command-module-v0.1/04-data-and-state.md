# 数据与状态

## 1. 核心结构

### `CommandDefinition`

单条命令定义，属于 registry 真源。

建议字段：

```python
CommandDefinition(
    id: str,
    slash: str,
    title: str,
    description: str,
    kind: Literal["prompt", "action", "interactive"],
    source: Literal["builtin", "custom"],
    host_visibility: Literal["cli", "web", "both"],
    aliases: tuple[str, ...],
    argument_hint: str | None,
)
```

### `ParsedInput`

原始输入经过 parser 之后的统一结果。

建议字段：

```python
ParsedInput(
    kind: Literal["text", "command"],
    raw_input: str,
    command_name: str | None,
    args_text: str,
)
```

### `CommandInvocation`

一次命令调用记录，属于执行态数据。

建议字段：

```python
CommandInvocation(
    invocation_id: str,
    session_id: str,
    command_id: str,
    host_kind: Literal["cli", "web"],
    raw_input: str,
    args_text: str,
    requested_at_ms: int,
)
```

### `CommandResult`

命令执行后的统一返回值。

建议字段：

```python
CommandResult(
    status: Literal["completed", "failed", "waiting_input"],
    display_text: str,
    payload: dict[str, object] | None,
    next_action: str | None,
)
```

### `InteractiveCommandState`

交互式命令的共享状态机。

建议字段：

```python
InteractiveCommandState(
    command_id: str,
    step_id: str,
    collected_args: dict[str, object],
    status: Literal["collecting", "ready", "cancelled", "completed"],
)
```

## 2. 持久化范围

v0.1 建议只持久化两类数据：

- custom command 定义
- action command 的运行产物

建议路径：

```text
.kongming/
  commands/
    commands.json
    runs/
      <invocation_id>.json
```

建议规则：

- `commands.json` 只存 workspace 级 custom commands
- builtin commands 不落盘
- `/review` 运行结果进入 `runs/`

## 3. 当前状态与目标状态

### 当前状态

当前仓库只有“原始文本输入”这一种统一输入形态：

- CLI：`read_input()` -> `run_once()`
- Web：`user.input` -> `run_once()`

当前没有：

- command catalog
- command invocation record
- shared command result model

### 目标状态

v0.1 增加一层共享 command 状态：

- 输入态：`ParsedInput`
- 定义态：`CommandDefinition`
- 执行态：`CommandInvocation`
- 结果态：`CommandResult`
- 交互态：`InteractiveCommandState`

## 4. 宿主边界

共享层负责：

- 解析
- 注册
- 执行
- 状态记录

宿主层负责：

- 输入框行为
- slash 候选展示
- 结果卡片或终端输出
- 交互式命令的 UI

## 5. `/review` 的状态要求

`/review` 属于 `action` 命令，建议至少记录：

- 审查对象范围
- reviewer run id
- reviewer status
- 结果摘要
- 完整产物路径

这样 Web 和 CLI 都能稳定显示同一份结果，不依赖宿主私有状态。
