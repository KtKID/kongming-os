# 模块拆分

## 模块总览

| 模块 | 职责 | 依赖 | 状态 | 备注 |
|---|---|---|---|---|
| Evolution Hook | 挂接 `after-run`，调度 review | `executors/agent_runtime`、`core.result` | 可进入 x-req | 主入口 |
| Evidence Selection | 裁剪 transcript window，产出证据引用 | `Session`、`Result` | 可进入 x-req | 高价值筛选前置 |
| Child Reviewer Runtime | 运行子 agent，输出结构化 review 并调用工具 | `AgentSpec`、`SessionEngine.build`、`LLMProvider` | 可进入 x-req | 学习判断核心 |
| Evolution Write Tool | 校验 payload，直写 review record 和进化养料 | `tools`、文件系统、events | 可进入 x-req | 主写入层 |
| Learning State / Observability | 状态、配置、事件、shutdown drain | `config_loader`、`EventSink` | 可进入 x-req | 产品化收口 |

## 模块详情

### 模块 1：Evolution Hook

**职责**：在 `SessionEngine.run()` 收到 `Result` 后决定是否触发 child review，并管理后台任务生命周期。

**包含范围**：

- `after-run` hook。
- trigger 判断。
- `asyncio.create_task` 启动后台 review。
- pending task 注册。
- `aclose()` drain。

**不包含范围**：

- transcript 打分逻辑。
- 养料写入细节。

**依赖**：

- `src/executors/agent_runtime/session_engine.py`
- `src/core/result.py`
- `src/core/contracts.py::Session`

**task 建议**：

- 建议 task 名：`self-evolution-review-hook-v0.1.9`
- 是否进入 x-req：是

### 模块 2：Evidence Selection

**职责**：从当前 session history 中截取最有价值的窗口，提供给 child reviewer。

**包含范围**：

- 最近 N 条消息窗口裁剪。
- 当前 run 的 user / assistant / tool 片段定位。
- `evidence_turns` 生成。
- 证据摘要和 message budget 控制。

**依赖**：

- `Session.history()`
- `Result.run_id / turn_count / final_message`

**task 建议**：

- 建议 task 名：`self-evolution-evidence-selection-v0.1.9`
- 是否进入 x-req：是

### 模块 3：Child Reviewer Runtime

**职责**：以专用 `AgentSpec` 运行一个 child reviewer，对 transcript window 做高价值分类，并调用专用工具写入 `evo` 目录。

**包含范围**：

- reviewer instructions。
- reviewer model / max_turns / tool whitelist。
- 结构化 `ReviewResult`。
- 一次 `evolution_write(review_result=...)` 工具调用。

**推荐实现**：

- 用独立 `AgentSpec(name="evolution-reviewer")`。
- `tool_names` 只开放 `evolution_write`。
- 输入是 transcript slice + review rubric。
- 输出路径是工具调用，不经过主链再总结。

**创建方案**：

1. 在 `src/evolution/reviewer_runtime.py` 新增 `run_child_review(...)` 入口。
2. 为每次 review 创建一个独立 `InMemorySession(session_id=f"evo_review_{parent_session_id}_{run_id}")`。
3. 先把 `TranscriptWindow.messages` 逐条 append 到这个 review session，作为 review 证据历史。
4. 构造专用 `AgentSpec`：
   - `name="evolution-reviewer"`
   - `instructions=<reviewer system prompt>`
   - `default_model=config.model.name`
   - `tool_names=("evolution_write",)`
   - `max_turns=2`
   - `reasoning_effort="low"` 或沿用调用方显式配置
5. 用 `SessionEngine.build(...)` 创建一份 reviewer runtime：
   - `tools={"evolution_write": evolution_write_tool}`
   - `enabled_tool_names=["evolution_write"]`
   - `agent_spec=review_agent_spec`
   - `session_factory=<返回上述 review session 的工厂>`
   - `event_sinks=<复用 trace sinks，附加 reviewer 标记>`
6. 调用 `await review_runtime.run(review_prompt, session_id=review_session.session_id)`。
7. review 完成后 `await review_runtime.aclose()`，释放 reviewer provider 资源。

**关键边界**：

- reviewer runtime 拥有独立 session，不污染主 session。
- reviewer runtime 拥有独立 tool 白名单，不可访问普通业务工具。
- reviewer runtime 只负责分析和写 `evo` 目录，不回写主链历史。

**生命周期约束**：

- 子 agent 默认运行在同一进程、同一 event loop 的后台 `asyncio.Task` 中。
- 每次 review 都创建一份独立 reviewer runtime 和独立 review session。
- 创建和回收必须一一匹配：`create runtime -> register pending task -> run -> aclose runtime -> unregister task`。
- 回收逻辑必须放在 `try/finally`，覆盖成功、失败、取消、超时四条路径。
- reviewer runtime 不进入全局 session cache，不复用主 agent 的 session 对象。
- reviewer runtime 只拿 transcript window 副本，不持有主链可变状态引用。

**防泄露要求**：

- **资源隔离**：reviewer runtime 自己关闭 provider 资源，`evolution_write` 单次打开单次关闭文件句柄。
- **状态隔离**：reviewer session 只存 review 证据，不写回主 session。
- **能力隔离**：tool 白名单只开放 `evolution_write`，不继承普通工具面。
- **观测隔离**：所有 reviewer 事件带 `review_id` / `parent_run_id`，便于排查孤儿任务。

**不包含范围**：

- 正式 skill 目录创建。
- memory 写入。

**依赖**：

- `src/core/agent_spec.py`
- `src/executors/agent_runtime/session_engine.py`
- 当前 `LLMProvider`

**task 建议**：

- 建议 task 名：`self-evolution-child-reviewer-v0.1.9`
- 是否进入 x-req：是

### 模块 4：Evolution Write Tool

**职责**：接收 child reviewer 的结构化 payload，原子写入 `reviews/<run_id>.json`，并把养料追加到 `evolution-nutrients.jsonl`。

**包含范围**：

- schema 校验。
- confidence threshold 过滤。
- 证据字段完整性检查。
- `reviews/<run_id>.json` 落盘。
- `evolution-nutrients.jsonl` append。
- 幂等去重与事件发射。

**不包含范围**：

- 正式 skill promote。
- memory promote。

**依赖**：

- 文件系统原子写入工具
- `EventSink`

**task 建议**：

- 建议 task 名：`self-evolution-evolution-write-tool-v0.1.9`
- 是否进入 x-req：是

### 模块 5：Learning State / Observability

**职责**：控制 review 节奏、配置项、事件和退出时 drain。

**包含范围**：

- `evolution.learning` 配置。
- session 级状态统计。
- `evolution.review.*`、`evolution.nutrient_written` 事件。
- `SessionEngine.aclose()` review drain。
- 单测、集成测试和 trace 对齐。

**task 建议**：

- 建议 task 名：`self-evolution-learning-config-observability-v0.1.9`
- 是否进入 x-req：是
