# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 |
|------|------|------|------|
| M1 | 数据契约 & schema v4 迁移 | 无 | 方案确认 |
| M2 | preset LLM 构建 | M1 | 方案确认 |
| M3 | thread 投递（双通道） | M1, M2 | 方案确认 |
| M4 | schedule_tool 上下文继承 | M1 | 方案确认 |
| M5 | per-run trace 观测 | 无 | 方案确认 |

## 模块详情

### M1 数据契约 & schema v4 迁移

**职责**：给 `ScheduledTask` 加 LLM 选择字段 + 给 `ScheduleDelivery` 加投递目标，迁移存量数据。

**包含范围**：

`src/scheduler/domain.py`：
```python
@dataclass(frozen=True)
class ScheduleDelivery:
    channel: DeliveryChannel              # v0.3 已有：web / cli
    target: str | None = None             # v0.4 新增：投递目标
    # None = 只广播到 cron 区域
    # "thread:thread-a1b2c3d4e5f6" = 投递到该 thread
    # 未来扩展："feishu:ou_xxx" 等

@dataclass(frozen=True)
class ScheduledTask:
    # ... v0.3 已有字段 ...
    preset_id: str = ""                   # v0.4 新增：用哪个 LLM preset 跑
```

`ScheduledRun` 不加新字段——复用已有 `delivery_status` / `delivery_error` 表达投递结果。

`SCHEMA_VERSION = 3 → 4`

`src/scheduler/store.py`：
- 启动时检测 `schema_version == 3` → 重置式迁移（与 v2→v3 一致）
  - 备份 `scheduled_tasks.json.v3.bak.<ts>`
  - 写空 `tasks=[]` + `schema_version: 4`
  - 旧任务需用户重新创建
- `_task_to_dict` / `_dict_to_task`：序列化 `delivery.target` + `preset_id`
- `_dict_to_run`：无新字段，不改

**不包含**：投递逻辑、LLM 构建、tool 改动

**风险**：低。重置式迁移简单无 bug；`_dict_to_task` 用 `.get()` 兼容缺字段的老 run jsonl。

---

### M2 per-task runtime 构建

**职责**：每次 cron task 触发时，按 `task.preset_id` 构建独立的 SessionEngine（含正确的 LLM provider），跑完释放。跟 Web 的 per-thread runtime factory 对称。

**架构变更**：

当前 v0.3：`ExecutionBridge` 持有一个固定的 `self._llm`，所有 task 共用。

v0.4：`ExecutionBridge` 持有一个 **runtime factory**，每次 execute 按 task 配置构建独立 runtime。

**包含范围**：

`src/scheduler/execution_bridge.py`：
- `ExecutionBridge.__init__` 改造：
  - 移除 `llm: LLMProvider` 参数（不再绑定单一 LLM）
  - 新增 `preset_map: dict[str, LLMPresetConfig]`
  - 新增 `base_config: Config`（兜底用）
- `execute()` 内部流程变更：
  1. 按 `task.preset_id` 查 preset_map
  2. 构建 per-task 的 `Config`（preset 覆盖 model 字段）
  3. 从 config 构建 LLM provider
  4. `_drive_runner()` 使用该 provider
  5. finally: `await provider.aclose()` 释放 httpx 连接

```python
async def execute(self, reservation: DueTaskReservation) -> ScheduledRun:
    task = reservation.task
    # ... concurrency check ...

    # per-task LLM 构建
    provider = self._build_provider(task.preset_id)
    try:
        final_run = await self._drive_runner(
            request=request, task=task,
            running_record=running_record,
            llm=provider,  # 传入而非用 self._llm
        )
    finally:
        await provider.aclose()
    # ... delivery + audit ...
```

```python
def _build_provider(self, preset_id: str) -> LLMProvider:
    """按 preset_id 构建 LLM provider。空串或未知 preset 走 base_config 兜底。"""
    if preset_id and preset_id in self._preset_map:
        preset = self._preset_map[preset_id]
        cfg = self._apply_preset_to_config(self._base_config, preset)
    else:
        cfg = self._base_config

    if cfg.model.effective_provider == "anthropic":
        return AnthropicMessagesProvider(model_config=cfg.model, ...)
    return OpenAIResponsesProvider(model_config=cfg.model, ...)
```

`src/scheduler/runtime_factory.py`：
- `build_cron_execution_bridge()` 新增 `preset_map` 参数
- 把 `config`（base_config）+ `preset_map` 一并传给 ExecutionBridge
- 不再调 `SessionEngine.build()` 拿 llm（runner / tools / approval 仍共享）

`src/web/app.py`：
- lifespan 装配时把 `cfg.web.llm_presets` 解析为 `preset_map` 传给 `build_cron_execution_bridge`

**关键决策**：
- provider 生命周期 = 单次 execute（构建 → 跑 → aclose）
- runner / tools / approval / session_factory 仍共享（不需要 per-task 重建）
- 只有 LLM provider 是 per-task 的——这是唯一跟 preset 相关的组件
- `_build_provider` 逻辑从 `run.py` 的 preset 解析提取为共享函数（避免两处写死）

**不包含**：domain 字段改动（M1）、投递逻辑（M3）

**风险**：中。provider 构建逻辑必须跟 `run.py` 一致——建议提取为 `src/executors/llm/provider_factory.py` 共用函数。

---

### M3 target 投递（双通道）

**职责**：cron run 完成后，始终广播到 `/ws/cron`（v0.3 行为保留） + 有 `delivery.target` 时投递到对应目标。

**架构设计**：通过 Protocol 接口解耦 scheduler ↔ web 的依赖方向。

```
scheduler/delivery.py        定义 TargetDeliverySink (Protocol)
web/cron_delivery.py         实现 ThreadTargetSink（往 thread 追加消息 + WS 通知）
web/app.py                   装配时注入 ThreadTargetSink 实例
```

**包含范围**：

`src/scheduler/delivery.py`：
- 新增 `TargetDeliverySink` Protocol：
  ```python
  class TargetDeliverySink(Protocol):
      async def deliver_to_target(
          self, target: str, task_name: str, message: str
      ) -> bool:
          """投递到具体目标。返回是否成功。"""
          ...
  ```
- `DeliveryDispatcher.__init__` 新增 `target_sink: TargetDeliverySink | None`
- `DeliveryDispatcher.deliver()` 流程变更：
  1. 始终调 `web_sink.deliver()`（cron 广播，v0.3 行为）
  2. 如果 `task.delivery.target` 非空 → 调 `target_sink.deliver_to_target()`
  3. 任一失败 → `DeliveryResult.failed(error)`

`src/web/app_support/cron_delivery.py`：
- `WebDeliverySink.deliver()` broadcast payload 新增 `delivery_target` 字段
- 新增 `ThreadTargetSink` 类，实现 `TargetDeliverySink`：
  ```python
  class ThreadTargetSink:
      def __init__(self, thread_manager: ThreadManager) -> None: ...

      async def deliver_to_target(self, target: str, task_name: str, message: str) -> bool:
          # 解析 target: "thread:thread-abc" → thread_id
          if not target.startswith("thread:"):
              return False
          thread_id = target[len("thread:"):]
          # 1. 追加消息到 thread session
          # 2. 推送 WS 通知到 thread 连接（如果在线）
          return True
  ```

`src/web/thread_manager.py`：
- 新增 `append_system_message(thread_id: str, text: str) -> bool`
  - 找 cell → session.append(Message(role="assistant", content=text))
  - cell 已 evict → 重建 session 写入（或降级返回 False）
- 新增 `notify_thread(thread_id: str, payload: dict) -> bool`
  - 找 cell → adapter.send_frame(payload)
  - 不在线 → 静默返回 False

**关键决策**：
- thread 追加的是一条 `role=assistant` 消息，内容是 cron 结果摘要
- 投递失败不影响 cron run 状态——`delivery_status=failed` + `delivery_error` 记录即可
- 静默任务（`[SILENT]`）跳过 target 投递，但 cron 广播仍正常
- `Session.append()` 是公开 Protocol 方法，从外部写入无协议障碍

**不包含**：LLM 构建、domain 改动、前端 UI

**风险**：中。ThreadManager 当前无 `append_system_message` API，需要新增；cell 已 evict 时需要决定是否重建 session 来写入。

---

### M4 schedule_tool 上下文继承

**职责**：`schedule_tool._do_create` 创建任务时，自动填充 `delivery.target` + `preset_id`。

**包含范围**：

`src/tools/schedule_tool.py`：

1. 构造函数新增 `default_preset_id: str = ""` 参数：
   ```python
   def __init__(self, store, *, ..., default_preset_id: str = "") -> None:
       self._default_preset_id = default_preset_id
   ```

2. `_do_create` 自动推导 delivery target + preset：
   ```python
   async def _do_create(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
       # ... 已有逻辑 ...

       # v0.4：自动推导 delivery.target
       # web 路径下 ctx.session_id 就是 thread_id（已有约定）
       delivery_target: str | None = None
       if _is_thread_id(ctx.session_id):
           delivery_target = f"thread:{ctx.session_id}"

       # v0.4：preset 从构造参数继承（web 装配时注入）
       preset_id = args.get("preset", "") or self._default_preset_id

       delivery = ScheduleDelivery(channel=channel, target=delivery_target)
       task = ScheduledTask(..., preset_id=preset_id, delivery=delivery)
   ```

`_is_thread_id(s)` 检查 `s` 是否匹配 `^thread-[a-f0-9]{12}$`。CLI 路径下 session_id 不匹配，target 自然为 None。

`src/web/run.py`（装配层）：
- `register_schedule_tool_if_enabled()` 传入 `default_preset_id=preset_id`（从 thread 的 preset 继承）

**不包含**：domain 改动、投递逻辑

**风险**：低。`ToolContext.session_id` 在 web 路径下确实就是 thread_id（代码已验证）。

---

### M5 per-run trace 观测

**职责**：给每次 cron run 挂一个 `JsonlTraceSink`，让执行过程（tool calls、LLM 回复、reasoning）落盘可查。

**包含范围**：

`src/scheduler/execution_bridge.py`（`_drive_runner` 内）：
```python
# 创建 per-run trace sink
trace_path = self._trace_dir / f"cron-{run_id}.jsonl"
trace_sink = JsonlTraceSink(trace_path, auto_flush=True)
sinks_list.append(trace_sink)
# ... runner.run() ...
# finally: 移除 + aclose trace_sink
```

`src/web/app.py` / `src/scheduler/runtime_factory.py`：
- 传 `trace_dir: Path` 给 `ExecutionBridge`（默认 `.kongming/cron/traces/`）

**不包含**：domain 改动、投递逻辑

**风险**：低。`JsonlTraceSink` 已有实现，直接复用。
