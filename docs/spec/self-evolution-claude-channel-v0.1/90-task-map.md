# 组件 → Task 映射（v2，按 EvolutionManager 架构重写）

## 拆分原则

按"模块边界 + 可独立测试"拆。每个 task 独立可进 x-req，独立可写测试。最大化复用 task-1 的纯函数 adapter，把核心架构重组都集中在 task-2（manager）。

## Task 列表

| Task | 名称 | 依赖 | 工时 | 风险 | 备注 |
|------|------|------|----------|------|------|
| **task-1** | claude-evidence-selector-v0.1 | 无 | 0.5d | 低 | ✅ x-req 完。纯函数 jsonl adapter，被 task-3 的 ClaudeTranscriptProvider 内部用 |
| **task-2** | evolution-manager-v0.1 | task-1 | **2d** | **中** | 核心：EvolutionManager + TranscriptProvider Protocol + EvolutionEventBus + mini_registry 装配 + cadence/spawn 逻辑。完全频道无关 |
| **task-3** | claude-channel-integration-v0.1 | task-2 | 0.5d | 低 | ClaudeTranscriptProvider 实现 + app.py 装 manager 单例 + route.py 三处钩子 + e2e |
| **task-4** | docs-sync | task-3 | 0.5h | 低 | 更新 `docs/modules/进化/README.md` 加 manager + transcript_provider 章节；更新 CLAUDE.md |

**总工时**：约 3 天

## Task 详情

### task-1：claude_evidence_selector ✅ 已 x-req

详情见 [dev-pipeline/tasks/claude-evidence-selector-v0.1/README.md](../../../dev-pipeline/tasks/claude-evidence-selector-v0.1/README.md)

跟之前一致，**不受架构重组影响**——它是纯函数 jsonl adapter，会被 task-3 的 `ClaudeTranscriptProvider` 在 `build_window` 里调用。

---

### task-2：evolution-manager-v0.1（核心，含 PoC）

**输出**：

- `src/evolution/evolution_manager.py` 🆕 EvolutionManager 类 + `_build_stub_parent_runtime` helper
- `src/evolution/transcript_provider.py` 🆕 TranscriptProvider Protocol
- `src/evolution/event_bus.py` 🆕 EvolutionEventBus
- `src/evolution/__init__.py` 改：re-export `EvolutionManager`, `TranscriptProvider`
- `tests/unit/test_evolution_manager_lifecycle.py`（init + aclose）
- `tests/unit/test_evolution_manager_cadence.py`（cadence 5 case）
- `tests/unit/test_evolution_manager_stub.py`（_build_stub_parent_runtime PoC）
- `tests/unit/test_evolution_manager_fire_and_forget.py`（异常吞）
- `tests/unit/test_evolution_event_bus.py`（路由 + 并发 register/emit）
- `tests/unit/test_evolution_manager_with_mock_provider.py`（频道无关性：用 MockTranscriptProvider 验证流程）
- `tests/unit/test_evolution_state_namespace.py`（thread_id 命名空间隔离）

**关键 checklist**：

1. **PoC 优先**：先写 `_build_stub_parent_runtime` 单测（build + aclose），验证 SessionEngine.build 在 ad-hoc 上下文 + manager 内部装配的 mini_registry/event_bus 跑通
2. EvolutionManager 公开 API：
   - `__init__(config, kongming_home)` 装配所有内部依赖
   - `@property enabled` 绑定 `config.evolution.learning.enabled`
   - `async notify_user_message(thread_id, provider, cwd)` — fire-and-forget
   - `register_event_route(thread_id, sink)` / `unregister_event_route(thread_id)` — 转发到 event_bus
   - `async aclose()` — 释放 bg_tasks 等待 + 释放资源
3. `_build_stub_parent_runtime` 内部用 `self._mini_registry` + `[self._event_bus]`，3 级 model fallback
4. `notify_user_message` 顶层 try/except 吞所有异常 + log warning
5. TranscriptProvider Protocol：`channel_id` property + `async build_window(run_id, max_messages)`
6. EvolutionEventBus：
   - 实现 EventSink Protocol
   - `register/unregister/emit` 用 `asyncio.Lock` 保护
   - `emit` 内按 `event.run_id` 正则解析 thread_id 路由（v0.1 写死正则 `^run-claude-(thread-[a-f0-9]{12})-\d+$`，M1.5 codex 时扩成多正则）
   - 路由不存在静默丢弃 + log debug；sink 抛异常吞 + log warning
7. run_id 命名：`f"run-claude-{thread_id}-{count}"`（v0.1 写死 claude 前缀；M1.5 改成按 `provider.channel_id` 拼）
8. `.importlinter` 添加 Contract：禁止 `src/evolution/` import `src/web/`（claude_evidence_selector → web.integrations.claude_code.jsonl_history 是单点例外，需在 Contract 里加 ignore）

**测试 case 清单**：

- ✅ `manager.enabled` 跟 `config.evolution.learning.enabled` 同步
- ✅ disabled 时 notify_user_message 立刻 return 不调 state_store
- ✅ enabled=True, run_count=2 (< min=3) → 不 spawn
- ✅ run_count=5, every_n=5 → spawn
- ✅ run_count=4, every_n=5 → 不 spawn
- ✅ run_count=10, every_n=5 → spawn
- ✅ window.messages 空 → mark_review_result(status="skipped_empty_window")
- ✅ stub.aclose 在 reviewer 异常路径也被调用
- ✅ run_id 严格格式 `run-claude-{thread_id}-{count}`
- ✅ manager 内部异常吞掉调用方不感知
- ✅ EventBus.register + unregister 幂等
- ✅ EventBus 并发 register/emit 不丢事件
- ✅ EventBus 路由不存在的 thread_id 静默丢弃
- ✅ EventBus 子 sink 抛异常不影响其它 sink
- ✅ 用 MockTranscriptProvider 跑完整流程（验证频道无关性 + D9）
- ✅ claude/generic_chat state.json 共存不污染（D6）

**风险与 PoC**：

| 风险 | 缓解 |
|------|------|
| `_build_stub_parent_runtime` 装配 | task-2 #1 PoC 优先：单测验证 build+aclose 链路 |
| EventBus thread_id 解析正则不健壮 | 单测覆盖各种 run_id 格式 |
| EventBus 并发安全 | asyncio.Lock + 并发单测 |
| Protocol 误抽象 | 跟 ClaudeTranscriptProvider 一起设计验证 |

---

### task-3：claude-channel-integration-v0.1

**输出**：

- `src/evolution/claude_transcript_provider.py` 🆕 `ClaudeTranscriptProvider` 实现
- `src/web/app.py` 改：lifespan 装配 `EvolutionManager` → `app.state.evolution_manager`
- `src/web/integrations/claude_code/route.py` 改：3 处 hook
- `tests/unit/test_claude_transcript_provider.py`（provider 内部调 selector 转发）
- `tests/unit/test_claude_route_evolution_hooks.py`（mock manager 验证 route.py 三处 hook 调用）
- `tests/e2e/test_evolution_claude_channel_e2e.py`（连续 5 次 user 消息 → 等 5s → 断言 reviews 出现）

**关键 checklist**：

1. `ClaudeTranscriptProvider` 实现 TranscriptProvider Protocol，内部调 task-1 的 `claude_evidence_selector.build_claude_transcript_window`
2. `channel_id` property 返回 `"claude"`
3. `app.py` 在 lifespan startup 装配 manager 单例 + shutdown 调 aclose
4. `route.py` 改动 3 处：
   - ws.accept() 后：`await manager.register_event_route(thread_id, WsEventSink(ws, thread_id))`
   - claude-command 处理后：`asyncio.create_task(manager.notify_user_message(thread_id, ClaudeTranscriptProvider(...), cwd))`
   - finally 块：`await manager.unregister_event_route(thread_id)`
5. route.py 不 import `evolution.state_store / reviewer_runtime / event_bus / manager 内部细节`
6. 验证 WsEventSink 是否需要抽 channel-agnostic 版本（如果当前耦合 generic_chat 上下文则要小重构）
7. e2e：5 次 user message → 等 reviews/ 出现 run-claude-*.json

**测试 case 清单**：

- ✅ ClaudeTranscriptProvider.build_window 调 selector 正确转发
- ✅ ClaudeTranscriptProvider.channel_id == "claude"
- ✅ route.py 调 register_event_route 一次（ws 连接时）
- ✅ route.py 调 notify_user_message 一次（每个 claude-command）
- ✅ route.py 调 unregister_event_route 一次（ws 断开时）
- ✅ mock manager 抛异常 → route.py 仍正常处理用户消息（不阻塞）
- ✅ e2e：5 次 user message → reviews/run-claude-*.json 出现
- ✅ e2e：手动浏览器测——发 5 次消息看 web 卡片显示

---

### task-4：docs-sync

**输出**：

- 更新 `docs/modules/进化/README.md` 加"EvolutionManager 门面 + TranscriptProvider 协议 + EventBus 路由"章节
- 更新根 `CLAUDE.md` 的 evolution 模块行
- 提交 `dev-pipeline/tasks/*/changelog.md`

**关键 checklist**：

1. 模块文档加"频道无关架构"段说明 manager / provider / event_bus 三件套关系
2. 列出 manager 公开 API 4 项
3. 标注 import 边界（evolution → web 的单点白名单）
4. CLAUDE.md 数据流图加 EvolutionManager 节点

## 排序

```
task-1 (0.5d, 无依赖) ✅
    ↓
task-2 (2d, 依赖 task-1 的 selector 作为 provider 内部实现) ← 当前重点
    ↓
task-3 (0.5d, 依赖 task-2 manager)
    ↓
task-4 (0.5h, 依赖 task-3)
```

## 并行机会

- task-2 内部多个组件可并行写：`transcript_provider.py`（Protocol，先定型）→ `event_bus.py` + `evolution_manager.py` 同时开
- task-2 的测试文件可以多个并行写
- task-3 的 `ClaudeTranscriptProvider`（约 30 行）可以跟 task-2 manager 实现同步进行（task-2 用 mock provider 测，task-3 提供真实 provider）

## 风险与 PoC 建议

| 任务 | 风险 | PoC 建议 |
|------|------|----------|
| task-2 manager 装配 | SessionEngine.build 在 ad-hoc 上下文 + 内部 mini_registry / event_bus 兼容性 | task-2 第一步只跑 `_build_stub_parent_runtime` 单测，挂了 fail-fast |
| task-2 EventBus | thread_id 解析正则 + 并发安全 | 单独并发单测 + 多 run_id 格式 fixture |
| task-2 Protocol 误抽象 | 万一 codex/native 不能复用 Protocol 就要返工 | task-2 用 MockTranscriptProvider + 在 spec 同步草拟 CodexTranscriptProvider 接口验证 |
| task-3 WsEventSink 复用 | 可能跟 generic_chat 耦合 | task-3 第一步先看 WsEventSink 现状，若耦合则抽 channel-agnostic 版本 |

## 进入开发的就绪度

| Task | 状态 | 备注 |
|------|------|------|
| task-1 | ✅ 可进入 x-dev | 已 req |
| task-2 | ✅ 可进入 x-req | 本 spec 修订完成后立即 req |
| task-3 | ⏳ 等 task-2 完成 | 提前 req 也可，但接口稳定性依赖 task-2 |
| task-4 | ⏳ 等 task-3 完成 | 轻量，等链路跑通再做 |

**结论**：spec 修订完成。task-2 是接下来的核心 task，进入 x-req 即可。
