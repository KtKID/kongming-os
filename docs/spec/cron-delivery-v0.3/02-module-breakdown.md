# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| M1 | 数据契约 & schema 迁移 | 无 | 方案确认 | 先行 |
| M2 | fresh session 落盘修复 | 无 | 方案确认 | v0.2 隐性 bug，可独立 commit |
| M3 | ExecutionBridge delivery 路由 | M1, M2 | 方案确认 | 跑完 → 路由 → 投递 → 写状态 |
| M4 | Web Delivery（系统消息池）| M1, M3 | 方案确认 | 落盘 + WS 广播 |
| M5 | CLI Delivery（提示符 flush）| M1, M3 | 方案确认 | 单文件实现，几行代码 |
| M6 | Web REST API（cron 管理） | M1, M4 | 方案确认 | 4 endpoint + WS |
| M7 | Web 前端（/cron 页）| M6 | 方案确认 | 工作量最大头 |
| M8 | schedule_tool 协议升级 | M1 | 方案确认 | 留最后做避免协议变更两次 |

## 模块详情

### M1 数据契约 & 迁移

**职责**：定义 v0.3 的数据结构升级，并提供平滑的 v2 → v3 迁移。

**包含范围**：

- `src/scheduler/domain.py` 新增数据结构：
  ```python
  class DeliveryChannel(str, Enum):
      WEB = "web"
      CLI = "cli"

  @dataclass(frozen=True)
  class ScheduleDelivery:
      channel: DeliveryChannel
      # 不带 target；target 概念已取消
  ```
- 给 `ScheduledTask` 加 `delivery: ScheduleDelivery | None`（None = 沿用旧默认 = web）
- 给 `RunRecord` 字段填空：
  - `delivered_at: datetime | None`（v0.2 没定，新增）
  - `delivery_status: Literal["pending", "delivered", "failed"]`
  - `delivery_error: str | None`（v0.2 留位 v0.3 启用）
  - `seen_at: datetime | None`（用户在 web 看过该 run 的时间，给红点用）
- `src/scheduler/store.py`：
  - `schema_version: 2 → 3` 升级
  - 启动时检测旧版本 → 备份 `.v2.bak.<ts>` → 写新结构（旧任务 delivery 字段补 default WEB）
  - 新增 `list_recent_runs(limit, since)` 查询
  - 新增 `mark_run_seen(run_id)` / `mark_all_runs_seen_until(timestamp)`
  - 新增 `count_unseen_runs()` 给红点

**不包含范围**：

- 投递逻辑本身（M3 / M4 / M5）
- web/cli 的 channel 实现
- schedule_tool 输入 schema（M8）

**依赖**：无

**风险与讨论点**：

- delivery 字段对历史 v2 task 的兼容：迁移时统一填 `DeliveryChannel.WEB`
- `seen_at` 的写入路径：必须经 `mark_run_seen` 接口，不能让 store 内部自动改
- schema migration 单元测试要覆盖：`v1 → v2 → v3` 链式升级（v0.2 测过 v1→v2，v0.3 加 v2→v3）

**task 建议**：

- task 名：`cron-delivery-v0.3-m1-schema`
- 是否进入 x-req：是
- 工作量：1.5h（结构定义 0.5 + migration 0.5 + 单测 0.5）

---

### M2 fresh session 落盘修复

**职责**：修复 v0.2 隐性 bug —— cron 触发的 fresh session 从未被持久化到 `.kongming/sessions/sched-*`。

**包含范围**：

- 排查 `src/scheduler/execution_bridge.py:398` 那条 `_session_factory(request.session_id)` 调用链：
  - 是不是 backend 配置没继承？
  - 是不是 session.append 写盘 lazy + 没 flush？
  - 是不是 fresh session bootstrap 时建错路径？
- 修复后保证 `.kongming/sessions/sched-task-<id>-<rand>/messages.jsonl` 存在且包含完整 history
- 加单元测试：`test_fresh_session_persisted_after_cron_run`
- 加 e2e：cron 跑完后用 file backend 重新 build_session 能读出全部 messages

**不包含范围**：

- session 数据展示（这是后续可选优化，v0.3 不做）
- 旧的 sched session 数据补救（已丢就丢了）

**依赖**：无（独立 bug 修复）

**风险与讨论点**：

- 这个 bug 跟 cron 调度链路无关，纯是 session 持久化漏接 → 修复影响面小
- 修完后 disk 占用增加（每条 cron run 产生一份完整 messages 历史），需要在文档说明 cleanup 策略

**task 建议**：

- task 名：`cron-delivery-v0.3-m2-fresh-session-persist`
- 是否进入 x-req：是
- 工作量：1.5-2h（排查 1h + 修复 0.5h + 测试 0.5h）

---

### M3 ExecutionBridge delivery 路由

**职责**：cron 跑完 fresh agent 后，按 task.delivery.channel 路由到 web / cli 实现，并把投递状态写回 RunRecord。

**包含范围**：

- 新增 `src/scheduler/delivery.py`：
  ```python
  class DeliveryDispatcher:
      def __init__(self, web_sink: WebDeliverySink | None, cli_sink: CliDeliverySink | None):
          self._web = web_sink
          self._cli = cli_sink

      async def deliver(self, task: ScheduledTask, run: RunRecord, final_message: str) -> DeliveryResult:
          channel = task.delivery.channel if task.delivery else DeliveryChannel.WEB
          if channel == DeliveryChannel.WEB:
              return await self._web.deliver(...) if self._web else DeliveryResult(skipped="no_web_sink")
          elif channel == DeliveryChannel.CLI:
              return await self._cli.deliver(...) if self._cli else DeliveryResult(skipped="no_cli_sink")
  ```
- `execution_bridge.py` 在 fresh agent run 完成后（finalize 阶段）调 dispatcher.deliver
- 把 DeliveryResult 写回 RunRecord：`delivered_at` / `delivery_status` / `delivery_error`
- 装配链路：
  - cli 装配（`src/cli/main.py`）注入 `CliDeliverySink`
  - web 装配（`src/web/run.py`）注入 `WebDeliverySink`
- `silent_marker_enabled` 语义重新定义：原本"投递时静默"现在变"`final_message` 含 `[SILENT]` 时跳过投递（仍写 RunRecord）"

**不包含范围**：

- web / cli 各自的 sink 实现（M4 / M5）
- 失败重试逻辑（v0.3 不做，delivery 失败只记录）

**依赖**：M1（需要 RunRecord 字段）+ M2（fresh session 要先落盘）

**风险与讨论点**：

- dispatcher 装配的位置：当前 `execution_bridge.py` 由 `register_schedule_tool_if_enabled` 装配 → dispatcher 同样在这层注入
- 异常处理：`deliver` 抛异常 → 不影响 cron run 本身已 completed 状态，只填 `delivery_error` 字段
- 测试用 stub sink

**task 建议**：

- task 名：`cron-delivery-v0.3-m3-bridge-route`
- 是否进入 x-req：是
- 工作量：1.5h

---

### M4 Web Delivery（系统消息池）

**职责**：实现 `WebDeliverySink`，把 cron 投递结果落到 web 的系统消息池 + WS 广播给所有连接的客户端。

**包含范围**：

- 新增 `src/web/app_support/cron_delivery.py`：
  ```python
  class WebDeliverySink:
      def __init__(self, ws_broker, store):
          self._ws_broker = ws_broker
          self._store = store

      async def deliver(self, task, run, final_message) -> DeliveryResult:
          # 1. RunRecord 已经在 store 里（M3 写的）
          # 2. WS 广播 cron.run.completed 事件
          await self._ws_broker.broadcast({"kind": "cron.run.completed", "task_id": ..., "run_id": ..., "final_message": ..., "task_name": ...})
          return DeliveryResult(delivered_at=now())
  ```
- 利用现有 store 持久化（不重新建一个"系统消息池表"，**RunRecord 本身就是系统消息池**）
- WS 广播复用 web 现有的 `WSEventSink` 路径，新增两个 event kind：
  - `cron.run.completed` —— 触发完成
  - `cron.task.updated` —— 任务状态变化（暂停 / 删除）
- 红点状态后端逻辑：
  - GET `/api/cron/unseen_count` 返回 `count_unseen_runs()`
  - POST `/api/cron/mark_seen` 接受 `until_ts`，调 `store.mark_all_runs_seen_until(until_ts)`

**不包含范围**：

- REST endpoint 本身（M6）
- 前端渲染（M7）

**依赖**：M1（RunRecord seen_at 字段）+ M3（被 dispatcher 调用）

**风险与讨论点**：

- WS broker 当前是 thread 维度的（每个 thread 一个 WS topic）—— cron 事件是全局的，要新增 `cron` 这个 global topic
- 前端订阅时机：用户打开 web app 就订阅 `cron`，不论是否在 `/cron` 页

**task 建议**：

- task 名：`cron-delivery-v0.3-m4-web-sink`
- 是否进入 x-req：是
- 工作量：1.5h

---

### M5 CLI Delivery（提示符 flush）

**职责**：实现 `CliDeliverySink`，cron 触发完成后写"待打印缓冲"，prompt_toolkit 在下次提示符前 flush。

**包含范围**：

- 新增 `src/cli/cron_delivery.py`：
  ```python
  class CliDeliverySink:
      def __init__(self, flush_callback: Callable[[str], None]):
          self._buffer: list[str] = []
          self._flush = flush_callback

      async def deliver(self, task, run, final_message) -> DeliveryResult:
          line = f"\n📌 [cron:{task.name}] {final_message}\n"
          self._buffer.append(line)
          # flush 由 REPL 主循环在下次 prompt 前调用
          return DeliveryResult(delivered_at=now())

      def drain_pending(self) -> str:
          out = "\n".join(self._buffer)
          self._buffer.clear()
          return out
  ```
- `src/cli/main.py` REPL 主循环每次 user input 之前先 `print(sink.drain_pending(), end="")` 再起 prompt
- 装配：CLI 启动时把 sink 注入 dispatcher

**不包含范围**：

- web 投递（M4）
- 状态栏指示（v0.3 P2，先不做）

**依赖**：M1, M3

**风险与讨论点**：

- 多线程安全：ticker 协程写 buffer，REPL 协程读 + clear → buffer 用 `asyncio.Lock` 或 `deque` 内置原子
- prompt_toolkit 输入正在进行中怎么办：保持现状不打断，cron 输出排队，下次空闲提示符前一次性 flush

**task 建议**：

- task 名：`cron-delivery-v0.3-m5-cli-sink`
- 是否进入 x-req：是
- 工作量：0.5h（实现简单）

---

### M6 Web REST API（cron 管理）

**职责**：提供 cron 管理用的 REST endpoint + WS 事件订阅。

**包含范围**：

- 新增 `src/web/routers/cron.py`：
  - `GET /api/cron/tasks` —— 列表（支持 query: enabled, state, limit）
  - `GET /api/cron/tasks/{task_id}` —— 详情 + 最近 N 次 run
  - `PATCH /api/cron/tasks/{task_id}` —— body: `{enabled: bool}`，仅支持 pause/resume
  - `DELETE /api/cron/tasks/{task_id}` —— 软删除（state=DELETED, enabled=False）
  - `GET /api/cron/runs` —— 触发记录列表（支持 query: task_id, since, limit）
  - `GET /api/cron/unseen_count` —— 红点用
  - `POST /api/cron/mark_seen` —— body: `{until_ts}`
- 在 `src/web/run.py` 注册 router
- 鉴权：复用 web 现有 auth 中间件（v0.3 仍是单用户本地工具）

**不包含范围**：

- cron 任务创建（仍走 LLM schedule_tool）
- 修改任务参数（不做）

**依赖**：M1（数据结构）+ M4（红点接口）

**风险与讨论点**：

- 软删除 vs 硬删除：先软删除（state=DELETED），列表 API 默认过滤；硬删除留命令行工具或 v0.4 做
- 删除时 run 历史保留还是一起清：保留（审计需要）

**task 建议**：

- task 名：`cron-delivery-v0.3-m6-web-rest`
- 是否进入 x-req：是
- 工作量：1.5h

---

### M7 Web 前端（/cron 页）

**职责**：实现 web 端 cron 管理页 + 顶部入口按钮 + 红点状态机。

**包含范围**：

- 新增 `web/src/pages/Cron.tsx`：
  - Tab 1「任务列表」：
    - 表格：name / schedule / next_run / last_run / state / actions
    - actions: ⏸/▶ 暂停切换 / 🗑 删除（确认对话框）
  - Tab 2「触发记录」：
    - 时间倒序 list，每条卡片：
      - 任务名 + 触发时间 + 状态 icon
      - 完整 final_message（折叠展开，超长截断）
      - 跳到对应 task 详情
    - 顶部 "全部已读" 按钮 → POST `/api/cron/mark_seen { until_ts: now }`
- 路由：`web/src/routes.tsx` 加 `/cron`
- 顶部入口按钮：
  - 在 `Layout.tsx` 顶部 toolbar 加 ⏰ 按钮
  - 红点：useQuery `/api/cron/unseen_count`（每 30s poll + WS event 触发刷新）
- WS 订阅：
  - 全局 store 订阅 `cron` topic
  - 收到 `cron.run.completed` → 红点计数 +1，列表已打开则插入新条目
  - 收到 `cron.task.updated` → 列表刷新

**不包含范围**：

- 表单创建任务（不做）
- 修改任务（不做）
- mobile 响应式（沿用 Layout 现有布局）

**依赖**：M6（REST API + WS event）

**风险与讨论点**：

- 顶部 toolbar 当前结构：`Layout.tsx` 已有 status / preset 等控件，cron 按钮加哪个位置（左 / 右 / 状态线集成）
- 红点未读计数刷新策略：WS 实时 + 30s poll 兜底，避免 WS 断连漏新
- 任务暂停 / 删除的 optimistic update 还是等后端回调：建议 optimistic（用户体感快），失败 rollback

**task 建议**：

- task 名：`cron-delivery-v0.3-m7-web-frontend`
- 是否进入 x-req：是
- 工作量：3-4h（前端最大头，主要是两 tab 渲染 + 红点状态机）

---

### M8 schedule_tool 协议升级

**职责**：给 schedule_tool 输入 schema 加 `delivery.channel` 字段，更新 TOOLS.md。

**包含范围**：

- `src/tools/schedule_tool.py`：
  - input schema 加：
    ```json
    "delivery": {
      "type": "object",
      "properties": {
        "channel": {"type": "string", "enum": ["web", "cli"]}
      }
    }
    ```
  - 解析逻辑：未指定 → 从 ToolContext 推断（web 调用 → web；cli 调用 → cli）
- `src/prompts/templates/TOOLS.md`：更新 schedule 工具说明，加 delivery 字段使用指引
- 单测：覆盖默认推断、显式指定、非法值拒绝三种 case

**不包含范围**：

- 未来 channel 扩展（feishu / email）

**依赖**：M1（DeliveryChannel 类型）

**风险与讨论点**：

- ToolContext 当前没有"调用方是 web/cli"的字段：要加 `caller_kind: Literal["web", "cli"]` 或类似
- 默认值的稳定性：如果 LLM 没填 delivery，按 caller_kind 推断 → 如果连 caller_kind 都没（比如脚本场景）→ 默认 web

**task 建议**：

- task 名：`cron-delivery-v0.3-m8-tool-schema`
- 是否进入 x-req：是
- 工作量：1h
