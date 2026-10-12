---
description: 当前 KMH 插件规格、实施记录和待评审方案的入口，按各规格声明的范围与状态使用。
---

# Spec 索引

当前插件的使用方法与限制见各包 README；本索引列出现行规格、任务记录和待评审方案。规格中的验收目标按对应任务核对实际实现。

| Spec | 状态 | 说明 |
| --- | --- | --- |
| [kmh-mobile-butler-v0.1](./kmh-mobile-butler-v0.1/spec.md) | 待评审 | 移动端管家统一委派给 Codex 或 ZCode，遵循用户选择并接收执行报告 |
| [Codex CLI provider](codex-cli-provider/spec.md) | 现行规格 | 提示与工具接入、原生能力、审批、进度与产物验收；使用方法见[包说明](../../packages/codex-cli/README.md) |
| [ZCode CLI provider](zcode-cli-provider/spec.md) | 现行规格 | 模型接入、登录与验证；使用方法见[包说明](../../packages/zcode-cli/README.md) |
| [模型请求停止与状态监督](kmh-zcode-cli-request-supervision/spec.md) | 规格与实施记录 | 请求状态、停止确认、挂起与证据，按[开发记录](kmh-zcode-cli-request-supervision/tasks/task-request-state/dev-report.md)核对交付范围 |
| [KMH SDK 审批桥接](kmh-sdk-approval/spec.md) | 待评审 | SDK 客户端审批与 KMH 维护归属 |
| [Agent OS 第一版服务接入](agent-os-v1/README.md) | 待评审 | 服务适配插件、统一入口与长期愿景，按文中已确认方向和待评审设计分别使用 |
