# 核心流程

## 流程 1：cron 触发 → 投递 → 用户可见（端到端）

```
[ticker tick (每 60s)]
  ↓
store.reserve_due_tasks(now)              # M1 / store
  ↓ 拿到 task + 占位 RunRecord(state=running)
ExecutionBridge.execute(task, run)        # M3 / bridge
  ↓
session = session_factory(sched-task-<id>-<rand>)   # M2 落盘修复
  ↓
runner.run(input_text, session=...)       # 走 SessionEngine → Runner（非流式）
  ↓ 非流式拿到 result.final_message
DeliveryDispatcher.deliver(task, run, msg)         # M3 / delivery
  ↓ 按 task.delivery.channel 路由
  ├─ channel=web → WebDeliverySink                  # M4
  │     ↓ 把 RunRecord delivery_status=delivered, delivered_at=now 写盘
  │     ↓ ws_broker.broadcast(topic="cron", event="cron.run.completed", payload={...})
  │       ↓
  │       [前端 cron 全局订阅收到]                    # M7
  │       ├─ 红点计数 +1（state.unseen_count++）
  │       ├─ 若 /cron 页打开 → 触发记录 tab 实时插入新卡片
  │       └─ Toast 提示（可选 P2）
  │
  └─ channel=cli → CliDeliverySink                   # M5
        ↓ buffer.append(formatted_line)
        [REPL 主循环下次 prompt 前]
        ↓ print(sink.drain_pending())
        > 📌 [cron:今日五十分钟提醒] 50分到了！
        > [user input prompt]
```

## 流程 2：用户在 web 看 cron 触发记录 + 清红点

```
用户登入 web
  ↓
全局 store 初始化
  ↓ GET /api/cron/unseen_count
顶部 ⏰ 按钮显示红点（如果 count > 0）
  ↓ 用户点击
路由跳到 /cron
  ↓ 默认 Tab「任务列表」
GET /api/cron/tasks → 渲染表格
  ↓ 用户切到 Tab「触发记录」
GET /api/cron/runs?limit=50 → 渲染列表（时间倒序）
  ↓ 用户阅读完毕，点 "全部已读" 按钮
POST /api/cron/mark_seen { until_ts: now() }
  ↓ store.mark_all_runs_seen_until(until_ts)
GET /api/cron/unseen_count → 0
  ↓ 红点消失（同时 WS 不再推 count > 0）
```

## 流程 3：用户暂停 / 删除任务

```
用户在 /cron 页 Tab「任务列表」点 ⏸
  ↓ 前端 optimistic update：UI 立刻显示已暂停
PATCH /api/cron/tasks/{task_id}  body: {enabled: false}
  ↓
store 更新 task.enabled = False, state = PAUSED
  ↓ ticker 下次 tick 不再 reserve 该任务
ws_broker.broadcast(topic="cron", event="cron.task.updated", payload={task_id, enabled: false})
  ↓
其他 web 客户端同步更新 UI
```

```
用户点 🗑 删除
  ↓ 弹出确认对话框 "确认删除任务 '{name}'？历史触发记录会保留"
  ↓ 用户确认
DELETE /api/cron/tasks/{task_id}
  ↓
store 更新 task.state = DELETED, task.enabled = False（软删除，run 历史保留）
  ↓ 列表 API 默认过滤 state=DELETED 的任务
  ↓ 触发记录 API 仍能查到这些 run（带 task_name 显示）
ws_broker.broadcast(topic="cron", event="cron.task.updated", payload={task_id, state: "deleted"})
  ↓
其他客户端从列表移除该任务
```

## 流程 4：LLM 创建 cron 任务（schedule_tool）

```
用户："每 30 秒提醒我喝水"
  ↓
LLM 调 schedule_tool({
  name: "喝水提醒",
  schedule: "every 30s",
  input: "提醒用户：该喝水啦！",
  delivery: { channel: "web" }    # ← v0.3 新增；省略时按 ToolContext.caller_kind 推断
})
  ↓ schedule_tool._do_create
ScheduleParser.parse(schedule_str) → ScheduleTrigger(INTERVAL, ...)
compute_first_run_at(trigger) → datetime
delivery = ScheduleDelivery(channel=DeliveryChannel.WEB)  # 默认或显式
  ↓
store.create_task(ScheduledTask(..., delivery=delivery))
  ↓
返回 task_id 给 LLM
  ↓
LLM："好的，已经创建任务 task-xxx，每 30 秒提醒你喝水"
```

## 流程 5：v0.2 → v0.3 schema migration（启动时）

```
ScheduleStore.__init__(home_dir)
  ↓ 读取 .kongming/cron/scheduled_tasks.json
  ↓ 检测 schema_version
  ├─ schema_version == 3 → 直接用
  ├─ schema_version == 2 →
  │   ↓ 备份: cp scheduled_tasks.json scheduled_tasks.json.v2.bak.<ts>
  │   ↓ 给每个 task 补 delivery: {channel: "web"}（默认）
  │   ↓ 写回 schema_version=3
  ├─ schema_version == 1 →（v0.2 已处理过 v1→v2，现在再走 v2→v3）
  │   ↓ 复用 v0.2 的 v1→v2 逻辑
  │   ↓ 再走 v2→v3
  └─ unknown → raise SchemaVersionError
  ↓
启动完成
```

## 流程 6：fresh session 落盘修复（M2）

**修复前（v0.2 现状）**：

```
bridge.execute(task)
  ↓
session = self._session_factory(fresh_session_id)
  ↓ session_factory 调 build_session(cfg, sid, bootstrap)
  ↓ build_session 按 cfg.session.backend 选择实现
  ?? 这里走的 backend 是 file 还是 memory？  ← 需要排查
  ?? 即使 file backend，是不是 session.append 没 flush？
  ↓
runner.run(...)
  ↓ session.append(messages) 多次
  ↓
[bridge 不持有 session 引用，runtime/runner 跑完即释放]
  ↓
fresh session 数据 → 没落盘 ❌
```

**修复后（v0.3 期望）**：

```
bridge.execute(task)
  ↓
session = self._session_factory(fresh_session_id)
  ↓ 显式 file backend，路径 .kongming/sessions/sched-task-<id>-<rand>/
  ↓
runner.run(...)
  ↓ session.append(...) → 每次 append 即 flush 到磁盘
  ↓ 或者用 context manager 在 finally 里 flush
  ↓
[runtime 释放 session]
  ↓
.kongming/sessions/sched-task-<id>-<rand>/messages.jsonl 完整保存 ✅
```

## 流程 7：CLI flush 模式时序

```
[T=0]  用户敲 "你好"，REPL 等待输入
[T=5]  ticker 在后台触发 cron task → CliDeliverySink.deliver
       buffer 加入 "📌 [cron:喝水提醒] 该喝水啦！"
[T=10] 用户敲完 "你好" 按 Enter
[T=10] LLM 处理用户输入 → 输出回复
[T=15] LLM 回复完毕，REPL 准备下次 prompt
[T=15] REPL 在 prompt 之前调 sink.drain_pending() → 打印 buffer
       > 📌 [cron:喝水提醒] 该喝水啦！
       > [新 prompt 等待]
```

不打断输入；不混在 LLM 流式输出中间；所有 cron 投递行被聚合到下一个 prompt 之前一次性打印。
