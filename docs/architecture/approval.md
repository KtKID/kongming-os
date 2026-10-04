# Approval

> Approval 模块负责统一工具调用的危险识别、全局模式、thread permissions、用户决策、通道接入和审计边界。

## Spec 导航

| Spec | 状态 | 说明 |
|------|------|------|
| [Safety 三模式与 thread permissions v0.6](../spec/safety-approval-three-modes-v0.6/README.md) | 开发中（非 cron 主体完成） | DangerGuard → approval mode → thread permissions 三层链；allow/deny 按顶层 thread JSON 持久化。 |
| [cli-approval-manager](./cli-approval-manager/) | 历史基线 | CLI 接入 ApprovalManager 的早期设计；当前状态以 v0.6 spec 与安全模块 README 为准。 |
| [规则统一与通道收敛](../../openspec/changes/approval-rule-unification-channel-convergence/) | 历史基线 | v0.5 通道收敛背景；旧全局规则门户已由 v0.6 PermissionsManager 取代。 |

状态：探索中 / 方案确认 / 可进入 x-req / 开发中 / 已完成
