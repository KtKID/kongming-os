# self-evolution-claude-channel-v0.1

> 状态：方案确认 → 可进入 x-req
> 目标：建立独立 `EvolutionManager`，让 evolution 子系统跟具体频道完全解耦；以 claude 频道作为第一个接入

## Spec 目标

把 evolution v0.1.9 升级为**频道无关的独立子系统**。引入 `EvolutionManager` 作为唯一对外门面，对各频道暴露三个钩子（register / notify / unregister）。各频道（claude_code / codex / generic_chat 重构后）通过实现 `TranscriptProvider` Protocol 接入，**零耦合 evolution 内部装配细节**（mini ToolRegistry / EventBus / cadence / reviewer spawn 全部在 manager 内部）。

第一个接入频道是 claude_code——用户在 claude thread 里发消息，manager 按 cadence 触发 reviewer，从 `~/.claude/projects/<encoded-cwd>/<sid>.jsonl` 读历史，子 agent 复盘后写 nutrient + web UI 显示卡片。

## 最小可用路径（MVP 链路）

```
[Web 启动] app.py 装配 EvolutionManager 单例 → app.state.evolution_manager

[Web 连接] claude_code/route.py ws 建立
   └─ evolution_manager.register_event_route(thread_id, WsEventSink(ws))

[用户发消息] claude_code/route.py claude-command 入口
   └─ asyncio.create_task(
         evolution_manager.notify_user_message(
             thread_id, ClaudeTranscriptProvider(claude_thread_id, cwd), cwd
         )
       )
         │
         ▼ (manager 内部，频道方不感知)
       cadence 判断 → provider.build_window() → spawn reviewer
         │                                          │
         │ ClaudeTranscriptProvider 内部             │
         │ 调 claude_evidence_selector              │
         │ (task-1 产出)                            │
         │                                          ▼
         └──────────────────────────────────→ evolution_write
                                                    │
                                                    ▼
                                             .kongming/evolution/reviews/run-claude-*.json
                                                    │
                                                    ▼
                                             emit evolution.review.completed (含 thread_id)
                                                    │
                                                    ▼
                                             EvolutionEventBus 按 thread_id 路由
                                                    │
                                                    ▼
                                             WsEventSink → web 卡片显示

[Web 断开] claude_code/route.py ws 断开
   └─ evolution_manager.unregister_event_route(thread_id)
```

## 组件导航

| 组件 | 角色 | 复用/新建 | 文档 |
|------|------|----------|------|
| **EvolutionManager** | 独立子系统门面，对外 4 个 API（enabled / notify / register / unregister）| 🆕 新建 | [02-module-breakdown.md](./02-module-breakdown.md) §① |
| **TranscriptProvider** Protocol | 抽象"怎么读对话历史"，频道无关 | 🆕 新建 | [02-module-breakdown.md](./02-module-breakdown.md) §② |
| **ClaudeTranscriptProvider** | claude 频道的 provider 实现 | 🆕 新建 | [02-module-breakdown.md](./02-module-breakdown.md) §③ |
| **EvolutionEventBus** | 按 thread_id 路由事件到对应频道的 sink | 🆕 新建 | [02-module-breakdown.md](./02-module-breakdown.md) §④ |
| **claude_evidence_selector** | jsonl 解析 + 拍平（task-1 产出，被 ClaudeTranscriptProvider 内部用）| 🆕 task-1 已 req | — |
| `app.py` 装配 | lifespan 启动时 build EvolutionManager 单例 → app.state | 改动既有 | [02-module-breakdown.md](./02-module-breakdown.md) §⑤ |
| `claude_code/route.py` 三处钩子 | ws 连接/断开/用户消息时分别调 manager 三个 API | 改动既有 | [02-module-breakdown.md](./02-module-breakdown.md) §⑥ |
| state_store / reviewer_runtime / evolution_write | 不动 | 复用 | — |

## 文档导航

- [01-goals-and-boundaries.md](./01-goals-and-boundaries.md) — 目标 + DoD + 范围 + 模块边界
- [02-module-breakdown.md](./02-module-breakdown.md) — 6 个组件详细设计
- [03-core-workflows.md](./03-core-workflows.md) — 时序图：3 个钩子的完整调用链
- [04-data-and-state.md](./04-data-and-state.md) — jsonl → TranscriptWindow 映射 + state.json 共存
- [05-validation-and-evolution.md](./05-validation-and-evolution.md) — 测试矩阵 + M1.5-M4 演进
- [90-task-map.md](./90-task-map.md) — 4 个 task：selector / manager / claude-channel / docs
- [architecture.html](./architecture.html) — 模块依赖图（浏览器打开）

## 当前建议

1. **重要架构原则**：evolution 必须是独立模块，频道方只调 manager 三个 API，不触碰 evolution 内部装配
2. **task 顺序**：task-1（selector，已 req）→ task-2（**manager**，2d，含 PoC）→ task-3（claude 接入，0.5d）→ task-4（docs，0.5h）
3. **总开关**：`config.evolution.learning.enabled` —— manager 在 disabled 时所有 API 都是 no-op，频道方无需做开关判断
4. **范围严守**：本 spec 只到 claude 频道闭环；codex 频道接入是 M1.5（新 spec）；司天读 evolution 产物是 M2；日报 M3；桌面宠物 M4

## 背景上下文

司天 + evolution 串联做工作区监视的路线图：

- **M1（本 spec）**：抽出 EvolutionManager 独立模块 + claude 频道接入，数据采集打通
- **M1.5**：codex 频道接入——**只需新建 `CodexTranscriptProvider` + codex route.py 三行钩子**，0 改动 EvolutionManager
- **M2**：司天读 `.kongming/evolution/` 产物 → workspace_state.work_item.metadata
- **M3**：cron 调度每日报告
- **M4**：桌面宠物 widget
