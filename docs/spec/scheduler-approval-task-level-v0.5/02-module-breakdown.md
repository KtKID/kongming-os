# 改动拆分

> **本 spec 不是"4 模块系统"**——是 **1 个 dataclass（`ScheduleApprovalProvider`）+ 3 类零散改动**（数据字段 / 装配点 / 调用点）。所谓"M1/M3/M4"是为了 task 切分方便起的编号，不要把它们当作平等的"模块"看待。下表的"性质"列把这件事说清楚。

## 改动总览

| 编号 | 性质 | 改的是什么 | 依赖 | 大致行数 | 状态 |
|------|------|-----------|------|----------|------|
| **③** | **类改造（唯一）** | `ScheduleApprovalProvider` dataclass 加字段 + 改 `decide()` 方法 | ① | ~80 行 | 方案确认 |
| ① | 数据字段 + 1 枚举 | `ApprovalMode` enum + `TaskExecutionPolicy.approval_mode` + `SchedulerApprovalConfig.mode` + schema v4→v5 迁移 + `resolve_effective_mode` 纯函数 helper | 无 | ~50 行 | 方案确认 |
| ② | 装配点（函数内） | `ExecutionBridge._drive_runner` 构造 wrapper 时调 helper 解析 mode（task > global > default）| ① + ③ | ~10 行 | 方案确认 |
| ④ | 调用点（各 1 行） | wrapper 内 `event_sink.emit("approval.cron.auto_allow", ...)` + bridge 内 `store.append_audit("run_approval_auto_allow", ...)` | ③ + ② | ~10 行 | 方案确认 |

> **真正的工作量在 ③**：决策分流逻辑 + metadata 装饰 + 全 8 种 mode×decision_class 组合单测。① 是数据字段（写完即用）、② 是装配胶水（5 行）、④ 是两行调用——这三类不是"独立模块"，是配合 ③ 的小修改。
> 
> 因此 task 切分按 90-task-map 的建议：**整个 spec 1 个 task** 完成（4-6h），而不是 4 个 task。

依赖关系：① 是基础（提供 enum / 字段 / helper），② 和 ③ 都消费 ①；④ 需要 ③ 在 wrapper 内 emit、② 在 bridge 内 append_audit。

## 详细设计

### ① 数据字段 + 1 枚举 + 1 helper {#m1}

> **性质**：纯数据结构 / 类型扩展。不引入新类，不改运行时行为。

**职责**：把"approval_mode"作为可持久化的字段灌入 cron domain 与 config schema，让任务可携带、可全局兜底。

**包含范围**：
- 新建 `ApprovalMode` StrEnum（在 `src/scheduler/domain.py`）
- `TaskExecutionPolicy` 新增 `approval_mode: ApprovalMode | None = None`（`None` = 走全局）
- `SchedulerApprovalConfig` 新增 `mode: ApprovalMode = ApprovalMode.FAIL_CLOSED`
- `SCHEMA_VERSION = 5`；`scheduler/store.py` 启动迁移：v4 → 给所有 task 的 policy 塞 `approval_mode=None`，包内字典 `schema_version=5`
- 提供 helper：`resolve_effective_mode(task_mode, global_mode) -> ApprovalMode`
- env 覆盖：`KONGMING_SCHEDULER_APPROVAL_MODE` 映射到 `config.scheduler.approval.mode`

**不包含范围**：
- 决策逻辑（M2）
- 装配解析（M3）

**依赖**：无（基础设施）

**复用/新建**：
- 复用 `config_loader.models.SchedulerApprovalConfig`（已存在，加字段）
- 复用 `scheduler.domain.TaskExecutionPolicy`（已存在，加字段）
- 新建 `ApprovalMode` enum
- 修改 `scheduler/store.py` 的 schema 迁移逻辑

**数据结构 / 接口**：

```python
# src/scheduler/domain.py
class ApprovalMode(StrEnum):
    FAIL_CLOSED = "fail_closed"  # 当前行为：consent → rejected
    TRUST = "trust"              # cron 信任：hard_block 外全放


@dataclass(frozen=True)
class TaskExecutionPolicy:
    # ... 原有字段
    approval_mode: ApprovalMode | None = None  # None = 走全局默认


def resolve_effective_mode(
    task_mode: ApprovalMode | None,
    global_mode: ApprovalMode,
) -> ApprovalMode:
    """task 显式声明优先，否则全局兜底。"""
    return task_mode if task_mode is not None else global_mode
```

```python
# src/config_loader/models.py
class SchedulerApprovalConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: Literal["fail_closed", "trust"] = "fail_closed"
    # 老字段保留兼容；trust 模式下此字段无效（trust 已经放开了）
    allow_write_file_create_in_cwd: bool = True
```

**风险等级**：低
**风险说明**：schema 迁移已有 v0.2/v0.3/v0.4 三轮先例（store.py 的 schema 重置 + 字段补全），按既有模式跟做即可。

**task 建议**：合并到主 task `scheduler-approval-mode-per-task-v0.5`，不单拆。

---

### ③ 核心 · `ScheduleApprovalProvider` dataclass 改造 {#m2}

> **性质**：**本 spec 唯一的"类"改造**。已有 frozen dataclass，加 2 个构造字段 + 改 `decide()` 方法主体。这是真正承载 trust / fail_closed 语义的地方。

**职责**：把 `ScheduleApprovalProvider` 从单一 fail-closed 改造为按 `mode` 分支的决策器，trust 模式下 `explicit_consent` 自动 approved，`hard_block` 透传 rejected。

**包含范围**：
- `ScheduleApprovalProvider` 加 `mode: ApprovalMode` 构造参数
- `decide()` 方法按 mode 分流：
  - `fail_closed`：保留现有逻辑（仅 `_is_allowed_cron_file_create` 白名单 + 其他 consent → rejected）
  - `trust`：`hard_block` 透传 rejected；`silent_allow` / `standard_allow` 透传；`explicit_consent` 转 approved
- metadata 装饰：trust 自动批准时写 `cron_trust_mode=true` + `decision_source=cron_trust` + `original_decision_class` + `original_outcome` + `cron_task_id`
- emit `Event(kind="approval.cron.auto_allow")`（M4 配合）

**不包含范围**：
- 全局 / task 优先级解析（M3）
- audit 行写入（M4 由外部 sink 完成）

**依赖**：M1（消费 `ApprovalMode`）

**复用/新建**：修改 `src/scheduler/safety_wrapper.py` 已有的 `ScheduleApprovalProvider`，不新建类

**数据结构 / 接口**：

```python
# src/scheduler/safety_wrapper.py
@dataclass(frozen=True)
class ScheduleApprovalProvider:
    inner: ApprovalProvider
    task_id: str
    mode: ApprovalMode                           # 新增
    policy: SchedulerApprovalConfig = field(default_factory=SchedulerApprovalConfig)
    event_sink: EventSink | None = None          # 新增（M4）

    async def decide(self, request: ApprovalRequest) -> ApprovalDecision:
        decision = await self.inner.decide(request)
        decision_class = str(decision.metadata.get("decision_class", ""))

        # 1. hard_block 永远透传（不可绕）
        if decision_class == "hard_block":
            return decision

        # 2. trust 模式：consent 自动放
        if self.mode is ApprovalMode.TRUST and decision_class == "explicit_consent":
            return self._wrap_trust_allow(decision, request)

        # 3. fail_closed 模式：保留现有逻辑（write_file 白名单 + 其他拒绝）
        if self.mode is ApprovalMode.FAIL_CLOSED and decision_class == "explicit_consent":
            return self._apply_fail_closed(decision, request)

        # 4. silent_allow / standard_allow → 透传
        return decision
```

**决策矩阵**（trust / fail_closed × 4 类 decision_class）：

| decision_class | fail_closed 模式 | trust 模式 |
|---|---|---|
| `hard_block` | rejected（透传）| rejected（透传）|
| `silent_allow` | approved（透传）| approved（透传）|
| `standard_allow` | approved（透传）| approved（透传）|
| `explicit_consent` (standard) | rejected（除 write_file 白名单）| **approved**（自动放）|
| `explicit_consent` (elevated) | rejected | **approved**（自动放）|

**风险等级**：中
**风险说明**：决策流改造涉及安全语义，必须**单测覆盖全 8 种组合**（2 模式 × 4 decision_class），保证 hard_block 永远拒绝。另需补一组 elevated × trust 的边界用例。

**task 建议**：合并到主 task。

---

### ② 装配点 · `_drive_runner` 改 5 行 {#m3}

> **性质**：在已有方法体内插入函数调用 + 构造参数变化。不是新模块，不是新类，是一段装配胶水。

**职责**：在 `ExecutionBridge._drive_runner()` 装配 `ScheduleApprovalProvider` 的时刻，按"task > global > default fail_closed"三级优先级解析最终 mode，传给 wrapper。

**包含范围**：
- `_drive_runner()` 第 427-435 行的 wrapper 构造改造
- 调用 `resolve_effective_mode(task.policy.approval_mode, config.scheduler.approval.mode)`
- 把 `mode` 传给 `ScheduleApprovalProvider(...)` 构造
- 失败回退：`base_config is None` 时（CLI 装配缺失）使用默认 `fail_closed`

**不包含范围**：
- 决策逻辑本身（M2 内部）
- audit 写入（M4）

**依赖**：M1（消费 `resolve_effective_mode` helper）+ M2（构造 wrapper）

**复用/新建**：修改 `src/scheduler/execution_bridge.py:427-435` 已有装配代码

**数据结构 / 接口**：

```python
# src/scheduler/execution_bridge.py 改造片段
from scheduler.domain import ApprovalMode, resolve_effective_mode

# ...
global_mode = (
    self._base_config.scheduler.approval.mode
    if self._base_config is not None
    else ApprovalMode.FAIL_CLOSED
)
effective_mode = resolve_effective_mode(task.policy.approval_mode, global_mode)

wrapped_approval = ScheduleApprovalProvider(
    inner=self._inner_approval,
    task_id=task.task_id,
    mode=effective_mode,
    policy=(
        self._base_config.scheduler.approval
        if self._base_config is not None
        else SchedulerApprovalConfig()
    ),
    event_sink=_aggregate_event_sink(self._event_sinks),  # M4 用
)
```

**风险等级**：低
**风险说明**：装配层改动有限；主要风险是漏传 `event_sink` 导致 M4 失效——需单测验证 wrapper 拿到 sink 后能 emit。

**task 建议**：合并到主 task。

---

### ④ 审计调用点 · 各 1 行 emit / append_audit {#m4}

> **性质**：在 ③ 的 wrapper 内加一行 `event_sink.emit(...)`、在 ② 的 bridge 内加一行 `store.append_audit(...)`。没有新类、没有新 Protocol、没有新文件。

**职责**：trust 模式下每次自动批准都留下两份证据：
1. **trace event**：`Event(kind="approval.cron.auto_allow", payload={...})` → JsonlTraceSink 写入 `.kongming/trace.jsonl`
2. **audit 行**：`Store.append_audit(action="run_approval_auto_allow", ...)` 写入 `.kongming/cron/audit.jsonl`

**包含范围**：
- `ScheduleApprovalProvider` 在 trust 自动放行时 emit event（通过 M3 注入的 sink）
- `ExecutionBridge` 在收到 wrapper 的 trust approved 后写 audit 行
- event payload 字段：`task_id` / `run_id`（如可拿）/ `tool_name` / `original_decision_class` / `original_decision_source` / `matched_rule` / `reason` / `arguments_digest`（前 200 字 hash）
- audit action 名：`run_approval_auto_allow`，payload 同上

**不包含范围**：
- web 端实时弹窗（独立 spec）
- LLM trace 中 reasoning 内容（不写）

**依赖**：M2（在 wrapper 内 emit）+ M3（注入 sink）

**复用/新建**：
- 复用 `core.contracts.Event` + `core.contracts.EventSink`（无新 Protocol）
- 复用 `Store.append_audit`（无新 action 真源，加一个常量字符串即可）
- `ExecutionBridge._drive_runner` finally 块外加一个钩子（决策结果通过 wrapper 返回后由 runner 触发 tool.call.start，bridge 不直接观察；改成 wrapper 自己 emit event，bridge 监听 sink 反过来写 audit）

**数据结构 / 接口**：

```python
# event payload 示例（写入 trace.jsonl）
{
  "kind": "approval.cron.auto_allow",
  "ts": "2026-05-17T09:00:00Z",
  "payload": {
    "task_id": "task-abc123",
    "run_id": "run-sched-task-abc123-deadbeef",
    "tool_name": "run_shell",
    "original_decision_class": "explicit_consent",
    "original_decision_source": "standard",
    "matched_rule": "shell.execute_script",
    "reason": "shell command requires consent",
    "arguments_digest": "sha256:7a8b9c..."  // 前 200 字 SHA256
  }
}

# audit 行示例（写入 .kongming/cron/audit.jsonl）
{
  "ts": "2026-05-17T09:00:00Z",
  "action": "run_approval_auto_allow",
  "task_id": "task-abc123",
  "actor": "scheduler",
  "payload": {
    "run_id": "run-sched-task-abc123-deadbeef",
    "tool_name": "run_shell",
    "original_decision_class": "explicit_consent",
    "original_decision_source": "standard",
    "matched_rule": "shell.execute_script"
  }
}
```

**风险等级**：低
**风险说明**：event 必须**异步 emit 不阻塞**（沿用现有 EventSink 协议的 await 语义）；payload 不写大对象（arguments 用 digest 代替）防止 trace 膨胀。

**task 建议**：合并到主 task。

---

## 模块外部接口

本 spec 不引入新 Protocol；所有改动收敛在 scheduler / config_loader 包内。对外接口变化：

| 接口 | 改动 |
|---|---|
| `schedule_tool` create action | 接受 `approval_mode` 入参（可选）|
| `KONGMING_SCHEDULER_APPROVAL_MODE` | 新增 env 覆盖 |
| `config.scheduler.approval.mode` yaml 字段 | 新增 |
| `ScheduledTask.policy.approval_mode` 持久化字段 | 新增 |
| trace event kind `approval.cron.auto_allow` | 新增 |
| audit action `run_approval_auto_allow` | 新增 |
