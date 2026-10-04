# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|------|------|------|------|------|
| M1 | Session 自增计数器 | 无 | 方案确认 | Protocol + 3 后端 |
| M2 | runner 时序调整 + run_id 拼装 | M1 | 方案确认 | A 方案 |
| M3 | WS 协议帧加 run_id | M2 | 方案确认 | 14 帧选 7 个加字段 |
| M4 | 前端 buffer key 修 bug | M3 | 方案确认 | 核心 bug 修复点 |
| M5 | 前端 debug 显示 | M4 | 方案确认 | UI badge |
| M6 | Web JsonlTraceSink | 无 | 方案确认 | 可与 M1-M5 并行 |

## 模块详情

### M1：Session 自增计数器

**职责**：在 Session 一阶接口加"运行次数"持久化能力。

**包含范围**：

- `core/contracts.py::Session` Protocol 加 `async def advance_run_index() -> int`，语义"递增并返回新值，原子写盘"
- `context/in_memory_session.py`：实例字段 `_run_count: int = 0`，方法内 +1 返回
- `context/file_session.py`：
  - `manifest.json` schema 加 `run_count: int`（`_SCHEMA_VERSION` bump）
  - `_recover` 时 `manifest.get("run_count", 0)` 兜底，旧 session 文件不崩
  - `advance_run_index` 内自增 + 原子写 manifest（复用 `.tmp` rename 机制）
- `context/session_store.py::SQLiteSession`：
  - 加 `async def advance_run_index(self) -> int: raise NotImplementedError("sqlite backend deprecated; use file backend")`
  - 仅保 Protocol 完整性；不实现持久化逻辑、不写测试、不做 ALTER 迁移
  - 原因：项目当前默认 `backend: file`，sqlite 后端不再维护（决策已写入 memory）
- 测试：memory + file 后端各加 advance 测试 + FileSession 跨重启延续测试（写 manifest → 新实例 recover 能读到正确值）；sqlite 后端单测仅断言抛 NotImplementedError

**不包含范围**：

- 严格事务原子（append jsonl + advance manifest 不做单事务提交，注释说明失败模式）
- 跨进程并发锁（thread_manager 已按 thread_id 串行化）
- run_count 上限保护（int 不会溢出）
- SQLiteSession 持久化实现（已决策：sqlite 后端不维护，留 NotImplementedError）
- FileSession manifest schema migration（用户拍板"旧 session 全删"，不做 migration）

**依赖**：无

**风险与讨论点**：

- FileSession 不 bump `_SCHEMA_VERSION`：新代码假设 manifest 含 `run_count`，旧 session 文件 recover 时 `manifest.get("run_count", 0)` 兜底为 0（实际等于"忘记上次到几"，下一轮 run_id 会从 1 重新开始；用户已接受"旧 session 全删"，所以此场景不发生）
- InMemorySession 跨重启计数清零（接受，内存后端语义本来就不持久）

**task 建议**：

- 建议 task 名：`session-run-counter`
- 是否进入 x-req：是
- 原因：单一职责，可独立测试，memory + file 后端互相隔离；sqlite 仅 stub

---

### M2：runner 时序调整 + run_id 拼装

**职责**：把 user message append 与 advance_run_index 绑定到同一时机，按"A 方案"调整 runner 内部调用顺序。

**包含范围**：

- `core/run_state.py::RunState`：`run_id` 字段从 frozen dataclass 字段改为 mutable（去掉 frozen 或加 setter）
- `core/runner.py::run`（line 143-165 段）：
  - 不再在入口生成 uuid
  - 不再在入口创建 RunState 时传 run_id（或传占位空串）
  - 调整顺序：先调 `_seed_messages` → 在 _seed_messages 内 `await session.append(user_msg)` 紧跟 `run_index = await session.advance_run_index()` → 写入 `state.run_id = f"run-{session_id}-{run_index}"`
  - emit run.start 推迟到 _seed_messages 之后；后续所有 emit 用更新后的 state.run_id
- `core/runner.py::_seed_messages`：注释说明非事务原子的失败模式
- `executors/agent_runtime/session_engine.py`：保留 runner.run 的 `run_id` 入参（外部测试可注入），默认 None 走 session 自增路径
- 测试：现有 runner 测试可能假设 run_id 格式为 hex，调整 fixture；加新测试验证连续两次 run_once 拿到不同 run_id 且按 session_id 递增

**不包含范围**：

- 改 SessionEngine 内部 session cache 逻辑（`_sessions` dict 不动）
- 改 lifecycle hook 时序（`_run_lifecycle_before_turn` 在 turn 循环内不变）

**依赖**：M1（需要 `session.advance_run_index()`）

**风险与讨论点**：

- **state.run_id 在 advance 之前的读取者**：runner 全文 grep `state.run_id`，确认所有读 run_id 的位置都在 advance 之后；典型风险点是异常路径（emit error 时 state.run_id 还是空）
  - **应对**：state.run_id 初始化为 `""` 或 `"<pending>"`；异常路径若读到该值，仍能写 trace（不阻塞）
- **trace 顺序变化**：现在 trace 第一条事件是 `run.start`，改后第一条仍是 `run.start`（只是推迟几行代码），但 user message append 早于 run.start —— 与现状相反；trace 消费者应该不依赖 run.start 必须先于一切（已确认 JsonlTraceSink 只是顺序追加 jsonl 行）
- **run.start payload 不变**：仍带 session_id / agent / model / max_turns / reasoning_effort，与现在一致

**task 建议**：

- 建议 task 名：`runner-run-id-rewire`
- 是否进入 x-req：是
- 原因：改动集中在 runner.py + run_state.py，单点验收

---

### M3：WS 协议帧加 run_id

**职责**：把 `Event.run_id` 透传到浏览器，让前端能区分不同 run。

**包含范围**：

- `web/protocol/ws_frames.py` 加字段（`run_id: str`）：
  - `ContentDeltaFrame`
  - `ReasoningDeltaFrame`
  - `TurnStartFrame`
  - `TurnEndFrame`
  - `AssistantFinalFrame`
  - `ToolCallStartFrame`
  - `ToolCallEndFrame`
- 不加 run_id 的帧：
  - `ApprovalRequestFrame` / `ApprovalDecisionFrame`：审批走 call_id，不依赖 run
  - `ErrorFrame`：可能在 run 之外（建连失败等），run_id 可为空
  - `UsageFrame`：v0.1.5 前端不显示，先不加
  - `PongFrame` / `CellEvictedFrame` / `ThreadHistoryFrame`：与 run 无关
- `web/ws_event_sink.py::WSEventSink._translate`：把 `event.run_id` 透传到对应帧的 `run_id` 字段
- 测试：协议层 pydantic 模型 round-trip；ws_event_sink 翻译测试加 run_id 字段断言

**不包含范围**：

- 帧版本号（schema 直接 in-place 加字段，前端旧客户端读到多余字段会报错 → 但前后端同步发布，不需要兼容）
- thread.history 帧的 HistoryMessageDTO 加 run_id（历史消息按时序排，不需要 run 区分）

**依赖**：M2（要 `Event.run_id` 已是新格式 `run-{session_id}-{n}`）

**风险与讨论点**：

- 旧 trace 文件 / 测试 fixture 里 frame 没 run_id 字段 → pydantic 默认值用 `""` 兜底，兼容性可控
- ws_event_sink 翻译时 `Event.run_id` 可能为 `None`（按 contracts 是 `str | None`）→ 传 `""` 而不是 None

**task 建议**：

- 建议 task 名：`ws-frame-run-id`
- 是否进入 x-req：是
- 原因：协议改动，独立验收

---

### M4：前端 buffer key 修 bug

**职责**：把前端 chat store 的 buffer key + ChatItem id 从 `(threadId, turn)` 升级到 `(threadId, run_id, turn)`，修非流式覆盖 bug。

**包含范围**：

- `web/src/stores/chat.ts`：
  - `bufferKey(threadId, runId, turn)` 改三参数
  - `appendDelta(threadId, kind, delta, turn, runId)` 加 runId 参数
  - `flushTurn(threadId, turn, runId)` 加 runId 参数
  - `commitBuffersToStore` 解析 key 三段；`findIndex` 用 `(it.kind === "assistant" && it.turn === turn && it.runId === runId)` 复合匹配
  - `ChatItem` assistant 变体加 `runId: string` 字段；id 模板改 `assistant-${threadId}-${runId}-${turn}`
  - `appendAssistantFinal` / `appendToolStart` / `appendToolEnd` / `appendApprovalRequest` 全部按 runId 区分（approval 帧虽然不带 run_id，但 chat store ChatItem 的 approval 项可以用 turn + callId 区分，runId 字段对 approval 设为可选）
- `web/src/hooks/useStreamingRender.ts`：从 frame 解出 `frame.run_id` 透传
- 测试：`chat.test.ts` 加多 run 隔离测试 —— 同 turn=1，不同 run_id 创建独立 ChatItem

**不包含范围**：

- 历史消息（`setHistory` 路径）加 runId（HistoryMessageDTO 不带 run_id，按时序展开）
- approval / error 项加 runId（不需要按 run 区分）

**依赖**：M3

**风险与讨论点**：

- ChatItem.id 变更可能影响现有测试 fixture（`hist-${threadId}-${i}` 历史路径不变，只有流式路径 id 变）
- React key 变化可能触发组件 unmount/remount —— 看一遍 MessageList 的 React key 用法（应该用 ChatItem.id 作 key，id 变 = 新组件，符合预期）

**task 建议**：

- 建议 task 名：`web-chat-buffer-key`
- 是否进入 x-req：是
- 原因：bug 修复主战场

---

### M5：前端 debug 显示

**职责**：开 debug 模式时给每条 ChatItem 角上贴 `[id │ run_id │ turn]` 小 badge，方便肉眼验证 bug 修复。

**包含范围**：

- 开关：URL `?debug=1` 或 localStorage `kongming.debug=1`，二选一命中即开
- `web/src/components/MessageList.tsx`：在每个气泡（user / assistant / tool）右上角贴一个 monospace 小 badge，内容 `${id.slice(0,8)} │ ${runId?.slice(-4) ?? "-"} │ t${turn}`
- 不加额外路由 / 不加全局 debug store；纯渲染层判断
- 现有测试加一个：debug 模式开启时 badge 出现；关闭时不出现

**不包含范围**：

- 完整 trace 查看面板（落盘 trace 由 M6 提供，肉眼复盘走文件即可）
- 性能 metric / token usage 显示

**依赖**：M4（runId 要先进 ChatItem）

**风险与讨论点**：

- localStorage 检查时机（首次渲染读一次即可，不需要响应式）

**task 建议**：

- 建议 task 名：`web-debug-badge`
- 是否进入 x-req：是
- 原因：纯前端可视化增强，独立交付

---

### M6：Web JsonlTraceSink 装配

**职责**：让 web 像 CLI 一样把所有 Event 落盘，包括 `content.delta` 携带的完整 LLM 回复。

**包含范围**：

- `src/web/run.py`：build_runtime_factory closure 内创建 JsonlTraceSink；输出路径用 `cfg.trace.output_path`，按 thread_id 拆文件（`trace.{thread_id}.jsonl`）
- `src/web/thread_manager.py:358`：`sinks: list[Any] = [ws_sink, jsonl_sink]`
- 复用 cli/main.py 已有的 `JsonlTraceSink(cfg.trace.output_path, auto_flush=cfg.trace.auto_flush)` 装配模式
- 测试：装配后 thread cell 收到事件应该写入对应 trace 文件

**不包含范围**：

- 增加新的 trace 字段（与 CLI 同款即可）
- 提供 web API 在线读 trace（用户直接打开 jsonl 文件）

**依赖**：无（独立增强）

**风险与讨论点**：

- 多 thread 并发写入：每 thread 独立 JsonlTraceSink 实例（持有独立文件句柄），不会冲突
- trace 文件清理：与 CLI 同语义，长跑会无限增长 → 暂不做轮转，用户自管
- cfg.trace.output_path 当前是单文件路径，需要把它当目录解释 → 装配层把 `{thread_id}` 拼到文件名上；目录默认 `.kongming/trace/`

**task 建议**：

- 建议 task 名：`web-trace-sink`
- 是否进入 x-req：是
- 原因：可与 M1-M5 并行
