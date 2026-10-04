# 验证策略 + 测试矩阵 + 演进

## 测试矩阵

### 单元测试（tests/unit/）

#### task-1: claude_evidence_selector

| 测试文件 | 覆盖 | 优先级 |
|---------|------|--------|
| `test_claude_evidence_selector.py` | jsonl 路径计算 / 解析过滤 / 倒序截取 / turn 递增 / 异常路径 | P0 |

#### task-2: EvolutionManager（核心）

| 测试文件 | 覆盖 | 优先级 |
|---------|------|--------|
| `test_evolution_manager_lifecycle.py` | `__init__` 装配 + `aclose()` 释放 + `enabled` 属性同步 config | P0 |
| `test_evolution_manager_cadence.py` | cadence 判断 5 case：disabled / count<min / 命中 / 不命中 / 高倍数命中 | P0 |
| `test_evolution_manager_stub.py` | `_build_stub_parent_runtime` PoC（build + aclose / reviewer 异常时 aclose 仍被调用）| P0 |
| `test_evolution_manager_fire_and_forget.py` | trigger 内部异常吞 + log warning + 不冒泡 | P0 |
| `test_evolution_event_bus.py` | EventBus 路由正常 / 路由不存在静默丢弃 / sink 抛异常吞 / 并发 register+emit | P0 |
| `test_evolution_manager_with_mock_provider.py` | 频道无关性（D9）：用 `MockTranscriptProvider` 跑完整流程 | P0 |
| `test_evolution_state_namespace.py` | claude/generic_chat 在同一 state.json 共存不污染（D6）| P1 |

#### task-3: claude channel integration

| 测试文件 | 覆盖 | 优先级 |
|---------|------|--------|
| `test_claude_transcript_provider.py` | provider.build_window 转发到 selector / channel_id == "claude" | P0 |
| `test_claude_route_evolution_hooks.py` | mock manager 验证 route.py 三处 hook 调用（register / notify / unregister）| P0 |

### e2e 测试（tests/e2e/）

| 测试文件 | 场景 | 优先级 |
|---------|------|--------|
| `test_evolution_claude_channel_e2e.py` | 模拟 5 次 user 消息 → 等后台 reviewer 完成 → 断言 reviews/run-claude-*.json 出现 | P0 |
| `test_evolution_claude_channel_ui.py`（手动）| 浏览器看 web 系统卡片 + 点 accept_memory → 验证 `.kongming/memory/MEMORY.md` 写入 | P1（手动）|

### Fixture 准备（task-1）

`tests/fixtures/claude_jsonl/` 下放样例 jsonl：

- `clean_5_turns.jsonl` — 5 个完整 user-assistant turn，干净 text
- `with_tool_use.jsonl` — 含 tool_use / tool_result（v0.1 应被过滤）
- `with_thinking.jsonl` — 含 thinking block（v0.1 应被过滤）
- `malformed_line.jsonl` — 含一行坏 JSON
- `wrong_session_id.jsonl` — sessionId 字段不匹配
- `empty.jsonl` — 空文件
- `single_user_no_assistant.jsonl` — 不完整 turn

### 验证命令

```bash
# task-1 单测
uv run pytest tests/unit/test_claude_evidence_selector.py -v

# task-2 单测（核心）
uv run pytest tests/unit/test_evolution_manager_lifecycle.py -v
uv run pytest tests/unit/test_evolution_manager_cadence.py -v
uv run pytest tests/unit/test_evolution_manager_stub.py -v
uv run pytest tests/unit/test_evolution_manager_fire_and_forget.py -v
uv run pytest tests/unit/test_evolution_event_bus.py -v
uv run pytest tests/unit/test_evolution_manager_with_mock_provider.py -v
uv run pytest tests/unit/test_evolution_state_namespace.py -v

# task-3 单测
uv run pytest tests/unit/test_claude_transcript_provider.py -v
uv run pytest tests/unit/test_claude_route_evolution_hooks.py -v

# 全部新增 evolution 单测
uv run pytest tests/unit -k "evolution_manager or evolution_event_bus or claude_transcript or claude_evidence" -v

# e2e（需要本地 LLM 服务）
uv run pytest tests/e2e/test_evolution_claude_channel_e2e.py -v

# 类型检查
make typecheck

# import 边界检查（关键——验证 D8）
make lint
```

## 验证 DoD 的对应表

| DoD | 验证测试 |
|-----|---------|
| D1 cadence 触发 | `test_evolution_manager_cadence.py` + `test_evolution_claude_channel_e2e.py` |
| D2 transcript 装配 | `test_claude_evidence_selector.py` + `test_claude_transcript_provider.py` |
| D3 工具白名单 | `test_evolution_manager_stub.py`（断言 enabled_tool_names）|
| D4 run_id 格式 | `test_evolution_manager_cadence.py` + e2e 文件名断言 |
| D5 web UI 流转 | 手动测试 `test_evolution_claude_channel_ui.py` + `test_evolution_event_bus.py` |
| D6 频道隔离 | `test_evolution_state_namespace.py` |
| D7 fire-and-forget | `test_evolution_manager_fire_and_forget.py` + `test_claude_route_evolution_hooks.py` |
| **D8 import 边界** | `make lint`（.importlinter Contract）|
| **D9 频道无关性** | `test_evolution_manager_with_mock_provider.py`（manager 单测内无 "claude"/"codex" 字样）|

## 集成回归

确认下面这些已有测试**不被破坏**：

- `tests/unit/test_evolution_*.py` — evolution v0.1.9 现有单测
- `tests/unit/test_evidence_selector.py` — generic_chat 频道 evidence_selector
- `tests/unit/test_reviewer_runtime.py` — reviewer_runtime 装配
- `tests/unit/test_state_store.py` — state_store cadence
- `tests/e2e/test_self_evolution_e2e.py` — generic_chat e2e

## 演进路径

### v0.1 → v0.1.5（codex 频道接入，单独 spec）

按本架构：

- 新增 `src/web/integrations/codex/codex_transcript_provider.py`（实现 TranscriptProvider，调 codex jsonl reader）
- 改动 `src/web/integrations/codex/route.py` 加 3 处 hook（register / notify / unregister）
- run_id 命名扩展：manager 内 hardcode `"claude"` 改成 `provider.channel_id` 拼接（v0.1.5 task-2 微调）
- **EvolutionManager 0 改动**

预计工时：1d（含 codex 现有路径调研）

### v0.1.5 → v0.2（M2 司天读 evolution）

- 司天加 `evolution_nutrients` source kind，扫 `.kongming/evolution/`
- workspace_state.work_item.metadata 加 `pending_nutrients` / `failed_apply_count`
- 司天 suggestions 引擎生成"nutrient 堆积 / 决策待处理"建议

### v0.2 → v0.3（M3 日报）

- cron 调度 `sitian_daily_report` 任务
- 生成 markdown 报告 + push 到 web

### v0.3 → v0.4（M4 桌面宠物）

- 独立 Tauri/Electron 窗口订阅 `/ws/sitian/pet`
- 显示当前激活 thread + 待审批 + 间隔提醒

### v0.4 → v0.5（generic_chat 迁移到 manager）

- 把 SessionEngine 内置的 evolution hook 改成 manager 接入
- 新增 `NativeTranscriptProvider`（实现 TranscriptProvider，调现有 evidence_selector）
- generic_chat ws.py 加 manager hook
- 删除 SessionEngine 内置 evolution 逻辑

## 已知后续改进点（不在 M1）

| 改进点 | 触发条件 | 解法 |
|--------|---------|------|
| v0.1 transcript 不纳入 thinking/tool_use | nutrient 质量受限 | v0.2 在 evidence_selector 加 `include_thinking` 参数 |
| 单 thread 短时间高频触发浪费 quota | 用户连续发 20 条消息 → 4 次 reviewer 同步触发 | v0.2 加 thread 级触发节流（min interval seconds）|
| reviewer 看不到工具调用模式 | "用户偏好用 grep 而非 find" 这种 nutrient 提不出来 | v0.2 加 tool_use/tool_result 纳入 transcript |
| 历史回填：上线前老 thread 没计数 | 老 thread 永不触发 review | 不修复，让用户继续用自然累计 |

## 监控与可观测性

复用 v0.1.9 现有事件（manager + event_bus 透传）：

- `evolution.review.started` — manager 决定 spawn 后发射
- `evolution.review.completed` — reviewer 成功写完
- `evolution.review.failed` — timeout / write 失败
- `evolution.nutrient_written` — 单条 nutrient 写盘

trace 落盘到 `.kongming/trace*.jsonl`，可用 `grep "evolution\." .kongming/trace*.jsonl` 查所有 evolution 事件。
