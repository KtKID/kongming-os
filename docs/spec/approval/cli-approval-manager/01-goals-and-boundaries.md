# 目标与边界

## 背景

现有审批体系已经有两条成熟路径：

- CLI：`src/hosts/cli/main.py` 在 interactive 模式下装配 `ApprovalManager + CLIApprovalEventSink`。
- Web generic：`src/hosts/web/run.py` 使用 `ApprovalManager + make_manager_prompt_fn`，并通过 `ApprovalRules` 连接自动审批 policy。

CLI 接入 manager 后，审批能力会集中到同一条规则和 pending 模型上。自动允许命中时直接返回通过；危险规则命中时进入强制人审，并由用户拒绝或超时拒绝阻断；规则未命中自动结果时继续让用户在终端确认。

## 目标

- CLI 复用 `ApprovalManager.request()`。
- CLI 复用自动审批规则。
- CLI 保留终端用户审批体验。
- Web generic 行为保持稳定。
- 自动审批 policy 从 Web 边界下沉到 safety 共享层。
- 新增能力遵守 `core.contracts` 单一协议真源和 core 零 sibling 依赖约束。

## 完成标准

| DoD | 验收方式 | 需要模块 | 需要 task |
|-----|----------|----------|-----------|
| CLI interactive approval 进入 `ApprovalManager.request(channel="cli")` | CLI e2e 断言 manager request 被调用 | CLI Runtime Wiring | T4 |
| CLI 自动允许命中规则后直接允许工具执行 | 单元测试 + CLI e2e | Shared Auto Approval Policy + ApprovalRules CLI Channel | T1 + T2 + T5 |
| CLI 危险规则命中后强制人审，用户拒绝或超时后阻断工具执行 | 单元测试 + CLI e2e | Shared Auto Approval Policy + ApprovalRules CLI Channel + CLIApprovalEventSink | T1 + T2 + T3 + T5 |
| CLI 规则未命中自动结果时继续提示用户 | CLI sink 单测 + CLI e2e | CLIApprovalEventSink | T3 + T5 |
| CLI 只支持一次允许 / 拒绝，不写 session grant | 单元测试 + CLI e2e | CLIApprovalEventSink + CLI Runtime Wiring + ApprovalRules no-op guard | T3 + T4 + T5 |
| CLI 不 import `web.approvals.auto` | import-linter 或单元测试检查 | Shared Auto Approval Policy | T1 + T5 |
| Web generic 现有自动审批行为稳定 | Web 现有 approval tests 复跑 | Shared Auto Approval Policy | T1 + T5 |

## 包含范围

- 共享 policy 迁移路径。
- `ApprovalRules.classify(channel="cli")` 行为。
- CLI pending 展示和 stdin 决策回填。
- CLI runtime 装配点改造。
- CLI `session_id` 提前解析，并复用给 manager prompt_fn 与 `SessionBridge`。
- 测试策略和演进路径。

## 排除范围

- Web UI 设计调整。
- 跨进程持久化 grant。
- rules.yaml v2 schema。
- cron/evolution/claude_code 迁移。
- Runner tool call 执行逻辑调整。

## 关键约束

- `src/core/` 继续只依赖 core 内部协议。
- `src/tools/` 继续通过 `ApprovalProvider` 抽象接入审批。
- `src/hosts/cli/` 避免直接 import `src/hosts/web/`。
- 自动审批规则的真源放到 `src/safety/` 或更合适的共享层。
- `ApprovalManager` 是进程单例；CLI sink 注入必须走幂等注册策略。
- 验证代码必须落在 `tests/` 下，用 pytest 重复运行。

## 追溯矩阵

| DoD 条目 | 需要哪些模块 | 需要哪些 task |
|---------|------------|-------------|
| CLI 进入 manager | CLI Runtime Wiring | T4 |
| 自动允许 | Shared Auto Approval Policy + ApprovalRules CLI Channel | T1 + T2 |
| 危险规则强制人审 | Shared Auto Approval Policy + ApprovalRules CLI Channel + CLIApprovalEventSink | T1 + T2 + T3 |
| 默认用户审批 | CLIApprovalEventSink | T3 |
| CLI session grant no-op | CLIApprovalEventSink + CLI Runtime Wiring + ApprovalRules no-op guard | T3 + T4 |
| 边界清晰 | Shared Auto Approval Policy + Validation Suite | T1 + T5 |
| Web 稳定 | Shared Auto Approval Policy + Validation Suite | T1 + T5 |

## 当前结论

本 spec 已完成实现。当前 CLI 侧边界是共享规则和 pending 模型复用，终端 UI 只暴露一次允许 / 拒绝；Web/generic_chat 继续承接本会话同意语义。
