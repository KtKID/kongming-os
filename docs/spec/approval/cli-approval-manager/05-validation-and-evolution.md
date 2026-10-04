# 验证策略与演进

## 验证原则

- 所有验证写入 `tests/` 下的 pytest 文件。
- 覆盖规则层、manager 层、CLI sink 层、CLI 装配层。
- Web generic 现有行为作为回归基线。
- 终端 stdin 交互用可注入 reader 或 monkeypatch 模拟。

## 单元测试

### ApprovalRules

目标文件：

- `tests/unit/safety/test_approval_rules_cli.py`

覆盖：

- `channel="cli"` 命中 auto allow。
- `channel="cli"` 命中危险规则后进入强制人审。
- `channel="cli"` 未命中自动结果返回 ask。
- policy 抛异常时返回 ask。
- CLI session grant 写入为 no-op；后续同 session/cwd/tool 仍按共享规则和人工审批路径判定。
- `generic_chat` 现有测试保持通过。

### CLIApprovalEventSink

目标文件：

- `tests/unit/cli/test_cli_approval_event_sink.py`

覆盖：

- 输入 `y` 调 `manager.resolve(... allow=True)`。
- 输入空、`n`、EOF、KeyboardInterrupt 调 reject。
- `emit_approval_removed` 输出或静默行为稳定。
- sink 异常不污染 manager 主流程。

### Shared Policy Import Boundary

目标文件：

- `tests/unit/safety/test_auto_approval_import_boundary.py`

覆盖：

- `src/cli` 不引用 `web.approvals.auto`。
- `src/hosts/web/approvals/auto` 可以薄封装或 re-export safety policy。
- `ApprovalRules` 只依赖共享 policy Protocol。

## E2E 测试

目标文件：

- `tests/e2e/test_cli_approval_manager.py`

覆盖：

- CLI tool call 自动允许后工具执行。
- CLI tool call 命中危险规则后强制人审，用户拒绝或超时后工具阻断。
- CLI ask 路径用户输入 `y` 后工具执行。
- CLI ask 路径用户输入 `n` 后工具拒绝。
- CLI 不提供 session grant 入口；重复同类调用仍会经过共享规则和终端审批路径。

## 回归测试

建议复跑：

```bash
uv run pytest tests/unit/safety/test_approval_rules.py -q
uv run pytest tests/unit/safety/test_approval_manager.py -q
uv run pytest tests/unit/safety/test_inbox_event_sink.py -q
uv run pytest tests/e2e/test_approval_ask.py -q
```

如 Web generic 有专门 approval inbox e2e，可在本 task 的 verify 阶段补跑。

## 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| CLI 直接 import Web policy 导致边界污染 | 高 | policy 下沉到 safety，共享层提供构造函数 |
| manager 无 CLI sink 时 ask 路径等待 timeout | 高 | CLI 装配测试断言 event_sinks 非空 |
| stdin 阻塞事件循环 | 中 | 继续用 `asyncio.to_thread` |
| Web generic 引用路径迁移破坏 | 中 | 更新所有引用并复跑测试 |
| CLI session id 生成时机晚于 approval 装配 | 高 | 在 CLI 装配阶段提前解析 session id，并复用给 prompt_fn 与 SessionBridge |
| ApprovalManager 单例忽略后续 event_sinks 入参 | 中 | CLI sink 使用 `register_event_sink()` 幂等注册，测试使用 `reset_for_testing()` |
| 危险规则与 SafetyGatedApproval hard block 语义重叠 | 中 | hard block 优先，manager 规则负责剩余强制人审判定 |

## 演进路线

1. v0.1：CLI 接入 manager + 共享 policy + 危险规则强制人审。
2. v0.2：审批审计 sink 接入 manager。
3. v0.3：rules schema 支持 per-channel 配置。
4. v0.4：persistent grant。
5. v0.5：claude_code / cron / evolution 继续迁入 manager。

## 当前建议

本 spec 已完成实现。当前建议保持 CLI 两选项边界，后续如需本会话同意，应先扩展 manager 协议和 CLI UX 设计。
