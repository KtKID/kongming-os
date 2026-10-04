# Task 映射

## 开发顺序

| Task | 优先级 | 范围 | 依赖 | 风险 | PoC 建议 |
|------|--------|------|------|------|----------|
| T1 shared-auto-approval-policy | P0 | 将 Web auto approval policy 下沉到 safety 共享层，更新 Web 引用 | 无 | 中 | 先跑 import 边界测试 |
| T2 approval-rules-cli-channel | P0 | `ApprovalRules.classify()` 支持 `channel="cli"` 自动允许、危险规则强制人审、ask | T1 | 中 | 用 fake policy 覆盖三态 |
| T3 cli-approval-event-sink | P0 | 新增 `CLIApprovalEventSink`，终端输入回填 `manager.resolve()` | T2 | 中 | 用 monkeypatch reader 单测 |
| T4 cli-runtime-wiring | P0 | 提前解析 CLI session id，装配 `ApprovalManager` 和 `make_manager_prompt_fn(channel="cli")` | T3 | 中 | 用 e2e stub tool 验证 |
| T5 validation-and-regression | P1 | 补单元测试、CLI e2e、Web 回归 | T1-T4 | 低 | 复跑 approval 相关 pytest |
| T6 docs-and-followup | P2 | 更新模块文档和后续 audit/rules schema 事项 | T5 | 低 | 无 |

## Task 拆分建议

首个 x-req 建议命名：

```text
cli-approval-manager-v0.1
```

范围包含 T1-T5。T6 可并入收尾，也可留到后续文档 task。

## 组件到 task 映射

| 组件 | Task |
|------|------|
| Shared Auto Approval Policy | T1 |
| ApprovalRules CLI Channel | T2 |
| CLIApprovalEventSink | T3 |
| CLI Runtime Wiring | T4 |
| Validation Suite | T5 |

## DoD 到 task 映射

| DoD | Task |
|-----|------|
| CLI 进入 manager | T4 |
| 自动允许 | T1 + T2 + T5 |
| 危险规则强制人审 | T1 + T2 + T3 + T5 |
| 默认用户审批 | T3 + T5 |
| CLI session grant no-op | T3 + T4 + T5 |
| Web 回归稳定 | T1 + T5 |

## 当前建议

T1 是阻塞 task，T2-T4 可以在 T1 完成后顺序推进。整个 spec 已可进入 x-req。
