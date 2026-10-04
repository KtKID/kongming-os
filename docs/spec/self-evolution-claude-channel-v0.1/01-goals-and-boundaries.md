# 目标 + 完成标准 + 范围

## 系统目标

把 self-evolution v0.1.9 升级为**频道无关的独立子系统**，引入 `EvolutionManager` 作为唯一对外门面。本 spec 范围内：

1. 建立 `EvolutionManager` + `TranscriptProvider` Protocol + `EvolutionEventBus` 三件套
2. 用 mini ToolRegistry 在 manager 内部装配，频道方零感知 evolution 内部
3. 以 claude_code 频道作为第一个接入实践，验证架构频道无关性
4. claude 频道用户消息触发 reviewer + nutrient 写盘 + web UI 卡片显示，跟 generic_chat 频道 UX 一致

**为什么做**：

- evolution v0.1.9 跟 generic_chat (SessionEngine) 强绑定，扩展到其他频道（claude/codex）需要复制大量装配代码 → 不可持续
- claude 频道是用户主力对话通道之一，目前 evolution 完全不跑 → 用户在 claude thread 里的有价值经验/偏好都没沉淀
- 司天 + evolution 串联做工作区监视的前置依赖：M2 需要司天读 `.kongming/evolution/` 看 thread 健康度
- 把"频道无关"做对一次，M1.5 codex 接入只需 30 行新代码（Provider + 3 行 hook）

**不做这个会怎样**：

- 每个频道都要重复一遍 cadence/spawn/tool/event 装配代码
- claude 用户经验持续丢失
- 司天工作区监视无法看到 thread 维度健康度

## 完成标准（DoD）

| # | DoD 条目 | 验收方式 |
|---|---------|---------|
| D1 | 用户在 claude thread 发第 5 次消息时（every_n_runs=5），manager 自动 spawn evolution reviewer | e2e 测试：模拟 5 条 user 消息 → 断言 `.kongming/evolution/reviews/run-claude-*.json` 出现 |
| D2 | reviewer 看到的 transcript 是 jsonl 里最后 max_history_messages 条 user/assistant 消息（按时间序、配对完整）| 单测：fixture jsonl + 断言 TranscriptWindow.messages |
| D3 | reviewer 工具白名单仅 `evolution_write`，由 manager 内部装配的 mini ToolRegistry 强制；外部传入的工具不会污染 | 单测：检查 reviewer 装配时 enabled_tool_names == [REVIEWER_TOOL_NAME] |
| D4 | review record 文件名格式 `run-claude-{thread_id}-{count}.json`，跟 generic_chat 的 `run-{sid}-{run_index}.json` 共存不冲突 | 单测：spawn 后断言文件名 + listdir 验证两种文件并存 |
| D5 | web 系统卡片在 claude thread 上显示"进化复盘 / 已沉淀"，决策弹窗能弹出，能 accept_memory/accept_skill/ignore | 手动测试：跑 5 轮 → 看 web UI 卡片 → 点 accept_memory → 验证 `.kongming/memory/MEMORY.md` 写入 |
| D6 | claude 频道与 generic_chat 频道在同一 `evolution.state.json` 共存不污染（thread_id 命名空间隔离）| 单测：交替触发两种频道的 record_parent_run → 断言互不污染 |
| D7 | 用户消息入口 `route.py` 改动不阻塞主路径——即使 manager 触发失败也不影响用户发消息 | 单测：mock manager 抛异常 → 断言 route.py 仍处理消息 |
| **D8 (新)** | **模块边界硬约束**：`src/evolution/` 不 import `src/web/*`（`evolution.claude_evidence_selector → web.integrations.claude_code.jsonl_history` 是单点白名单，在 .importlinter 标记）| `make lint` 通过（含 import-linter 边界检查）|
| **D9 (新)** | **频道无关性**：用 `MockTranscriptProvider` 在 manager 单测里跑通完整流程（无任何 claude/codex/native 字样），证明 manager 不耦合具体频道 | 单测：`test_evolution_manager_with_mock_provider.py` 通过 |

## 包含范围

- 新增 `src/evolution/evolution_manager.py`：EvolutionManager 类（核心门面）
- 新增 `src/evolution/transcript_provider.py`：TranscriptProvider Protocol
- 新增 `src/evolution/claude_transcript_provider.py`：claude 频道的 provider 实现
- 新增 `src/evolution/event_bus.py`：EvolutionEventBus（按 thread_id 路由）
- 新增 `src/evolution/claude_evidence_selector.py`：jsonl 解析 + 拍平（task-1，被 ClaudeTranscriptProvider 内部用）
- 改动 `src/web/app.py`：lifespan 装配 EvolutionManager 单例 → `app.state.evolution_manager`
- 改动 `src/web/integrations/claude_code/route.py`：3 处 hook（register / notify / unregister）
- 复用 `src/evolution/state_store.py` / `store.py` / `reviewer_runtime.py` / `evolution_write_tool`（不改）
- 复用 `src/web/ws_event_sink.py`（如已 channel-agnostic）或抽成 channel-agnostic 版本
- 单测 + e2e + 手动 UI 验证

## 不包含范围

- ❌ codex 频道接入（M1.5——按本架构只需新建 `CodexTranscriptProvider` + codex route.py 三处 hook，单独 spec）
- ❌ generic_chat 频道重构走 manager 接入（generic_chat 仍用现有 SessionEngine hook，迁移留给未来）
- ❌ 司天读 evolution 产物（M2）
- ❌ 每日报告（M3）
- ❌ 桌面宠物 widget（M4）
- ❌ TranscriptWindow 按 token 预算裁剪（沿用 native 现有 `max_history_messages`）
- ❌ reviewer 自身 prompt 优化（沿用 v0.1.9）
- ❌ 修改 `evolution.state.json` schema
- ❌ 修改 `ThreadMetadata` schema
- ❌ 新增 LLM tool（reviewer 工具白名单仅 evolution_write 不变）

## 关键约束

| 约束 | 来源 | 影响 |
|------|------|------|
| **模块边界**：evolution 不能 import web/* | 用户明确要求 + 架构原则 | 所有"频道相关"代码住在 `web/<channel>/` 下；evolution 只暴露 TranscriptProvider Protocol |
| reviewer 工具白名单仅 `evolution_write` | 安全设计 + CLAUDE.md 约束 | manager 内部装配 mini_registry，不接受外部 tools 注入 |
| 不改 `run_child_review` 签名 | 避免破坏 generic_chat 调用方 | manager 内部构建 `_StubParentRuntime` 当 reviewer parent 容器，跑完即 aclose |
| 不改 `evolution.state.json` schema | 复用现有 cadence 逻辑 | thread_id 命名空间直接当 session_id key |
| 计数发生在 SDK 之外 | 用户明确要求 | 计数在 `route.py` 用户消息入口（通过 `manager.notify_user_message`），不依赖 SDK 内部 turn |
| 触发是 fire-and-forget 异步 | 不能阻塞用户主路径 | route.py 用 `asyncio.create_task(manager.notify_user_message(...))` |

## DoD ↔ 模块追溯矩阵

| DoD | 需要的组件 | 需要的 task |
|-----|----------|------------|
| D1 cadence 触发 | EvolutionManager + state_store + route.py hook | task-2, task-3 |
| D2 transcript 装配 | ClaudeTranscriptProvider + claude_evidence_selector | task-1, task-3 |
| D3 工具白名单 | manager._mini_registry（内部装配）| task-2 |
| D4 run_id 命名 | manager.notify_user_message 拼接 `run-claude-{thread_id}-{count}` | task-2 |
| D5 web UI 显示 | EvolutionEventBus 路由 + WsEventSink + route.register_event_route | task-2, task-3 |
| D6 频道隔离 | state_store 共用 sessions 表 | task-2 |
| D7 fire-and-forget | manager.notify_user_message 顶层 try/except + route.py 异步 task | task-2, task-3 |
| **D8 import 边界** | `.importlinter` Contract + 代码组织 | task-2（写 Contract）, 全程 |
| **D9 频道无关性** | `TranscriptProvider` Protocol + MockTranscriptProvider 验证 | task-2 |
