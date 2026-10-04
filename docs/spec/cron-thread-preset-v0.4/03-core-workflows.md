# 核心流程

## 流程 1：用户在 thread 中创建 cron 任务（v0.4 变更）

```
用户在 thread-abc（preset=claude-sonnet）说："每天 9 点提醒我站起来活动"
  ↓
LLM 调 schedule_tool({
  name: "站起来活动",
  schedule: "0 9 * * *",
  input: "提醒用户：该站起来活动 5 分钟了！",
  // v0.4：preset 不需要显式传，从 ToolContext 自动继承
})
  ↓ schedule_tool._do_create
ctx.session_id = "thread-abc"          → _is_thread_id → true
  → delivery.target = "thread:thread-abc"
  → preset_id = "claude-sonnet"        （从装配层注入的 default_preset_id）
  ↓
store.create_task(ScheduledTask(
    ...,
    delivery=ScheduleDelivery(channel=WEB, target="thread:thread-abc"),
    preset_id="claude-sonnet",         # v0.4 新增
))
  ↓
返回 task_id 给 LLM
```

## 流程 2：cron 触发 → 用正确 LLM 跑 → 双通道投递（v0.4 端到端）

```
[ticker tick]
  ↓
store.reserve_due_tasks(now)
  ↓ 拿到 DueTaskReservation(task=..., scheduled_for=...)
ExecutionBridge.execute(reservation)
  ↓
  ├─ 1) concurrency_policy 检查
  ├─ 2) 生成 fresh session_id + run_id
  ├─ 3) 写 ScheduledRun(RUNNING) + audit
  │
  ├─ 4) 【v0.4 新增】解析 LLM
  │     task.preset_id = "claude-sonnet"
  │     → _resolve_llm("claude-sonnet")
  │     → preset_map["claude-sonnet"] 存在
  │     → 构建 AnthropicMessagesProvider(model="claude-sonnet-4-6", ...)
  │     llm = per_preset_provider
  │
  ├─ 5) 【v0.4 新增】挂 trace sink
  │     trace_sink = JsonlTraceSink(".kongming/cron/traces/cron-{run_id}.jsonl")
  │     runner._event_sinks.append(trace_sink)
  │
  ├─ 6) _drive_runner(request, task, running_record)
  │     ├─ 工具裁剪（移除 schedule.*/cron.*）
  │     ├─ approval 包装（fail-closed）
  │     ├─ watchdog（inactivity timeout）
  │     ├─ runner.run(input_text, session, llm=per_preset_provider, ...)
  │     └─ classify_result → ScheduledRun
  │
  ├─ 7) _apply_delivery (v0.3 行为保留 + v0.4 target 投递)
  │     ├─ 7a) cron 广播（始终）
  │     │     WebDeliverySink.deliver → broker.broadcast({
  │     │       kind: "cron.run.completed",
  │     │       task_id, task_name, run_id,
  │     │       final_message,
  │     │       delivery_target: "thread:thread-abc",   ← v0.4 新增
  │     │     })
  │     │
  │     └─ 7b) target 投递（delivery.target 非空时）
  │           → DeliveryDispatcher 调 target_sink.deliver_to_target(
  │               "thread:thread-abc", "站起来活动", "该站起来活动...")
  │           → ThreadTargetSink 解析 "thread:" 前缀
  │           → ThreadManager.append_system_message + notify_thread
  │
  ├─ 8) supersede_and_append_run(final_run) + update_task(last_run_at)
  │
  └─ 9) finally: trace_sink.aclose() + per_preset_provider.aclose()
```

## 流程 3：target 投递细节

```
DeliveryDispatcher.deliver(task, run, final_message)
  ↓
  ├─ 1) web_sink.deliver() → cron 广播（始终）
  │
  └─ 2) task.delivery.target 非空？
       ↓ 空 → 跳过
       ↓ "thread:thread-abc" →
         target_sink.deliver_to_target("thread:thread-abc", task.name, final_message)
           ↓ ThreadTargetSink 实现：
           ├─ 解析前缀 "thread:" → thread_id = "thread-abc"
           ├─ ThreadManager.append_system_message(thread_id, formatted_text)
           │     ↓ 找 cell → session.append(Message(role="assistant", ...))
           │     ↓ cell 已 evict → 重建 session 写入
           │     ↓ thread 已删除 → 返回 False
           └─ ThreadManager.notify_thread(thread_id, ws_payload)
                 ↓ cell 在线 → adapter.send_frame → 用户实时看到
                 ↓ 不在线 → 静默跳过（下次打开 thread 能看到追加的消息）
```

## 流程 4：preset LLM 解析

```
_resolve_llm(preset_id="claude-sonnet")
  ↓
  ├─ preset_id == "" → return self._llm (ticker runtime 默认 provider)
  ├─ preset_id not in preset_map → log warning → return self._llm
  └─ preset = preset_map[preset_id]
       ↓
       model_overrides = {name, base_url, api_key, provider?, reasoning_effort?}
       preset_cfg = base_config.model_copy(update={"model": ...})
       ↓ effective_provider 判定
       ├─ "anthropic" → AnthropicMessagesProvider(preset_cfg.model, ...)
       └─ else → OpenAIResponsesProvider(preset_cfg.model, ...)
       ↓
       return new_provider  (调用方负责 aclose)
```

## 流程 5：schema v3 → v4 迁移

```
Store.__init__(home_dir)
  ↓ 读 scheduled_tasks.json
  ↓ schema_version == 4 → 直接用
  ↓ schema_version == 3 →
      备份: scheduled_tasks.json → .v3.bak.<ts>
      每个 task 补: origin_thread_id=null, preset_id=""
      写 schema_version=4
      audit: "schema_migrated_v3_to_v4"
  ↓ schema_version < 3 → 先走已有链式迁移，再走 v3→v4
```
