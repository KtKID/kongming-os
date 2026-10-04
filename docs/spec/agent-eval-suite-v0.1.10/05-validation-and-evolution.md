# 验证与演进

## 1. 验收目标

这套测试集的验收目标有四条：

- 当前框架的主链风险能被统一 case 集覆盖。
- 现有 `unit + e2e` 能映射成一套系统级能力视图。
- 大多数框架回归能在 `stub / replay` lane 被稳定捕获。
- 少量 `real-provider-smoke` case 能验证装配、流式、落盘、回收这条真链路。

## 2. 测试分层

### 2.1 第一性原理测试轴

| 轴 | 要回答的问题 | 当前框架对应边界 |
|---|---|---|
| 状态推进 | turn loop 是否按预期推进和停止 | `src/core/runner.py` |
| 动作正确 | tool call 是否正确分发、回填、收口 | `src/tools/*`, `ToolLookup` |
| 权限边界 | 调用是否经过正确的安全链 | `src/safety/*`, `SessionEngine.build` |
| 上下文连续性 | session / instruction / compact 是否保持语义 | `src/context/*`, `src/core/session.py` |
| 可观测性 | trace / prompt-debug / thread file 是否完整 | `src/observability/*`, `src/web/*` |
| 隔离与恢复 | reviewer、scheduler、web cell 是否互不污染 | `src/evolution/*`, `src/scheduler/*`, `src/web/thread_manager*` |

### 2.2 执行 lane

| lane | 目标 | 成本 | 稳定性 |
|---|---|---|---|
| `stub` | 守住框架语义 | 低 | 高 |
| `replay` | 守住 provider / protocol 适配 | 中 | 高 |
| `real-provider-smoke` | 守住真实链路 | 高 | 中 |

## 3. MVP case 集

MVP 先收 `24` 条 case，按六个能力面分桶。

| case_id | 能力面 | lane | 目标 |
|---|---|---|---|
| `core.plain_chat.single_turn` | core | stub | 单轮文本 run 成功收口 |
| `core.tool_call.happy_path` | core | stub | tool call 正常执行并回填 |
| `core.tool_call.multi_step` | core | stub | 多步 tool loop 正常停止 |
| `core.max_turns.exceeded` | core | stub | 超过 turn 上限时失败收口 |
| `core.system_seed.once` | core | stub | system 只注入一次 |
| `core.trace.fanout.complete` | core | replay | `run.start/end` 与 `turn.started/ended` 完整 |
| `safety.hard_block.shell` | safety | stub | hard deny 直接拒绝 |
| `safety.permission.ask.approve_once` | safety | stub | ask + approve_once 执行成功 |
| `safety.permission.ask.reject` | safety | stub | ask + reject 不执行 tool |
| `safety.session_grant.silent_allow` | safety | stub | session grant 命中 silent_allow |
| `safety.config_grant.silent_allow` | safety | replay | config grant 命中 silent_allow |
| `safety.boundary.sensitive_path` | safety | replay | sensitive path 命中边界判定 |
| `context.session.multi_turn_persist` | context | stub | 多轮会话连续 |
| `context.file_session.usage_shape` | context | replay | JSONL usage 字段 shape 正确 |
| `context.compact.preserve_recent` | context | stub | compact 保留 system 和 recent history |
| `context.prompt_debug.origins` | context | replay | `instruction_origins` 与 assembled messages 对齐 |
| `tool.skill.loader.shadow` | tool | stub | workspace skill 覆盖 home skill |
| `tool.skill.execute.substitute` | tool | stub | skill 变量替换与 tool_result 回填正确 |
| `tool.skill.rule.allow` | tool | replay | skill allow rule 命中 silent_allow |
| `tool.scheduler.register.gated` | tool | replay | schedule tool 按开关注册 |
| `host.web.thread_boot_resume` | web | replay | thread boot / resume 连续 |
| `host.web.ws.history_roundtrip` | web | replay | ws 历史 frame 往返正确 |
| `runtime.stream.approval_flow` | runtime | real-provider-smoke | 流式 + approval 真链路冒烟 |
| `runtime.evolution.review_isolated` | runtime | real-provider-smoke | child reviewer 隔离并稳定落盘 |

## 4. 与现有测试的映射

当前仓库已经有大量现成覆盖。第一批实施建议直接复用这些文件，把它们纳入统一 case id。

| 能力面 | 现有测试文件 | 现状 | 缺口 |
|---|---|---|---|
| core | `tests/unit/test_core_runner_basic.py`, `tests/e2e/test_plain_chat.py`, `tests/e2e/test_tool_call.py`, `tests/e2e/test_max_turns_counter_real_llm.py` | 核心闭环已覆盖 | 缺统一 trace 断言和 case id |
| safety | `tests/unit/test_safety_chain.py`, `tests/unit/test_safety_permission.py`, `tests/unit/test_safety_consent_resolver.py`, `tests/e2e/test_permission_deny.py`, `tests/e2e/test_approval_ask.py` | 规则分支已覆盖 | 缺 grant 命中与 artifact 报告统一视图 |
| context | `tests/unit/test_input_assembler.py`, `tests/unit/test_instruction_loader.py`, `tests/unit/test_file_session.py`, `tests/e2e/test_file_session_integration.py`, `tests/e2e/test_history_compact_runner.py` | 状态面较完整 | 缺 prompt-debug / session / result 三证据统一判分 |
| tool / skill / scheduler | `tests/unit/test_skill_loader.py`, `tests/unit/test_skill_assemble.py`, `tests/unit/test_tools_build_default_registry_skill.py`, `tests/unit/test_register_schedule_tool_if_enabled.py`, `tests/e2e/test_scheduler_e2e.py` | 扩展面已有独立测试 | 缺纳入同一 suite 的系统定位 |
| web | `tests/unit/test_web_protocol_round_trip.py`, `tests/unit/test_web_ws_endpoint.py`, `tests/unit/test_web_thread_manager_lifecycle.py`, `tests/unit/test_web_ws_history_frame.py`, `tests/e2e/test_stream_approval_flow.py` | 宿主协议面较强 | 缺统一 thread lifecycle case 集 |
| evolution | `tests/unit/test_evolution_reviewer_runtime.py`, `tests/unit/test_evolution_write_tool.py`, `tests/e2e/test_self_evolution_e2e.py` | 后台 review 主链已覆盖 | 缺 reviewer 隔离的 suite 级断言 |

## 5. 这套测试集新增的东西

相对现有测试文件，这套方案新增四个能力：

- `统一 case id`
- `统一 ExecutionRecord`
- `统一 grader 语义`
- `统一 suite report`

这四件事会把“很多测试文件”收口成“一个框架级测试集”。

## 6. 推荐实施顺序

### 第一阶段

- 定义 `CaseSpec / ExecutionRecord / GraderResult / SuiteReport`
- 先把 `core + safety + context` 的 `stub` case 跑通
- 给现有测试补 case id 和统一报告

### 第二阶段

- 接 `replay` lane
- 把 `skill / scheduler / web` 纳入统一 suite
- 补 session / prompt-debug / trace 三证据 grader

### 第三阶段

- 收窄 `real-provider-smoke`
- 保留少量高价值真链路 case
- 为 nightly 或手动发布前检查准备 smoke 清单

## 7. 演进路线

### 7.1 v0.1.10 完成态

- 框架级测试集方案固定
- MVP `24` 条 case 完成映射
- 三类 grader 语义固定

### 7.2 下一阶段

- 与公开 benchmark 建立外环映射
- 让 `GAIA / WebArena / SWE-bench Pro` 成为框架外层能力对照
- 把框架内因和模型外因分开看

### 7.3 更后续阶段

- case 录制与回放自动化
- flaky 统计
- 统一 HTML 或 Markdown suite report
