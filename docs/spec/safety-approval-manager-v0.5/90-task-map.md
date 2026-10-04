# 90 · Task Map

> 5 阶段对应 5 个 task。每个 task 独立 PR，可独立发布。
>
> 本文档是 spec 与 task 的双向追溯锚点：spec 决策的每一项必须对应到至少一个 task；每个 task 必须对应到 spec 决策。

---

## Task 总览

| Phase | Task 名 | 范围 | 估时 | 状态 | 依赖 | 模块编号 |
|---|---|---|---|---|---|---|
| 1 | `smart-approval-manager-stage1` | 骨架 + generic_chat web 接入 + helper | 1.5d | ⏳ 可进入 x-req | 无 | 1 / 4 / 5 / 8 / 10(web) |
| 2 | `smart-approval-manager-stage2-claude` | 迁 claude_code（ApprovalBridge → thin wrapper + allow_list → GrantStore） | 1d | ⏳ 等 stage 1 | stage 1 | 9 / 2(部分) / 3 |
| 3 | `smart-approval-manager-stage3-auto` | 迁 cron / evolution 装配 + rules auto_allow 配置 | 0.5d | ⏳ 等 stage 1 | stage 1 | 10(scheduler+evo) / 2(部分) |
| 4 | `smart-approval-manager-stage4-cli` | CLIEventSink + CLI adapter 改装 | 0.5d | ⏳ 等 stage 1 | stage 1 | 6 / 10(cli) |
| 5 | `smart-approval-manager-stage5-finalize` | timeout 统一 + rules schema 完整 + 协议帧 v0.5 + 文档收尾 | 0.5d | ⏳ 等 stage 2/3/4 | stage 2 + 3 + 4 | 1(timeout) / 2(完整) / 7 / docs |

**总计**：4-5 天分 5 个 PR；阶段 2/3/4 互不阻塞可并行。

---

## 状态枚举

| 符号 | 状态 | 说明 |
|---|---|---|
| ⏳ | 未开始 | 等待开始或被前置阻塞 |
| ▶️ | 进行中 | x-req / x-dev 中 |
| 🟡 | 待测试 | x-dev 完成等 Gate |
| 🟢 | Gate 通过 | x-verify + x-qa-gate 通过 |
| ✅ | 已完成 | 上线 + 用户验收 |

---

## Stage 1 · `smart-approval-manager-stage1`

### 目标
建 ApprovalManager 骨架；接 generic_chat web 通道；其余通道 0 改 0 回归。

### 核心交付
- `src/safety/approval_manager.py`（ApprovalManager 单例 + _PendingApproval + ApprovalEventSink Protocol）
- `src/safety/approval_rules.py`（空骨架）
- `src/safety/inbox_event_sink.py`
- `src/safety/inbox_helpers.py`
- broadcaster 加 register_resolve_target / unregister API
- web/run.py L245-246 装配换 prompt_fn
- ApprovalToastCard 按 channel 隐藏第三按钮

### DoD
- generic_chat web chat 触发 LLM tool call → 浮窗弹卡 → 用户决策
- Card channel='generic_chat' 隐藏「本 session」按钮
- v2-inbox 306 后端 + 442 前端测全过（**0 回归**）
- 后端新增 ≥15 测；前端新增 ≥3 测
- lint-imports 9 contracts KEPT
- mypy 0 error
- 所有新建/改动函数中文 docstring

### 模块覆盖
- 模块 1 ApprovalManager（骨架）
- 模块 4 ApprovalEventSink Protocol
- 模块 5 InboxEventSink
- 模块 8 inbox_helpers
- 模块 10 装配（仅 web/run.py）

### 推荐 skill 链
```
x-req smart-approval-manager-stage1
  → x-dev smart-approval-manager-stage1
  → x-verify (Gate ①)
  → x-qa-gate (Gate ②)
  → ✅
```

### 推荐前置阅读
- [10-architecture.md](10-architecture.md) — manager 内部细节
- [20-data-model.md](20-data-model.md) — _PendingApproval / ApprovalEventSink Protocol
- [50-migration-plan.md#阶段-1](50-migration-plan.md#阶段-1骨架--generic_chat-web)

### 关键风险（详见 60-risk-and-mitigation.md）
- R4: EventSink Protocol 设计不准 → 阶段 1 reviewer 必查
- R9: 单例 manager 跨 thread 死锁 → 阶段 1 lock 设计 review
- R10: timeout task 内存泄漏 → 阶段 1 加 pending_count 监控

---

## Stage 2 · `smart-approval-manager-stage2-claude`

### 目标
ApprovalBridge 改 thin wrapper 调 manager；allow_list 迁 GrantStore；24 规则迁 ApprovalRules（hardcode）。

### 核心交付
- `src/web/integrations/claude_code/approval.py` ApprovalBridge.can_use_tool 改 thin wrapper
- 删 ApprovalBridge._allow_list；改 GrantStore.put_session(channel='claude_code')
- `src/web/approvals/auto/policy.py` AutoApprovalPolicy 改 thin wrapper
- `src/safety/approval_rules.py` 注入 24 规则（hardcode）
- ApprovalBridge 改调 inbox_helpers.to_inbox_payload

### DoD
- v2-inbox 306 后端 + 442 前端必须**全过**（**最关键**）
- 等价性测试：新路径 vs 老路径输出 PermissionResult 完全等价
- 新增 unit `test_approval_bridge_thin_wrapper.py` + `test_grant_store_claude_code.py`
- claude_code 通道 SDK round-trip 延迟不增加

### 模块覆盖
- 模块 9 claude_code Bridge 改造
- 模块 2 ApprovalRules（claude_code 24 规则 hardcode）
- 模块 3 GrantStore（claude_code in_memory backend）

### 关键风险
- R2: v2-inbox 回归 → PR 必须 100% 现有测试套
- R3: SDK can_use_tool sync 兼容 → 集成测覆盖完整 round-trip
- R1: 双轨期 contract 漂移 → 等价性测试

---

## Stage 3 · `smart-approval-manager-stage3-auto`

### 目标
ScheduleApprovalProvider + AutoAllowApproval 改 thin wrapper；rules 加 cron / evolution channel 默认 auto_allow。

### 核心交付
- `src/scheduler/runtime_factory.py` ScheduleApprovalProvider 改 thin wrapper
- `src/tools/approval.py` AutoAllowApproval 改 thin wrapper
- `src/safety/approval_rules.py` 注入 cron / evolution channel 默认（hardcode）

### DoD
- cron + evolution 现有测试必须**全过**
- scheduler per-task approval_mode（trust / fail_closed）保留语义
- 新增 unit `test_schedule_approval_thin_wrapper.py` + `test_auto_allow_thin_wrapper.py`

### 模块覆盖
- 模块 10 装配（scheduler + evolution）
- 模块 2 ApprovalRules（cron + evolution 通道 hardcode）

---

## Stage 4 · `smart-approval-manager-stage4-cli`

### 目标
CLIEventSink 收 manager 输出 → stdin/tty prompt → manager.resolve；CLI adapter 改装走 manager。

### 核心交付
- `src/safety/cli_event_sink.py`（CLIEventSink）
- `src/cli/main.py` 装配 manager + CLIEventSink
- `src/host/cli_adapter.py` adapter.prompt_approval 退役或改 thin wrapper

### DoD
- CLI 现有 e2e 测试必须**全过**
- 新增 unit `test_cli_event_sink.py`（mock stdin/tty）
- CLI 用户体感无差异（stdin prompt 三按钮 UX 不变）

### 模块覆盖
- 模块 6 CLIEventSink
- 模块 10 装配（cli/main.py）

---

## Stage 5 · `smart-approval-manager-stage5-finalize`

### 目标
散落超时逻辑收 manager；rules.yaml 完整 schema 落地；协议帧 v0.5 字段升级；docs/modules/安全 整体重写。

### 核心交付
- `src/safety/approval_manager.py` _handle_timeout 收所有通道超时
- 删 ApprovalBridge.wait_for / ScheduleApprovalProvider / WebHostAdapter._timeout 散落 timeout
- `src/safety/approval_rules.py` 从 rules.yaml 读（pydantic Config 校验）
- `kongming-rules.yaml`（项目根模板，完整 v0.5 schema）
- `src/config_loader/config.py` 加 ApprovalRulesConfig
- 删 `src/web/approvals/auto/default_rules.yaml`（迁到新 rules.yaml）
- broadcaster emit_add 加 v0.5 字段（autoDecisionAtMs / autoDecisionKind / severity / supportedActions / matchedRule）
- thread_status_ws resolve handler 兼容 v2-inbox + v0.5 双协议
- ApprovalToastCard 按 supportedActions 渲染按钮
- types.ts 加 v0.5 协议字段
- `docs/modules/安全/README.md` 重写 manager 章节
- `docs/modules/安全/approval-flow-current-state.html` 重画"目标"视图
- `bin/kongming-rules` 或 `make rules-validate` schema 校验工具

### DoD
- 全套回归：claude_code / generic_chat / cron / evolution / CLI 5 通道全过
- 协议帧 v0.5 backward compat：v2-inbox 老前端连 v0.5 服务端不崩
- 新增：unit `test_approval_rules_yaml.py` + integration `test_protocol_v0.5_backward_compat.py`
- 文档完整：README + 5 通道流程图 + protocol-evolution

### 模块覆盖
- 模块 1 ApprovalManager（_handle_timeout 完整）
- 模块 2 ApprovalRules（yaml schema 完整）
- 模块 7 ApprovalDecision 统一 DTO 完整字段
- 协议帧 v0.5 落地
- 文档收尾

### 关键风险
- R5: rules schema 跨通道命名冲突 → 校验工具 + 友好报错
- R6: 协议帧 v0.5 与 v2-inbox 兼容 → 兼容字段保留 + 前端 fallback

---

## 模块号 ↔ task 反查矩阵

（基于 [README.md#模块拆分](README.md) 中 10 个组件）

| 模块号 | 组件名 | 涉及 task |
|---|---|---|
| 1 | ApprovalManager | stage 1 (骨架) + stage 5 (timeout 完整) |
| 2 | ApprovalRules | stage 2 (claude_code 24) + stage 3 (cron/evolution) + stage 5 (yaml 完整) |
| 3 | GrantStore 统一 | stage 2 (claude_code 接入) |
| 4 | ApprovalEventSink Protocol | stage 1 (内部 Protocol) |
| 5 | InboxEventSink | stage 1 |
| 6 | CLIEventSink | stage 4 |
| 7 | ApprovalDecision 统一 DTO | stage 5 (v0.5 字段补全) |
| 8 | inbox_helpers | stage 1 |
| 9 | claude_code Bridge thin wrapper | stage 2 |
| 10 | 5 通道装配 | stage 1 (web) + stage 2 (claude_code) + stage 3 (scheduler+evolution) + stage 4 (cli) |

**双向覆盖检查**（✅ 表示有 task 覆盖）：
- 模块 1 ✅ ✅
- 模块 2 ✅ ✅ ✅
- 模块 3 ✅
- 模块 4 ✅
- 模块 5 ✅
- 模块 6 ✅
- 模块 7 ✅
- 模块 8 ✅
- 模块 9 ✅
- 模块 10 ✅ ✅ ✅ ✅

无 scope creep；无 DoD 漏实现。

---

## Spec 决策点 ↔ task 追溯

（基于 [README.md#关键决策点](README.md) 8 项决策）

| 决策 | 落地 task |
|---|---|
| 1. manager 在 safety 层 | stage 1 |
| 2. EventSink 阶段 1 内部 Protocol；阶段 5 重审 | stage 1 (建立) + stage 5 (重审) |
| 3. broadcaster DI 注入 | stage 1 (装配模式确立) |
| 4. ApprovalDecision 统一 DTO | stage 5 (v0.5 字段完整) |
| 5. allow_list → GrantStore in_memory backend | stage 2 |
| 6. rules schema per-channel + per-thread + per-cwd 三层 scope | stage 5 (yaml 完整) |
| 7. 协议帧 v0.5 演进 | stage 5 |
| 8. 中文 docstring 强制 | 所有 stage |

---

## 何时本 spec 标"已实施"

当以下条件全部满足：

- [ ] Stage 1 状态 = ✅
- [ ] Stage 2 状态 = ✅
- [ ] Stage 3 状态 = ✅
- [ ] Stage 4 状态 = ✅
- [ ] Stage 5 状态 = ✅
- [ ] `docs/modules/安全/README.md` 已重写完成
- [ ] `docs/modules/安全/approval-flow-current-state.html` 已重画"目标"视图
- [ ] 用户在 web chat / CLI 都验证过 5 通道审批正常工作

则把本 README.md 顶部 `Spec status` 改为 "已实施 ✅"。

---

## 阶段间状态报告（建议每阶段完成后更新）

| Phase | 开始时间 | 完成时间 | PR | 状态 | 备注 |
|---|---|---|---|---|---|
| 1 | - | - | - | ⏳ | 等 x-req |
| 2 | - | - | - | ⏳ | 等 stage 1 |
| 3 | - | - | - | ⏳ | 等 stage 1 |
| 4 | - | - | - | ⏳ | 等 stage 1 |
| 5 | - | - | - | ⏳ | 等 2/3/4 |

---

## 下一步行动

**当前**：本 spec 已写完；用户审本 spec 通过后：

1. `x-req smart-approval-manager-stage1` → 产 task 包到 `dev-pipeline/tasks/smart-approval-manager-stage1/`
2. `x-dev smart-approval-manager-stage1` → 执行开发 → 走 Gate
3. 阶段 1 ✅ 后并行启动 stage 2 / 3 / 4
4. 全完成后 stage 5 收尾
