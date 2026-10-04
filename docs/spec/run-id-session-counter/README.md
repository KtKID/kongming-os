# run-id session counter

> 状态：方案确认中
> 目标：把 run_id 从 uuid 改为 session 内自增编号，顺手修 web 非流式多轮覆盖 bug + 补 web debug/trace

## 系统目标

当前 `runner.run` 入口用 `uuid.uuid4().hex[:12]` 生成 run_id（`src/core/runner.py:143`）。前端 chat store 用 `(threadId, turn)` 作 buffer key，但 runner 每次 run 都新建 RunState，turn 从 1 重数 —— 多轮非流式对话时不同 run 的 turn=1 撞车，前端把新回答盖到旧气泡，必须刷新页面才能看到正确历史（详见 `docs/fixes/20260427-non-streaming-provider-no-content/` 的隔壁邻居 bug）。

本系统要做三件事：

1. **修 bug**：让前端能稳定区分不同 run，多轮非流式回复正确显示
2. **改 run_id 语义**：从无意义 uuid 改成"session 内顺序编号"（`run-{session_id}-{n}`），同时把"运行次数"作为 session 一阶持久化元数据
3. **补 web 调试链路**：trace 落盘 + 前端 id badge，让 web 像 CLI 一样可复盘

## 范围边界

**包含**：

- `Session` Protocol 加 `advance_run_index()`；3 个后端持久化 `run_count`
- `runner.run` 内部时序调整（append user → advance → emit run.start）
- `RunState.run_id` 从 frozen 改 mutable
- `SessionEngine` 拼装 run_id 串
- WS 协议帧（`ContentDelta` / `Reasoning` / `TurnStart` / `TurnEnd` / `AssistantFinal` / `ToolCallStart` / `ToolCallEnd`）加 `run_id` 字段
- 前端 chat store buffer key + ChatItem id 加 run_id 维度
- 前端 MessageList debug 模式（URL `?debug=1` / localStorage 开关）
- Web 装配补 `JsonlTraceSink`（按 thread_id 拆文件）

**不包含**：

- runner.py:143 改成事务原子提交（append + advance 严格事务）—— v0.x 简化为分两步，注释说明失败模式
- Session.advance_run_index 的并发锁（thread_manager 已按 thread_id 串行化，无需额外锁）
- thread.history 帧 / setHistory 路径加 run_id（历史消息按时序展开，不需要 run 维度区分）
- approval.request / approval.decision / approval.ack 帧加 run_id（审批按 call_id 唯一，不依赖 run_id 路由）
- 修 `WebHostAdapter.write_output` 的 turn=-1 占位（web 路径 `echo_final_content=False` 不会触发，留作后续）

## 模块导航

| 模块 | 状态 | 是否可进 task | 说明 |
|------|------|---------------|------|
| M1 session 自增计数器 | 方案确认 | 是 | Session Protocol + 3 后端持久化 |
| M2 runner 时序调整 | 方案确认 | 是 | 依赖 M1；A 方案"先 append 再宣布" |
| M3 WS 协议帧加 run_id | 方案确认 | 是 | 依赖 M2（Event.run_id 已是新格式） |
| M4 前端 buffer key | 方案确认 | 是 | 依赖 M3；修非流式覆盖 bug |
| M5 前端 debug 显示 | 方案确认 | 是 | 依赖 M4 |
| M6 Web JsonlTraceSink | 方案确认 | 是 | 独立增强，可与 M1-M5 并行 |

## 文档导航

- [模块拆分](./02-module-breakdown.md)
- [Task 映射](./90-task-map.md)

## 当前建议

1. M1 → M2 → M3 → M4 串行（强依赖链）；M5 紧随 M4；M6 可独立并行
2. 建议合成 1 个 task `run-id-session-counter` 一气呵成；若想拆，按依赖串切两段：
   - Phase 1：`run-id-backend`（M1+M2）—— 后端 run_id 生成与持久化
   - Phase 2：`run-id-web-flow`（M3+M4+M5+M6）—— Web 协议、前端、trace
3. 执行前用 `pre-commit run --files` 验证 mypy + import-linter（`.importlinter` 边界，安全/工具/上下文之间的依赖方向）
